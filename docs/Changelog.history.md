## v2.4.5

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
- 修复设置允许外部控制来源不能立即生效
- 修复前端性能回归问题

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

## v2.4.4

- **Mihomo(Meta) 内核升级至 v1.19.17**

### 🐞 修复问题

- Linux 无法切换 TUN 堆栈
- macOS service 启动项显示名称(试验性修改)
- macOS 非预期 Tproxy 端口设置
- 流量图缩放异常
- PAC 自动代理脚本内容无法动态调整
- 兼容从旧版服务模式升级
- Monaco 编辑器的行数上限
- 已删除节点在手动分组中导致配置无法加载
- 仪表盘与托盘状态不同步
- 彻底修复 macOS 连接页面显示异常
- windows 端监听关机信号失败
- 修复代理按钮和高亮状态不同步
- 修复侧边栏可能的未能正确跳转
- 修复解锁测试部分地区图标编码不正确
- 修复 IP 检测切页后强制刷新，改为仅在必要时更新
- 修复在搜索框输入不完整正则直接崩溃
- 修复创建窗口时在非简体中文环境或深色主题下的短暂闪烁
- 修复更新时加载进度条异常
- 升级内核失败导致内核不可用问题
- 修复 macOS 在安装和卸载服务时提示与操作不匹配
- 修复菜单排序模式拖拽异常
- 修复托盘菜单代理组前的异常勾选状态
- 修复 Windows 下自定义标题栏按钮在最小化 / 关闭后 hover 状态残留
- 修复直接覆盖 `config.yaml` 使用时无法展开代理组
- 修复 macOS 下应用启动时系统托盘图标颜色闪烁
- 修复应用静默启动模式下非全局热键一直抢占其他应用按键问题
- 修复首页当前节点卡片按延迟排序时，打开节点列表后，`timeout` 节点被排在正常节点前的问题

<details>
<summary><strong> ✨ 新增功能 </strong></summary>

- 支持连接页面各个项目的排序
- 实现可选的自动备份
- 连接页面支持查看已关闭的连接（最近最多 500 个已关闭连接）
- 日志页面支持按时间倒序
- 增加「重新激活订阅」的全局快捷键
- WebView2 Runtime 修复构建升级到 133.0.3065.92
- 侧边栏右键新增「恢复默认排序」
- Linux 下新增对 TUN 「自动重定向」（`auto-redirect` 字段）的配置支持，默认关闭

</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- 网络请求改为使用 rustls，提升 TLS 兼容性
- rustls 避免因服务器证书链配置问题或较新 TLS 要求导致订阅无法导入
- 替换前端信息编辑组件，提供更好性能
- 优化后端内存和性能表现
- 防止退出时可能的禁用 TUN 失败
- 全新 i18n 支持方式
- 优化备份设置布局
- 优化流量图性能表现，实现动态 FPS 和窗口失焦自动暂停
- 性能优化系统状态获取
- 优化托盘菜单当前订阅检测逻辑
- 优化连接页面表格渲染
- 优化链式代理 UI 反馈
- 优化重启应用的资源清理逻辑
- 优化前端数据刷新
- 优化流量采样和数据处理
- 优化应用重启/退出时的资源清理性能, 大幅缩短执行时间
- 优化前端 WebSocket 连接机制
- 改进旧版 Service 需要重新安装检测流程
- 优化 macOS, Linux 和 Windows 系统信号处理
- 链式代理仅显示 Selector 类型规则组
- 优化 Windows 系统代理设置，不再依赖 `sysproxy.exe` 来设置代理

</details>

## v2.4.3

**发行代号：澜**
代号释义：澜象征平稳与融合，本次版本聚焦稳定性、兼容性、性能与体验优化，全面提升整体可靠性。

特别感谢 @Slinetrac, @oomeow, @Lythrilla, @Dragon1573 的出色贡献

### 🐞 修复问题

- 优化服务模式重装逻辑，避免不必要的重复检查
- 修复轻量模式退出无响应的问题
- 修复托盘轻量模式支持退出/进入
- 修复静默启动和自动进入轻量模式时，托盘状态刷新不再依赖窗口创建流程
- macOS Tun/系统代理 模式下图标大小不统一
- 托盘节点切换不再显示隐藏组
- 修复前端 IP 检测无法使用 ipapi, ipsb 提供商
- 修复MacOS 下 Tun开启后 系统代理无法打开的问题
- 修复服务模式启动时，修改、生成配置文件或重启内核可能导致页面卡死的问题
- 修复 Webdav 恢复备份不重启
- 修复 Linux 开机后无法正常代理需要手动设置
- 修复增加订阅或导入订阅文件时订阅页面无更新
- 修复系统代理守卫功能不工作
- 修复 KDE + Wayland 下多屏显示 UI 异常
- 修复 Windows 深色模式下首次启动客户端标题栏颜色异常
- 修复静默启动不加载完整 WebView 的问题
- 修复 Linux WebKit 网络进程的崩溃
- 修复无法导入订阅
- 修复实际导入成功但显示导入失败的问题
- 修复服务不可用时，自动关闭 Tun 模式导致应用卡死问题
- 修复删除订阅时未能实际删除相关文件
- 修复 macOS 连接界面显示异常
- 修复规则配置项在不同配置文件间全局共享导致切换被重置的问题
- 修复 Linux Wayland 下部分 GPU 可能出现的 UI 渲染问题
- 修复自动更新使版本回退的问题
- 修复首页自定义卡片在切换轻量模式时失效
- 修复悬浮跳转导航失效
- 修复小键盘热键映射错误
- 修复前端无法及时刷新操作状态
- 修复 macOS 从 Dock 栏退出轻量模式状态不同步
- 修复 Linux 系统主题切换不生效
- 修复 `允许自动更新` 字段使手动订阅刷新失效
- 修复轻量模式托盘状态不同步
- 修复一键导入订阅导致应用卡死崩溃的问题

<details>
<summary><strong> ✨ 新增功能 </strong></summary>

- **Mihomo(Meta) 内核升级至 v1.19.15**
- 支持前端修改日志（最大文件大小、最大保留数量）
- 新增链式代理图形化设置功能
- 新增系统标题栏与程序标题栏切换 （设置-页面设置-倾向系统标题栏）
- 监听关机事件，自动关闭系统代理
- 主界面“当前节点”卡片新增“延迟测试”按钮
- 新增批量选择配置文件功能
- Windows / Linux / MacOS 监听关机信号，优雅恢复网络设置
- 新增本地备份功能
- 主界面“当前节点”卡片新增自动延迟检测开关（默认关闭）
- 允许独立控制订阅自动更新
- 托盘 `更多` 中新增 `关闭所有连接` 按钮
- 新增左侧菜单栏的排序功能（右键点击左侧菜单栏）
- 托盘 `打开目录` 中新增 `应用日志` 和 `内核日志`
</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- 重构并简化服务模式启动检测流程，消除重复检测
- 重构并简化窗口创建流程
- 重构日志系统，单个日志默认最大 10 MB
- 优化前端资源占用
- 改进 macos 下系统代理设置的方法
- 优化 TUN 模式可用性的判断
- 移除流媒体检测的系统级提示(使用软件内通知)
- 优化后端 i18n 资源占用
- 改进 Linux 托盘支持并添加 `--no-tray` 选项
- Linux 现在在新生成的配置中默认将 TUN 栈恢复为 mixed 模式
- 为代理延迟测试的 URL 设置增加了保护以及添加了安全的备用 URL
- 更新了 Wayland 合成器检测逻辑，从而在 Hyprland 会话中保留原生 Wayland 后端
- 改进 Windows 和 Unix 的 服务连接方式以及权限，避免无法连接服务或内核
- 修改内核默认日志级别为 Info
- 支持通过桌面快捷方式重新打开应用
- 支持订阅界面输入链接后回车导入
- 选择按延迟排序时每次延迟测试自动刷新节点顺序
- 配置重载失败时自动重启核心
- 启用 TUN 前等待服务就绪
- 卸载 TUN 时会先关闭
- 优化应用启动页
- 优化首页当前节点对MATCH规则的支持
- 允许在 `界面设置` 修改 `悬浮跳转导航延迟`
- 添加热键绑定错误的提示信息
- 在 macOS 10.15 及更高版本默认包含 Mihomo-go122，以解决 Intel 架构 Mac 无法运行内核的问题
- Tun 模式不可用时，禁用系统托盘的 Tun 模式菜单
- 改进订阅更新方式，仍失败需打开订阅设置 `允许危险证书`
- 允许设置 Mihomo 端口范围 1000(含) - 65536(含)

</details>

## v2.4.2

### ✨ 新增功能

- 增加托盘节点选择

### 🚀 性能优化

- 优化前端首页加载速度
- 优化前端未使用 i18n 文件缓存
- 优化后端内存占用
- 优化后端启动速度

### 🐞 修复问题

- 修复首页节点切换失效的问题
- 修复和优化服务检查流程
- 修复2.4.1引入的订阅地址重定向报错问题
- 修复 rpm/deb 包名称问题
- 修复托盘轻量模式状态检测异常
- 修复通过 scheme 导入订阅崩溃
- 修复单例检测实效
- 修复启动阶段可能导致的无法连接内核
- 修复导入订阅无法 Auth Basic

### 👙 界面样式

- 简化和改进代理设置样式

## v2.4.1

### 🏆 重大改进

- **应用响应速度提升**：采用全新异步处理架构，大幅提升应用响应速度和稳定性

### ✨ 新增功能

- **Mihomo(Meta) 内核升级至 v1.19.13**

### 🚀 性能优化

- 优化热键响应速度，提升快捷键操作体验
- 改进服务管理响应性，减少系统服务操作等待时间
- 提升文件和配置处理性能
- 优化任务管理和日志记录效率
- 优化异步内存管理，减少内存占用并提升多任务处理效率
- 优化启动阶段初始化性能

### 🐞 修复问题

- 修复应用在某些操作中可能出现的响应延迟问题
- 修复任务管理中的潜在并发问题
- 修复通过托盘重启应用无法恢复
- 修复订阅在某些情况下无法导入
- 修复无法新建订阅时使用远程链接
- 修复卸载服务后的 tun 开关状态问题
- 修复页面快速切换订阅时导致崩溃
- 修复丢失工作目录时无法恢复环境
- 修复从轻量模式恢复导致崩溃

### 👙 界面样式

- 统一代理设置样式

### 🗑️ 移除内容

- 移除启动阶段自动清理过期订阅

## v2.4.0

**发行代号：融**
代号释义： 「融」象征融合与贯通，寓意新版本通过全新 IPC 通信机制 将系统各部分紧密衔接，打破壁垒，实现更高效的 数据流通与全面性能优化。

### 🏆 重大改进

- **核心通信架构升级**：采用全新通信机制，提升应用性能和稳定性
- **流量监控系统重构**：全新的流量监控界面，支持更丰富的数据展示
- **数据缓存优化**：改进配置和节点数据缓存，提升响应速度

### ✨ 新增功能

- **Mihomo(Meta) 内核升级至 v1.19.12**
- 新增版本信息复制按钮
- 增强型流量监控，支持更详细的数据分析
- 新增流量图表多种显示模式
- 新增强制刷新配置和节点缓存功能
- 首页流量统计支持查看刻度线详情

### 🚀 性能优化

- 全面提升数据传输和处理效率
- 优化内存使用，减少系统资源消耗
- 改进流量图表渲染性能
- 优化配置和节点刷新策略，从5秒延长到60秒
- 改进数据缓存机制，减少重复请求
- 优化异步程序性能

### 🐞 修复问题

- 修复系统代理状态检测和显示不一致问题
- 修复系统主题窗口颜色不一致问题
- 修复特殊字符 URL 处理问题
- 修复配置修改后缓存不同步问题
- 修复 Windows 安装器自启设置问题
- 修复 macOS 下 Dock 图标恢复窗口问题
- 修复 linux 下 KDE/Plasma 异常标题栏按钮
- 修复架构升级后节点测速功能异常
- 修复架构升级后流量统计功能异常
- 修复架构升级后日志功能异常
- 修复外部控制器跨域配置保存问题
- 修复首页端口显示不一致问题
- 修复首页流量统计刻度线显示问题
- 修复日志页面按钮功能混淆问题
- 修复日志等级设置保存问题
- 修复日志等级异常过滤
- 修复清理日志天数功能异常
- 修复偶发性启动卡死问题
- 修复首页虚拟网卡开关在管理模式下的状态问题

### 🔧 技术改进

- 统一使用新的内核通信方式
- 新增外部控制器配置界面
- 改进跨平台兼容性支持

## v2.3.2

### 🐞 修复问题

- 修复系统代理端口不同步问题
- 修复自定义 `css` 背景图无法生效问题
- 修复在轻量模式下快速点击托盘图标带来的竞争态卡死问题
- 修复同时开启静默启动与自动进入轻量模式后，自动进入轻量模式失效的问题
- 修复静默启动时托盘工具栏轻量模式开启与关闭状态的同步
- 修复导入订阅时非 http 协议链接被错误尝试导入
- 修复切换节点后页面长时间 loading 及缓存过期导致的数据不同步问题
- 修复将快捷键名称更名为 `Clash Verge`之后无法删除图标和无法删除注册表
- 修复`DNS`覆写 `fallback` `proxy server` `nameserver` `direct Nameserver` 字段支持留空
- 修复`DNS`覆写 `nameserver-policy` 字段无法正确识别 `geo` 库
- 修复搜索框输入特殊字符崩溃
- 修复 Windows 下 Start UP 名称与 exe 名称不统一
- 修复显示 Mihomo 内核日志等级应该大于设置等级

### ✨ 新增功能

- `sidecar` 模式下清理多余的内核进程，防止运行出现异常
- 新 macOS 下 TUN 和系统代理模式托盘图标（暂测）
- 快捷键事件通过系统通知
- 添加外部 `cors` 控制面板

### 🚀 优化改进

- 优化重构订阅切换逻辑，可以随时中断载入过程，防止卡死
- 引入事件驱动代理管理器，优化代理配置更新逻辑，防止卡死
- 改进主页订阅卡流量已使用比例计算精度
- 优化后端缓存刷新机制，支持毫秒级 TTL（默认 3000ms），减少重复请求并提升性能，切换节点时强制刷新后端数据，前端 UI 实时更新，操作更流畅
- 解耦前端数据拉取与后端缓存刷新，提升节点切换速度和一致性

### 🗑️ 移除内容

- 移除了 macOS tray 图标显示网络速率

### 🌐 国际化更新

- 修复部分翻译缺失和不一致问题

## v2.3.1

### 🐞 修复问题

- 增加配置文件校验，修复从古老版本升级上来的"No such file or directory (os error 2)"错误
- 修复扩展脚本转义错误
- 修复 macOS Intel X86 架构构建错误导致无法运行
- 修复 Linux 下界面边框白边问题
- 修复 托盘 无响应问题
- 修复 托盘 无法从轻量模式退出并恢复窗口
- 修复 快速切换订阅可能导致的卡死问题

### ✨ 新增功能

- 新增 window-state 窗口状态管理和恢复

### 🚀 优化改进

- 优化 托盘 统一响应
- 优化 静默启动+自启动轻量模式 运行方式
- 降低前端潜在内存泄漏风险，提升运行时性能
- 优化 React 状态、副作用、数据获取、清理等流程。

## v2.3.0

**发行代号：御**
代号释义： 「御」，象征掌控与守护，寓意本次版本对系统稳定性、安全性与用户体验的全面驾驭与提升。

尽管 `external-controller` 密钥现已自动补全默认值且不允许为空，**仍建议手动修改密钥以提高安全性**。

### ⚠️ 已知问题

- 仅在 Ubuntu 22.04/24.04、Fedora 41 的 **GNOME 桌面环境** 做过简单测试，不保证其他 Linux 发行版兼容，后续将逐步适配和优化。
- macOS：
  - MacOS 下自动升级成功后请关闭程序等待 30 秒重启，因为 MacOS 的端口释放特性，卸载服务后需重启应用等 30 秒才能恢复内核通信。立即启动可能无法正常启动内核。
  - 墙贴主要为浅色，深色 Tray 图标存在闪烁问题；
  - 彩色 Tray 图标颜色偏淡；

- 已确认窗口状态管理器存在上游缺陷，已暂时移除窗口大小与位置记忆功能。

### 🐞 修复问题

- 修复首页“代理模式”快速切换导致的卡死问题
- 修复 MacOS 快捷键关闭窗口无法启用自动轻量模式
- 修复静默启动异常窗口的创建与关闭流程
- 修复 Windows 下错误注册的全局快捷键 `Ctrl+Q`
- 修复解锁测试报错信息与 VLESS URL 解码时的网络类型错误
- 修复切换自定义代理地址后系统代理状态异常
- 修复 macOS TUN 默认无效网卡名称
- 修复更改订阅后托盘 UI 不同步的问题
- 修复服务模式安装后无法立即开启 TUN 模式
- 修复无法删除 `.window-state.json`
- 修复无法修改配置更新 HTTP 请求超时问题
- 修复 `getDelayFix` 钩子异常
- 修复外部扩展脚本覆写代理组时首页无法显示代理组
- 修复 Verge 导出诊断版本与设置页面不同步
- 修复切换语言时设置页面可能加载失败
- 修复编辑器中连字符处理问题
- 修复提权漏洞，改用带认证的 IPC 通信机制
- 修复静默启动无法使用自动轻量模式
- 修复 JS 脚本转义特殊字符报错
- 修复 macOS 静默启动时异常启动 Dock 栏图标

### ✨ 新增功能

- **Mihomo(Meta) 内核升级至 v1.19.10**
- 支持设置代理地址为非 `127.0.0.1`，提升 WSL 兼容性
- 系统代理守卫：可检测意外变更并自动恢复
- 托盘新增当前轻量模式状态显示
- 关闭系统代理时同时断开已建立的连接
- 新增 WebDAV 功能：
  - 加入 UA 请求头
  - 支持目录重定向
  - 备份目录检查与上传重试机制

- 自动订阅更新机制：
  - 加入请求超时机制防止卡死
  - 支持在代理状态下自动重试订阅更新
  - 支持订阅卡片点击切换下次自动更新时间，并显示更新结果提示

- DNS 设置新增 Hosts 配置功能
- 首页代理节点支持排序
- 支持服务模式手动卸载，回退至 Sidecar 模式
- 核心状态管理支持切换、升级、重启
- 配置加载阶段自动补全 `external-controller secret`
- 新增日志自动清理周期选项（含1天）
- 新增 Zashboard 一键跳转入口
- 使用系统默认窗口管理器

### 🚀 优化改进

- **系统相关：**
  - 系统代理 Bypass 设置优化
  - 优化代理设置更新逻辑与守卫机制
  - Windows 启动方式调整为 Startup 文件夹，解决管理员模式下自启问题

- **性能与稳定性：**
  - 全面异步化处理配置加载、UI 启动、事件通知等关键流程，解决卡顿问题
  - 优化 MihomoManager 实现与窗口创建流程
  - 改进内核日志等级为 `warn`，减少噪音输出
  - 重构主进程与通知系统，提升响应性与分离度
  - 优化网络请求与错误处理机制
  - 添加网络管理器防止资源竞争引发 UI 卡死
  - 优化配置文件加载内存使用
  - 优化缓存 Mihomo proxy 和 providers 信息内存使用

- **前端与界面体验：**
  - 切换规则页自动刷新数据
  - 非激活订阅编辑时不再触发配置重载
  - 优化托盘速率显示，macOS 下默认关闭
  - Windows 快捷键名称更名为 `Clash Verge`
  - 更新失败可回退至使用代理重试
  - 支持异步端口查找与保存，端口支持随机生成
  - 修改端口检测范围至 `1111-65536`
  - 优化保存机制，使用平滑函数防止卡顿

- **配置增强与安全性：**
  - 配置缺失 `secret` 字段时自动补全为 `set-your-secret`
  - 强制为 Mihomo 配置补全 `external-controller-cors` 字段（默认不允许跨域，限制本地访问）计划后续支持自定义 cors
  - 优化窗口权限设置与状态初始化逻辑
  - 网络延迟测试替换为 HTTPS 协议：`https://cp.cloudflare.com/generate_204`
  - 优化 IP 信息获取流程，添加去重机制与轮询检测算法

- 同步修复翻译错误与不一致项，优化整体语言体验
- 加强语言切换后的页面稳定性，避免加载异常

### 🗑️ 移除内容

- 窗口状态管理器（上游存在缺陷）
- WebDAV 跨平台备份恢复限制

---

## v2.2.3

#### 已知问题

- 仅在Ubuntu 22.04/24.04，Fedora 41 **Gnome桌面环境** 做过简单测试，不保证其他其他Linux发行版可用，将在未来做进一步适配和调优
- MacOS 自定义图标与速率显示推荐图标尺寸为 256x256。其他尺寸（可能）会导致不正常图标和速率间隙
- MacOS 下 墙贴主要为浅色，Tray 图标深色时图标闪烁；彩色 Tray 速率颜色淡
- Linux 下 Clash Verge Rev 内存占用显著高于 Windows / MacOS

### 2.2.3 相对于 2.2.2

#### 修复了：

- 首页“当前代理”因为重复刷新导致的CPU占用过高的问题
- “开机自启”和“DNS覆写”开关跳动问题
- 自定义托盘图标未能应用更改
- MacOS 自定义托盘图标显示速率时图标和文本间隙过大
- MacOS 托盘速率显示不全
- Linux 在系统服务模式下无法拉起 Mihomo 内核
- 使用异步操作，避免获取系统信息和切换代理模式可能带来的崩溃
- 相同节点名称可能导致的页面渲染出错
- URL Schemes被截断的问题
- 首页流量统计卡更好的时间戳范围
- 静默启动无法触发自动轻量化计时器

#### 新增了：

- Mihomo(Meta)内核升级至 1.19.4
- Clash Verge Rev 从现在开始不再强依赖系统服务和管理权限
- 支持根据用户偏好选择Sidecar(用户空间)模式或安装服务
- 增加载入初始配置文件的错误提示，防止切换到错误的订阅配置
- 检测是否以管理员模式运行软件，如果是提示无法使用开机自启
- 代理组显示节点数量
- 统一运行模式检测，支持管理员模式下开启TUN模式
- 托盘切换代理模式会根据设置自动断开之前连接
- 如订阅获取失败回退使用Clash内核代理再次尝试

#### 移除了：

- 实时保存窗口位置和大小。这个功能可能会导致窗口异常大小和位置，还需观察。

#### 优化了：

- 重构了后端内核管理逻辑，更轻量化和有效的管理内核，提高了性能和稳定性
- 前端统一刷新应用数据，优化数据获取和刷新逻辑
- 优化首页流量图表代码，调整图表文字边距
- MacOS 托盘速率更好的显示样式和更新逻辑
- 首页仅在有流量图表时显示流量图表区域
- 更新DNS默认覆写配置
- 移除测试目录，简化资源初始化逻辑

## v2.2.2

**发行代号：拓**

感谢 Tunglies 对 Verge 后端重构，性能优化做出的重大贡献！

代号释义： 本次发布在功能上的大幅扩展。新首页设计为用户带来全新交互体验，DNS 覆写功能增强网络控制能力，解锁测试页面助力内容访问自由度提升，轻量模式提供灵活使用选择。此外，macOS 应用菜单集成、sidecar 模式、诊断信息导出等新特性进一步丰富了软件的适用场景。这些新增功能显著拓宽了 Clash Verge 的功能边界，为用户提供了更强大的工具和可能性。

#### 已知问题

- 仅在Ubuntu 22.04/24.04，Fedora 41 **Gnome桌面环境** 做过简单测试，不保证其他其他Linux发行版可用，将在未来做进一步适配和调优

### 2.2.2 相对于 2.2.1(已下架不再提供)

#### 修复了：

- 弹黑框的问题（原因是服务崩溃触发重装机制）
- MacOS进入轻量模式以后隐藏Dock图标
- 增加轻量模式缺失的tray翻译
- Linux下的窗口边框被削掉的问题

#### 新增了:

- 加强服务检测和重装逻辑
- 增强内核与服务保活机制
- 增加服务模式下的僵尸进程清理机制
- 新增当服务模式多次尝试失败后自动回退至用户空间模式

### 2.2.1 相对于 2.2.0(已下架不再提供)

#### 修复了：

1. **首页**
   - 修复 Direct 模式首页无法渲染
   - 修复 首页启用轻量模式导致 ClashVergeRev 从托盘退出
   - 修复 系统代理标识判断不准的问题
   - 修复 系统代理地址错误的问题
   - 代理模式“多余的切换动画”
2. **系统**
   - 修复 MacOS 无法使用快捷键粘贴/选择/复制订阅地址。
   - 修复 代理端口设置同步问题。
   - 修复 Linux 无法与 Mihomo 核心 和 ClashVergeRev 服务通信
3. **界面**
   - 修复 连接详情卡没有跟随主题色
4. **轻量模式**
   - 修复 MacOS 轻量模式下 Dock 栏图标无法隐藏。

#### 新增了:

1. **首页**
   - 首页文本过长自动截断
2. **轻量模式**
   - 新增托盘进入轻量模式支持
   - 新增进入轻量模式快捷键支持
3. **系统**
   - 在 ClashVergeRev 对 Mihomo 进行操作时，总是尝试确保两者运行
   - 服务器模式下启动mihomo内核的时候查找并停止其他已经存在的内核进程，防止内核假死等问题带来的通信失败
4. **托盘**
   - 新增 MacOS 启用托盘速率显示时，可选隐藏托盘图标显示

---

## 2.2.0(已下架不再提供)

#### 新增功能

1. **首页**
   - 新增首页功能，默认启动页面改为首页。
   - 首页流量图卡片显示上传/下载名称。
   - 首页支持轻量模式切换。
   - 流量统计数据持久保存。
   - 限制首页配置文件卡片URL长度。

2. **DNS 设置与覆写**
   - 新增 DNS 覆写功能。
   - 默认启用 DNS 覆写。

3. **解锁测试**
   - 新增解锁测试页面。

4. **轻量模式**
   - 新增轻量模式及设置。
   - 添加自动轻量模式定时器。

5. **系统支持**
   - Mihomo(meta)内核升级 1.19.3
   - macOS 支持 CMD+W 关闭窗口。
   - 新增 macOS 应用菜单。
   - 添加 macOS 安装服务时候的管理员权限提示。
   - 新增 sidecar(用户空间启动内核) 模式。

6. **其他**
   - 增强延迟测试日志和错误处理。
   - 添加诊断信息导出。
   - 新增代理命令。

#### 修复

1. **系统**
   - 修复 Windows 热键崩溃。
   - 修复 macOS 无框标题。
   - 修复 macOS 静默启动崩溃。
   - 修复 macOS tray图标错位到左上角的问题。
   - 修复 Windows/Linux 运行时崩溃。
   - 修复 Win10 阴影和边框问题。
   - 修复 升级或重装后开机自启状态检测和同步问题。

2. **构建**
   - 修复构建失败问题。

#### 优化

1. **性能**
   - 重构后端，巨幅性能优化。
   - 优化首页组件性能。
   - 优化流量图表资源使用。
   - 提升代理组列表滚动性能。
   - 加快应用退出速度。
   - 加快进入轻量模式速度。
   - 优化小数值速度更新。
   - 增加请求超时至 60 秒。
   - 修复代理节点选择同步。
   - 优化修改verge配置性能。

2. **重构**
   - 重构后端，巨幅性能优化。
   - 优化定时器管理。
   - 重构 MihomoManager 处理流量。
   - 优化 WebSocket 连接。

3. **其他**
   - 更新依赖。
   - 默认 TUN 堆栈改为 gvisor。

---

## v2.1.2

**发行代号：臻**

代号释义： 千锤百炼臻至善，集性能跃升、功能拓展、交互焕新于一体，彰显持续打磨、全方位优化的迭代精神。

感谢 Tychristine 对社区群组管理做出的重大贡献！

##### 2.1.2相对2.1.1(已下架不再提供)更新了：

- 无法更新和签名验证失败的问题(该死的CDN缓存)
- 设置菜单区分Verge基本设置和高级设置
- 增加v2 Updater的更多功能和权限
- 退出Verge后Tun代理状态仍保留的问题

##### 2.1.1相对2.1.0(已下架不再提供)更新了：

- 检测所需的Clash Verge Service版本（杀毒软件误报可能与此有关，因为检测和安装新版本Service需管理员权限）
- MacOS下支持彩色托盘图标和更好速率显示（感谢Tunglies）
- 文件类型判断不准导致脚本检测报错的问题
- 打开Win下的阴影(Win10因底层兼容性问题，可能圆角和边框显示不太完美)
- 边框去白边
- 修复Linux下编译问题
- 修复热键无法关闭面板的问题

##### 2.1.0 - 发行代号：臻

### 功能新增

- 新增窗口状态实时监控与自动保存功能
- 增强核心配置变更时的验证与错误处理机制
- 支持通过环境变量 `CLASH_VERGE_REV_IP`自定义复制IP地址
- 添加连接表列宽持久化设置与进程过滤功能
- 新增代理组首字母导航与动态滚动定位功能
- 实现连接追踪暂停/恢复功能
- 支持从托盘菜单快速切换代理配置
- 添加轻量级模式开关选项
- 允许用户自定义TUN模式增强类型和FakeIP范围
- 新增系统代理状态指示器
- 增加Alpha版本自动重命名逻辑
- 优化字母导航工具提示与防抖交互机制

### 性能优化

- 重构代理列表渲染逻辑，提升布局计算效率
- 优化代理数据更新机制，采用乐观UI策略
- 改进虚拟列表渲染性能（Virtuoso）
- 提升主窗口Clash模式切换速度（感谢Tunglies）
- 加速内核关闭流程并优化管理逻辑
- 优化节点延迟刷新速率
- 改进托盘网速显示更新逻辑
- 提升配置验证错误信息的可读性
- 重构服务架构，优化代码组织结构（感谢Tunglies）
- 优化内核启动时的配置验证流程

### 问题修复

- 修复删除节点时关联组信息残留问题
- 解决菜单切换异常与重复勾选问题
- 修正连接页流量计算错误
- 修复Windows圆角显示异常问题
- 解决控制台废弃API警告
- 修复全局热键空值导致的崩溃
- 修复Alpha版本Windows打包重命名问题
- 修复MacOS端口切换崩溃问题
- 解决Linux持续集成更新器问题
- 修复静默启动后热键失效问题
- 修正TypeScript代理组类型定义
- 修复Windows托盘图标空白问题
- 优化远程目标地址显示（替换旧版IP展示）

### 交互体验

- 统一多平台托盘图标点击行为
- 优化代理列表滚动流畅度
- 改进日志搜索功能与数据管理
- 重构热键管理逻辑，修复托盘冻结问题
- 优化托盘网速显示样式
- 增强字母导航工具提示的动态响应

### 国际化

- 新增配置检查多语言支持
- 添加轻量级模式多语言文本
- 完善多语言翻译内容

### 维护更新

- 将默认TUN协议栈改为gVisor
- 更新Node.js运行版本
- 移除自动生成更新器文件
- 清理废弃代码与未使用组件
- 禁用工作流自动Alpha标签更新
- 更新依赖库版本
- 添加MacOS格式转换函数专项测试
- 优化开发模式日志输出

### 安全增强

- 强化应用启动时的配置验证机制
- 改进脚本验证与异常处理流程
- 修复编译警告（移除无用导入）

---

## v2.0.3

### Notice

- !!使用出现异常的，打开设置-->配置目录 备份 后 删除所有文件 尝试是否正常!！
- 历时3个月的紧密开发与严格测试稳定版2.0.0终于发布了：巨量改进与性能、稳定性提升，目前Clash Verge Rev已经有了比肩cfw的健壮性；而且更强大易用！
- 由于更改了服务安装逻辑，每次更新安装需要输入系统密码卸载老版本服务和安装新版本服务，以后可以丝滑使用tun(虚拟网卡)模式

### 2.0.3相对于2.0.2改进修复了：

1. 修复VLess-URL识别网络类型错误 f400f90 #2126
2. 新增系统代理绕过文本校验 c71e18e
3. 修复脚本编辑器UI显示不正确 6197249 #2267
4. 修复Shift热键无效 589324b #2278
5. 新增nushell环境变量复制 d233a84
6. 修复全局扩展脚本无法覆写DNS d22b37c #2235
7. 切换到系统代理相对于稳定的版本 38745d4
8. 修改fake-ip-range网段 0e3b631
9. 修复窗口隐藏后WebSocket未断开连接，减小内存风险 b42d13f
10. 改进系统代理绕过设置 c5c840d
11. 修复i18n翻译文本缺失 b149084
12. 修复双击托盘图标打开面板 f839d3b #2346
13. 修复Windows10窗口白色边框 4f6ca40 #2425
14. 修复Windows窗口状态恢复 4f6ca40
15. 改进保存配置文件自动重启Mihomo内核 0669f7a
16. 改进更新托盘图标性能 d9291d4
17. 修复保存配置后代理列表未更新 542baf9 #2460
18. 新增MacOS托盘显示实时速率，可在"界面设置"中关闭 1b2f1b6
19. 新增托盘菜单显示已设置的快捷键 eeff4d4
20. 新增重载配置文件错误响应"400"时显示更多错误信息 c5989d2 #2492
21. 修复GUI代理状态与菜单显示不一致 13b63b5 #2502
22. 新增默认语言跟随系统语言(无语言支持即为英语)，添加了阿拉伯语、印尼语、鞑靼语支持 9655f77 #2940

### Features

- Meta(mihomo)内核升级 1.19.1
- 增加更多语言和托盘语言跟随
- MacOS增加状态栏速率显示
- 托盘显示快捷键
- 重载配置文件错误响应"400"时显示更多错误信息
- 改进保存配置文件自动重启Mihomo内核

### Performance

- 改进更新托盘图标性能
- 窗口隐藏后WebSocket断开连接

---

## v2.0.2

### Notice

- !!使用出现异常的，打开设置-->配置目录 备份 后 删除所有文件 尝试是否正常!！
- 历时3个月的紧密开发与严格测试稳定版2.0.0终于发布了：巨量改进与性能、稳定性提升，目前Clash Verge Rev已经有了比肩cfw的健壮性；而且更强大易用！
- 由于更改了服务安装逻辑，Mac/Linux 首次安装需要输入系统密码卸载和安装服务，以后可以丝滑使用 tun(虚拟网卡)模式
- 因 Tauri 2.0 底层 bug，关闭窗口后保留webview进程，优点是再次打开面板更快，缺点是内存使用略有增加

### 2.0.2相对于2.0.1改进了：

- MacOS 下自定义图标可以支持彩色、单色切换
- 修正了 Linux 下多个内核僵尸进程的问题
- 修正了 DNS ipv6 强制覆盖的逻辑
- 修改了 MacOS tun 模式下覆盖设置 dns 字段的问题
- 修正了 MacOS tray 图标不会随代理模式更改的问题
- 静默启动下重复运行会出现多个实例的bug
- 安装的时候自动删除历史残留启动项
- Tun模式默认是还用内核推荐的 mixed 堆栈
- 改进了默认窗口大小（启动软件窗口不会那么小了）
- 改进了 WebDAV 备份超时时间机制
- 测试菜单添加滚动条
- 改进和修正了 Tun 模式下对设置的覆盖逻辑
- 修复了打开配置出错的问题
- 修复了配置文件无法拖拽添加的问题
- 改善了浅色模式的对比度

### 2.0.1相对于2.0.0改进了：

- 无法从 2.0rc和2.0.0 升级的问题（已经安装了2.0版本的需手动下载安装）
- MacOS 系统下少有的无法安装服务，无法启动的问题，目前更健壮了
- 当系统中没有 yaml 编辑器的情况下，打开文件程序崩溃的问题
- Windows 应用内升级和覆盖安装不会删除老执行文件的问题
- 修改优化了 mac 下 fakeip 段和 dns
- 测试菜单 svg 图标格式检查
- 应用内升级重复安装 vs runtime 的问题
- 修复外部控制下密码有特殊字符认证出错的问题
- 修复恢复 Webdav 备份设置后， Webdav 设置丢失的问题
- 代理页面增加快速回到顶部的按钮

### Breaking changes

- 重大框架升级：使用 Tauri 2.0（巨量改进与性能提升）
- 出现 bug 到 issues 中提出；以后不再接受1.x版本的bug反馈。
- 强烈建议完全删除 1.x 老版本再安装此版本 !!使用出现异常的，打开设置-->配置目录 备份 后 删除所有文件 尝试是否正常!！

### Features

- Meta(mihomo)内核升级 1.18.10
- Win 下的系统代理替换为 Shadowsocks/CFW/v2rayN 等成熟的 sysproxy.exe 方案，解决拨号/VPN 环境下无法设置系统代理的问题
- 服务模式改进为启动软件时自动安装，TUN 模式可自由开启不再限制于服务模式
- Mac 下可用 URL Scheme 导入订阅
- 可使用 Ctrl(cmd)+Q 快捷键退出程序
- 成功导入订阅的提示消息
- 能自动选中新导入的订阅
- 日志加入颜色区分
- 改进多处文本表述
- 加入图标 svg 格式检测
- 增加更多 app 调试日志
- 添加 MacOS 下白色桌面的 tray 黑色配色（但会代理系统代理、tun 模式图标失效的问题）
- 增加 Webdav 备份功能
- 添加统一延迟的设置开关
- 添加 Windows 下自动检测并下载 vc runtime 的功能
- 支持显示 mux 和 mptcp 的节点标识
- 延迟测试连接更换 http 的 cp.cloudflare.com/generate_204 （关闭统一延迟的情况下延迟测试结果会有所增加）
- 重构日志记录逻辑，可以收集和筛选所有日志类型了（之前无法记录debug的日志类型）

### Performance

- 优化及重构内核启动管理逻辑
- 优化 TUN 启动逻辑
- 重构和优化 app_handle
- 重构系统代理绕过逻辑
- 移除无用的 PID 创建逻辑
- 优化系统 DNS 设置逻辑
- 后端实现窗口控制
- 重构 MacOS 下的 DNS 设置逻辑

### Bugs Fixes

- 修复已有多个订阅导入新订阅会跳选订阅的问题
- 修复多个 Linux 下的 bug, Tun 模式在 Linux 下目前工作正常
- 修复 Linux wayland 下任务栏图标缺失的问题
- 修复 Linux KDE 桌面环境无法启动的问题
- 移除多余退出变量和钩子
- 修复 MacOS 下 tray 菜单重启 app 失效的问题
- 修复某些特定配置文件载入失败的问题
- 修复 MacOS 下 tun 模式 fakeip 不生效的问题
- 修复 Linux 下 关闭 tun 模式文件报错的问题
- 修复快捷键设置的相关 bug
- 修复 Win 下点左键菜单闪现的问题（Mac 下的操作逻辑相反，默认情况下不管点左/右键均会打开菜单，闪现不属于 bug）

### Known issues

- Windows 下窗口大小无法记忆（等待上游修复）
- Webdav 备份因为安全性和兼容性问题，暂不支持跨平台配置同步

---

## v1.7.7

### Bugs Fixes

- 修复导入订阅没有自动重载(不显示节点)的问题
- 英语状态下修复 Windows 工具栏提示文本超过限制的问题

---

## v1.7.6

### Notice

- Clash Verge Rev 目前已进入稳定周期，日后更新将着重于 bug 修复与内核常规升级

### Features

- Meta(mihomo)内核升级 1.18.7
- 界面细节调整
- 优化服务模式安装逻辑
- 移除无用的 console log
- 能自动选择第一个订阅

### Bugs Fixes

- 修复服务模式安装问题
- 修复 Mac 下的代理绕过 CIDR 写法过滤
- 修复 32 位升级 URL
- 修复不同分组 URL 测试地址配置无效的问题
- 修复 Web UI 下的一处 hostname 参数

---

## v1.7.5

### Features

- 展示局域网 IP 地址信息
- 在设置页面直接复制环境变量
- 优化服务模式安装逻辑

### Performance

- 优化切换订阅速度
- 优化更改端口速度

### Bugs Fixes

- 调整 MacOS 托盘图标大小
- Trojan URI 解析错误
- 卡片拖动显示层级错误
- 代理绕过格式检查错误
- MacOS 下编辑器最大化失败
- MacOS 服务安装失败
- 更改窗口大小导致闪退的问题

---

## v1.7.3

### Features

- 支持可视化编辑订阅代理组
- 支持可视化编辑订阅节点
- 支持可视化编辑订阅规则
- 扩展脚本支持订阅名称参数 `function main(config, profileName)`

### Bugs Fixes

- 代理绕过格式检查错误

---

## v1.7.2

### Break Changes

- 更新后请务必重新导入所有订阅，包括 Remote 和 Local
- 此版本重构了 Merge/Script，更新前请先备份好自定义 Merge 和 Script（更新并不会删除配置文件，但是旧版 Merge 和 Script 在更新后无法从前端访问，备份以防万一）
- Merge 改名为 `扩展配置`，分为 `全局扩展配置` 和 `订阅扩展配置`，全局扩展配置对所有订阅生效，订阅扩展配置只对关联的订阅生效
- Script 改名为 `扩展脚本`，同样分为 `全局扩展脚本` 和 `订阅扩展脚本`
- 订阅扩展配置在订阅右键菜单里进入
- 执行优先级为： 全局扩展配置 -> 全局扩展脚本 -> 订阅扩展配置 ->订阅扩展脚本
- 扩展配置删除了 `prepend/append` 能力，请使用 右键订阅 -> `编辑规则`/`编辑节点`/`编辑代理组` 来代替
- MacOS 用户更新后请重新安装服务模式

### Features

- 升级内核到 1.18.6
- 移除内核授权，改为服务模式实现
- 自动填充本地订阅名称
- 添加重大更新处理逻辑
- 订阅单独指定扩展配置/脚本（需要重新导入订阅）
- 添加可视化规则编辑器（需要重新导入订阅）
- 编辑器新增工具栏按钮（格式化、最大化/最小化）
- WEBUI 使用最新版 metacubex，并解决无法自动登陆问问题
- 禁用部分 Webview2 快捷键
- 热键配置新增连接符 + 号
- 新增部分悬浮提示按钮，用于解释说明
- 当日志等级为 `Debug`时（更改需重启软件生效），支持点击内存主动内存回收（绿色文字）
- 设置页面右上角新增 TG 频道链接
- 各种细节优化和界面性能优化

### Bugs Fixes

- 修复代理绕过格式检查
- 通过进程名称关闭进程
- 退出软件时恢复 DNS 设置
- 修复创建本地订阅时更新间隔无法保存
- 连接页面列宽无法调整

---

## v1.7.1

### Break Changes

- 更新后请务必重新导入所有订阅，包括 Remote 和 Local
- 此版本重构了 Merge/Script，更新前请先备份好自定义 Merge 和 Script（更新并不会删除配置文件，但是旧版 Merge 和 Script 在更新后无法从前端访问，备份以防万一）
- Merge 改名为 `扩展配置`，分为 `全局扩展配置` 和 `订阅扩展配置`，全局扩展配置对所有订阅生效，订阅扩展配置只对关联的订阅生效
- Script 改名为 `扩展脚本`，同样分为 `全局扩展脚本` 和 `订阅扩展脚本`
- 订阅扩展配置在订阅右键菜单里进入
- 执行优先级为： 全局扩展配置 -> 全局扩展脚本 -> 订阅扩展配置 ->订阅扩展脚本
- 扩展配置删除了 `prepend/append` 能力，请使用 右键订阅 -> `编辑规则`/`编辑节点`/`编辑代理组` 来代替
- MacOS 用户更新后请重新安装服务模式

### Features

- 升级内核到 1.18.6
- 移除内核授权，改为服务模式实现
- 自动填充本地订阅名称
- 添加重大更新处理逻辑
- 订阅单独指定扩展配置/脚本（需要重新导入订阅）
- 添加可视化规则编辑器（需要重新导入订阅）
- 编辑器新增工具栏按钮（格式化、最大化/最小化）
- WEBUI 使用最新版 metacubex，并解决无法自动登陆问问题
- 禁用部分 Webview2 快捷键
- 热键配置新增连接符 + 号
- 新增部分悬浮提示按钮，用于解释说明
- 当日志等级为 `Debug`时（更改需重启软件生效），支持点击内存主动内存回收（绿色文字）
- 设置页面右上角新增 TG 频道链接
- 各种细节优化和界面性能优化

### Bugs Fixes

- 修复代理绕过格式检查
- 通过进程名称关闭进程
- 退出软件时恢复 DNS 设置
- 修复创建本地订阅时更新间隔无法保存
- 连接页面列宽无法调整

---

## v1.7.0

### Break Changes

- 此版本重构了 Merge/Script，更新前请先备份好自定义 Merge 和 Script（更新并不会删除配置文件，但是旧版 Merge 和 Script 在更新后无法从前端访问，备份以防万一）
- Merge 改名为 `扩展配置`，分为 `全局扩展配置` 和 `订阅扩展配置`，全局扩展配置对所有订阅生效，订阅扩展配置只对关联的订阅生效
- Script 改名为 `扩展脚本`，同样分为 `全局扩展脚本` 和 `订阅扩展脚本`
- 执行优先级为： 全局扩展配置 -> 全局扩展脚本 -> 订阅扩展配置 ->订阅扩展脚本
- MacOS 用户更新后请重新安装服务模式

### Features

- 移除内核授权，改为服务模式实现
- 自动填充本地订阅名称
- 添加重大更新处理逻辑
- 订阅单独指定扩展配置/脚本（需要重新导入订阅）
- 添加可视化规则编辑器（需要重新导入订阅）
- 编辑器新增工具栏按钮（格式化、最大化/最小化）
- WEBUI 使用最新版 metacubex，并解决无法自动登陆问问题
- 禁用部分 Webview2 快捷键
- 热键配置新增连接符 + 号
- 新增部分悬浮提示按钮，用于解释说明
- 当日志等级为 `Debug`时（更改需重启软件生效），支持点击内存主动内存回收（绿色文字）
- 设置页面右上角新增 TG 频道链接

### Bugs Fixes

- 修复代理绕过格式检查
- 通过进程名称关闭进程
- 退出软件时恢复 DNS 设置
- 修复创建本地订阅时更新间隔无法保存
- 连接页面列宽无法调整

---

## v1.6.6

### Features

- MacOS 应用签名
- 删除 AppImage
- 应用更新对话框添加下载按钮
- 设置系统代理绕过时保留默认值
- 系统代理绕过设置输入格式检查

### Bugs Fixes

- MacOS 代理组图标无法显示
- RPM 包依赖缺失

---

## v1.6.5

### Features

- 添加 RPM 包支持
- 优化细节

### Bugs Fixes

- MacOS 10.15 编辑器空白的问题
- MacOS 低版本启动白屏的问题

---

## v1.6.4

### Features

- 系统代理支持 PAC 模式
- 允许关闭不使用的端口
- 使用新的应用图标
- MacOS 支持切换托盘图标单色/彩色模式
- CSS 注入支持通过编辑器编辑
- 优化代理组列表性能
- 优化流量图显性能
- 支持波斯语

### Bugs Fixes

- Kill 内核后 Tun 开启缓慢的问题
- 代理绕过为空时使用默认值
- 无法读取剪切板内容
- Windows 下覆盖安装无法内核占用问题

---

## v1.6.2

### Features

- 支持本地文件拖拽导入
- 重新支持 32 位 CPU
- 新增内置 Webview2 版本
- 优化 Merge 逻辑，支持深度合并
- 删除 Merge 配置中的 append/prepend-provider 字段
- 支持更新稳定版内核

### Bugs Fixes

- MacOS DNS 还原失败
- CMD 环境变量格式错误
- Linux 下与 N 卡的兼容性问题
- 修改 Tun 设置不立即生效

---

## v1.6.1

### Features

- 鼠标悬浮显示当前订阅的名称 [#938](https://github.com/clash-verge-rev/clash-verge-rev/pull/938)
- 日志过滤支持正则表达式 [#959](https://github.com/clash-verge-rev/clash-verge-rev/pull/959)
- 更新 Clash 内核到 1.18.4

### Bugs Fixes

- 修复 Linux KDE 环境下系统代理无法开启的问题
- 窗口最大化图标调整 [#924](https://github.com/clash-verge-rev/clash-verge-rev/pull/924)
- 修改 MacOS 托盘点击行为(左键菜单，右键点击事件)
- 修复 MacOS 服务模式安装失败的问题

---

## v1.6.0

### Features

- Meta(mihomo)内核回退 1.18.1（当前新版内核 hy2 协议有 bug，等修复后更新）
- 多处界面细节调整 [#724](https://github.com/clash-verge-rev/clash-verge-rev/pull/724) [#799](https://github.com/clash-verge-rev/clash-verge-rev/pull/799) [#900](https://github.com/clash-verge-rev/clash-verge-rev/pull/900) [#901](https://github.com/clash-verge-rev/clash-verge-rev/pull/901)
- Linux 下新增服务模式
- 新增订阅卡片右键可以打开机场首页
- url-test 支持手动选择、节点组 fixed 节点使用角标展示 [#840](https://github.com/clash-verge-rev/clash-verge-rev/pull/840)
- Clash 配置、Merge 配置提供 JSON Schema 语法支持、连接界面调整 [#887](https://github.com/clash-verge-rev/clash-verge-rev/pull/887)
- 修改 Merge 配置文件默认内容 [#889](https://github.com/clash-verge-rev/clash-verge-rev/pull/889)
- 修改 tun 模式默认 mtu 为 1500，老版本升级，需在 tun 模式设置下“重置为默认值”。
- 使用 npm 安装 meta-json-schema [#895](https://github.com/clash-verge-rev/clash-verge-rev/pull/895)
- 更新部分翻译 [#904](https://github.com/clash-verge-rev/clash-verge-rev/pull/904)
- 支持 ico 格式的任务栏图标

### Bugs Fixes

- 修复 Linux KDE 环境下系统代理无法开启的问题
- 修复延迟检测动画问题
- 窗口最大化图标调整 [#816](https://github.com/clash-verge-rev/clash-verge-rev/pull/816)
- 修复 Windows 某些情况下无法安装服务模式 [#822](https://github.com/clash-verge-rev/clash-verge-rev/pull/822)
- UI 细节修复 [#821](https://github.com/clash-verge-rev/clash-verge-rev/pull/821)
- 修复使用默认编辑器打开配置文件
- 修复内核文件在特定目录也可以更新的问题 [#857](https://github.com/clash-verge-rev/clash-verge-rev/pull/857)
- 修复服务模式的安装目录问题
- 修复删除配置文件的“更新间隔”出现的问题 [#907](https://github.com/clash-verge-rev/clash-verge-rev/issues/907)

### 已知问题（历史遗留问题，暂未找到有效解决方案）

- MacOS M 芯片下服务模式无法安装；临时解决方案：在内核 ⚙️ 下，手动授权，再打开 tun 模式。
- MacOS 下如果删除过网络配置，会导致无法正常打开系统代理；临时解决方案：使用浏览器代理插件或手动配置系统代理。
- Window 拨号连接下无法正确识别并打开系统代理；临时解决方案：使用浏览器代理插件或使用 tun 模式。

---

## v1.5.11

### Features

- Meta(mihomo)内核更新 1.18.2

### Bugs Fixes

- 升级图标无法点击的问题
- 卸载时检查安装目录是否为空
- 代理界面图标重合的问题

---

## v1.5.10

### Features

- 优化 Linux 托盘菜单显示
- 添加透明代理端口设置
- 删除订阅前确认

### Bugs Fixes

- 删除 MacOS 程序坞图标
- Windows 下 service 日志没有清理
- MacOS 无法开启系统代理

---

## v1.5.9

### Features

- 缓存代理组图标
- 使用 `boa_engine` 代替 `rquickjs`
- 支持 Linux armv7

### Bugs Fixes

- Windows 首次安装无法点击
- Windows 触摸屏无法拖动
- 规则列表 `REJECT-DROP` 颜色
- MacOS Dock 栏不显示图标
- MacOS 自定义字体无效
- 避免使用空 UA 拉取订阅

---

## v1.5.8

### Features

- 优化 UI 细节
- Linux 绘制窗口圆角
- 开放 DevTools

### Bugs Fixes

- 修复 MacOS 下开启 Tun 内核崩溃的问题

---

## v1.5.7

### Features

- 优化 UI 各种细节
- 提供菜单栏图标样式切换选项(单色/彩色/禁用)
- 添加自动检查更新开关
- MacOS 开启 Tun 模式自动修改 DNS
- 调整可拖动区域(尝试修复触摸屏无法拖动的问题)

---

## v1.5.6

### Features

- 全新专属 Verge rev UI 界面 (by @Amnesiash) 及细节调整
- 提供允许无效证书的开关
- 删除不必要的快捷键
- Provider 更新添加动画
- Merge 支持 Provider
- 更换订阅框的粘贴按钮，删除默认的"Remote File" Profile 名称
- 链接菜单添加节点显示

### Bugs Fixes

- Linux 下图片显示错误

---

## v1.5.4

### Features

- 支持自定义托盘图标
- 支持禁用代理组图标
- 代理组显示当前代理
- 修改 `打开面板` 快捷键为 `打开/关闭面板`

---

## v1.5.3

### Features

- Tun 设置添加重置按钮

### Bugs Fixes

- Tun 设置项显示错误的问题
- 修改一些默认值
- 启动时不更改启动项设置

---

## v1.5.2

### Features

- 支持自定义延迟测试超时时间
- 优化 Tun 相关设置

### Bugs Fixes

- Merge 操作出错
- 安装后重启服务
- 修复管理员权限启动时开机启动失效的问题

---

## v1.5.1

### Features

- 保存窗口最大化状态
- Proxy Provider 显示数量
- 不再提供 32 位安装包（因为 32 位经常出现各种奇怪问题，比如 tun 模式无法开启；现在系统也几乎没有 32 位了）

### Bugs Fixes

- 优化设置项名称
- 自定义 GLOBAL 代理组时代理组显示错误的问题

---

## v1.5.0

### Features

- 删除 Clash 字段过滤功能
- 添加 socks 端口和 http 端口设置
- 升级内核到 1.18.1

### Bugs Fixes

- 修复 32 位版本无法显示流量信息的问题

---

## v1.4.11

### Break Changes

- 此版本更改了 Windows 安装包安装模式，需要卸载后手动安装，否则无法安装到正确位置

### Features

- 优化了系统代理开启的代码，解决了稀有场景下代理开启卡顿的问题
- 添加 MacOS 下的 debug 日志，以便日后调试稀有场景下 MacOS 下无法开启系统代理的问题
- MacOS 关闭 GUI 时同步杀除后台 GUI [#306](https://github.com/clash-verge-rev/clash-verge-rev/issues/306)

### Bugs Fixes

- 解决自动更新时文件占用问题
- 解决稀有场景下系统代理开启失败的问题
- 删除冗余内核代码

---

## v1.4.10

### Features

- 设置中添加退出按钮
- 支持自定义软件启动页
- 在 Proxy Provider 页面展示订阅信息
- 优化 Provider 支持

### Bugs Fixes

- 更改端口时立即重设系统代理
- 网站测试超时错误

---

## v1.4.9

### Features

- 支持启动时运行脚本
- 支持代理组显示图标
- 新增测试页面

### Bugs Fixes

- 连接页面时间排序错误
- 连接页面表格宽度优化

---

## v1.4.8

### Features

- 连接页面总流量显示

### Bugs Fixes

- 连接页面数据排序错误
- 新建订阅时设置更新间隔无效
- Windows 拨号网络无法设置系统代理
- Windows 开启/关闭系统代理延迟(使用注册表即可)
- 删除无效的背景模糊选项

---

## v1.4.7

### Features

- Windows 便携版禁用应用内更新
- 支持代理组 Hidden 选项
- 支持 URL Scheme(MacOS & Linux)

---

## v1.4.6

### Features

- 更新 Clash Meta(mihomo) 内核到 v1.18.0
- 支持 URL Scheme(暂时仅支持 Windows)
- 添加窗口置顶按钮
- UI 优化调整

### Bugs Fixes

- 修复一些编译错误
- 获取订阅名称错误
- 订阅信息解析错误

---

## v1.4.5

### Features

- 更新 MacOS 托盘图标样式(@gxx2778 贡献)

### Bugs Fixes

- Windows 下更新时无法覆盖 `clash-verge-service.exe`的问题(需要卸载重装一次服务，下次更新生效)
- 窗口最大化按钮变化问题
- 窗口尺寸保存错误问题
- 复制环境变量类型无法切换问题
- 某些情况下闪退的问题
- 某些订阅无法导入的问题

---

## v1.4.4

### Features

- 支持 Windows aarch64(arm64) 版本
- 支持一键更新 GeoData
- 支持一键更新 Alpha 内核
- MacOS 支持在系统代理时显示不同的托盘图标
- Linux 支持在系统代理时显示不同的托盘图标
- 优化复制环境变量逻辑

### Bugs Fixes

- 修改 PID 文件的路径

### Performance

- 优化创建窗口的速度

---

## v1.4.3

### Break Changes

- 更改配置文件路径到标准目录(可以保证卸载时没有残留)
- 更改 appid 为 `io.github.clash-verge-rev.clash-verge-rev`
- 建议卸载旧版本后再安装新版本，该版本安装后不会使用旧版配置文件，你可以手动将旧版配置文件迁移到新版配置文件目录下

### Features

- 移除页面切换动画
- 更改 Tun 模式托盘图标颜色
- Portable 版本默认使用当前目录作为配置文件目录
- 禁用 Clash 字段过滤时隐藏 Clash 字段选项
- 优化拖拽时光标样式

### Bugs Fixes

- 修复 windows 下更新时没有关闭内核导致的更新失败的问题
- 修复打开文件报错的问题
- 修复 url 导入时无法获取中文配置名称的问题
- 修复 alpha 内核无法显示内存信息的问题

---

## v1.4.2

### Features

- update clash meta core to mihomo 1.17.0
- support both clash meta stable release and prerelease-alpha release
- fixed the problem of not being able to set the system proxy when there is a dial-up link on windows system [#833](https://github.com/zzzgydi/clash-verge/issues/833)
- support new clash field
- support random mixed port
- add windows x86 and linux armv7 support
- support disable tray click event
- add download progress for updater
- support drag to reorder the profile
- embed emoji fonts
- update depends
- improve UI style

---

## v1.4.1

### Features

- update clash meta core to newest 虚空终端(2023.11.23)
- delete clash core UI
- improve UI
- change Logo to original

---

## v1.4.0

### Features

- update clash meta core to newest 虚空终端
- delete clash core, no longer maintain
- merge Clash nyanpasu changes
- remove delay display different color
- use Meta Country.mmdb
- update dependencies
- small changes here and there

---

## v1.3.8

### Features

- update clash meta core
- add default valid keys
- adjust the delay display interval and color

### Bug Fixes

- fix connections page undefined exception

---

## v1.3.7

### Features

- update clash and clash meta core
- profiles page add paste button
- subscriptions url textfield use multi lines
- set min window size
- add check for updates buttons
- add open dashboard to the hotkey list

### Bug Fixes

- fix profiles page undefined exception

---

## v1.3.6

### Features

- add russian translation
- support to show connection detail
- support clash meta memory usage display
- support proxy provider update ui
- update geo data file from meta repo
- adjust setting page

### Bug Fixes

- center the window when it is out of screen
- use `sudo` when `pkexec` not found (Linux)
- reconnect websocket when window focus

### Notes

- The current version of the Linux installation package is built by Ubuntu 20.04 (Github Action).

---

## v1.3.5

### Features

- update clash core

### Bug Fixes

- fix blurry system tray icon (Windows)
- fix v1.3.4 wintun.dll not found (Windows)
- fix v1.3.4 clash core not found (macOS, Linux)

---

## v1.3.4

### Features

- update clash and clash meta core
- optimize traffic graph high CPU usage when window hidden
- use polkit to elevate permission (Linux)
- support app log level setting
- support copy environment variable
- overwrite resource file according to file modified
- save window size and position

### Bug Fixes

- remove fallback group select status
- enable context menu on editable element (Windows)

---

## v1.3.3

### Features

- update clash and clash meta core
- show tray icon variants in different system proxy status (Windows)
- close all connections when mode changed

### Bug Fixes

- encode controller secret into uri
- error boundary for each page

---

## v1.3.2

### Features

- update clash and clash meta core

### Bug Fixes

- fix import url issue
- fix profile undefined issue

---

## v1.3.1

### Features

- update clash and clash meta core

### Bug Fixes

- fix open url issue
- fix appimage path panic
- fix grant root permission in macOS
- fix linux system proxy default bypass

---

## v1.3.0

### Features

- update clash and clash meta
- support opening dir on tray
- support updating all profiles with one click
- support granting root permission to clash core(Linux, macOS)
- support enable/disable clash fields filter, feel free to experience the latest features of Clash Meta

### Bug Fixes

- deb add openssl depend(Linux)
- fix the AppImage auto launch path(Linux)
- fix get the default network service(macOS)
- remove the esc key listener in macOS, cmd+w instead(macOS)
- fix infinite retry when websocket error

---

## v1.2.3

### Features

- update clash
- adjust macOS window style
- profile supports UTF8 with BOM

### Bug Fixes

- fix selected proxy
- fix error log

---

## v1.2.2

### Features

- update clash meta
- recover clash core after panic
- use system window decorations(Linux)

### Bug Fixes

- flush system proxy settings(Windows)
- fix parse log panic
- fix ui bug

---

## v1.2.1

### Features

- update clash version
- proxy groups support multi columns
- optimize ui

### Bug Fixes

- fix ui websocket connection
- adjust delay check concurrency
- avoid setting login item repeatedly(macOS)

---

## v1.2.0

### Features

- update clash meta version
- support to change external-controller
- support to change default latency test URL
- close all connections when proxy changed or profile changed
- check the config by using the core
- increase the robustness of the program
- optimize windows service mode (need to reinstall)
- optimize ui

### Bug Fixes

- invalid hotkey cause panic
- invalid theme setting cause panic
- fix some other glitches

---

## v1.1.2

### Features

- the system tray follows i18n
- change the proxy group ui of global mode
- support to update profile with the system proxy/clash proxy
- check the remote profile more strictly

### Bug Fixes

- use app version as default user agent
- the clash not exit in service mode
- reset the system proxy when quit the app
- fix some other glitches

---

## v1.1.1

### Features

- optimize clash config feedback
- hide macOS dock icon
- use clash meta compatible version (Linux)

### Bug Fixes

- fix some other glitches

---

## v1.1.0

### Features

- add rule page
- supports proxy providers delay check
- add proxy delay check loading status
- supports hotkey/shortcut management
- supports displaying connections data in table layout(refer to yacd)

### Bug Fixes

- supports yaml merge key in clash config
- detect the network interface and set the system proxy(macOS)
- fix some other glitches

---

## v1.0.6

### Features

- update clash and clash.meta

### Bug Fixes

- only script profile display console
- automatic configuration update on demand at launch

---

## v1.0.5

### Features

- reimplement profile enhanced mode with quick-js
- optimize the runtime config generation process
- support web ui management
- support clash field management
- support viewing the runtime config
- adjust some pages style

### Bug Fixes

- fix silent start
- fix incorrectly reset system proxy on exit

---

## v1.0.4

### Features

- update clash core and clash meta version
- support switch clash mode on system tray
- theme mode support follows system

### Bug Fixes

- config load error on first use

---

## v1.0.3

### Features

- save some states such as URL test, filter, etc
- update clash core and clash-meta core
- new icon for macOS

---

## v1.0.2

### Features

- supports for switching clash core
- supports release UI processes
- supports script mode setting

### Bug Fixes

- fix service mode bug (Windows)

---

## v1.0.1

### Features

- adjust default theme settings
- reduce gpu usage of traffic graph when hidden
- supports more remote profile response header setting
- check remote profile data format when imported

### Bug Fixes

- service mode install and start issue (Windows)
- fix launch panic (Some Windows)

---

## v1.0.0

### Features

- update clash core
- optimize traffic graph animation
- supports interval update profiles
- supports service mode (Windows)

### Bug Fixes

- reset system proxy when exit from dock (macOS)
- adjust clash dns config process strategy

---

## v0.0.29

### Features

- sort proxy node
- custom proxy test url
- logs page filter
- connections page filter
- default user agent for subscription
- system tray add tun mode toggle
- enable to change the config dir (Windows only)

---

## v0.0.28

### Features

- enable to use clash config fields (UI)

### Bug Fixes

- remove the character
- fix some icon color

---

## v0.0.27

### Features

- supports custom theme color
- tun mode setting control the final config

### Bug Fixes

- fix transition flickers (macOS)
- reduce proxy page render

---

## v0.0.26

### Features

- silent start
- profile editor
- profile enhance mode supports more fields
- optimize profile enhance mode strategy

### Bug Fixes

- fix csp restriction on macOS
- window controllers on Linux

---

## v0.0.25

### Features

- update clash core version

### Bug Fixes

- app updater error
- display window controllers on Linux

### Notes

If you can't update the app properly, please consider downloading the latest version from github release.

---

## v0.0.24

### Features

- Connections page
- add wintun.dll (Windows)
- supports create local profile with selected file (Windows)
- system tray enable set system proxy

### Bug Fixes

- open dir error
- auto launch path (Windows)
- fix some clash config error
- reduce the impact of the enhanced mode

---

## v0.0.23

### Features

- i18n supports
- Remote profile User Agent supports

### Bug Fixes

- clash config file case ignore
- clash `external-controller` only port
