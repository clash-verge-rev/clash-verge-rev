## v2.5.2

### 🐞 修复问题

- macOS 托盘速率可能的样式错误
- 修复订阅 TLS 1.0/1.1 等过旧协议时显示更明确错误原因
- 修复 gzip 压缩订阅响应被当作无效 YAML 导致导入失败的问题
- 修复订阅 URL 使用空密码 Basic Auth 时未发送认证信息的问题

<details>
<summary><strong> ✨ 新增功能 </strong></summary>

- 增加 TrustTunnel, OpenVPN, Tailscale, GostRelay 节点显示支持

</details>

<details>
<summary><strong> 🧹 移除变更 </strong></summary>

- 移除订阅下载 TLS 校验失败后的静态根证书回退重试

</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- 关闭 autofill 弹出窗口

</details>
