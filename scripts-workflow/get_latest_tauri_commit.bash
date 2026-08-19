#!/bin/bash

# Print the latest commit that modified Tauri-related files.

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

PATHS=""
for pattern in "${TAURI_PATTERNS[@]}"; do
    if [[ -e "$pattern" ]]; then
        PATHS="$PATHS $pattern"
    fi
done

if [[ -z "$PATHS" ]]; then
    echo "Error: No Tauri-related paths found in current directory" >&2
    exit 1
fi

LATEST_COMMIT=$(git log --format="%H" -n 1 -- $PATHS)

if [[ -z "$LATEST_COMMIT" ]]; then
    echo "Error: No commits found for Tauri-related files" >&2
    exit 1
fi

echo "$LATEST_COMMIT"
