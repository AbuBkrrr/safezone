package com.collapse.safelinks;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;

public class MainActivity extends BridgeActivity {
    private static final int REQ = 42;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DtnPlugin.class);
        super.onCreate(savedInstanceState);
        requestNeededPermissions();
        RelayService.Companion.start(this);
    }

    /** Asks once, on first launch, for everything the relay needs. The user can refuse any of them. */
    private void requestNeededPermissions() {
        ArrayList<String> want = new ArrayList<>();
        want.add(Manifest.permission.ACCESS_FINE_LOCATION);
        want.add(Manifest.permission.CAMERA);
        want.add(Manifest.permission.RECORD_AUDIO);
        if (Build.VERSION.SDK_INT >= 31) {
            want.add(Manifest.permission.BLUETOOTH_SCAN);
            want.add(Manifest.permission.BLUETOOTH_ADVERTISE);
            want.add(Manifest.permission.BLUETOOTH_CONNECT);
        }
        if (Build.VERSION.SDK_INT >= 33) {
            want.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        ArrayList<String> missing = new ArrayList<>();
        for (String p : want) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
        }
        if (!missing.isEmpty()) ActivityCompat.requestPermissions(this, missing.toArray(new String[0]), REQ);
    }
}
