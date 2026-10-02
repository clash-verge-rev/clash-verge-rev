## v2.5.7

<details>
<summary><strong> 🐞 修复问题 </strong></summary>

- 修复读屏软件将普通模式下的侧边栏导航项播报为不可用的可拖拽控件的问题
- 修复订阅包含自定义 DNS 时，确认开启的 DNS 覆写在重启应用后被自动关闭的问题

**🖥️ Windows**

- 修复 Windows 系统盘根目录的删除权限被误判，导致服务模式和 TUN 无法使用的问题
- 修复 Windows 部分系统安装服务失败，提示「program not found」的问题

**🍎 macOS**

- macOS 修复启动或重启应用时偶发内核启动失败，并误提示「需要更新系统服务」的问题
- macOS 修复 VPN 接管网络或开机网络未就绪时的问题：服务模式内核无法启动、TUN 不可用、系统代理状态读取报错
- macOS 修复用 `ipconfig set` 手动配置网卡后无法设置系统代理的问题

**🍎/🐧 macOS/Linux**

- 修复 macOS/Linux 服务模式停止或重启内核时直接强制结束的问题：内核来不及正常退出、最后的日志丢失

</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- 优化服务模式的问题排查：服务自身的运行日志会保存到文件，便于追查内核被停止的原因

**🖥️ Windows**

- 优化 Windows 服务安全检查未通过时的启动提示：不再只显示「服务无法启动内核」，直接说明原因并提供修复文档链接

</details>
