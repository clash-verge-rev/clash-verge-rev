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
     - platform entries sit under their platform heading (bold, emoji
       prefixed, ordered Windows/macOS/Linux, combined for pairs like
       macOS/Linux) at the end of their section;
       scripts-workflow/group_platforms.sh regroups, --check verifies
     HTML comments are stripped by the update dialog's sanitizer and hidden on
     GitHub, so they never reach users. -->
## v2.6.0

<details>
<summary><strong> 🐞 修复问题 </strong></summary>

- 修复规则扩展包含空列表项时，「编辑规则」界面报错的问题
- 修复 重启应用后定时自动备份不执行的问题
- 修复托盘测速与代理页行为不一致的问题，移除托盘「测试延迟」入口
- 修复通过 URL 导入订阅时，即使导入的订阅并非当前使用的订阅，也会重新加载当前配置
- 修复 首页 网站测速失败后卡片一直显示测试中
- 修复 代理 页展开分组后不显示最新测速结果，需切换节点才刷新
- 修复 代理 在全局模式下无法展开节点组
- 修复 自定义 CSS 无法修改编辑器字体和字号的问题
- 修复 WebDAV 设置清空后无法保存
- 修复检测更新后又发布新版时，应用内更新失败

**🍎 macOS**

- macOS：修复 Bigsur 上首页测速和流量图无法显示的问题

**🐧 Linux**

- Linux：修复 deb/rpm 安装包错误包含多余的 `frontend-contract` 可执行文件，导致下游重新打包失败的问题

</details>

<details>
<summary><strong> ✨ 新增功能 </strong></summary>


</details>

<details>
<summary><strong> 🚀 优化改进 </strong></summary>


</details>
