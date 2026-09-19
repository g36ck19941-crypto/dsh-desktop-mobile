# DSH 桌面端 + 手机端

[English](README.md) · [简体中文](README.zh-CN.md)

[DeepSeek Harness (DSH)](https://github.com/deepseek-ai/deepseek-harness) 的桌面端（Windows）和手机端（Android）应用 —— 自包含工作台，内嵌终端、自动启动服务，并支持手机远程控制桌面。

## 亮点

- **全程零命令行** —— 桌面端自动拉起 DSH、gzip 压缩代理，并保持健康。
- **四个标签页** —— DSH 工作区、独立 DeepSeek 对话、DeepSeek 开放平台（应用内）、个人面板。
- **消耗统计** —— 按会话统计 token 用量与金额，含峰谷定价与缓存命中/未命中拆分。
- **手机远程控制** —— 通过 Tailscale 用手机 App 控制桌面 DSH。

## 目录结构

- `desktop/` — 桌面端源码（Electron）
- `android/` — 手机端源码（Android）
- `installers/` — 已构建的安装包（Windows .exe / Android .apk）
- `scripts/` — 辅助脚本（gzip 代理、一键配置、构建脚本等）
- `远程遥控说明.md` — 手机远程连接电脑的配置说明

## 桌面端（Windows）

### 安装

运行安装版 `DSH-Desktop-Setup-<版本>.exe`（安装向导，可选安装目录）。

### 使用

1. 启动后自动拉起 DSH 服务（日志见右上角「日志」内嵌面板）；
2. 状态条变绿「已就绪」即可使用；
3. 托盘菜单提供：打开工作台 / 在浏览器打开 / 📱手机连接 / 重启服务 / 退出。

### 标签页

- **DSH** — 内嵌 DSH web 工作区（自动 token 认证）。
- **DeepSeek** — 独立流式对话，直连 DeepSeek API。
- **开放平台** — 应用内嵌 DeepSeek 开放平台（带刷新按钮）。
- **个人** — ChatGPT 账户设置风格的个人面板：
  - **概览** — 峰谷定价横幅 + 消耗汇总。
  - **消耗明细** — 每个会话的 token 金额，含峰谷/缓存拆分。
  - **版本更新** — 检查 / 一键更新 DSH。
  - **关于** — 应用版本信息。

### 消耗统计

金额由 DSH 会话日志中的真实 provider 用量计算：

- 按模型的价格历史（2026-08-17 调价前后）；
- 北京时间峰谷窗口（工作日 09:00–12:00、14:00–18:00 为高峰）；
- 缓存命中 / 缓存未命中 / 输出 token 拆分；
- 归档会话不计入；
- 自动识别当前会话日志格式（v0 / v3）按版本选择。

## 手机端（Android）

### 安装

安装 `DSH-Mobile-<版本>.apk`（需允许「未知来源」）。

### 两种模式（顶部切换）

1. **独立对话** — 在设置里填写 LLM API（Base URL / API Key / 模型），不依赖电脑直接对话；
2. **远程桌面** — 连接电脑上的 DSH，顶部显示在线/离线状态。

## 构建

- 桌面端：`electron-builder --win nsis`（见 `重新打包.bat`）。
- 手机端：先 `scripts/setup-android-sdk.ps1` 安装 SDK，再 `scripts/build-apk.ps1`。

## 远程遥控

手机 → Tailscale HTTPS → gzip 代理（3081）→ DSH（3080）。完整说明见 `远程遥控说明.md`。

## 版本与许可证

- **当前版本**：v0.5.0
- **版本规范**：遵循[语义化版本](https://semver.org/)，变更记录见 [CHANGELOG.md](CHANGELOG.md)
- **许可证**：[MIT](LICENSE)
