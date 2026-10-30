## v2.5.9

<details>
<summary><strong> 🐞 修复问题 </strong></summary>

- 修复规则扩展包含空列表项时，「编辑规则」界面报错的问题
- 修复托盘测速与代理页行为不一致的问题，移除托盘「测试延迟」入口
- 修复通过 URL 导入订阅时，即使导入的订阅并非当前使用的订阅，也会重新加载当前配置
- 修复 首页 网站测速失败后卡片一直显示测试中
- 修复 代理 页展开分组后不显示最新测速结果，需切换节点才刷新
- 修复 代理 在全局模式下无法展开节点组
- 修复 自定义 CSS 无法修改编辑器字体和字号的问题
- 修复服务模式下，SSH 节点的 `private-key` 使用私钥文件时内核无法启动的问题

**🍎 macOS**

- macOS：修复 Bigsur 上首页测速和流量图无法显示的问题

**🐧 Linux**

- Linux：修复 deb/rpm 安装包错误包含多余的 `frontend-contract` 可执行文件，导致下游重新打包失败的问题

</details>

<details>
<summary><strong> ✨ 新增功能 </strong></summary>

- 新增虚拟网卡设置的「DNS 模式」选项，支持配置 mihomo 系统 DNS 行为
- 新增「IP 信息」自动刷新开关，关闭后仍可手动刷新
- 新增 Muse AI 解锁检测，针对 Muse AI 特有的 Cloudflare 人机验证增加「Risky」状态标记

</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- 优化「链式代理」：开启前需确认网速影响提示，空面板新增「关闭」按钮

**🖥️ Windows**

- Windows 系统代理默认绕过 `*.local` 域名，访问局域网设备的 `.local` 主机名时不再经过代理

</details>
