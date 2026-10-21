package com.nanoandroid.host;

import android.content.Context;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

public class NanoBridge {
    private Context context;

    public NanoBridge(Context context) {
        this.context = context;
    }

    @JavascriptInterface
    public void toast(String message) {
        Toast.makeText(context, message, Toast.LENGTH_SHORT).show();
    }
    
    // Future Capability APIs will be added here
}
