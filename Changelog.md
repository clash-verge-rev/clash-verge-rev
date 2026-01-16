## v2.4.5

> [!WARNING]
> 此版本 macOS 和 Linux 对服务 IPC 权限进一步限制引入了破坏性变更，需要先在旧版本**卸载 TUN 服务**后再安装新版本。
>
> **已经安装的用户**可在终端卸载服务再安装。
>
> 对于 macOS：
>
> ```bash
> APP="/Applications/Clash Verge.app"
> sudo "$APP/Contents/Resources/resources/clash-verge-service-uninstall"
> sudo "$APP/Contents/Resources/resources/clash-verge-service-install"
> ```
>
> 对于 Linux：
>
> ```bash
> sudo clash-verge-service-uninstall
> sudo clash-verge-service-install
> ```

- **Mihomo(Meta) 内核升级至 v1.19.19**

### 🐞 修复问题

- 修复 macOS 有线网络 DNS 劫持失败
- 修复 Monaco 编辑器内右键菜单显示异常
- 修复设置代理端口时检查端口占用
- 修复 Monaco 编辑器初始化卡 Loading
- 修复恢复备份时 `config.yaml` / `profiles.yaml` 文件内字段未正确恢复
- 修复 Windows 下系统主题同步问题
- 修复 URL Schemes 无法正常导入
- 修复 Linux 下无法安装 TUN 服务
- 修复可能的端口被占用误报

<details>
<summary><strong> ✨ 新增功能 </strong></summary>

- 允许代理页面允许高级过滤搜索
- 备份设置页面新增导入备份按钮
- 允许修改通知弹窗位置
- 支持收起导航栏（导航栏右键菜单 / 界面设置）
- 允许将出站模式显示在托盘一级菜单
- 允许禁用在托盘中显示代理组
- 支持在「编辑节点」中直接导入 AnyTLS URI 配置
- 支持关闭「验证代理绕过格式」
- 新增系统代理绕过和 TUN 排除自定义网段的可视化编辑器

</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- 应用内更新日志支持解析并渲染 HTML 标签
- 性能优化前后端在渲染流量图时的资源
- 在 Linux NVIDIA 显卡环境下尝试禁用 WebKit DMABUF 渲染以规避潜在问题
- Windows 下自启动改为计划任务实现
- 改进托盘和窗口操作频率限制实现
- 使用「编辑节点」添加节点时，自动将节点添加到第一个 `select` 类型的代理组的第一位
- 隐藏侧边导航栏和悬浮跳转导航的滚动条
- 完善对 AnyTLS / Mieru / Sudoku 的 GUI 支持
- macOS 和 Linux 对服务 IPC 权限进一步限制
- 移除 Windows 自启动计划任务中冗余的 3 秒延时
- 右键错误通知可复制错误详情
- 保存 TUN 设置时优化执行流程，避免界面卡顿
- 补充 `deb` / `rpm` 依赖 `libayatana-appindicator`
- 「连接」表格标题的排序点击区域扩展到整列宽度
- 备份恢复时显示加载覆盖层，恢复过程无需再手动关闭对话框

</details>
