package com.collapse.safelinks

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import com.collapse.safelinks.dtn.*
import com.collapse.safelinks.sync.Node
import com.collapse.safelinks.sync.SyncProtocol
import com.collapse.safelinks.transport.BleBeacon
import com.collapse.safelinks.transport.WifiDirectSync
import kotlinx.serialization.json.*
import java.util.concurrent.ConcurrentHashMap

/**
 * Foreground relay: keeps BLE presence and Wi-Fi Direct sync running with the app closed.
 * Shows a persistent notification, so relaying is always visible to the user.
 */
class RelayService : Service() {
    companion object {
        private const val CHANNEL = "relay"
        private const val NOTE_ID = 1
        private const val DISCOVER_EVERY_MS = 5 * 60_000L
        private const val MIN_GAP_MS = 60_000L

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
            synchronized(n) {
                return JsonArray(n.store.inbox.map { it.toJson() })
            }
        }

        fun packVersion(): Int = node?.packVersion ?: (storage?.loadPack()?.first ?: 0)
        fun packJson(): JsonObject? = storage?.loadPack()?.second
    }

    private val lastSync = ConcurrentHashMap<String, Long>()
    private var lastDiscover = 0L
    private val handler = Handler(Looper.getMainLooper())
    private var wifi: WifiDirectSync? = null
    private var ble: BleBeacon? = null
    private val periodic = object : Runnable {
        override fun run() {
            wifi?.discover()
            handler.postDelayed(this, DISCOVER_EVERY_MS)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val st = Storage(filesDir)
        storage = st
        val (ver, _) = st.loadPack()
        val n = Node(
            identity = st.identity(),
            store = st.loadStore(),
            maintainerPub = Content.MAINTAINER_PUB,
            baseIds = Content.BASE_IDS,
            packVersion = ver,
            onPack = { v, pack -> st.savePack(v, pack) },
            save = { st.saveStore(it) },
        )
        node = n
        wifi = WifiDirectSync(
            this,
            runSession = { i, o -> synchronized(n) { SyncProtocol.run(i, o, n, System.currentTimeMillis() / 1000) } },
            onDone = { r -> lastSync[r.peerAddr] = System.currentTimeMillis() },
        )
        ble = BleBeacon(this, n.identity.signPub) { _ -> maybeDiscover() }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        createChannel()
        startForeground(NOTE_ID, notification())
        wifi?.start()
        ble?.start()
        handler.removeCallbacks(periodic)
        handler.postDelayed(periodic, DISCOVER_EVERY_MS)
        return START_STICKY
    }

    private fun maybeDiscover() {
        val now = System.currentTimeMillis()
        if (now - lastDiscover < MIN_GAP_MS) return
        lastDiscover = now
        wifi?.discover()
    }

    override fun onDestroy() {
        handler.removeCallbacks(periodic)
        ble?.stop()
        wifi?.stop()
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
