package com.dsh.mobile;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {
  private static final String PREFS = "dsh";
  private static final String KEY_API_BASE = "api_base";
  private static final String KEY_API_KEY = "api_key";
  private static final String KEY_API_MODEL = "api_model";
  private static final String KEY_SERVER_URL = "server_url";
  private static final String DEFAULT_API_BASE = "https://api.deepseek.com";
  private static final String DEFAULT_API_MODEL = "deepseek-chat";
  private static final String DEFAULT_SERVER = "http://192.168.110.61:3080";

  private SharedPreferences prefs;
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private final Handler main = new Handler(Looper.getMainLooper());

  // 视图
  private LinearLayout root;
  private Button btnStandalone;
  private Button btnRemote;
  private LinearLayout chatView;
  private LinearLayout remoteView;
  private ListView chatList;
  private EditText chatInput;
  private WebView web;
  private TextView statusText;

  // 独立对话历史
  private final List<Msg> messages = new ArrayList<>();
  private MsgAdapter adapter;
  private boolean busy = false;

  // crypto.randomUUID 缺失时的 polyfill（远程 WebView 在非安全上下文加载 dsh 网页时用到）
  private static final String POLYFILL =
      "(function(){if(window.crypto&&!window.crypto.randomUUID){"
      + "window.crypto.randomUUID=function(){var b=window.crypto.getRandomValues(new Uint8Array(16));"
      + "b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;"
      + "var h=function(x){return ('0'+x.toString(16)).slice(-2);};"
      + "return h(b[0])+h(b[1])+h(b[2])+h(b[3])+'-'+h(b[4])+h(b[5])+'-'+h(b[6])+h(b[7])"
      + "+'-'+h(b[8])+h(b[9])+'-'+h(b[10])+h(b[11])+h(b[12])+h(b[13])+h(b[14])+h(b[15]);};"
      + "}})();";

  private static class Msg {
    final String role;
    final String content;
    Msg(String role, String content) { this.role = role; this.content = content; }
  }

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
    getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
    buildUi();
    switchTo(true); // 默认独立对话
  }

  // ─────────────────── UI ───────────────────
  private void buildUi() {
    root = new LinearLayout(this);
    root.setOrientation(LinearLayout.VERTICAL);
    root.setBackgroundColor(0xFF151517);

    // 顶部模式切换
    LinearLayout bar = new LinearLayout(this);
    bar.setOrientation(LinearLayout.HORIZONTAL);
    bar.setPadding(8, 8, 8, 8);
    btnStandalone = makeTab("独立对话");
    btnRemote = makeTab("远程桌面");
    bar.addView(btnStandalone, new LinearLayout.LayoutParams(0, dp(44), 1));
    bar.addView(btnRemote, new LinearLayout.LayoutParams(0, dp(44), 1));
    root.addView(bar);

    buildChatView();
    buildRemoteView();

    // 内容容器
    FrameLayout container = new FrameLayout(this);
    container.addView(chatView, match());
    container.addView(remoteView, match());
    root.addView(container, new LinearLayout.LayoutParams(match(), 0, 1));

    setContentView(root);
  }

  private Button makeTab(String label) {
    Button b = new Button(this);
    b.setText(label);
    b.setAllCaps(false);
    b.setTextSize(15);
    b.setPadding(8, 4, 8, 4);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(44), 1);
    lp.setMargins(4, 0, 4, 0);
    b.setLayoutParams(lp);
    b.setGravity(Gravity.CENTER);
    b.setOnClickListener(v -> switchTo(v == btnStandalone));
    return b;
  }

  private void buildChatView() {
    chatView = new LinearLayout(this);
    chatView.setOrientation(LinearLayout.VERTICAL);

    chatList = new ListView(this);
    chatList.setDivider(null);
    chatList.setDividerHeight(0);
    chatList.setTranscriptMode(ListView.TRANSCRIPT_MODE_ALWAYS_SCROLL);
    chatList.setPadding(0, 4, 0, 4);
    adapter = new MsgAdapter();
    chatList.setAdapter(adapter);

    LinearLayout inputRow = new LinearLayout(this);
    inputRow.setOrientation(LinearLayout.HORIZONTAL);
    inputRow.setPadding(8, 8, 8, 8);
    chatInput = new EditText(this);
    chatInput.setHint("输入消息…");
    chatInput.setTextSize(16);
    chatInput.setSingleLine(false);
    chatInput.setMaxLines(4);
    Button send = new Button(this);
    send.setText("发送");
    send.setAllCaps(false);
    send.setOnClickListener(v -> sendMessage());

    inputRow.addView(chatInput, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
    inputRow.addView(send, new LinearLayout.LayoutParams(dp(72), dp(48)));

    ((LinearLayout) chatView).addView(chatList, new LinearLayout.LayoutParams(match(), 0, 1));
    ((LinearLayout) chatView).addView(inputRow);
  }

  private void buildRemoteView() {
    remoteView = new LinearLayout(this);
    remoteView.setOrientation(LinearLayout.VERTICAL);

    statusText = new TextView(this);
    statusText.setTextSize(13);
    statusText.setPadding(16, 8, 16, 8);
    statusText.setTextColor(0xFF9AA3B2);
    statusText.setText("● 未连接");

    web = new WebView(this);
    web.setBackgroundColor(0xFF151517);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    s.setDatabaseEnabled(true);
    s.setLoadWithOverviewMode(true);
    s.setUseWideViewPort(true);
    s.setSupportZoom(false);
    s.setBuiltInZoomControls(false);
    s.setDisplayZoomControls(false);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
    web.setWebViewClient(new WebViewClient() {
      @Override public void onPageStarted(WebView view, String url, Bitmap favicon) { inject(view); }
      @Override public void onPageFinished(WebView view, String url) { inject(view); }
    });
    web.setWebChromeClient(new WebChromeClient());

    ((LinearLayout) remoteView).addView(statusText);
    ((LinearLayout) remoteView).addView(web, new LinearLayout.LayoutParams(match(), 0, 1));
  }

  private void inject(WebView view) {
    try { view.evaluateJavascript(POLYFILL, null); } catch (Throwable ignored) {}
  }

  private void switchTo(boolean standalone) {
    chatView.setVisibility(standalone ? View.VISIBLE : View.GONE);
    remoteView.setVisibility(standalone ? View.GONE : View.VISIBLE);
    styleTab(btnStandalone, standalone);
    styleTab(btnRemote, !standalone);
    if (!standalone) loadRemote();
  }

  private void styleTab(Button b, boolean active) {
    b.setTextColor(active ? 0xFFFFFFFF : 0xFF9AA3B2);
    b.setBackgroundColor(active ? 0xFF2B3A55 : 0xFF1E1F24);
  }

  // ─────────────────── 独立对话 ───────────────────
  private void sendMessage() {
    if (busy) { toast("正在回复中…"); return; }
    String text = chatInput.getText().toString().trim();
    if (text.isEmpty()) return;
    chatInput.setText("");
    messages.add(new Msg("user", text));
    adapter.notifyDataSetChanged();

    String key = prefs.getString(KEY_API_KEY, "");
    if (key.isEmpty()) {
      messages.add(new Msg("assistant", "请先在右上角「设置」里填写 API Key（DeepSeek 等 OpenAI 兼容接口）。"));
      adapter.notifyDataSetChanged();
      return;
    }

    busy = true;
    final List<Msg> snapshot = new ArrayList<>(messages);
    callLlm(snapshot, new Callback() {
      @Override public void ok(String content) {
        busy = false;
        messages.add(new Msg("assistant", content));
        adapter.notifyDataSetChanged();
      }
      @Override public void fail(String err) {
        busy = false;
        messages.add(new Msg("assistant", "⚠ " + err));
        adapter.notifyDataSetChanged();
      }
    });
  }

  private interface Callback { void ok(String content); void fail(String err); }

  private void callLlm(final List<Msg> history, final Callback cb) {
    executor.execute(() -> {
      try {
        String base = prefs.getString(KEY_API_BASE, DEFAULT_API_BASE).trim();
        String key = prefs.getString(KEY_API_KEY, "").trim();
        String model = prefs.getString(KEY_API_MODEL, DEFAULT_API_MODEL).trim();
        if (key.isEmpty()) { post(() -> cb.fail("未配置 API Key")); return; }

        URL url = new URL(base.replaceAll("/+$", "") + "/chat/completions");
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + key);
        conn.setConnectTimeout(20000);
        conn.setReadTimeout(90000);
        conn.setDoOutput(true);

        JSONObject body = new JSONObject();
        body.put("model", model);
        JSONArray msgs = new JSONArray();
        for (Msg m : history) {
          JSONObject o = new JSONObject();
          o.put("role", m.role);
          o.put("content", m.content);
          msgs.put(o);
        }
        body.put("messages", msgs);
        body.put("stream", false);

        try (OutputStream os = conn.getOutputStream()) {
          os.write(body.toString().getBytes(StandardCharsets.UTF_8));
        }

        int code = conn.getResponseCode();
        InputStream is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
        final String resp = readAll(is);
        is.close();
        conn.disconnect();

        if (code != 200) { post(() -> cb.fail("API " + code + ": " + trim(resp, 300))); return; }

        JSONObject json = new JSONObject(resp);
        String content = json.getJSONArray("choices").getJSONObject(0).getJSONObject("message").getString("content");
        post(() -> cb.ok(content));
      } catch (Exception e) {
        post(() -> cb.fail("请求失败: " + (e.getMessage() == null ? e.toString() : e.getMessage())));
      }
    });
  }

  // ─────────────────── 远程桌面 ───────────────────
  private void loadRemote() {
    String url = prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER).trim();
    if (url.isEmpty()) { statusText.setText("● 未配置服务器（点右上角设置）"); return; }
    if (!url.startsWith("http")) url = "http://" + url;
    web.loadUrl(url);
    checkRemoteStatus(url);
  }

  private void checkRemoteStatus(final String url) {
    executor.execute(() -> {
      boolean online = false;
      try {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(5000);
        c.setReadTimeout(5000);
        c.setRequestMethod("GET");
        online = c.getResponseCode() > 0;
        c.disconnect();
      } catch (Exception ignored) {}
      final boolean f = online;
      main.post(() -> statusText.setText(f ? "● 在线  " + url : "● 离线  " + url));
    });
  }

  // ─────────────────── 设置 ───────────────────
  private void showSettings() {
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.setPadding(32, 16, 32, 16);

    box.addView(label("API Base URL"));
    EditText apiBase = edit(prefs.getString(KEY_API_BASE, DEFAULT_API_BASE));
    box.addView(apiBase);

    box.addView(label("API Key"));
    EditText apiKey = edit(prefs.getString(KEY_API_KEY, ""));
    apiKey.setHint("sk-...");
    box.addView(apiKey);

    box.addView(label("模型"));
    EditText apiModel = edit(prefs.getString(KEY_API_MODEL, DEFAULT_API_MODEL));
    box.addView(apiModel);

    box.addView(label("远程桌面地址"));
    EditText serverUrl = edit(prefs.getString(KEY_SERVER_URL, DEFAULT_SERVER));
    box.addView(serverUrl);

    new AlertDialog.Builder(this)
        .setTitle("设置")
        .setView(box)
        .setPositiveButton("保存", (d, w) -> {
          prefs.edit()
              .putString(KEY_API_BASE, apiBase.getText().toString().trim())
              .putString(KEY_API_KEY, apiKey.getText().toString().trim())
              .putString(KEY_API_MODEL, apiModel.getText().toString().trim())
              .putString(KEY_SERVER_URL, serverUrl.getText().toString().trim())
              .apply();
          toast("已保存");
        })
        .setNegativeButton("取消", null)
        .show();
  }

  private TextView label(String t) {
    TextView tv = new TextView(this);
    tv.setText(t);
    tv.setTextColor(0xFF9AA3B2);
    tv.setTextSize(13);
    tv.setPadding(0, 10, 0, 4);
    return tv;
  }

  private EditText edit(String v) {
    EditText e = new EditText(this);
    e.setText(v);
    e.setTextSize(15);
    e.setTextColor(0xFFE8EBF0);
    e.setSingleLine(false);
    e.setMaxLines(3);
    return e;
  }

  @Override
  public boolean onCreateOptionsMenu(android.view.Menu menu) {
    menu.add("设置");
    menu.add("刷新");
    menu.add("清空对话");
    return true;
  }

  @Override
  public boolean onOptionsItemSelected(android.view.MenuItem item) {
    String t = item.getTitle().toString();
    if ("设置".equals(t)) { showSettings(); return true; }
    else if ("刷新".equals(t)) {
      if (chatView.getVisibility() == View.VISIBLE) { adapter.notifyDataSetChanged(); }
      else { loadRemote(); }
      return true;
    }
    else if ("清空对话".equals(t)) { messages.clear(); adapter.notifyDataSetChanged(); return true; }
    return super.onOptionsItemSelected(item);
  }

  // ─────────────────── 工具 ───────────────────
  private void post(Runnable r) { main.post(r); }

  private void toast(String m) { Toast.makeText(this, m, Toast.LENGTH_SHORT).show(); }

  private int dp(int v) { return (int) (v * getResources().getDisplayMetrics().density); }

  private static int match() { return ViewGroup.LayoutParams.MATCH_PARENT; }

  private static String readAll(InputStream is) throws Exception {
    java.io.ByteArrayOutputStream bos = new java.io.ByteArrayOutputStream();
    byte[] buf = new byte[8192];
    int n;
    while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
    return bos.toString("UTF-8");
  }

  private static String trim(String s, int max) {
    return s.length() <= max ? s : s.substring(0, max) + "…";
  }

  private class MsgAdapter extends BaseAdapter {
    @Override public int getCount() { return messages.size(); }
    @Override public Object getItem(int i) { return messages.get(i); }
    @Override public long getItemId(int i) { return i; }
    @Override public View getView(int i, View convertView, ViewGroup parent) {
      TextView tv;
      if (convertView instanceof TextView) {
        tv = (TextView) convertView;
      } else {
        tv = new TextView(MainActivity.this);
        tv.setTextSize(15);
        tv.setPadding(20, 14, 20, 14);
      }
      Msg m = messages.get(i);
      boolean user = "user".equals(m.role);
      tv.setText((user ? "我" : "助手") + "\n" + m.content);
      tv.setTextColor(user ? 0xFFE8EBF0 : 0xFFA5C1FF);
      tv.setBackgroundColor(user ? 0xFF1E2A3A : 0xFF1A1D23);
      return tv;
    }
  }
}
