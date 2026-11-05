# Issue Guidelines / Issue 提交指引

Use these suggestions to make reports easier to assess. State what you observed
and what you could not verify; unknown details are fine.

以下建议有助于维护者评估问题。请说明实际观察到的现象和无法确认的部分；未知信息可以留空。

- Search existing issues by symptom, conditions, and outcome. Add new evidence
  to an existing report when it describes the same problem.
  按现象、条件和结果搜索已有 Issue。若描述的是同一问题，请在原 Issue 中补充新证据。
- Keep each issue to one distinct user problem or requested outcome. Split
  unrelated findings instead of bundling an audit or checklist.
  每个 Issue 聚焦一个独立的问题或需求结果；无关发现请拆开，不要把审计清单打包成一个 Issue。
- For bugs, include the version, operating system, steps, and actual versus
  expected behavior when known. A root-cause diagnosis is not required. Share
  only relevant logs and redact tokens or personal information.
  反馈 Bug 时，尽可能提供版本、操作系统、复现步骤及实际与预期行为。无需先判断根因；只提供相关日志，并遮盖令牌和个人信息。
- For feature requests, describe the user task, current limitation, desired
  outcome, and affected platforms. An implementation proposal is optional.
  提交功能请求时，请描述用户要完成的任务、当前限制、期望结果和适用平台；实现方案不是必填项。
- Separate observations from guesses. An AI or scanner finding is a hypothesis
  until its affected configuration, concrete impact, and supporting evidence
  are stated; do not present a list of theoretical risks as confirmed bugs.
  区分观察结果和推测。AI 或扫描器的发现应先视为假设；请说明受影响的配置、具体影响和支持证据，不要把理论风险清单写成已确认的 Bug。
- Do not post secrets, personal data, or sensitive exploit details in a public
  issue. Ask maintainers how to share sensitive security information safely.
  请勿在公开 Issue 中发布密钥、个人信息或敏感利用细节；如涉及安全敏感信息，请先询问维护者如何安全提供。
- AI assistance is welcome; human contributors do not need to disclose it. If
  an AI agent or automation creates or co-authors an issue, add a final body line
  such as `Assisted by: GPT-5.6 High`. Omit effort when the runtime does not
  report it. Disclosure is transparency only, not evidence for or against issue
  quality.
  欢迎使用 AI 辅助，人工提交者无需披露。如果 Issue 由 AI Agent 或自动化创建或共同撰写，请在正文末尾添加披露行，例如 `Assisted by: GPT-5.6 High`。运行环境未提供 effort 时可省略。披露仅用于提高透明度，不作为 Issue 质量的正面或负面证据。
