
#!/bin/bash
set -e

cd /Users/slagsea/Documents/rust/clash-verge-rev

COMMIT_HASH="0bb19c251fbaeb7b1ae690ccf41617105cdc9b45"

echo "=========================================="
echo "修复提交 $COMMIT_HASH 的邮箱并推送"
echo "=========================================="
echo ""

# 检查提交是否存在
if ! git cat-file -e "$COMMIT_HASH" 2>/dev/null; then
    echo "错误: 提交 $COMMIT_HASH 不存在"
    exit 1
fi

# 获取提交信息
COMMIT_NAME=$(git show "$COMMIT_HASH" --format="%aN" --no-patch -s 2>&1)
COMMIT_EMAIL=$(git show "$COMMIT_HASH" --format="%aE" --no-patch -s 2>&1)
COMMIT_MSG=$(git show "$COMMIT_HASH" --format="%s" --no-patch -s 2>&1)

echo "提交信息:"
echo "  提交者: $COMMIT_NAME <$COMMIT_EMAIL>"
echo "  提交消息: $COMMIT_MSG"
echo "  提交哈希: $COMMIT_HASH"
echo ""

# 手动输入邮箱
read -p "请输入正确的邮箱地址（与 GPG 签名匹配）: " NEW_EMAIL

if [ -z "$NEW_EMAIL" ]; then
    echo "错误: 邮箱不能为空"
    exit 1
fi

echo ""
echo "将修改为: $COMMIT_NAME <$NEW_EMAIL>"
read -p "确认修改并推送? (y/N): " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "已取消"
    exit 0
fi

# 更新 Git 配置
git config user.email "$NEW_EMAIL"
git config user.name "$COMMIT_NAME"

# 检查是否是 HEAD
CURRENT_HEAD=$(git rev-parse HEAD 2>&1)

if [ "$CURRENT_HEAD" = "$COMMIT_HASH" ]; then
    # 如果是 HEAD，直接 amend
    echo ""
    echo "这是 HEAD 提交，正在修改..."
    git commit --amend --author="$COMMIT_NAME <$NEW_EMAIL>" --no-edit
    echo "✓ 提交已修改"
else
    # 如果不是 HEAD，使用 rebase
    echo ""
    echo "这不是 HEAD 提交，使用 rebase 修改..."
    
    # 找到提交的父提交
    PARENT=$(git rev-parse "$COMMIT_HASH^" 2>&1)
    
    # 检查提交是否在当前分支
    if git merge-base --is-ancestor "$COMMIT_HASH" HEAD 2>/dev/null; then
        echo "提交在当前分支历史中，开始 rebase..."
        
        # 创建 rebase 编辑脚本
        REBASE_SCRIPT=$(mktemp)
        cat > "$REBASE_SCRIPT" << EOF
#!/bin/bash
sed -i.bak "s/^pick $COMMIT_HASH/edit $COMMIT_HASH/" "\$1"
EOF
        chmod +x "$REBASE_SCRIPT"
        
        # 执行 rebase
        GIT_SEQUENCE_EDITOR="$REBASE_SCRIPT" git rebase -i "$PARENT" 2>&1 || {
            echo "Rebase 交互式模式，请手动编辑..."
            # 如果自动编辑失败，提示用户
            echo "请在打开的编辑器中，将 'pick $COMMIT_HASH' 改为 'edit $COMMIT_HASH'"
            read -p "按回车继续..."
        }
        
        git commit --amend --author="$COMMIT_NAME <$NEW_EMAIL>" --no-edit
        git rebase --continue 2>&1 || {
            echo "Rebase 完成或遇到冲突，请检查状态"
            git status
            exit 1
        }
        
        rm -f "$REBASE_SCRIPT"
        echo "✓ 提交已修改"
    else
        echo "错误: 提交 $COMMIT_HASH 不在当前分支的历史中"
        echo "无法使用 rebase 修改，请切换到包含该提交的分支"
        exit 1
    fi
fi

echo ""
echo "修改后的提交信息:"
NEW_HASH=$(git rev-parse HEAD 2>&1)
git log -1 --format="  提交者: %aN <%aE>%n  提交哈希: %H" 2>&1
echo ""

# 获取分支和远程信息
BRANCH=$(git branch --show-current 2>&1)
REMOTE="origin2"

# 推送到远程
echo "推送到 $REMOTE/$BRANCH..."
git push --force-with-lease "$REMOTE" "$BRANCH"

echo ""
echo "✓ 完成！提交已修改并推送"

