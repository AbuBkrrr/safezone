package com.collapse.safelinks

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import com.collapse.safelinks.content.Packs
import com.collapse.safelinks.content.Trust
import com.collapse.safelinks.dtn.*
import com.collapse.safelinks.sync.Node
import com.collapse.safelinks.sync.SyncProtocol
import com.collapse.safelinks.transport.BleBeacon
import com.collapse.safelinks.transport.GattSync
import kotlinx.serialization.json.*

/**
 * Foreground relay: BLE presence, GATT sync, and the message store, running with the app closed.
 * A persistent notification makes relaying visible to the user at all times.
 */
class RelayService : Service() {
    companion object {
        private const val CHANNEL = "relay"
        private const val NOTE_ID = 1

        @Volatile private var node: Node? = null
        @Volatile private var storage: Storage? = null

        fun start(ctx: Context) {
            val i = Intent(ctx, RelayService::class.java)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }

        fun address(ctx: Context): String = Storage(ctx.filesDir).identity().address

        /** Composes an encrypted message and queues it for the network. */
        fun send(to: String, text: String): String {
            val n = node ?: throw IllegalStateException("relay is starting, try again")
            synchronized(n) {
                val b = makeBundle(n.identity, to, "msg", buildJsonObject { put("text", text) }, System.currentTimeMillis() / 1000, 72 * 3600)
                n.store.bundles[b.id] = b
                n.save(n.store)
                return b.id
            }
        }

        fun inbox(): JsonArray {
            val n = node ?: return JsonArray(emptyList())
            synchronized(n) { return JsonArray(n.store.inbox.map { it.toJson() }) }
        }

        fun packVersion(): Int = node?.packVersion ?: (storage?.loadPack()?.first ?: 0)
        fun packJson(): JsonObject? = storage?.loadPack()?.second
    }

    private var gatt: GattSync? = null
    private var ble: BleBeacon? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val st = Storage(filesDir)
        storage = st
        val (pv, _) = st.loadPack()
        val trust = Trust { st.loadKeyring() }
        val n = Node(
            identity = st.identity(),
            store = st.loadStore(),
            trust = { trust.current() },
            packVersion = pv,
            keyringVersion = trust.version(),
            onPack = { v, pack -> st.savePack(v, pack) },
            onKeyring = { v, keys -> st.saveKeyring(v, keys) },
            save = { st.saveStore(it) },
        )
        node = n
        gatt = GattSync(
            this,
            runSync = { i, o -> synchronized(n) { SyncProtocol.run(i, o, n, System.currentTimeMillis() / 1000) } },
            onDone = { },
        )
        val myShort = n.identity.signPub.copyOf(8)
        ble = BleBeacon(this, myShort) { peer, device ->
            if (GattSync.initiates(myShort, peer)) gatt?.connectTo(device, System.currentTimeMillis())
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createChannel()
        startForeground(NOTE_ID, notification())
        gatt?.startServer()
        ble?.start()
        return START_STICKY
    }

    override fun onDestroy() {
        ble?.stop()
        gatt?.stop()
        super.onDestroy()
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val ch = NotificationChannel(CHANNEL, "Relay", NotificationManager.IMPORTANCE_LOW)
        ch.description = "Carries messages for nearby players while the app is closed"
        getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
    }

    private fun notification(): Notification =
        NotificationCompat.Builder(this, CHANNEL)
            .setContentTitle("The Collapse is relaying")
            .setContentText("Carrying messages for nearby players. Turn off in the app.")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .build()
}
