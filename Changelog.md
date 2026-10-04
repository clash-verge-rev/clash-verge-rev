## v2.5.8

<details>
<summary><strong> 🐞 修复问题 </strong></summary>

- 修复从开始菜单再次打开应用后，窗口反复弹出并提示启动失败的问题
- 修复多个代理集合包含同名节点时，代理组中的节点变灰并显示 ambiguous、无法选择的问题
- 修复系统托盘代理组中订阅节点延迟始终显示 `-ms` 的问题，超时项改以 `T/O` 标识

**🖥️ Windows**

- 修复 Windows 升级后因文件权限异常无法启动、需要手动清理配置的问题
- 修复 Windows 服务启动类型被改为手动后，软件启动卡住约两分钟的问题，并提供一键修复

</details>

<details>
<summary><strong> ✨ 新增功能 </strong></summary>

- 新增系统托盘代理组中的「测试延迟」菜单项

</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- 优化侧边栏流量图表的 CPU 占用

**🖥️ Windows**

- 优化 Windows 服务安全检查未通过时的提示：启动、安装或修复服务时说明原因与内核占用，并提供处理方法

</details>
