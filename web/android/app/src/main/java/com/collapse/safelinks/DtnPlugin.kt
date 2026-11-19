package com.collapse.safelinks

import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Bridge for the web UI: address, messages, inbox, pack status, and starting the relay. */
@CapacitorPlugin(name = "Dtn")
class DtnPlugin : Plugin() {

    @PluginMethod
    fun address(call: PluginCall) {
        call.resolve(JSObject().put("address", RelayService.address(context)))
    }

    @PluginMethod
    fun startRelay(call: PluginCall) {
        RelayService.start(context)
        call.resolve()
    }

    @PluginMethod
    fun send(call: PluginCall) {
        val to = call.getString("to") ?: return call.reject("missing to")
        val text = call.getString("text") ?: return call.reject("missing text")
        if (to.length != 128 || !to.all { it in '0'..'9' || it in 'a'..'f' }) return call.reject("address must be 128 hex characters")
        if (text.isBlank() || text.length > 500) return call.reject("message must be 1 to 500 characters")
        try {
            call.resolve(JSObject().put("id", RelayService.send(to, text)))
        } catch (e: Exception) {
            call.reject(e.message ?: "send failed")
        }
    }

    @PluginMethod
    fun inbox(call: PluginCall) {
        call.resolve(JSObject().put("items", JSArray(RelayService.inbox().map { it.toString() })))
    }

    @PluginMethod
    fun pack(call: PluginCall) {
        val pack = RelayService.packJson()
        call.resolve(JSObject().put("version", RelayService.packVersion()).put("pack", pack?.toString()))
    }
}
