## v2.5.9

<details>
<summary><strong> 🐞 修复问题 </strong></summary>

- 修复 macOS 快捷面板操作提示导致界面上下跳动的问题，并在节点切换确认后立即更新选中状态
- 修复 macOS 快捷面板在内核未连接时停留加载状态及出现白色空白的问题
- 修复通过 URL 导入订阅时，即使导入的订阅并非当前使用的订阅，也会重新加载当前配置的问题
- 修复「首页」网站测速失败后卡片一直显示测试中的问题

</details>

<details>
<summary><strong> ✨ 新增功能 </strong></summary>

**🍎 macOS**

- 新增菜单栏右键原生弹出面板，采用更宽的紧凑布局，支持常用节点延迟测速，可直接开关代理、切换模式和常用节点，并快捷退出客户端
</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>


**🖥️ Windows**

- Windows 系统代理默认绕过 `*.local` 域名，访问局域网设备的 `.local` 主机名时不再经过代理

</details>
