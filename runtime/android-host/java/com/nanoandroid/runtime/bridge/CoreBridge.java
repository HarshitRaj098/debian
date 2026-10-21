package com.nanoandroid.runtime.bridge;

import android.app.Activity;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

public class CoreBridge {
    private Activity activity;

    public CoreBridge(Activity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public void toast(String message) {
        activity.runOnUiThread(() -> Toast.makeText(activity, message, Toast.LENGTH_SHORT).show());
    }

    @JavascriptInterface
    public void exit() {
        activity.runOnUiThread(() -> activity.finish());
    }
}
