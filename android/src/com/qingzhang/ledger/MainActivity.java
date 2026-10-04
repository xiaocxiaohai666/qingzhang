package com.qingzhang.ledger;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;

/**
 * 青账 · 微信账单助手 —— Android 外壳
 *
 * 设计要点（都是踩过的坑，改动前请先读）：
 *
 * 1. 不加载 file:///android_asset/，而是自己拦 https://qingzhang.local/ 并在
 *    shouldInterceptRequest 里从 assets 回内容。原因：file:// 源在部分 WebView 版本上
 *    拿不到可用的 localStorage，而这个 App 的全部数据都靠 localStorage。同时这个做法
 *    不需要 WebViewAssetLoader（那是 androidx 的，本项目刻意不依赖 androidx 以便手工编译）。
 *
 * 2. 因为没有真正的网络请求，AndroidManifest 里【不声明 INTERNET 权限】。
 *
 * 3. 网页里的「导出 CSV / 导出 JSON 备份」用的是 URL.createObjectURL + <a download>，
 *    Android WebView 不会处理 blob: 下载。所以由 assets 里的 shim 拦截点击，
 *    转调这里的 saveFile()，再用 SAF（ACTION_CREATE_DOCUMENT）让用户选保存位置。
 *    这条路径不需要任何存储权限。
 *
 * 4. 选账单文件靠 onShowFileChooser，同样不需要存储权限（SAF）。
 */
public class MainActivity extends Activity {

    private static final String HOST = "qingzhang.local";
    private static final String START_URL = "https://" + HOST + "/index.html";
    private static final int REQ_PICK_FILE = 1001;
    private static final int REQ_SAVE_FILE = 1002;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingBytes;
    private String pendingName;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);

        web = new WebView(this);
        web.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        // 全部资源都由 shouldInterceptRequest 提供，不需要任何 file:// 访问
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);

        web.setBackgroundColor(0xFFF5F7F3);
        web.addJavascriptInterface(new ExportBridge(), "Android");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req == null ? null : req.getUrl();
                if (u == null || !HOST.equals(u.getHost())) return null;
                String asset = u.getPath();
                if (asset == null || asset.isEmpty() || "/".equals(asset)) asset = "/index.html";
                if (asset.startsWith("/")) asset = asset.substring(1);
                try {
                    InputStream in = getAssets().open(asset);
                    return new WebResourceResponse(mimeOf(asset), "utf-8", in);
                } catch (IOException e) {
                    return notFound(asset);
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                // 页面内只有 #锚点，交给 WebView 自己处理
                return false;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                    fileCallback = null;
                }
                fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                // 用 */* 而不是 accept 里的 xlsx：不少文件管理器把 xlsx 报成
                // application/octet-stream，按扩展名过滤会让文件变灰不可选。
                pick.setType("*/*");
                pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(pick, "选择微信账单文件"), REQ_PICK_FILE);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        if (saved != null) {
            web.restoreState(saved);
        } else {
            web.loadUrl(START_URL);
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (web != null) web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.setWebChromeClient(null);
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (req == REQ_PICK_FILE) {
            if (fileCallback == null) return;
            fileCallback.onReceiveValue(
                    WebChromeClient.FileChooserParams.parseResult(res, data));
            fileCallback = null;
            return;
        }
        if (req == REQ_SAVE_FILE) {
            byte[] bytes = pendingBytes;
            String name = pendingName;
            pendingBytes = null;
            pendingName = null;
            if (res != RESULT_OK || data == null || data.getData() == null || bytes == null) return;
            OutputStream out = null;
            try {
                out = getContentResolver().openOutputStream(data.getData());
                if (out == null) throw new IOException("无法写入所选位置");
                out.write(bytes);
                out.flush();
                toast("已保存 " + name);
            } catch (Exception e) {
                toast("保存失败：" + e.getMessage());
            } finally {
                if (out != null) try { out.close(); } catch (IOException ignored) { }
            }
        }
    }

    /** 暴露给网页的导出桥，见 assets 里注入的 shim */
    private class ExportBridge {
        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String base64) {
            final byte[] bytes;
            try {
                bytes = Base64.decode(base64, Base64.DEFAULT);
            } catch (IllegalArgumentException e) {
                runOnUiThread(new Runnable() {
                    public void run() { toast("导出失败：数据编码异常"); }
                });
                return;
            }
            if (bytes == null || bytes.length == 0) return;
            runOnUiThread(new Runnable() {
                public void run() {
                    pendingBytes = bytes;
                    pendingName = name == null || name.isEmpty() ? "qingzhang-export" : name;
                    Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    save.addCategory(Intent.CATEGORY_OPENABLE);
                    save.setType(mime == null || mime.isEmpty()
                            ? "application/octet-stream" : mime);
                    save.putExtra(Intent.EXTRA_TITLE, pendingName);
                    try {
                        startActivityForResult(save, REQ_SAVE_FILE);
                    } catch (Exception e) {
                        pendingBytes = null;
                        pendingName = null;
                        toast("无法打开保存对话框：请检查系统是否有文件管理器");
                    }
                }
            });
        }
    }

    private static String mimeOf(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html") || p.endsWith(".htm")) return "text/html";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }

    private static WebResourceResponse notFound(String asset) {
        HashMap<String, String> headers = new HashMap<String, String>();
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try {
            buf.write(("Not found: " + asset).getBytes("UTF-8"));
        } catch (IOException ignored) { }
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers,
                new ByteArrayInputStream(buf.toByteArray()));
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show();
    }
}
