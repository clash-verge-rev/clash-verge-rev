## v2.5.3

### 🐞 修复问题

<details>
<summary><strong> ✨ 新增功能 </strong></summary>

- 新增混合代理端口冲突自动回退：启动时检测端口占用并持久化可用端口，同时统一首页、设置与系统代理中的生效端口显示

</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- TUN 模式设置也遵循 原始配置 < Merge 覆写 < Script 脚本 < GUI
- 优化监听端口冲突检测：代理端口按最终 Runtime 监听范围校验并协调三层持久化，隧道按实际地址与 TCP/UDP 协议检测且保留热重载
- 优化代理数据处理：统一通过单一 IPC 获取有序代理视图，并增强刷新、链路选择、重复判断及异常状态下的稳定性
- 新增 macOS 启动门禁，避免多用户环境下的实例冲突
- 加强 Service 多用户隔离与身份认证，支持安全的 Owner 接管
- 统一系统代理所有权，实现原子化代理切换
- 新增旧版 Service 迁移引导与 Sidecar 安全回退
- 优化核心启动、停止及更新流程，减少竞态与残留进程

</details>
