const { app, BrowserWindow, Tray, Menu, shell, nativeImage, dialog, ipcMain } = require('electron');
const { spawn, exec, execFile } = require('child_process');
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

function findDshBin() {
  const base = path.join(process.env.LOCALAPPDATA || '', 'npm-cache', '_npx');
  try {
    for (const d of fs.readdirSync(base)) {
      const bin = path.join(base, d, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
      if (fs.existsSync(bin)) return bin;
    }
  } catch (e) {}
  return null;
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
  const args = bin ? [bin, 'web', ...trustedHostArgs()] : ['--yes', '@deepseek-ai/dsh', 'web', ...trustedHostArgs()];
  const cmd = bin ? nodeExe() : 'npx.cmd';
  sendLog('[dsh] 启动: ' + cmd + ' ' + args.join(' ') + '\n');
  try {
    serverProc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env }, cwd: app.getPath('home') });
    serverProc.stdout.on('data', (d) => sendLog(d.toString()));
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
      spellcheck: false
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
