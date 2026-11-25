<!-- Release-notes skeleton. Entries accumulate in ./Changelog.md as PRs land;
     before publishing a release, distill them:
     - user-visible changes only — no dev tooling, CI fixes, or refactors whose
       effect is already covered by another entry
     - describe outcomes, not internals: no internal module names, IPC or
       protocol details, or implementation mechanics — write what the user
       observes, not how the code achieves it
     - one line per theme: merge entries that share a root cause
     - each entry fits a single readable line (about 60 CJK characters); if it
       overflows, it is packing multiple themes or detail that belongs in the
       linked issue/PR — split it or drop the detail
     - line grammar: open with a verb (修复/新增/优化), with the platform
       first (Windows/macOS/Linux) when the change is platform-specific;
       merge sub-symptoms as 主题：症状、症状; full-width punctuation,
       「」 for UI labels, backticks for config keys and commands
     - omit the redundant suffix 「的问题」; end with the concrete symptom
       or outcome instead
     - platform entries sit under their platform heading (bold, emoji
       prefixed, ordered Windows/macOS/Linux, combined for pairs like
       macOS/Linux) at the end of their section;
       scripts-workflow/group_platforms.sh regroups, --check verifies
     HTML comments are stripped by the update dialog's sanitizer and hidden on
     GitHub, so they never reach users. -->
## v2.6.0

- **Mihomo 内核升级至 v1.19.34**

<details>
<summary><strong> 🐞 修复问题 </strong></summary>

- 修复「外部控制器」复制成功的提示一闪而过
- 修复订阅的规则、代理组、节点编辑器快速连续操作时条目可能重复或错位
- 修复检测更新后又发布新版时，应用内更新失败
- 修复关闭「自动检查更新」后，手动检查更新时弹窗空白
- 修复订阅响应过大导致内存占用过高，限制单次下载为 4 MiB
- 修复全局模式默认停在 `DIRECT` 或 `REJECT` 导致流量未经代理，现自动切换到第一个策略组
- 修复订阅中未加引号的 REALITY `short-id`（如 `1234e123`）被误读为数字，导致订阅无法启用
- 修复订阅中唯一的代理组名为 `GLOBAL` 或没有代理组时，规则模式下代理页面显示「未获取到代理信息」
- 修复窗口较窄时，首页「当前节点」卡片中过长的节点名把延迟标签挤出卡片
- 修复断开链式代理时清空已选节点，导致再次连接需要重新选择
- 修复「连接」页表格排序时表头换行、标题位置跳动
- 修复「TUN 设置」未手动保存时，界面显示的默认 MTU 1500 未生效
- 修复连接详情较窄时操作按钮偏离右侧
- 修复「链式代理」节点列表按名称排序，未保持订阅中的节点顺序
- 修复规则模式下 Muse AI 解锁检测显示错误的出口地区
- 修复使用系统代理或本地代理认证时首页 IP 信息显示直连地址或报错
- 修复打开「链式代理」时自动对全部节点发起延迟测试

**🖥️ Windows**

- 修复 Windows 普通用户因权限不足无法开启「开机自启」

**🍎 macOS**

- 修复 macOS TUN 模式下原有 DNS 被清除、关闭后 DNS 未恢复及联网后设置未生效
- 修复 macOS 断网时误报代理已回退直连，恢复联网后自动重试系统代理
- 修复 macOS 切换主题后标题栏保留原有深浅色

**🐧 Linux**

- 修复 Linux OpenRC 环境下服务安装失败
- 修复 Linux 安装版 Mihomo 内核升级因权限不足而失败

</details>

<details>
<summary><strong> ✨ 新增功能 </strong></summary>

- 新增连接页面按网络协议（TCP/UDP）筛选连接
- 新增从连接详情设置域名、进程或源／目标 IP 规则，支持识别主域、匹配子域、自定义 IP 网段及修改已有规则
- 新增规则模式下在规则流量未经过的代理组选节点时，自动将首个包含该组的 `select` 代理组切换到该组，可在「杂项设置」关闭

</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>

- 优化设置页打开时的开销：布局设置弹窗首次打开时才加载图标
- 优化连接、规则和日志筛选：切换页面后保留过滤条件
- 优化全局模式代理列表：仅显示 `GLOBAL` 节点，选中其中的策略组时才显示该组
- 优化设置页开关和选项所在行的鼠标悬停高亮，便于对应说明与控件
- 优化首页「当前节点」卡片：按规则指向的代理组逐级显示和切换实际生效的节点，选中后下拉菜单自动收起
- 优化延迟测试：节点超时后自动重测一次再显示结果，减少网络波动造成的误报

**🍎 macOS**

- 优化 macOS TUN 模式的系统 DNS，增加阿里和 Cloudflare 地址

</details>
