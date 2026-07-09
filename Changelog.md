## v2.5.2

### 🐞 修复问题

- macOS 托盘速率可能的样式错误
- 修复订阅 TLS 1.0/1.1 等过旧协议时显示更明确错误原因
- 修复 gzip 压缩订阅响应被当作无效 YAML 导致导入失败的问题
- 修复订阅 URL 使用空密码 Basic Auth 时未发送认证信息的问题
- Linux 托盘可能与其他 tauri 程序托盘冲突导致图标异常
- 修复前端连接页面导致的内存泄漏
- macOS 12(Monterey) 首页 IP 卡兼容性
- 代理卡可能显示的通信错误，但实际可用
- 修复 Fake-IP 模式开启 IPv6 后未生成 fake-ip-range6
- 修复 DNS 覆写的高级模式无法正常编辑
- 修复部分非标准 WebDAV 服务器在备份目录已存在时的问题
- 修复 Linux 应用内更新问题
- 修复 JS 脚本验证因 console 方法调用导致的执行失败问题
- 修复 macOS 内存压力下 WebView 渲染进程被系统终止引发的白屏与主进程内存泄漏
- 删除覆盖全局热键开关的冗余写入
- 修复编辑节点下base64解码未能正确处理非ASCII字符
- 修复订阅规则编辑器自定义规则偶发显示为空的问题

<details>
<summary><strong> ✨ 新增功能 </strong></summary>

- 增加 TrustTunnel, OpenVPN, Tailscale, GostRelay 节点显示支持
- 全局扩展脚本增加恢复默认按钮
- DNS 添加 fake-ip-range6 可配置项

</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- 更健壮的 service 生命周期管理
- 更健壮的 Mihomo API 通信机制
- 关闭 autofill 弹出窗口
- 改进切换订阅后激活选中节点的逻辑
- 实现代理组粘性滚动列表
- 完善了配置覆写的相关逻辑

</details>
