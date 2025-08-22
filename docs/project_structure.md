## 完整的项目结构 / Full project structure

```
clash-verge-rev/
├── .editorconfig                  # 编辑器配置文件 / Editor configuration file
├── .prettierignore                # Prettier忽略文件列表 / Prettier ignore file list
├── .prettierrc                    # Prettier格式化配置 / Prettier formatting configuration
├── CONTRIBUTING.md                # 贡献指南 / Contribution guidelines
├── LICENSE                        # 项目许可证 / Project license
├── README.md                      # 项目说明文档 / Project description document
├── UPDATELOG.md                   # 更新日志 / Update log
├── crowdin.yml                    # Crowdin国际化配置 / Crowdin internationalization config
├── package.json                   # Node.js项目依赖配置 / Node.js project dependency config
├── pnpm-lock.yaml                 # pnpm依赖锁定文件 / pnpm dependency lock file
├── renovate.json                  # Renovate自动更新配置 / Renovate auto-update config
├── tree.py                        # 生成项目结构的脚本 / Script to generate project structure
├── tsconfig.json                  # TypeScript配置 / TypeScript configuration
├── vite.config.mts                # Vite构建配置 / Vite build configuration
├── .cargo/                        # Cargo配置目录 / Cargo configuration directory
│   ├── config.toml                # Cargo配置文件 / Cargo configuration file
├── .devcontainer/                 # 开发容器配置目录 / Development container configuration directory
│   ├── devcontainer.json          # 开发容器配置文件 / Development container configuration file
├── .github/                       # GitHub相关配置目录 / GitHub related configuration directory
│   ├── FUNDING.yml                # 资助配置文件 / Funding configuration file
│   ├── ISSUE_TEMPLATE/            # 问题模板目录 / Issue template directory
│   │   ├── bug_report.yml         # 错误报告模板 / Bug report template
│   │   ├── config.yml             # 问题模板配置 / Issue template configuration
│   │   ├── feature_request.yml    # 功能请求模板 / Feature request template
│   │   ├── i18n_request.yml       # 国际化请求模板 / Internationalization request template
│   ├── workflows/                 # GitHub工作流配置目录 / GitHub workflows configuration directory
│   │   ├── alpha.yml              # Alpha版本构建工作流 / Alpha version build workflow
│   │   ├── autobuild-check-test.yml # 自动构建检查测试工作流 / Autobuild check test workflow
│   │   ├── autobuild.yml          # 自动构建工作流 / Autobuild workflow
│   │   ├── check-commit-needs-build.yml # 检查提交是否需要构建的工作流 / Check if commit needs build workflow
│   │   ├── clean-old-assets.yml   # 清理旧资产工作流 / Clean old assets workflow
│   │   ├── clippy.yml             # Rust代码检查工作流 / Rust code lint workflow
│   │   ├── cross_check.yaml       # 跨平台检查工作流 / Cross-platform check workflow
│   │   ├── dev.yml                # 开发环境工作流 / Development environment workflow
│   │   ├── fmt.yml                # 代码格式化检查工作流 / Code formatting check workflow
│   │   ├── release.yml            # 发布工作流 / Release workflow
│   │   ├── updater.yml            # 更新器工作流 / Updater workflow
├── .husky/                        # Husky Git钩子配置目录 / Husky Git hooks configuration directory
│   ├── pre-commit                 # 提交前钩子脚本 / Pre-commit hook script
│   ├── pre-push                   # 推送前钩子脚本 / Pre-push hook script
├── docs/                          # 文档目录 / Documentation directory
│   ├── preview_dark.png           # 深色模式预览图 / Dark mode preview image
│   ├── preview_light.png          # 浅色模式预览图 / Light mode preview image
│   ├── project_structure.md       # 项目结构预览 / Project structure preview
├── scripts/                       # 脚本文件目录 / Script files directory
│   ├── check-unused-i18n.js       # 检查未使用的国际化键 / Check unused i18n keys
│   ├── fix-alpha_version.mjs      # 修复Alpha版本号脚本 / Fix alpha version script
│   ├── portable-fixed-webview2.mjs # 便携版固定WebView2脚本 / Portable fixed WebView2 script
│   ├── portable.mjs               # 便携版构建脚本 / Portable build script
│   ├── prebuild.mjs               # 预构建脚本 / Pre-build script
│   ├── publish-version.mjs        # 发布版本脚本 / Publish version script
│   ├── release-version.mjs        # 版本发布脚本 / Release version script
│   ├── set_dns.sh                 # 设置DNS脚本 / Set DNS script
│   ├── telegram.mjs               # Telegram通知脚本 / Telegram notification script
│   ├── unset_dns.sh               # 取消DNS设置脚本 / Unset DNS script
│   ├── updatelog.mjs              # 更新日志生成脚本 / Update log generation script
│   ├── updater-fixed-webview2.mjs # 更新器固定WebView2脚本 / Updater fixed WebView2 script
│   ├── updater.mjs                # 更新器脚本 / Updater script
│   ├── utils.mjs                  # 工具函数脚本 / Utility functions script
├── scripts-workflow/              # 工作流脚本目录 / Workflow scripts directory
│   ├── get_latest_tauri_commit.bash # 获取最新Tauri提交的脚本 / Script to get latest Tauri commit
├── src/                           # 前端源代码目录 / Frontend source code directory
│   ├── App.tsx                    # 应用入口组件 / App entry component
│   ├── index.html                 # HTML入口文件 / HTML entry file
│   ├── main.tsx                   # 前端入口脚本 / Frontend entry script
│   ├── assets/                    # 静态资源目录 / Static assets directory
│   │   ├── fonts/                 # 字体文件目录 / Font files directory
│   │   │   ├── Twemoji.Mozilla.ttf # Twemoji字体文件 / Twemoji font file
│   │   ├── image/                 # 图片资源目录 / Image resources directory
│   │   │   ├── icon_dark.svg      # 深色模式图标 / Dark mode icon
│   │   │   ├── icon_light.svg     # 浅色模式图标 / Light mode icon
│   │   │   ├── logo.ico           # 应用图标ICO格式 / App icon ICO format
│   │   │   ├── logo.svg           # 应用图标SVG格式 / App icon SVG format
│   │   │   ├── component/         # 组件图片目录 / Component images directory
│   │   │   │   ├── match_case.svg # 匹配大小写图标 / Match case icon
│   │   │   │   ├── match_whole_word.svg # 匹配整个单词图标 / Match whole word icon
│   │   │   │   ├── use_regular_expression.svg # 使用正则表达式图标 / Use regular expression icon
│   │   │   ├── itemicon/          # 项目图标目录 / Item icons directory
│   │   │   │   ├── connections.svg # 连接图标 / Connections icon
│   │   │   │   ├── home.svg       # 首页图标 / Home icon
│   │   │   │   ├── logs.svg       # 日志图标 / Logs icon
│   │   │   │   ├── profiles.svg   # 订阅图标 / Profiles icon
│   │   │   │   ├── proxies.svg    # 代理图标 / Proxies icon
│   │   │   │   ├── rules.svg      # 规则图标 / Rules icon
│   │   │   │   ├── settings.svg   # 设置图标 / Settings icon
│   │   │   │   ├── test.svg       # 测试图标 / Test icon
│   │   │   │   ├── unlock.svg     # 解锁图标 / Unlock icon
│   │   │   ├── test/              # 测试相关图片目录 / Test related images directory
│   │   │   │   ├── apple.svg      # 苹果图标 / Apple icon
│   │   │   │   ├── github.svg     # GitHub图标 / GitHub icon
│   │   │   │   ├── google.svg     # Google图标 / Google icon
│   │   │   │   ├── youtube.svg    # YouTube图标 / YouTube icon
│   │   ├── styles/                # 样式文件目录 / Style files directory
│   │   │   ├── font.scss          # 字体样式 / Font styles
│   │   │   ├── index.scss         # 主样式文件 / Main style file
│   │   │   ├── layout.scss        # 布局样式 / Layout styles
│   │   │   ├── page.scss          # 页面样式 / Page styles
│   ├── components/                # 前端组件目录 / Frontend components directory
│   │   ├── center.tsx             # 居中组件 / Center component
│   │   ├── base/                  # 基础组件目录 / Base components directory
│   │   │   ├── NoticeManager.tsx  # 通知管理器组件 / Notice manager component
│   │   │   ├── base-dialog.tsx    # 基础对话框组件 / Base dialog component
│   │   │   ├── base-empty.tsx     # 基础空状态组件 / Base empty state component
│   │   │   ├── base-error-boundary.tsx # 基础错误边界组件 / Base error boundary component
│   │   │   ├── base-fieldset.tsx  # 基础字段集组件 / Base fieldset component
│   │   │   ├── base-loading-overlay.tsx # 基础加载覆盖层组件 / Base loading overlay component
│   │   │   ├── base-loading.tsx   # 基础加载组件 / Base loading component
│   │   │   ├── base-page.tsx      # 基础页面组件 / Base page component
│   │   │   ├── base-search-box.tsx # 基础搜索框组件 / Base search box component
│   │   │   ├── base-styled-select.tsx # 基础样式选择器组件 / Base styled select component
│   │   │   ├── base-styled-text-field.tsx # 基础样式文本框组件 / Base styled text field component
│   │   │   ├── base-switch.tsx    # 基础开关组件 / Base switch component
│   │   │   ├── base-tooltip-icon.tsx # 基础工具提示图标组件 / Base tooltip icon component
│   │   │   ├── index.ts           # 基础组件导出索引 / Base components export index
│   │   ├── common/                # 通用组件目录 / Common components directory
│   │   │   ├── traffic-error-boundary.tsx # 流量错误边界组件 / Traffic error boundary component
│   │   ├── connection/            # 连接相关组件目录 / Connection related components directory
│   │   │   ├── connection-detail.tsx # 连接详情组件 / Connection detail component
│   │   │   ├── connection-item.tsx # 连接项组件 / Connection item component
│   │   │   ├── connection-table.tsx # 连接表格组件 / Connection table component
│   │   ├── home/                  # 首页组件目录 / Home page components directory
│   │   │   ├── clash-info-card.tsx # Clash信息卡片组件 / Clash info card component
│   │   │   ├── clash-mode-card.tsx # Clash模式卡片组件 / Clash mode card component
│   │   │   ├── current-proxy-card.tsx # 当前代理卡片组件 / Current proxy card component
│   │   │   ├── enhanced-canvas-traffic-graph.tsx # 增强型画布流量图表组件 / Enhanced canvas traffic graph component
│   │   │   ├── enhanced-card.tsx  # 增强型卡片组件 / Enhanced card component
│   │   │   ├── enhanced-traffic-stats.tsx # 增强型流量统计组件 / Enhanced traffic stats component
│   │   │   ├── home-profile-card.tsx # 首页配置文件卡片组件 / Home profile card component
│   │   │   ├── ip-info-card.tsx   # IP信息卡片组件 / IP info card component
│   │   │   ├── proxy-tun-card.tsx # 代理TUN卡片组件 / Proxy TUN card component
│   │   │   ├── system-info-card.tsx # 系统信息卡片组件 / System info card component
│   │   │   ├── test-card.tsx      # 测试卡片组件 / Test card component
│   │   ├── layout/                # 布局组件目录 / Layout components directory
│   │   │   ├── layout-item.tsx    # 布局项组件 / Layout item component
│   │   │   ├── layout-traffic.tsx # 布局流量组件 / Layout traffic component
│   │   │   ├── scroll-top-button.tsx # 返回顶部按钮组件 / Scroll top button component
│   │   │   ├── traffic-graph.tsx  # 流量图表组件 / Traffic graph component
│   │   │   ├── update-button.tsx  # 更新按钮组件 / Update button component
│   │   │   ├── use-custom-theme.ts # 自定义主题钩子 / Custom theme hook
│   │   ├── log/                   # 日志组件目录 / Log components directory
│   │   │   ├── log-item.tsx       # 日志项组件 / Log item component
│   │   ├── profile/               # 配置文件组件目录 / Profile components directory
│   │   │   ├── confirm-viewer.tsx # 确认查看器组件 / Confirm viewer component
│   │   │   ├── editor-viewer.tsx  # 编辑器查看器组件 / Editor viewer component
│   │   │   ├── file-input.tsx     # 文件输入组件 / File input component
│   │   │   ├── group-item.tsx     # 组项组件 / Group item component
│   │   │   ├── groups-editor-viewer.tsx # 组编辑器查看器组件 / Groups editor viewer component
│   │   │   ├── log-viewer.tsx     # 日志查看器组件 / Log viewer component
│   │   │   ├── profile-box.tsx    # 配置文件框组件 / Profile box component
│   │   │   ├── profile-item.tsx   # 配置文件项组件 / Profile item component
│   │   │   ├── profile-more.tsx   # 配置文件更多操作组件 / Profile more operations component
│   │   │   ├── profile-viewer.tsx # 配置文件查看器组件 / Profile viewer component
│   │   │   ├── proxies-editor-viewer.tsx # 代理编辑器查看器组件 / Proxies editor viewer component
│   │   │   ├── proxy-item.tsx     # 代理项组件 / Proxy item component
│   │   │   ├── rule-item.tsx      # 规则项组件 / Rule item component
│   │   │   ├── rules-editor-viewer.tsx # 规则编辑器查看器组件 / Rules editor viewer component
│   │   ├── proxy/                 # 代理组件目录 / Proxy components directory
│   │   │   ├── provider-button.tsx # 提供程序按钮组件 / Provider button component
│   │   │   ├── proxy-groups.tsx   # 代理组组件 / Proxy groups component
│   │   │   ├── proxy-head.tsx     # 代理头部组件 / Proxy head component
│   │   │   ├── proxy-item-mini.tsx # 迷你代理项组件 / Mini proxy item component
│   │   │   ├── proxy-item.tsx     # 代理项组件 / Proxy item component
│   │   │   ├── proxy-render.tsx   # 代理渲染组件 / Proxy render component
│   │   │   ├── use-filter-sort.ts # 过滤排序钩子 / Filter and sort hook
│   │   │   ├── use-head-state.ts  # 头部状态钩子 / Head state hook
│   │   │   ├── use-render-list.ts # 渲染列表钩子 / Render list hook
│   │   │   ├── use-window-width.ts # 窗口宽度钩子 / Window width hook
│   │   ├── rule/                  # 规则组件目录 / Rule components directory
│   │   │   ├── provider-button.tsx # 提供程序按钮组件 / Provider button component
│   │   │   ├── rule-item.tsx      # 规则项组件 / Rule item component
│   │   ├── setting/               # 设置组件目录 / Setting components directory
│   │   │   ├── setting-clash.tsx  # Clash设置组件 / Clash setting component
│   │   │   ├── setting-system.tsx # 系统设置组件 / System setting component
│   │   │   ├── setting-verge-advanced.tsx # Verge高级设置组件 / Verge advanced setting component
│   │   │   ├── setting-verge-basic.tsx # Verge基础设置组件 / Verge basic setting component
│   │   │   ├── mods/              # 设置模块目录 / Setting modules directory
│   │   │   │   ├── backup-config-viewer.tsx # 备份配置查看器组件 / Backup config viewer component
│   │   │   │   ├── backup-table-viewer.tsx # 备份表格查看器组件 / Backup table viewer component
│   │   │   │   ├── backup-viewer.tsx # 备份查看器组件 / Backup viewer component
│   │   │   │   ├── clash-core-viewer.tsx # Clash内核查看器组件 / Clash core viewer component
│   │   │   │   ├── clash-port-viewer.tsx # Clash端口查看器组件 / Clash port viewer component
│   │   │   │   ├── config-viewer.tsx # 配置查看器组件 / Config viewer component
│   │   │   │   ├── controller-viewer.tsx # 控制器查看器组件 / Controller viewer component
│   │   │   │   ├── dns-viewer.tsx # DNS查看器组件 / DNS viewer component
│   │   │   │   ├── external-controller-cors.tsx # 外部控制器CORS组件 / External controller CORS component
│   │   │   │   ├── guard-state.tsx # 状态保护组件 / Guard state component
│   │   │   │   ├── hotkey-input.tsx # 热键输入组件 / Hotkey input component
│   │   │   │   ├── hotkey-viewer.tsx # 热键查看器组件 / Hotkey viewer component
│   │   │   │   ├── layout-viewer.tsx # 布局查看器组件 / Layout viewer component
│   │   │   │   ├── lite-mode-viewer.tsx # 精简模式查看器组件 / Lite mode viewer component
│   │   │   │   ├── misc-viewer.tsx # 杂项查看器组件 / Misc viewer component
│   │   │   │   ├── network-interface-viewer.tsx # 网络接口查看器组件 / Network interface viewer component
│   │   │   │   ├── password-input.tsx # 密码输入组件 / Password input component
│   │   │   │   ├── setting-comp.tsx # 设置组件 / Setting component
│   │   │   │   ├── stack-mode-switch.tsx # 堆栈模式切换组件 / Stack mode switch component
│   │   │   │   ├── sysproxy-viewer.tsx # 系统代理查看器组件 / Sysproxy viewer component
│   │   │   │   ├── theme-mode-switch.tsx # 主题模式切换组件 / Theme mode switch component
│   │   │   │   ├── theme-viewer.tsx # 主题查看器组件 / Theme viewer component
│   │   │   │   ├── tun-viewer.tsx # TUN查看器组件 / TUN viewer component
│   │   │   │   ├── update-viewer.tsx # 更新查看器组件 / Update viewer component
│   │   │   │   ├── web-ui-item.tsx # Web UI项组件 / Web UI item component
│   │   │   │   ├── web-ui-viewer.tsx # Web UI查看器组件 / Web UI viewer component
│   │   ├── shared/                # 共享组件目录 / Shared components directory
│   │   │   ├── ProxyControlSwitches.tsx # 代理控制开关组件 / Proxy control switches component
│   │   ├── test/                  # 测试组件目录 / Test components directory
│   │   │   ├── test-box.tsx       # 测试框组件 / Test box component
│   │   │   ├── test-item.tsx      # 测试项组件 / Test item component
│   │   │   ├── test-viewer.tsx    # 测试查看器组件 / Test viewer component
│   ├── hooks/                     # 钩子目录 / Hooks directory
│   │   ├── use-clash.ts           # Clash相关钩子 / Clash related hook
│   │   ├── use-current-proxy.ts   # 当前代理钩子 / Current proxy hook
│   │   ├── use-listen.ts          # 监听钩子 / Listen hook
│   │   ├── use-log-data.ts        # 日志数据钩子 / Log data hook
│   │   ├── use-profiles.ts        # 配置文件钩子 / Profiles hook
│   │   ├── use-system-proxy-state.ts # 系统代理状态钩子 / System proxy state hook
│   │   ├── use-system-state.ts    # 系统状态钩子 / System state hook
│   │   ├── use-traffic-monitor.ts # 流量监控钩子 / Traffic monitor hook
│   │   ├── use-verge.ts           # Verge相关钩子 / Verge related hook
│   │   ├── use-visibility.ts      # 可见性钩子 / Visibility hook
│   │   ├── useNotificationPermission.ts # 通知权限钩子 / Notification permission hook
│   │   ├── useServiceInstaller.ts # 服务安装器钩子 / Service installer hook
│   ├── locales/                   # 国际化语言文件目录 / Internationalization language files directory
│   │   ├── ar.json                # 阿拉伯语语言文件 / Arabic language file
│   │   ├── de.json                # 德语语言文件 / German language file
│   │   ├── en.json                # 英语语言文件 / English language file
│   │   ├── es.json                # 西班牙语语言文件 / Spanish language file
│   │   ├── fa.json                # 波斯语语言文件 / Persian language file
│   │   ├── id.json                # 印尼语语言文件 / Indonesian language file
│   │   ├── jp.json                # 日语语言文件 / Japanese language file
│   │   ├── ko.json                # 韩语语言文件 / Korean language file
│   │   ├── ru.json                # 俄语语言文件 / Russian language file
│   │   ├── tr.json                # 土耳其语语言文件 / Turkish language file
│   │   ├── tt.json                # 鞑靼语语言文件 / Tatar language file
│   │   ├── zh.json                # 中文(简体)语言文件 / Chinese (Simplified) language file
│   │   ├── zhtw.json              # 中文(繁体)语言文件 / Chinese (Traditional) language file
│   ├── pages/                     # 页面组件目录 / Page components directory
│   │   ├── _layout.tsx            # 布局页面组件 / Layout page component
│   │   ├── _routers.tsx           # 路由配置组件 / Router configuration component
│   │   ├── _theme.tsx             # 主题配置组件 / Theme configuration component
│   │   ├── connections.tsx        # 连接页面组件 / Connections page component
│   │   ├── home.tsx               # 首页页面组件 / Home page component
│   │   ├── logs.tsx               # 日志页面组件 / Logs page component
│   │   ├── profiles.tsx           # 配置文件页面组件 / Profiles page component
│   │   ├── proxies.tsx            # 代理页面组件 / Proxies page component
│   │   ├── rules.tsx              # 规则页面组件 / Rules page component
│   │   ├── settings.tsx           # 设置页面组件 / Settings page component
│   │   ├── test.tsx               # 测试页面组件 / Test page component
│   │   ├── unlock.tsx             # 解锁页面组件 / Unlock page component
│   ├── polyfills/                 # 兼容性补丁目录 / Polyfills directory
│   │   ├── RegExp.js              # RegExp兼容性补丁 / RegExp polyfill
│   │   ├── WeakRef.js             # WeakRef兼容性补丁 / WeakRef polyfill
│   │   ├── matchMedia.js          # matchMedia兼容性补丁 / matchMedia polyfill
│   ├── providers/                 # 数据提供器目录 / Providers directory
│   │   ├── app-data-provider.tsx  # 应用数据提供器组件 / App data provider component
│   ├── services/                  # 服务接口目录 / Service interfaces directory
│   │   ├── api.ts                 # API服务 / API service
│   │   ├── cmds.ts                # 命令服务 / Command service
│   │   ├── delay.ts               # 延迟测试服务 / Delay test service
│   │   ├── global-log-service.ts  # 全局日志服务 / Global log service
│   │   ├── i18n.ts                # 国际化服务 / Internationalization service
│   │   ├── ipc-log-service.ts     # IPC日志服务 / IPC log service
│   │   ├── noticeService.ts       # 通知服务 / Notice service
│   │   ├── states.ts              # 状态管理服务 / State management service
│   │   ├── types.d.ts             # 类型定义文件 / Type definition file
│   ├── utils/                     # 工具函数目录 / Utility functions directory
│   │   ├── data-validator.ts      # 数据验证工具 / Data validation utility
│   │   ├── debounce.ts            # 防抖工具 / Debounce utility
│   │   ├── get-system.ts          # 系统信息获取工具 / System information utility
│   │   ├── helper.ts              # 辅助工具函数 / Helper utility function
│   │   ├── ignore-case.ts         # 忽略大小写工具 / Ignore case utility
│   │   ├── is-async-function.ts   # 异步异步函数判断工具 / Is async function utility
│   │   ├── noop.ts                # 空操作函数 / No operation function
│   │   ├── notification-permission.ts # 通知权限工具 / Notification permission utility
│   │   ├── parse-hotkey.ts        # 热键解析工具 / Hotkey parsing utility
│   │   ├── parse-traffic.ts       # 流量解析工具 / Traffic parsing utility
│   │   ├── traffic-diagnostics.ts # 流量诊断工具 / Traffic diagnostics utility
│   │   ├── truncate-str.ts        # 字符串截断工具 / String truncation utility
│   │   ├── uri-parser.ts          # URI解析工具 / URI parsing utility
│   │   ├── websocket.ts           # WebSocket工具 / WebSocket utility
├── src-tauri/                     # Tauri后端代码目录 / Tauri backend code directory
│   ├── .clippy.toml               # Clippy Rust代码检查配置 / Clippy Rust lint configuration
│   ├── Cargo.lock                 # Rust依赖锁定文件 / Rust dependency lock file
│   ├── Cargo.toml                 # Rust项目配置 / Rust project configuration
│   ├── build.rs                   # Rust构建脚本 / Rust build script
│   ├── deny.toml                  # Rust依赖安全检查配置 / Rust dependency security check configuration
│   ├── rustfmt.toml               # Rust代码格式化配置 / Rust code formatting configuration
│   ├── tauri.conf.json            # Tauri应用配置 / Tauri application configuration
│   ├── tauri.linux.conf.json      # Linux平台Tauri配置 / Tauri configuration for Linux
│   ├── tauri.macos.conf.json      # macOS平台Tauri配置 / Tauri configuration for macOS
│   ├── tauri.windows.conf.json    # Windows平台Tauri配置 / Tauri configuration for Windows
│   ├── webview2.arm64.json        # ARM64架构WebView2配置 / WebView2 configuration for ARM64
│   ├── webview2.x64.json          # x64架构WebView2配置 / WebView2 configuration for x64
│   ├── webview2.x86.json          # x86架构WebView2配置 / WebView2 configuration for x86
│   ├── assets/                    # 静态资源目录 / Static assets directory
│   │   ├── fonts/                 # 字体文件目录 / Font files directory
│   │   │   ├── SF-Pro.ttf         # SF-Pro字体文件 / SF-Pro font file
│   ├── benches/                   # 基准测试目录 / Benchmark tests directory
│   │   ├── draft_benchmark.rs     # 草稿基准测试 / Draft benchmark test
│   ├── capabilities/              # Tauri权限配置目录 / Tauri capabilities configuration directory
│   │   ├── desktop-windows.json   # Windows桌面权限配置 / Desktop capabilities for Windows
│   │   ├── desktop.json           # 桌面权限配置 / Desktop capabilities configuration
│   │   ├── migrated.json          # 迁移权限配置 / Migrated capabilities configuration
│   ├── icons/                     # 应用图标目录 / Application icons directory
│   │   ├── 128x128.png            # 128x128图标 / 128x128 icon
│   │   ├── 128x128@2x.png         # 128x128@2x图标 / 128x128@2x icon
│   │   ├── 32x32.png              # 32x32图标 / 32x32 icon
│   │   ├── Square107x107Logo.png  # 107x107方形图标 / 107x107 square icon
│   │   ├── Square142x142Logo.png  # 142x142方形图标 / 142x142 square icon
│   │   ├── Square150x150Logo.png  # 150x150方形图标 / 150x150 square icon
│   │   ├── Square284x284Logo.png  # 284x284方形图标 / 284x284 square icon
│   │   ├── Square30x30Logo.png    # 30x30方形图标 / 30x30 square icon
│   │   ├── Square310x310Logo.png  # 310x310方形图标 / 310x310 square icon
│   │   ├── Square44x44Logo.png    # 44x44方形图标 / 44x44 square icon
│   │   ├── Square71x71Logo.png    # 71x71方形图标 / 71x71 square icon
│   │   ├── Square89x89Logo.png    # 89x89方形图标 / 89x89 square icon
│   │   ├── StoreLogo.png          # 应用商店图标 / Store logo
│   │   ├── icon.icns              # macOS图标 / macOS icon
│   │   ├── icon.ico               # Windows图标 / Windows icon
│   │   ├── icon.png               # 通用PNG图标 / General PNG icon
│   │   ├── tray-icon-mono.ico     # 单色托盘图标 / Monochrome tray icon
│   │   ├── tray-icon-sys-mono-new.ico # 新系统单色托盘图标 / New system monochrome tray icon
│   │   ├── tray-icon-sys-mono.ico # 系统单色托盘图标 / System monochrome tray icon
│   │   ├── tray-icon-sys.ico      # 系统托盘图标 / System tray icon
│   │   ├── tray-icon-tun-mono-new.ico # 新TUN单色托盘图标 / New TUN monochrome tray icon
│   │   ├── tray-icon-tun-mono.ico # TUN单色托盘图标 / TUN monochrome tray icon
│   │   ├── tray-icon-tun.ico      # TUN托盘图标 / TUN tray icon
│   │   ├── tray-icon.ico          # 托盘图标 / Tray icon
│   ├── images/                    # 图片资源目录 / Image resources directory
│   │   ├── background.png         # 背景图片 / Background image
│   ├── packages/                  # 打包配置目录 / Packaging configuration directory
│   │   ├── linux/                 # Linux打包配置 / Linux packaging configuration
│   │   │   ├── clash-verge.desktop # Linux桌面文件 / Linux desktop file
│   │   │   ├── post-install.sh    # 安装后脚本 / Post-install script
│   │   │   ├── pre-remove.sh      # 卸载前脚本 / Pre-remove script
│   │   ├── macos/                 # macOS打包配置 / macOS packaging configuration
│   │   │   ├── entitlements.plist # 权限配置文件 / Entitlements file
│   │   ├── windows/               # Windows打包配置 / Windows packaging configuration
│   │   │   ├── installer.nsi      # NSIS安装脚本 / NSIS installer script
│   ├── src/                       # Rust源代码目录 / Rust source code directory
│   │   ├── lib.rs                 # 库入口文件 / Library entry file
│   │   ├── main.rs                # 主程序入口 / Main program entry
│   │   ├── cmd/                   # 命令处理模块 / Command processing module
│   │   │   ├── app.rs             # 应用命令处理 / App command processing
│   │   │   ├── clash.rs           # Clash命令处理 / Clash command processing
│   │   │   ├── lightweight.rs     # 轻量模式命令处理 / Lightweight mode command processing
│   │   │   ├── media_unlock_checker.rs # 媒体解锁检查命令 / Media unlock checker command
│   │   │   ├── mod.rs             # 命令模块导出 / Command module export
│   │   │   ├── network.rs         # 网络命令处理 / Network command processing
│   │   │   ├── profile.rs         # 配置文件命令处理 / Profile command processing
│   │   │   ├── proxy.rs           # 代理命令处理 / Proxy command processing
│   │   │   ├── runtime.rs         # 运行时命令处理 / Runtime command processing
│   │   │   ├── save_profile.rs    # 保存配置文件命令 / Save profile command
│   │   │   ├── service.rs         # 服务命令处理 / Service command processing
│   │   │   ├── system.rs          # 系统命令处理 / System command processing
│   │   │   ├── uwp.rs             # UWP相关命令处理 / UWP related command processing
│   │   │   ├── validate.rs        # 验证命令处理 / Validation command processing
│   │   │   ├── verge.rs           # Verge命令处理 / Verge command processing
│   │   │   ├── webdav.rs          # WebDAV命令处理 / WebDAV command processing
│   │   ├── config/                # 配置处理模块 / Configuration processing module
│   │   │   ├── clash.rs           # Clash配置处理 / Clash configuration processing
│   │   │   ├── config.rs          # 配置处理 / Configuration processing
│   │   │   ├── draft.rs           # 草稿配置处理 / Draft configuration processing
│   │   │   ├── encrypt.rs         # 加密处理 / Encryption processing
│   │   │   ├── mod.rs             # 配置模块导出 / Configuration module export
│   │   │   ├── prfitem.rs         # 配置文件项处理 / Profile item processing
│   │   │   ├── profiles.rs        # 配置文件管理 / Profiles management
│   │   │   ├── runtime.rs         # 运行时配置处理 / Runtime configuration processing
│   │   │   ├── verge.rs           # Verge配置处理 / Verge configuration processing
│   │   ├── core/                  # 核心功能模块 / Core functionality module
│   │   │   ├── async_proxy_query.rs # 异步代理查询 / Async proxy query
│   │   │   ├── backup.rs          # 备份功能 / Backup functionality
│   │   │   ├── core.rs            # 核心功能 / Core functionality
│   │   │   ├── event_driven_proxy.rs # 事件驱动代理 / Event-driven proxy
│   │   │   ├── handle.rs          # 句柄管理 / Handle management
│   │   │   ├── hotkey.rs          # 热键处理 / Hotkey processing
│   │   │   ├── mod.rs             # 核心模块导出 / Core module export
│   │   │   ├── service.rs         # 服务管理 / Service management
│   │   │   ├── service_ipc.rs     # 服务IPC通信 / Service IPC communication
│   │   │   ├── sysopt.rs          # 系统选项 / System options
│   │   │   ├── timer.rs           # 定时器 / Timer
│   │   │   ├── win_uwp.rs         # Windows UWP处理 / Windows UWP processing
│   │   │   ├── tray/              # 托盘模块 / Tray module
│   │   │   │   ├── mod.rs         # 托盘模块导出 / Tray module export
│   │   │   │   ├── speed_rate.rs  # 速度显示 / Speed rate display
│   │   ├── enhance/               # 增强功能模块 / Enhancement module
│   │   │   ├── chain.rs           # 链式处理 / Chain processing
│   │   │   ├── field.rs           # 字段处理 / Field processing
│   │   │   ├── merge.rs           # 合并处理 / Merge processing
│   │   │   ├── mod.rs             # 增强模块导出 / Enhancement module export
│   │   │   ├── script.rs          # 脚本处理 / Script processing
│   │   │   ├── seq.rs             # 序列处理 / Sequence processing
│   │   │   ├── tun.rs             # TUN处理 / TUN processing
│   │   │   ├── builtin/           # 内置脚本目录 / Built-in scripts directory
│   │   │   │   ├── meta_guard.js  # Meta保护脚本 / Meta guard script
│   │   │   │   ├── meta_hy_alpn.js # Meta ALPN混合脚本 / Meta ALPN hybrid script
│   │   ├── feat/                  # 功能模块 / Feature module
│   │   │   ├── backup.rs          # 备份功能 / Backup feature
│   │   │   ├── clash.rs           # Clash功能 / Clash feature
│   │   │   ├── config.rs          # 配置功能 / Configuration feature
│   │   │   ├── mod.rs             # 功能模块导出 / Feature module export
│   │   │   ├── profile.rs         # 配置文件功能 / Profile feature
│   │   │   ├── proxy.rs           # 代理功能 / Proxy feature
│   │   │   ├── window.rs          # 窗口功能 / Window feature
│   │   ├── ipc/                   # IPC通信模块 / IPC communication module
│   │   │   ├── general.rs         # 通用IPC处理 / General IPC processing
│   │   │   ├── logs.rs            # 日志IPC处理 / Logs IPC processing
│   │   │   ├── memory.rs          # 内存IPC处理 / Memory IPC processing
│   │   │   ├── mod.rs             # IPC模块导出 / IPC module export
│   │   │   ├── monitor.rs         # 监控IPC处理 / Monitor IPC processing
│   │   │   ├── traffic.rs         # 流量IPC处理 / Traffic IPC processing
│   │   ├── module/                # 子模块 / Submodule
│   │   │   ├── lightweight.rs     # 轻量模式模块 / Lightweight mode module
│   │   │   ├── mod.rs             # 子模块导出 / Submodule export
│   │   │   ├── sysinfo.rs         # 系统信息模块 / System information module
│   │   ├── process/               # 进程处理模块 / Process processing module
│   │   │   ├── async_handler.rs   # 异步处理器 / Async handler
│   │   │   ├── mod.rs             # 进程模块导出 / Process module export
│   │   ├── state/                 # 状态管理模块 / State management module
│   │   │   ├── lightweight.rs     # 轻量模式状态 / Lightweight mode state
│   │   │   ├── mod.rs             # 状态模块导出 / State module export
│   │   │   ├── proxy.rs           # 代理状态 / Proxy state
│   │   ├── utils/                 # 工具函数模块 / Utility functions module
│   │   │   ├── autostart.rs       # 自动启动工具 / Autostart utility
│   │   │   ├── dirs.rs            # 目录处理工具 / Directory processing utility
│   │   │   ├── format.rs          # 格式化工具 / Formatting utility
│   │   │   ├── help.rs            # 辅助工具 / Helper utility
│   │   │   ├── i18n.rs            # 国际化工具 / Internationalization utility
│   │   │   ├── init.rs            # 初始化工具 / Initialization utility
│   │   │   ├── logging.rs         # 日志工具 / Logging utility
│   │   │   ├── mod.rs             # 工具模块导出 / Utility module export
│   │   │   ├── network.rs         # 网络工具 / Network utility
│   │   │   ├── notification.rs    # 通知工具 / Notification utility
│   │   │   ├── resolve.rs         # 解析工具 / Resolution utility
│   │   │   ├── server.rs          # 服务器工具 / Server utility
│   │   │   ├── singleton.rs       # 单例工具 / Singleton utility
│   │   │   ├── tmpl.rs            # 模板工具 / Template utility
│   │   │   ├── window_manager.rs  # 窗口管理工具 / Window management utility
```