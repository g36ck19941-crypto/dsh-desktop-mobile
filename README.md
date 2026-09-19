# DSH Desktop + Mobile

[English](README.md) · [简体中文](README.zh-CN.md)

Desktop (Windows) and mobile (Android) apps for [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) — a self-contained workbench with an embedded terminal, automatic service startup, and phone-to-desktop remote control.

## Highlights

- **Zero command line** — the desktop app auto-starts DSH, the gzip compression proxy, and keeps them healthy.
- **Four tabs** — DSH workspace, a standalone DeepSeek chat, the DeepSeek Open Platform (in-app), and a personal panel.
- **Cost tracking** — per-session token usage and cost, with off-peak/peak pricing and cache-hit/miss breakdown.
- **Phone remote control** — control the desktop DSH from the Android app over Tailscale.

## Directory layout

- `desktop/` — Electron desktop app (source)
- `android/` — Android app (source)
- `installers/` — built installers (Windows .exe / Android .apk)
- `scripts/` — helper scripts (gzip proxy, one-click setup, build scripts)
- `远程遥控说明.md` — remote-control setup guide (Chinese)

## Desktop (Windows)

### Install

Run the NSIS installer `DSH-Desktop-Setup-<version>.exe` (wizard, selectable install directory).

### Usage

1. Launch the app; it auto-starts the DSH service (logs are in the embedded panel via the top-right "日志" button).
2. Wait for the green "已就绪" status, then use it.
3. The tray menu provides: open workbench / open in browser / 📱 phone connection / restart services / quit.

### Tabs

- **DSH** — embedded DSH web workspace (auto token auth).
- **DeepSeek** — standalone streaming chat against the DeepSeek API.
- **开放平台** — the DeepSeek Open Platform embedded in-app (with a refresh button).
- **个人** — a ChatGPT-settings-style personal panel:
  - **概览 (Overview)** — peak/off-peak pricing banner + cost summary.
  - **消耗明细 (Usage)** — per-session token cost with peak/off-peak & cache breakdown.
  - **版本更新 (Updates)** — check / one-click update of DSH.
  - **关于 (About)** — app version info.

### Cost tracking

Cost is computed from the real provider usage stored in DSH session logs:

- model-specific pricing history (pre-/post-2026-08-17 price change);
- Beijing-time off-peak/peak windows (weekdays 09:00–12:00, 14:00–18:00 are peak);
- cache-hit / cache-miss / output token breakdown;
- archived sessions are excluded;
- auto-detects the current session-log format (v0 / v3) by version.

## Mobile (Android)

### Install

Install `DSH-Mobile-<version>.apk` (allow "unknown sources").

### Two modes (top tabs)

1. **独立对话 (Standalone chat)** — fill in your LLM API (Base URL / API Key / model) under settings; works without a computer.
2. **远程桌面 (Remote desktop)** — connect to the desktop DSH; shows online/offline status.

## Build

- Desktop: `electron-builder --win nsis` (see `重新打包.bat`).
- Mobile: set up the Android SDK first (`scripts/setup-android-sdk.ps1`), then `scripts/build-apk.ps1`.

## Remote control

Phone → Tailscale HTTPS → gzip proxy (3081) → DSH (3080). See `远程遥控说明.md` for the full setup.

## Version & license

- **Current version**: v0.5.0
- **Versioning**: [SemVer](https://semver.org/); changelog in [CHANGELOG.md](CHANGELOG.md)
- **License**: [MIT](LICENSE)
