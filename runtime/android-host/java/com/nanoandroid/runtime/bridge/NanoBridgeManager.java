package com.nanoandroid.runtime.bridge;

import android.app.Activity;
import android.webkit.WebView;
import java.util.HashMap;
import java.util.Map;

public class NanoBridgeManager {
    private Map<String, Object> registeredBridges = new HashMap<>();

    public NanoBridgeManager(Activity activity, WebView webView) {
        // Core is always loaded
        registeredBridges.put("Core", new CoreBridge(activity));
        // Lazy loaded on demand: Vibrate, Storage, etc.
    }

    public void registerBridge(String name, Object bridge) {
        registeredBridges.put(name, bridge);
    }

    public Object getBridge(String name) {
        return registeredBridges.get(name);
    }
}
