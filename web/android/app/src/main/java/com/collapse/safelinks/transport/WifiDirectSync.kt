package com.collapse.safelinks.transport

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pDevice
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceInfo
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceRequest
import android.net.wifi.p2p.WifiP2pManager
import android.os.Build
import android.os.Looper
import androidx.core.app.ActivityCompat
import com.collapse.safelinks.sync.SyncProtocol
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Bulk data over Wi-Fi Direct. Phones find each other with DNS-SD (service "_collapse._tcp"),
 * form a group with no router or internet, then sync over a TCP socket on the group.
 * One session at a time. Android may ask the other phone to accept the connection.
 */
class WifiDirectSync(
    private val ctx: Context,
    private val runSession: (DataInputStream, DataOutputStream) -> SyncProtocol.SyncResult,
    private val onDone: (SyncProtocol.SyncResult) -> Unit,
) {
    companion object {
        const val PORT = 8766
        const val SERVICE = "collapse"
    }

    private val manager = ctx.getSystemService(Context.WIFI_P2P_SERVICE) as WifiP2pManager
    private val channel = manager.initialize(ctx, Looper.getMainLooper(), null)
    private val busy = AtomicBoolean(false)
    @Volatile private var receiver: BroadcastReceiver? = null

    fun hasPermission(): Boolean {
        val perm = if (Build.VERSION.SDK_INT >= 33) "android.permission.NEARBY_WIFI_DEVICES" else Manifest.permission.ACCESS_FINE_LOCATION
        return ActivityCompat.checkSelfPermission(ctx, perm) == PackageManager.PERMISSION_GRANTED
    }

    /** Advertise this device and look for other devices running the app. */
    @Suppress("MissingPermission")
    fun start() {
        if (!hasPermission()) return
        val rx = object : BroadcastReceiver() {
            override fun onReceive(c: Context, i: Intent) {
                if (i.action == WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION) {
                    manager.requestConnectionInfo(channel) { info ->
                        if (info.groupFormed && busy.compareAndSet(false, true)) Thread { session(info.isGroupOwner, info.groupOwnerAddress?.hostAddress) }.start()
                    }
                }
            }
        }
        ctx.registerReceiver(rx, IntentFilter(WifiP2pManager.WIFI_P2P_CONNECTION_CHANGED_ACTION))
        receiver = rx

        val record = mapOf("app" to SERVICE)
        val info = WifiP2pDnsSdServiceInfo.newInstance(SERVICE, "_collapse._tcp", record)
        manager.addLocalService(channel, info, null)
        manager.setDnsSdResponseListeners(channel,
            { _, _, _ -> },
            { _, txt, device -> if (txt["app"] == SERVICE) connect(device) },
        )
        manager.addServiceRequest(channel, WifiP2pDnsSdServiceRequest.newInstance(), null)
        discover()
    }

    @Suppress("MissingPermission")
    fun discover() {
        if (!hasPermission()) return
        manager.discoverServices(channel, null)
    }

    @Suppress("MissingPermission")
    private fun connect(device: WifiP2pDevice) {
        if (busy.get()) return
        val cfg = WifiP2pConfig().apply { deviceAddress = device.deviceAddress }
        manager.connect(channel, cfg, null)
    }

    /** Runs one sync over the formed group. The group owner listens; the client connects to it. */
    private fun session(isOwner: Boolean, ownerAddr: String?) {
        try {
            if (isOwner) {
                ServerSocket(PORT).use { server ->
                    server.soTimeout = 60_000
                    server.accept().use { sock -> sync(sock) }
                }
            } else if (ownerAddr != null) {
                val sock = Socket()
                sock.connect(InetSocketAddress(ownerAddr, PORT), 10_000)
                sock.use { sync(it) }
            }
        } catch (_: Exception) {
            // A failed session is retried on the next discovery cycle.
        } finally {
            manager.removeGroup(channel, null)
            busy.set(false)
        }
    }

    private fun sync(sock: Socket) {
        sock.soTimeout = 60_000
        val input = DataInputStream(BufferedInputStream(sock.getInputStream()))
        val output = DataOutputStream(BufferedOutputStream(sock.getOutputStream()))
        onDone(runSession(input, output))
    }

    fun stop() {
        receiver?.let { ctx.unregisterReceiver(it) }
        receiver = null
        manager.clearLocalServices(channel, null)
        manager.clearServiceRequests(channel, null)
    }
}
