## v2.1.2

**发行代号：臻**

代号释义： 千锤百炼臻至善，集性能跃升、功能拓展、交互焕新于一体，彰显持续打磨、全方位优化的迭代精神。

感谢 Tychristine 对社区群组管理做出的重大贡献！

##### 2.1.2相对2.1.1(已下架不在提供)更新了：

- 无法更新和签名验证失败的问题(该死的CDN缓存)
- 设置菜单区分Verge基本设置和高级设置
- 增加v2 Updater的更多功能和权限
- 退出Verge后Tun代理状态仍保留的问题

##### 2.1.1相对2.1.0(已下架不在提供)更新了：

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
- 支持通过环境变量`CLASH_VERGE_REV_IP`自定义复制IP地址
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
- 当日志等级为`Debug`时（更改需重启软件生效），支持点击内存主动内存回收（绿色文字）
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
- 当日志等级为`Debug`时（更改需重启软件生效），支持点击内存主动内存回收（绿色文字）
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
- 当日志等级为`Debug`时（更改需重启软件生效），支持点击内存主动内存回收（绿色文字）
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
- 使用`boa_engine` 代替 `rquickjs`
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
- 修改 `打开面板` 快捷键为`打开/关闭面板`

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

- Windows 下更新时无法覆盖`clash-verge-service.exe`的问题(需要卸载重装一次服务，下次更新生效)
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
