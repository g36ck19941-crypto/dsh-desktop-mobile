# 更新日志

本项目的所有显著变更都会记录在此文件。版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [0.3.0] - 2026-08-16

### 变更
- 桌面端构建目标改为**仅安装版（nsis）**，移除便携版（portable）与绿色版（win-unpacked）的发布。
- 发布流程统一为打包：桌面走安装程序、手机走 APK，取消「直接替换 asar」方式。
- 安装包文件名与版本号直接同步（rename，无需重新打包）。

## [0.2.0] - 2026-08-16

### 新增
- **DeepSeek 开放平台接入**：桌面端新增「DeepSeek」标签（流式对话 + 余额查询）与「开放平台」标签（内嵌 platform.deepseek.com，API key 管理 / 用量 / 充值不切浏览器）。
- **手机端**：独立对话支持流式输出（逐字显示）与余额查询，新增「开放平台」标签（内嵌官网）。

## [0.1.0] - 2026-08-16

### 新增
- **桌面端（Windows）**：Electron 套壳，内嵌日志面板，自动拉起 dsh 服务 + gzip 压缩代理，全程零命令行。
- **桌面端自愈**：启动时自动校验 tailscale serve 指向，配置漂移自动修复；服务掉线自动拉起。
- **桌面端「📱 手机连接」**：一键配置远程遥控（tailscale serve + 防火墙 + trusted-host）。
- **手机端（Android）**：双模式——独立 LLM 对话（自带 API 配置）+ 远程桌面（连电脑 dsh）+ 在线/离线状态检测。
- **远程遥控链路**：Tailscale(HTTPS) → gzip 压缩代理(3081) → dsh(3080)，历史响应压缩约 10 倍。

### 修复
- 修复 `crypto.randomUUID` 在非安全上下文（HTTP）下缺失的问题（手机 WebView polyfill）。
- 修复历史加载超时/中止：gzip 压缩 + tailscale serve 稳定长连接。

[0.1.0]: https://github.com/g36ck19941-crypto/dsh-desktop-mobile/releases/tag/v0.1.0
