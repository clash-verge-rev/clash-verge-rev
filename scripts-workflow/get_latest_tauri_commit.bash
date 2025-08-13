#!/bin/bash

# 获取最近一个和 Tauri 相关的改动的 commit hash
# This script finds the latest commit that modified Tauri-related files

# Tauri 相关文件的模式
TAURI_PATTERNS=(
    "src-tauri/"
    "Cargo.toml"
    "Cargo.lock"
    "tauri.*.conf.json"
    "package.json"
    "pnpm-lock.yaml"
    "src/"
)

# 排除的文件模式（build artifacts 等）
EXCLUDE_PATTERNS=(
    "src-tauri/target/"
    "src-tauri/gen/"
    "*.log"
    "*.tmp"
    "node_modules/"
    ".git/"
)

# 构建 git log 的路径过滤参数
PATHS=""
for pattern in "${TAURI_PATTERNS[@]}"; do
    if [[ -e "$pattern" ]]; then
        PATHS="$PATHS $pattern"
    fi
done

# 如果没有找到相关路径，返回错误
if [[ -z "$PATHS" ]]; then
    echo "Error: No Tauri-related paths found in current directory" >&2
    exit 1
fi

# 获取最新的 commit hash
# 使用 git log 查找最近修改了 Tauri 相关文件的提交
LATEST_COMMIT=$(git log --format="%H" -n 1 -- $PATHS)

# 验证是否找到了 commit
if [[ -z "$LATEST_COMMIT" ]]; then
    echo "Error: No commits found for Tauri-related files" >&2
    exit 1
fi

# 输出结果
echo "$LATEST_COMMIT"

# 如果需要更多信息，可以取消注释以下行
# echo "Latest Tauri-related commit: $LATEST_COMMIT"
# git show --stat --oneline "$LATEST_COMMIT"