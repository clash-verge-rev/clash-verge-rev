<!--
### 🚨 Breaking Changes
-->

### ✨ Features

- 与 Clash Verge Service 的通信改用 IPC 通信，**需要卸载旧版本服务**（Macos 未验证）
- 默认禁用 RESTfull API 的外部控制器，使用本地通信的方式控制 mihomo
- 对使用 RESTfull API 外部控制器添加 Cors 配置，默认允许 Web UI 默认设置中的地址
- 优化内核切换速度

### 🐛 Bug Fixes

- 在 Linux 上，服务日志文件的所有者为 root 权限，导致日志文件清理失败
- 软件卸载后未移除自启动的注册表值
- 在 Windows 上，系统代理绕过内容格式错误时，无法设置代理，从而导致应用无法退出
