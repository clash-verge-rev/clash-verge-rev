## v(2.4.6)

### 🐞 修复问题

- 修复首次启动时代理信息刷新缓慢
- 修复无网络时无限请求 IP 归属查询
- 修复 WebDAV 页面重试逻辑
- 修复 Linux 通过 GUI 安装服务模式权限不符合预期
- 修复 macOS 因网口顺序导致无法正确设置代理
- 修复恢复休眠后无法操作托盘

<details>
<summary><strong> ✨ 新增功能 </strong></summary>

- 支持订阅设置自动延时监测间隔
- 新增流量隧道管理界面，支持可视化添加/删除隧道配置

</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- 安装服务失败时报告更详细的错误
- 避免脏订阅地址无法 Scheme 导入订阅
- macOS TUN 覆盖 DNS 时使用 114.114.114.114

</details>
