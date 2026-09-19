const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog, ipcMain } = require('electron');
const { spawn, exec, execFile } = require('child_process');
const https = require('https');
const net = require('net');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SERVER_HOST = '127.0.0.1';
const SERVER_PORT = 3080;
const PROXY_PORT = 3081;
const SERVER_URL = `http://${SERVER_HOST}:${SERVER_PORT}`;
const HEALTH_INTERVAL = 15000;
const SETUP_PHONE_SCRIPT = 'C:\\dsh\\setup-phone.ps1';
const PHONE_URL_FILE = 'C:\\dsh\\phone-url.txt';
const PROXY_SCRIPT = 'C:\\dsh\\gzip-proxy.js';
const NODE_EXE = 'C:\\Program Files\\nodejs\\node.exe';

let win = null;
let tray = null;
let serverProc = null;
let proxyProc = null;
let quitting = false;
let lastLaunch = 0;
let currentStatus = 'starting';
let dshToken = null;

function nodeExe() { return fs.existsSync(NODE_EXE) ? NODE_EXE : 'node.exe'; }

function sendLog(msg) {
  try { if (win && !win.isDestroyed()) win.webContents.send('dsh-log', msg); } catch (e) {}
  try { fs.appendFileSync('C:\\dsh\\desktop-debug.log', msg); } catch (e) {}
}

function setStatus(state) {
  currentStatus = state;
  try { if (win && !win.isDestroyed()) win.webContents.send('dsh-status', state); } catch (e) {}
}

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.createConnection({ port: port, host: SERVER_HOST });
    s.once('connect', () => { s.end(); resolve(true); });
    s.once('error', () => resolve(false));
  });
}

function waitServer(timeoutMs) {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      const req = http.get(SERVER_URL, (r) => { r.resume(); resolve(true); });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) resolve(false);
        else setTimeout(tick, 800);
      });
      req.setTimeout(1200, () => { req.destroy(); });
    };
    tick();
  });
}

function trustedHostArgs() {
  try {
    const value = fs.readFileSync(path.join(os.homedir(), '.dsh', 'trusted-host.txt'), 'utf8').trim();
    if (value) return ['--trusted-host', value];
  } catch (e) {}
  return [];
}

function cmpVersion(a, b) {
  const pa = String(a).split(/[-.]/).map((s) => (/^\d+$/.test(s) ? parseInt(s, 10) : s));
  const pb = String(b).split(/[-.]/).map((s) => (/^\d+$/.test(s) ? parseInt(s, 10) : s));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') { if (x !== y) return x < y ? -1 : 1; }
    else { const xs = String(x), ys = String(y); if (xs !== ys) return xs < ys ? -1 : 1; }
  }
  return 0;
}

function dshPkgOf(dir) {
  return path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx', dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
}

// 找到本地缓存的 DSH：优先用锁定版本（~/.dsh/dsh-pinned-version.txt），否则用最新
function findDshBin() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  let pinned = null;
  try { pinned = fs.readFileSync(path.join(os.homedir(), '.dsh', 'dsh-pinned-version.txt'), 'utf8').trim(); } catch (e) {}
  let best = null, bestVer = null, pinnedBin = null;
  try {
    for (const d of fs.readdirSync(base)) {
      const bin = path.join(base, d, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
      if (!fs.existsSync(bin)) continue;
      let v = '0.0.0';
      try { v = (JSON.parse(fs.readFileSync(dshPkgOf(d), 'utf8'))).version || '0.0.0'; } catch (e) {}
      if (pinned && v === pinned) pinnedBin = bin;
      if (!best || cmpVersion(v, bestVer) > 0) { best = bin; bestVer = v; }
    }
  } catch (e) {}
  return pinnedBin || best;
}

function getLocalDshVersion() {
  const bin = findDshBin();
  if (!bin) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(bin), '..', 'package.json'), 'utf8'));
    return pkg.version || null;
  } catch (e) { return null; }
}

function findTailscale() {
  const candidates = ['C:\\Program Files\\Tailscale\\tailscale.exe'];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

// 启动/周期校验：确保 tailscale serve 指向 gzip 代理(3081)，若漂移则自动修复
function verifyTailscaleServe() {
  const ts = findTailscale();
  if (!ts) { sendLog('[tailscale] 未找到 tailscale.exe，跳过 serve 校验\n'); return; }
  execFile(ts, ['serve', 'status'], { timeout: 15000 }, (err, stdout) => {
    if (err) {
      sendLog('[tailscale] serve status 查询失败（可能未登录/未启用），跳过：' + (err.message || '') + '\n');
      return;
    }
    if ((stdout || '').includes('127.0.0.1:3081')) {
      // 已正确指向 gzip 代理，无需修改（不刷屏，仅记一次日志）
      return;
    }
    sendLog('[tailscale] serve 未指向 gzip 代理(3081)，自动修复: tailscale serve --bg 3081\n');
    execFile(ts, ['serve', '--bg', '3081'], { timeout: 25000 }, (err2, out2, errOut2) => {
      if (err2) sendLog('[tailscale] 自动修复失败：' + (err2.message || errOut2 || out2 || '') + '\n');
      else sendLog('[tailscale] 已自动指向 gzip 代理(3081)\n');
    });
  });
}

function startProxy() {
  if (proxyProc) return;
  if (!fs.existsSync(PROXY_SCRIPT)) { sendLog('[proxy] 脚本不存在: ' + PROXY_SCRIPT + '\n'); return; }
  sendLog('[proxy] 启动 gzip 代理 (127.0.0.1:' + PROXY_PORT + ' -> ' + SERVER_PORT + ')...\n');
  try {
    proxyProc = spawn(nodeExe(), [PROXY_SCRIPT], { stdio: ['ignore', 'pipe', 'pipe'] });
    proxyProc.stdout.on('data', (d) => sendLog(d.toString()));
    proxyProc.stderr.on('data', (d) => sendLog('[proxy] ' + d.toString()));
    proxyProc.on('error', (e) => { sendLog('[proxy] 启动失败: ' + e.message + '\n'); proxyProc = null; });
    proxyProc.on('exit', (code) => { sendLog('[proxy] 已退出 code=' + code + '\n'); proxyProc = null; });
  } catch (e) { sendLog('[proxy] 启动异常: ' + e.message + '\n'); proxyProc = null; }
}

function startServer() {
  if (Date.now() - lastLaunch < 45000) return;
  lastLaunch = Date.now();
  setStatus('starting');
  const bin = findDshBin();
  const args = bin ? [bin, 'web', '--no-open', ...trustedHostArgs()] : ['--yes', '@deepseek-ai/dsh', 'web', '--no-open', ...trustedHostArgs()];
  const cmd = bin ? nodeExe() : 'npx.cmd';
  sendLog('[dsh] 启动: ' + cmd + ' ' + args.join(' ') + '\n');
  try {
    serverProc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env }, cwd: app.getPath('home') });
    serverProc.stdout.on('data', (d) => {
      const s = d.toString();
      sendLog(s);
      const m = s.match(/token=([A-Za-z0-9_-]+)/);
      if (m && m[1]) { dshToken = m[1]; try { if (win && !win.isDestroyed()) win.webContents.send('dsh-token', dshToken); } catch (e) {} }
    });
    serverProc.stderr.on('data', (d) => sendLog(d.toString()));
    serverProc.on('error', (e) => { sendLog('[dsh] 启动失败: ' + e.message + '\n'); serverProc = null; setStatus('error'); });
    serverProc.on('exit', (code) => { sendLog('[dsh] 已退出 code=' + code + '\n'); serverProc = null; if (!quitting) setStatus('error'); });
  } catch (e) { sendLog('[dsh] 启动异常: ' + e.message + '\n'); serverProc = null; setStatus('error'); }
}

function killByPort(port) {
  return new Promise((resolve) => {
    exec(`netstat -ano | findstr :${port} | findstr LISTENING`, (err, stdout) => {
      const m = stdout && stdout.match(/(\d+)\s*$/m);
      if (m && m[1]) exec(`taskkill /F /PID ${m[1]}`, () => resolve());
      else resolve();
    });
  });
}

function killServer() {
  if (serverProc) { try { serverProc.kill(); } catch (e) {} serverProc = null; }
  return killByPort(SERVER_PORT);
}

function killProxy() {
  if (proxyProc) { try { proxyProc.kill(); } catch (e) {} proxyProc = null; }
  return killByPort(PROXY_PORT);
}

function loadShell() { win.loadFile(path.join(__dirname, 'shell.html')); }

async function ensureAndLoad() {
  loadShell();
  if (await portInUse(SERVER_PORT)) { setStatus('ready'); startProxy(); return; }
  startProxy();
  startServer();
  const up = await waitServer(45000);
  if (up) setStatus('ready');
  else setStatus('error');
}

async function restartServices() {
  setStatus('starting');
  await killServer();
  await killProxy();
  startProxy();
  startServer();
  const up = await waitServer(60000);
  setStatus(up ? 'ready' : 'error');
  return up;
}

function setupPhone() {
  const ps = `powershell.exe -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${SETUP_PHONE_SCRIPT}'"`;
  exec(ps, { windowsHide: true }, async (err) => {
    if (err) {
      dialog.showMessageBox(win, { type: 'error', title: '手机连接', message: '配置失败或已取消', detail: String(err.message || err) });
      return;
    }
    let url = '';
    try { url = fs.readFileSync(PHONE_URL_FILE, 'utf8').trim(); } catch (e) {}
    const ok = await restartServices();
    dialog.showMessageBox(win, {
      type: 'info', title: '手机连接',
      message: url ? '配置完成' : '配置完成（未取到地址）',
      detail: (url ? '手机 App 地址：\n' + url + '\n\n' : '') + (ok ? 'DSH 服务已重启。' : 'DSH 服务重启失败。')
    });
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    title: 'DSH 工作台',
    autoHideMenuBar: true,
    backgroundColor: '#151517',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      webviewTag: true
    }
  });
  ensureAndLoad();
  win.on('close', (e) => { if (!quitting) { e.preventDefault(); win.hide(); } });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function createTray() {
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(img);
  tray.setToolTip('DSH 工作台');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开工作台', click: () => { win.show(); win.focus(); } },
    { label: '在浏览器打开', click: () => shell.openExternal(SERVER_URL) },
    { type: 'separator' },
    { label: '📱 手机连接', click: () => setupPhone() },
    { label: '重启服务', click: async () => { await restartServices(); } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { win.show(); win.focus(); });
}

ipcMain.handle('dsh-get-status', () => currentStatus);
ipcMain.handle('dsh-get-token', () => dshToken);

// ─── DeepSeek 开放平台 ───
const DEEPSEEK_CONFIG_PATH = path.join(os.homedir(), '.dsh', 'deepseek-config.json');

function loadDeepseekConfig() {
  try {
    return JSON.parse(fs.readFileSync(DEEPSEEK_CONFIG_PATH, 'utf8'));
  } catch (e) {
    return { baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat', apiKey: '' };
  }
}

function saveDeepseekConfig(cfg) {
  try {
    fs.mkdirSync(path.dirname(DEEPSEEK_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(DEEPSEEK_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}

ipcMain.handle('deepseek-config-get', () => loadDeepseekConfig());
ipcMain.handle('deepseek-config-set', (_e, cfg) => saveDeepseekConfig(cfg));

ipcMain.handle('deepseek-balance', async (_e, cfg) => {
  try {
    const base = ((cfg && cfg.baseUrl) || 'https://api.deepseek.com').replace(/\/+$/, '');
    const res = await fetch(base + '/user/balance', {
      headers: { 'Authorization': 'Bearer ' + ((cfg && cfg.apiKey) || ''), 'Accept': 'application/json' }
    });
    return { ok: true, data: await res.json() };
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

ipcMain.on('deepseek-chat', (event, payload) => {
  const cfg = (payload && payload.cfg) || {};
  const messages = (payload && payload.messages) || [];
  const base = ((cfg.baseUrl) || 'https://api.deepseek.com').replace(/\/+$/, '');
  const body = JSON.stringify({ model: cfg.model || 'deepseek-chat', messages: messages, stream: true });
  const u = new URL(base + '/chat/completions');
  const mod = u.protocol === 'https:' ? https : http;
  const req = mod.request(u, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (cfg.apiKey || ''),
      'Accept': 'text/event-stream'
    }
  }, (res) => {
    let buf = '';
    res.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (data === '[DONE]') { event.sender.send('deepseek-chunk', { done: true }); continue; }
        try {
          const json = JSON.parse(data);
          const ch = json.choices && json.choices[0];
          if (ch && ch.delta && ch.delta.content) event.sender.send('deepseek-chunk', { content: ch.delta.content });
          if (ch && ch.finish_reason) event.sender.send('deepseek-chunk', { done: true });
        } catch (e) {}
      }
    });
    res.on('end', () => event.sender.send('deepseek-chunk', { done: true }));
    res.on('error', () => event.sender.send('deepseek-chunk', { done: true }));
  });
  req.on('error', (err) => event.sender.send('deepseek-error', String((err && err.message) || err)));
  req.write(body);
  req.end();
});

// ─── 个人面板：消耗查询（token 用量 + 金额，峰谷/缓存命中拆分） ───
const USAGE_PRICES_PATH = path.join(os.homedir(), '.dsh', 'usage-prices.json');

// 用系统 Node(>=22，内置 zstd) 跑解码脚本，Electron 内置 Node 20 无 zstd
function runUsageCalc() {
  return new Promise((resolve) => {
    let code;
    try { code = fs.readFileSync(path.join(__dirname, 'usage-calc.cjs'), 'utf8'); }
    catch (e) { resolve({ error: '计算脚本缺失: ' + (e.message || e) }); return; }
    let out = '', errOut = '';
    let settled = false;
    let child;
    try {
      child = spawn(nodeExe(), ['--input-type=commonjs', '-'], { env: { ...process.env } });
    } catch (e) { resolve({ error: '无法启动计算进程: ' + (e.message || e) }); return; }
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { errOut += d.toString(); });
    child.on('error', (e) => { if (!settled) { settled = true; resolve({ error: '计算进程错误: ' + (e.message || e) }); } });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) { resolve({ error: '计算进程退出 code=' + code + ': ' + (errOut || '').slice(0, 300) }); return; }
      try { resolve(JSON.parse(out)); }
      catch (e) { resolve({ error: '结果解析失败: ' + (errOut || out || '').slice(0, 500) }); }
    });
    try { child.stdin.write(code); child.stdin.end(); } catch (e) { if (!settled) { settled = true; resolve({ error: '写入脚本失败: ' + (e.message || e) }); } }
  });
}

ipcMain.handle('usage-cost', () => runUsageCalc());

// 刷新价格：抓官方 pricing 页解析 v4 系列价格，写入 ~/.dsh/usage-prices.json
function parsePricesFromHtml(html) {
  // 表头模型顺序
  const head = html.match(/<td[^>]*colspan="3"[^>]*>\s*模型\s*<\/td>([\s\S]*?)<\/tr>/i);
  const models = [];
  if (head) {
    const re = /<td>\s*(deepseek-[\w-]+)\s*<\/td>/gi;
    let m;
    while ((m = re.exec(head[1]))) models.push(m[1]);
  }
  // 三种计费行：缓存命中 / 缓存未命中 / 输出，各含空闲与高峰两行（每行 3 列，顺序 = 模型列顺序）
  const row = (label) => {
    const seg = html.match(new RegExp(label + '[\\s\\S]*?高峰时段[\\s\\S]*?<\/tr>', 'i'));
    if (!seg) return null;
    return [...seg[0].matchAll(/(\d+(?:\.\d+)?)元/g)].map((x) => parseFloat(x[1]));
  };
  const hitNums = row('（缓存命中）');
  const missNums = row('（缓存未命中）');
  const outNums = row('百万tokens输出');
  const modelsOut = {};
  if (models.length >= 2 && hitNums && missNums && outNums) {
    // 每行 3 列，顺序 = models 顺序；空闲=前半，高峰=后半
    const n = models.length;
    for (let i = 0; i < n; i++) {
      const name = models[i];
      const offHit = hitNums[i], peakHit = hitNums[n + i];
      const offMiss = missNums[i], peakMiss = missNums[n + i];
      const offOut = outNums[i], peakOut = outNums[n + i];
      if ([offHit, peakHit, offMiss, peakMiss, offOut, peakOut].every((x) => typeof x === 'number' && isFinite(x))) {
        modelsOut[name] = {
          peak: { input: peakMiss, cacheRead: peakHit, output: peakOut },
          off:  { input: offMiss,  cacheRead: offHit,  output: offOut  }
        };
      }
    }
  }
  return modelsOut;
}

ipcMain.handle('usage-refresh-prices', async () => {
  try {
    const res = await fetch('https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' }
    });
    const html = await res.text();
    const models = parsePricesFromHtml(html);
    if (!models || Object.keys(models).length === 0) {
      return { ok: false, error: '未从官方页面解析到价格（页面结构可能已变化）' };
    }
    const data = {
      updatedAt: new Date().toISOString(),
      priceCutoffUtc: Date.UTC(2026, 7, 16, 16), // 8/17 00:00 北京时间，此前为调价前统一价
      source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
      models
    };
    fs.mkdirSync(path.dirname(USAGE_PRICES_PATH), { recursive: true });
    fs.writeFileSync(USAGE_PRICES_PATH, JSON.stringify(data, null, 2), 'utf8');
    return { ok: true, models };
  } catch (err) { return { ok: false, error: String((err && err.message) || err) }; }
});

// ─── DSH 更新检查 ───
ipcMain.handle('dsh-check-update', async () => {
  const local = getLocalDshVersion();
  try {
    const latest = await new Promise((resolve, reject) => {
      execFile('npm.cmd', ['view', '@deepseek-ai/dsh', 'version'], { timeout: 40000, windowsHide: true }, (err, stdout) => {
        if (err) return reject(err);
        const v = (stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
        resolve(v || null);
      });
    });
    return { ok: true, local, latest, hasUpdate: !!(local && latest && cmpVersion(latest, local) > 0) };
  } catch (err) {
    return { ok: false, local, error: String((err && err.message) || err) };
  }
});

ipcMain.handle('dsh-update', async () => {
  try {
    // 触发 npx 拉取最新版（下载到新的缓存目录），随后重启 DSH 服务
    await new Promise((resolve, reject) => {
      execFile('npx.cmd', ['--yes', '@deepseek-ai/dsh@latest', '--version'], { timeout: 180000, windowsHide: true }, (err, stdout, stderr) => {
        if (err && !(stdout || stderr)) return reject(err);
        resolve(stdout || stderr || '');
      });
    });
    const local = getLocalDshVersion();
    const restarted = await restartServices();
    return { ok: true, local, restarted };
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
});

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
  app.whenReady().then(() => {
    createWindow();
    createTray();
    verifyTailscaleServe();
    setInterval(() => { verifyTailscaleServe(); }, 5 * 60 * 1000);
    setInterval(async () => {
      const up = await portInUse(SERVER_PORT);
      if (up) {
        if (currentStatus !== 'ready') setStatus('ready');
        if (!(await portInUse(PROXY_PORT))) startProxy();
      } else {
        if (currentStatus === 'ready') setStatus('starting');
        startProxy();
        startServer();
        if (await waitServer(30000)) setStatus('ready');
        else setStatus('error');
      }
    }, HEALTH_INTERVAL);
    app.on('activate', () => { if (win) win.show(); });
  });
  app.on('window-all-closed', () => { /* 保持托盘常驻 */ });
}
