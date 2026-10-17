package com.dawrak.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

// تطبيق دورك: غلاف يفتح الموقع نفسه، فأي تحديث على الموقع بيوصل للتطبيق تلقائياً
public class MainActivity extends Activity {
    static final String HOME = "https://mohamedfayzyasenalsabagh-create.github.io/dawrak/app.html";
    static final String HOST = "mohamedfayzyasenalsabagh-create.github.io";
    static final int FILE_REQ = 7;
    WebView web;
    ValueCallback<Uri[]> fileCb;
    View splash;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        // الشاشة بتضل شغالة عند الكاشير
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        web = new WebView(this);
        FrameLayout root = new FrameLayout(this);
        root.addView(web);
        splash = buildSplash();
        root.addView(splash);
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " DawrakApp/1");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                // صفحة الزبون (المعاينة) وروابط خارجية بتنفتح بالمتصفح
                if (HOST.equals(u.getHost()) && !u.getPath().endsWith("/o.html")) return false;
                openExternal(u);
                return true;
            }
            @Override
            public void onPageFinished(WebView v, String url) { hideSplash(); }
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame()) {
                    hideSplash();
                    v.loadData("<html dir='rtl'><body style='font-family:sans-serif;text-align:center;padding:60px 24px;color:#17201B;background:#FAF7F2'>"
                        + "<div style='font-size:48px'>📶</div><h2>ما في اتصال بالإنترنت</h2><p style='color:#6B6F6A'>تأكد من الاتصال وجرّب مرة تانية</p>"
                        + "<button style='margin-top:16px;padding:14px 28px;border-radius:14px;border:0;background:#FF7A1A;color:#fff;font-size:17px;font-weight:bold' onclick=\"location.href='" + HOME + "'\">إعادة المحاولة</button></body></html>",
                        "text/html; charset=utf-8", "UTF-8");
                }
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                try {
                    startActivityForResult(p.createIntent(), FILE_REQ);
                } catch (ActivityNotFoundException e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });

        if (b != null) web.restoreState(b); else web.loadUrl(HOME);
        web.postDelayed(this::hideSplash, 8000);
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == FILE_REQ && fileCb != null) {
            Uri[] r = WebChromeClient.FileChooserParams.parseResult(res, data);
            if (r == null && data != null && data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                r = new Uri[n];
                for (int i = 0; i < n; i++) r[i] = data.getClipData().getItemAt(i).getUri();
            }
            fileCb.onReceiveValue(r);
            fileCb = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) { super.onSaveInstanceState(out); web.saveState(out); }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }

    void openExternal(Uri u) {
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); }
        catch (ActivityNotFoundException e) { Toast.makeText(this, "ما في تطبيق يفتح هالرابط", Toast.LENGTH_SHORT).show(); }
    }

    View buildSplash() {
        LinearLayout l = new LinearLayout(this);
        l.setOrientation(LinearLayout.VERTICAL);
        l.setGravity(Gravity.CENTER);
        l.setBackgroundColor(Color.parseColor("#17201B"));
        TextView bell = new TextView(this);
        bell.setText("🔔");
        bell.setTextSize(56);
        bell.setGravity(Gravity.CENTER);
        TextView name = new TextView(this);
        name.setText("دورك");
        name.setTextSize(30);
        name.setTypeface(Typeface.DEFAULT_BOLD);
        name.setTextColor(Color.WHITE);
        name.setGravity(Gravity.CENTER);
        l.addView(bell);
        l.addView(name);
        return l;
    }

    void hideSplash() {
        if (splash != null && splash.getVisibility() == View.VISIBLE)
            splash.animate().alpha(0f).setDuration(250).withEndAction(() -> splash.setVisibility(View.GONE));
    }
}
