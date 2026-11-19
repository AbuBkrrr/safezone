@file:Suppress("DEPRECATION", "MissingPermission")

package com.collapse.safelinks.transport

import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.content.Context
import com.collapse.safelinks.sync.SyncProtocol
import java.io.DataInputStream
import java.io.DataOutputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Bulk sync over Bluetooth LE GATT. No Wi-Fi, no hotspot, no internet, and no accept prompt:
 * the connection needs only the Bluetooth permissions the user grants at first launch.
 * Every phone runs a GATT server. The phone with the lower id connects as client, so two phones
 * never open two sessions. One session at a time. Writes go to RX, notifications come from TX.
 * Throughput is tens of KB/s, enough for messages and packs; it is not for video.
 */
class GattSync(
    private val ctx: Context,
    private val runSync: (DataInputStream, DataOutputStream) -> SyncProtocol.SyncResult,
    private val onDone: (SyncProtocol.SyncResult) -> Unit,
) {
    companion object {
        val SERVICE: UUID = UUID.fromString("0000fcf2-0000-1000-8000-00805f9b34fb")
        val RX: UUID = UUID.fromString("0000fcf3-0000-1000-8000-00805f9b34fb")
        val TX: UUID = UUID.fromString("0000fcf4-0000-1000-8000-00805f9b34fb")
        val CCC: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        private const val TIMEOUT_S = 8L
        private const val MIN_CHUNK = 20

        /** True when this phone should open the connection, so only one side does. */
        fun initiates(myShortId: ByteArray, peerShortId: ByteArray): Boolean {
            for (i in myShortId.indices) {
                val a = myShortId[i].toInt() and 0xff
                val b = peerShortId[i].toInt() and 0xff
                if (a != b) return a < b
            }
            return false
        }
    }

    private class Session(val device: BluetoothDevice) {
        val inQ = ByteQueue()
        val outQ = ByteQueue()
        val sent = Semaphore(0)
        val written = Semaphore(0)
        @Volatile var writeOk = false
        @Volatile var mtu = 23
        var gatt: BluetoothGatt? = null
        lateinit var send: (ByteArray) -> Boolean
    }

    private val bt = ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val busy = AtomicBoolean(false)
    private val lastAttempt = ConcurrentHashMap<String, Long>()
    private var server: BluetoothGattServer? = null
    @Volatile private var session: Session? = null

    private fun sessionFor(device: BluetoothDevice): Session? = session?.takeIf { it.device.address == device.address }

    /** Opens the GATT server so other phones can sync with this one. */
    fun startServer() {
        if (server != null) return
        val cb = object : BluetoothGattServerCallback() {
            override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
                if (newState == BluetoothProfile.STATE_DISCONNECTED) sessionFor(device)?.inQ?.close()
            }

            override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
                sessionFor(device)?.mtu = mtu
            }

            override fun onCharacteristicWriteRequest(
                device: BluetoothDevice, requestId: Int, ch: BluetoothGattCharacteristic,
                preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray,
            ) {
                if (ch.uuid == RX) sessionFor(device)?.inQ?.put(value.copyOf())
                if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }

            override fun onDescriptorWriteRequest(
                device: BluetoothDevice, requestId: Int, desc: BluetoothGattDescriptor,
                preparedWrite: Boolean, responseNeeded: Boolean, offset: Int, value: ByteArray,
            ) {
                if (desc.uuid == CCC && value.isNotEmpty() && value[0] != 0.toByte()) acceptSession(device)
                if (responseNeeded) server?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            }

            override fun onNotificationSent(device: BluetoothDevice, status: Int) {
                sessionFor(device)?.sent?.release()
            }
        }
        val gs = bt.openGattServer(ctx, cb) ?: return
        server = gs
        val svc = BluetoothGattService(SERVICE, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        svc.addCharacteristic(BluetoothGattCharacteristic(RX,
            BluetoothGattCharacteristic.PROPERTY_WRITE, BluetoothGattCharacteristic.PERMISSION_WRITE))
        val tx = BluetoothGattCharacteristic(TX,
            BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_READ,
            BluetoothGattCharacteristic.PERMISSION_READ)
        tx.addDescriptor(BluetoothGattDescriptor(CCC, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE))
        svc.addCharacteristic(tx)
        gs.addService(svc)
    }

    private fun acceptSession(device: BluetoothDevice) {
        if (!busy.compareAndSet(false, true)) return
        val s = Session(device)
        s.send = { bytes -> notifyChunk(s, bytes) }
        session = s
        start(s) { server?.cancelConnection(device) }
    }

    private fun notifyChunk(s: Session, bytes: ByteArray): Boolean {
        val gs = server ?: return false
        val tx = gs.getService(SERVICE)?.getCharacteristic(TX) ?: return false
        tx.value = bytes
        return gs.notifyCharacteristicChanged(s.device, tx, false) && s.sent.tryAcquire(TIMEOUT_S, TimeUnit.SECONDS)
    }

    /** Client role: connect to a peer seen over BLE advertising. Ignored if a session is running or recently tried. */
    fun connectTo(device: BluetoothDevice, now: Long) {
        val last = lastAttempt[device.address] ?: 0L
        if (now - last < 60_000L) return
        if (!busy.compareAndSet(false, true)) return
        lastAttempt[device.address] = now
        val s = Session(device)
        s.send = { bytes -> writeChunk(s, bytes) }
        session = s
        val cb = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                when (newState) {
                    BluetoothProfile.STATE_CONNECTED -> gatt.requestMtu(517)
                    BluetoothProfile.STATE_DISCONNECTED -> { s.inQ.close(); gatt.close() }
                }
            }

            override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
                s.mtu = mtu
                gatt.discoverServices()
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                val tx = gatt.getService(SERVICE)?.getCharacteristic(TX)
                if (tx == null) { gatt.disconnect(); return }
                gatt.setCharacteristicNotification(tx, true)
                val d = tx.getDescriptor(CCC)
                d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                gatt.writeDescriptor(d)
            }

            override fun onDescriptorWrite(gatt: BluetoothGatt, desc: BluetoothGattDescriptor, status: Int) {
                if (desc.uuid == CCC && status == BluetoothGatt.GATT_SUCCESS) start(s) { gatt.disconnect() }
                else gatt.disconnect()
            }

            override fun onCharacteristicChanged(gatt: BluetoothGatt, ch: BluetoothGattCharacteristic) {
                if (ch.uuid == TX) s.inQ.put(ch.value.copyOf())
            }

            override fun onCharacteristicWrite(gatt: BluetoothGatt, ch: BluetoothGattCharacteristic, status: Int) {
                s.writeOk = status == BluetoothGatt.GATT_SUCCESS
                s.written.release()
            }
        }
        s.gatt = device.connectGatt(ctx, false, cb, BluetoothDevice.TRANSPORT_LE)
    }

    private fun writeChunk(s: Session, bytes: ByteArray): Boolean {
        val g = s.gatt ?: return false
        val rx = g.getService(SERVICE)?.getCharacteristic(RX) ?: return false
        rx.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        rx.value = bytes
        return g.writeCharacteristic(rx) && s.written.tryAcquire(TIMEOUT_S, TimeUnit.SECONDS) && s.writeOk
    }

    /** Runs the sync on a worker thread: reads from inQ, writes to outQ, and a writer sends outQ in chunks. */
    private fun start(s: Session, close: () -> Unit) {
        Thread {
            val writer = Thread {
                while (true) {
                    val chunk = s.outQ.take() ?: break
                    val step = maxOf(MIN_CHUNK, s.mtu - 3)
                    var off = 0
                    var failed = false
                    while (off < chunk.size && !failed) {
                        val end = minOf(chunk.size, off + step)
                        failed = !s.send(chunk.copyOfRange(off, end))
                        off = end
                    }
                    if (failed) break
                }
            }
            writer.start()
            try {
                val r = runSync(DataInputStream(s.inQ.input), DataOutputStream(s.outQ.output))
                onDone(r)
            } catch (_: Exception) {
                // A failed session is retried on the next sighting.
            } finally {
                s.outQ.close()
                s.inQ.close()
                writer.join(5000)
                close()
                session = null
                busy.set(false)
            }
        }.start()
    }

    fun stop() {
        server?.close()
        server = null
    }
}
