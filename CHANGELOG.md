# 更新日志

本项目的所有显著变更都会记录在此文件。版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

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
