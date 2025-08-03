### 🚨 Breaking Changes

- 优化更新了 Clash Verge Service 服务，需要在设置界面中重新卸载安装服务

### ✨ Features

- 优化部分样式
- 添加进程匹配模式设置
- 添加清空 DNS 缓存设置
- 调整 amd64 平台使用的内核版本
- 复制环境变量新增对 NuShell 的支持
- 连接界面支持查看已关闭的连接信息
- 新版本更新内容窗口支持显示更多的内容格式，例如 Github 的 [警报信息](https://docs.github.com/zh/contributing/style-guide-and-content-model/style-guide#alerts)
- 优化代理组延迟检测，超过 30 个节点的代理组，不在对代理节点逐一检测，而是使用内核方法进行一次性检测
- 优化规则合集更新逻辑，减少重复读取规则合集文件内容的次数，避免内存占用过高
- 优化代理合集更新逻辑

### 🐛 Bug Fixes

- 取消固定代理时没有清除配置中选中节点信息的数据
- 未同步更新流量图显
- 应用未及时关闭 websocket 连接导致应用后台运行时，内存占用持续升高的问题
- 未正确编码 URL 导致请求不正确的问题
- 未及时清理旧的 websocket 连接
- websocket hooks 未正确处理重连的问题
