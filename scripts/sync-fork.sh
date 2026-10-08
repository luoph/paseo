#!/usr/bin/env bash
# 把当前分支 rebase 到官方最新代码上，再推回个人 fork。流程说明见 docs/fork-sync.md。
#
# 用法：
#   ./scripts/sync-fork.sh                 # rebase 到官方 main 并推送
#   ./scripts/sync-fork.sh --latest-tag    # rebase 到官方最新正式版 tag（跳过 beta）
#   ./scripts/sync-fork.sh --onto v0.11.1  # rebase 到指定 tag 或 ref
#   ./scripts/sync-fork.sh --verify        # rebase 后安装依赖、typecheck、构建 legacy Web UI，全部通过才推送
#   ./scripts/sync-fork.sh --sync-main     # 推送时顺带把 fork 的 main 快进到官方 main
#   ./scripts/sync-fork.sh --no-push       # 只 rebase，不推送
#
# 环境变量：
#   UPSTREAM_REMOTE  官方仓库的 remote，默认 origin
#   FORK_REMOTE      个人 fork 的 remote，默认 fork
set -euo pipefail

# 整个脚本放在一个代码块里，bash 先读完再执行。rebase 会改写这个文件本身，
# 边读边执行可能读到新内容。
{

UPSTREAM_REMOTE="${UPSTREAM_REMOTE:-origin}"
FORK_REMOTE="${FORK_REMOTE:-fork}"
ONTO=""
USE_LATEST_TAG=false
PUSH=true
VERIFY=false
SYNC_MAIN=false

usage() {
  sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
}

die() {
  echo "错误：$*" >&2
  exit 1
}

step() {
  printf '\n==> %s\n' "$*"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --onto)
      [[ $# -ge 2 ]] || die "--onto 需要一个 tag 或 ref"
      ONTO="$2"
      shift 2
      ;;
    --latest-tag) USE_LATEST_TAG=true; shift ;;
    --verify) VERIFY=true; shift ;;
    --sync-main) SYNC_MAIN=true; shift ;;
    --no-push) PUSH=false; shift ;;
    -h | --help) usage; exit 0 ;;
    *) usage >&2; die "未知参数：$1" ;;
  esac
done

if $USE_LATEST_TAG && [[ -n "$ONTO" ]]; then
  die "--latest-tag 和 --onto 只能选一个"
fi

cd "$(git rev-parse --show-toplevel)"

# ---- 前置检查 ----

if [[ -d "$(git rev-parse --git-path rebase-merge)" || -d "$(git rev-parse --git-path rebase-apply)" ]]; then
  die "有未完成的 rebase。先解决冲突并执行 git rebase --continue（或 git rebase --abort），再重新运行本脚本。"
fi

BRANCH="$(git symbolic-ref --quiet --short HEAD)" || die "当前是 detached HEAD，先切到要同步的分支。"
[[ "$BRANCH" != "main" ]] || die "不要在 main 上运行，切到你的功能分支（例如 feat/ios12-legacy-web）。"

git remote get-url "$UPSTREAM_REMOTE" >/dev/null 2>&1 || die "找不到 remote：$UPSTREAM_REMOTE"
if $PUSH; then
  git remote get-url "$FORK_REMOTE" >/dev/null 2>&1 || die "找不到 remote：$FORK_REMOTE（见 docs/fork-sync.md 的初始配置）"
fi

[[ -z "$(git status --porcelain --untracked-files=no)" ]] || die "工作区有未提交的改动。先提交（可以是临时 WIP 提交）再同步。"

# ---- 拉取官方代码，确定目标 ----

step "拉取 $UPSTREAM_REMOTE 的最新代码和 tag"
git fetch "$UPSTREAM_REMOTE" --tags

if $USE_LATEST_TAG; then
  # 带 "-" 的是预发布版本（v0.11.0-beta.1 之类）
  ONTO="$(git tag --list 'v*' --sort=-v:refname | grep -v -- '-' | sed -n 1p || true)"
  [[ -n "$ONTO" ]] || die "没有找到正式版 tag"
fi
ONTO="${ONTO:-$UPSTREAM_REMOTE/main}"
TARGET_SHA="$(git rev-parse --verify --quiet "$ONTO^{commit}")" || die "找不到 $ONTO"

# 自己的提交 = 当前分支上、官方任何分支和 tag 都不包含的提交。
# 用它定位旧基线，再 rebase --onto，这样在 main 和 tag 之间来回切换时，
# 不会把官方提交当成自己的提交重放。
OWN_EXCLUDES=(--not "--remotes=$UPSTREAM_REMOTE" --tags)
OWN_COUNT="$(git rev-list --count HEAD "${OWN_EXCLUDES[@]}")"
MERGE_COUNT="$(git rev-list --count --merges HEAD "${OWN_EXCLUDES[@]}")"
[[ "$MERGE_COUNT" == "0" ]] || die "分支上有 $MERGE_COUNT 个 merge 提交，本脚本只处理线性历史。"

if [[ "$OWN_COUNT" == "0" ]]; then
  OLD_BASE="$(git rev-parse HEAD)"
else
  OLDEST="$(git rev-list --reverse HEAD "${OWN_EXCLUDES[@]}" | sed -n 1p)"
  OLD_BASE="$(git rev-parse "$OLDEST^")"
fi

ORIG_SHA="$(git rev-parse HEAD)"

echo "分支：$BRANCH"
echo "目标：$ONTO ($(git rev-parse --short "$TARGET_SHA"))"
echo "自己的提交（$OWN_COUNT 个）："
git --no-pager log --oneline "$OLD_BASE..HEAD"

# ---- rebase ----

if [[ "$OLD_BASE" == "$TARGET_SHA" ]]; then
  step "已经基于 $ONTO，跳过 rebase"
else
  NEW_COUNT="$(git rev-list --count "$OLD_BASE..$TARGET_SHA")"
  DROPPED_COUNT="$(git rev-list --count "$TARGET_SHA..$OLD_BASE")"
  step "rebase 到 $ONTO（相对当前基线：官方新增 $NEW_COUNT 个提交，退回 $DROPPED_COUNT 个提交）"
  echo "同步前的 HEAD：$ORIG_SHA"
  echo "想撤销这次同步：git reset --hard $ORIG_SHA"
  if ! git rebase --onto "$TARGET_SHA" "$OLD_BASE" "$BRANCH"; then
    cat >&2 <<EOF

rebase 遇到冲突，已停下。
  1. 解决冲突，git add <文件>，再 git rebase --continue，直到 rebase 结束
  2. 用同样的参数重新运行本脚本，它会跳过 rebase，接着校验和推送
放弃这次同步：git rebase --abort
EOF
    exit 1
  fi
fi

# ---- 校验 ----

if $VERIFY; then
  step "校验：npm install"
  npm install --no-audit --no-fund
  step "校验：npm run build:server（刷新跨包类型声明）"
  npm run build:server
  step "校验：npm run typecheck"
  npm run typecheck
  step "校验：npm run build:legacy-web-ui"
  npm run build:legacy-web-ui
fi

# ---- 推送 ----

if ! $PUSH; then
  step "完成（--no-push，未推送）"
  exit 0
fi

if [[ "$(git rev-parse --verify --quiet "refs/remotes/$FORK_REMOTE/$BRANCH" || true)" == "$(git rev-parse HEAD)" ]]; then
  step "$FORK_REMOTE/$BRANCH 已是最新，无需推送"
else
  step "推送到 $FORK_REMOTE/$BRANCH"
  # rebase 改写了历史，必须强推；--force-with-lease 在 fork 上有本地没见过的提交时会拒绝覆盖
  git push --force-with-lease -u "$FORK_REMOTE" "$BRANCH"
fi

if $SYNC_MAIN; then
  step "把 $FORK_REMOTE/main 快进到 $UPSTREAM_REMOTE/main"
  # 不加 force：fork 的 main 只做快进，分叉时直接失败
  git push "$FORK_REMOTE" "refs/remotes/$UPSTREAM_REMOTE/main:refs/heads/main"
fi

step "完成"
exit 0
}
