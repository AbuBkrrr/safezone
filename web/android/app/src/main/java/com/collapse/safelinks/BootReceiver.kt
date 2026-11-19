package com.collapse.safelinks

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Restarts the relay after the phone reboots, so carrying messages does not depend on opening the app. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) RelayService.start(context)
    }
}
