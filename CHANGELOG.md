<!--
### 🚨 Breaking Changes
-->

### ✨ Features

- 与 Clash Verge Service 的通信改用 IPC 通信，**需要卸载旧版本服务**（Macos 未验证）
- 使用 mihomo 的 IPC 控制器控制 mihomo 内核，默认禁用 RESTfull API 的外部控制器
- 对使用 RESTfull API 外部控制器添加 Cors 配置，默认允许 Web UI 默认设置中的地址
- 优化内核切换速度
- 重构代理绕过处理以支持平台特定的配置

### 🐛 Bug Fixes

- 在 Linux 上，服务日志文件的所有者为 root 权限，导致日志文件清理失败
- 软件卸载后未移除自启动的注册表值
- 在 Windows 上，通过备份文件恢复软件设置时，由于系统代理绕过内容格式错误，无法更新系统代理，从而导致应用无法退出
