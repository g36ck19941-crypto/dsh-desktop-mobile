# DSH 桌面端 + 手机端

DeepSeek Harness（DSH）的桌面端（Windows）和手机端（Android）应用。

## 目录结构

- `installers/` — 安装包
  - `DSH-Desktop-Setup-0.1.0.exe` — 桌面安装版（安装向导，可选安装目录）
  - `DSH-Desktop-Portable-0.1.0.exe` — 桌面便携版（免安装，单文件直接运行）
  - `DSH-Mobile-0.1.0.apk` — 手机端安装包
- `desktop/` — 桌面端源码（Electron）
- `android/` — 手机端源码（Android）
- `scripts/` — 辅助脚本（gzip 压缩代理、一键配置、构建脚本等）
- `远程遥控说明.md` — 手机远程连接电脑的配置说明

---

## 一、桌面端

### 安装

- **便携版**：双击 `installers/DSH-Desktop-Portable-0.1.0.exe` 即可运行；
- **安装版**：双击 `installers/DSH-Desktop-Setup-0.1.0.exe`，按向导安装。

### 使用

1. 启动后，App 会**自动拉起 dsh 服务**（右上角「日志」可查看内嵌日志面板）；
2. 状态条变绿显示「已就绪」后即可使用；
3. 托盘菜单提供：打开工作台 / 在浏览器打开 / 📱手机连接 / 重启服务 / 退出。

### 特点

- 全程零命令行：内嵌日志面板 + 自动启动 dsh + 自动起 gzip 压缩代理；
- 启动时**自动校验 tailscale serve** 配置，漂移自动修复；
- 一键「📱 手机连接」配置远程遥控（详见 `远程遥控说明.md`）。

---

## 二、手机端

### 安装

把 `installers/DSH-Mobile-0.1.0.apk` 传到手机安装（需允许「未知来源」安装）。

### 两种模式（顶部切换）

1. **独立对话**：右上角「设置」里填 LLM API（Base URL / API Key / 模型），**不依赖电脑**直接对话；
2. **远程桌面**：连接电脑上的 dsh，顶部显示「● 在线 / 离线」状态（配置见 `远程遥控说明.md`）。

---

## 三、构建

- 桌面端：`scripts/build-desktop.ps1`
- 手机端：先 `scripts/setup-android-sdk.ps1` 安装 SDK，再 `scripts/build-apk.ps1`

---

## 四、远程遥控

手机远程连接电脑的完整说明见 [远程遥控说明.md](远程遥控说明.md)。
