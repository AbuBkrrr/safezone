package com.collapse.safelinks.transport

import android.bluetooth.BluetoothManager
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.ParcelUuid
import com.collapse.safelinks.dtn.hex

/**
 * Bluetooth LE presence beacon. Each phone advertises a short id (8 bytes of its address hash)
 * under a 16-bit service UUID, and listens for others. A sighting triggers a Wi-Fi Direct sync,
 * because BLE is too slow and too small for bulk data. Advertising fits the 31-byte limit.
 */
class BleBeacon(
    private val ctx: Context,
    private val myId: ByteArray,
    private val onPeerNearby: (peerId: String) -> Unit,
) {
    companion object {
        val SERVICE: ParcelUuid = ParcelUuid.fromString("0000FCF1-0000-1000-8000-00805F9B34FB")
    }

    private val adapter = (ctx.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
    private var advertiseCb: AdvertiseCallback? = null
    private var scanCb: ScanCallback? = null

    @Suppress("MissingPermission")
    fun start() {
        if (adapter == null || !adapter.isEnabled) return
        val short = myId.copyOf(8)
        val settings = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_POWER)
            .setConnectable(false)
            .build()
        val data = AdvertiseData.Builder()
            .addServiceUuid(SERVICE)
            .addServiceData(SERVICE, short)
            .setIncludeDeviceName(false)
            .build()
        val acb = object : AdvertiseCallback() {}
        advertiseCb = acb
        adapter.bluetoothLeAdvertiser?.startAdvertising(settings, data, acb)

        val filter = ScanFilter.Builder().setServiceUuid(SERVICE).build()
        val scanSettings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_POWER).build()
        val scb = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val id = result.scanRecord?.getServiceData(SERVICE) ?: return
                if (id.contentEquals(short)) return
                onPeerNearby(hex(id))
            }
        }
        scanCb = scb
        adapter.bluetoothLeScanner?.startScan(listOf(filter), scanSettings, scb)
    }

    @Suppress("MissingPermission")
    fun stop() {
        advertiseCb?.let { adapter?.bluetoothLeAdvertiser?.stopAdvertising(it) }
        scanCb?.let { adapter?.bluetoothLeScanner?.stopScan(it) }
        advertiseCb = null
        scanCb = null
    }
}
