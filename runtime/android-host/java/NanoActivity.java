package com.nanoandroid.host;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebSettings;

public class NanoActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        
        // Register Capability Bridge
        webView.addJavascriptInterface(new NanoBridge(this), "NanoBridge");
        
        // Load the injected index.html
        webView.loadUrl("file:///android_asset/index.html");
        
        setContentView(webView);
    }
}
