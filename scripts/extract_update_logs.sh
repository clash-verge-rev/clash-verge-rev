#!/usr/bin/env bash
#
# extract_update_logs.sh
# 从 Changelog.md 提取最新版本 (## v...) 的更新内容
# 并输出到屏幕或写入环境变量文件（如 GitHub Actions）

set -euo pipefail

CHANGELOG_FILE="Changelog.md"

if [[ ! -f "$CHANGELOG_FILE" ]]; then
  echo "❌ 文件不存在: $CHANGELOG_FILE" >&2
  exit 1
fi

# 提取从第一个 '## v' 开始到下一个 '## v' 前的内容
UPDATE_LOGS=$(awk '
  /^## v/ {
    if (found) exit;
    found=1
  }
  found
' "$CHANGELOG_FILE")

if [[ -z "$UPDATE_LOGS" ]]; then
  echo "⚠️ 未找到更新日志内容"
  exit 0
fi

echo "✅ 提取到的最新版本日志内容如下："
echo "----------------------------------------"
echo "$UPDATE_LOGS"
echo "----------------------------------------"

# 如果在 GitHub Actions 环境中（GITHUB_ENV 已定义）
if [[ -n "${GITHUB_ENV:-}" ]]; then
  {
    echo "UPDATE_LOGS<<EOF"
    echo "$UPDATE_LOGS"
    echo "EOF"
  } >> "$GITHUB_ENV"
  echo "✅ 已写入 GitHub 环境变量 UPDATE_LOGS"
fi
