# 跟随官方更新（fork 同步）

本仓库是 [getpaseo/paseo](https://github.com/getpaseo/paseo) 的个人 fork（[luoph/paseo](https://github.com/luoph/paseo)），在官方代码之上维护少量自己的提交，例如 iOS 12 legacy Web UI。同步方式固定为 rebase：自己的提交始终排在官方最新代码之上，历史保持线性，回看和排查冲突都简单。

## Remote 约定

| Remote   | 指向             | 用途                       |
| -------- | ---------------- | -------------------------- |
| `origin` | `getpaseo/paseo` | 只拉取官方代码，不向它推送 |
| `fork`   | `luoph/paseo`    | 推送自己的分支             |

新 clone 时补上 `fork`：

```bash
git remote add fork git@github.com:luoph/paseo.git
```

remote 名不同的话，用环境变量 `UPSTREAM_REMOTE`、`FORK_REMOTE` 告诉脚本。

## 同步

在功能分支上运行：

```bash
./scripts/sync-fork.sh            # 跟官方 main
./scripts/sync-fork.sh --verify   # 跟官方 main，校验通过后再推送（推荐）
./scripts/sync-fork.sh --latest-tag --verify   # 只跟官方正式版
```

脚本依次做这些事：拉取 `origin` 的代码和 tag，把自己的提交 rebase 到目标上，可选地校验，最后用 `--force-with-lease` 推到 `fork`。已经基于目标时跳过 rebase，fork 已是最新时跳过推送，所以重复运行没有副作用。

| 参数           | 作用                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| （无）         | rebase 到 `origin/main`                                                                                   |
| `--latest-tag` | rebase 到最新正式版 tag，跳过 `-beta` 等预发布版本                                                        |
| `--onto <ref>` | rebase 到指定 tag 或 ref，例如 `--onto v0.11.1`                                                           |
| `--verify`     | rebase 后依次运行 `npm install`、`build:server`、`typecheck`、`build:legacy-web-ui`，任何一步失败都不推送 |
| `--sync-main`  | 顺带把 `fork/main` 快进到 `origin/main`。只快进，分叉时报错                                               |
| `--no-push`    | 只在本地 rebase，不推送                                                                                   |

在 `main` 和 tag 之间来回切换是安全的。脚本把“官方任何分支和 tag 都不包含的提交”当作自己的提交，只重放这些。

## 冲突

rebase 遇到冲突会停下，脚本退出：

1. 解决冲突，`git add <文件>`，`git rebase --continue`，直到 rebase 结束。
2. 用同样的参数再运行一次脚本，它会跳过 rebase，接着校验和推送。

放弃这次同步用 `git rebase --abort`。

rebase 已经完成、但结果不对时，用脚本打印的“同步前的 HEAD”回退：

```bash
git reset --hard <同步前的 HEAD>
```

也可以从 `git reflog` 里找。回退后还没推送就到此为止；如果已经推送，回退后再运行 `git push --force-with-lease fork <分支>`。

## 规则

- 只在自己独占的功能分支上 rebase。有人基于这个分支开发时，改用 `git merge origin/main`，免得强推覆盖别人的基线。
- 分支上不要有 merge 提交，脚本遇到会拒绝运行。
- 自己的改动尽量放进新文件，少改官方已有文件。改动越集中，rebase 冲突越少。
- 同步后在 iOS 12 真机上打开一次 legacy Web UI，并连上主机看一遍侧边栏和会话。官方可能引入 Safari 12 不支持的语法或 API，`build:legacy-web-ui` 的 ES2019 校验能拦下语法问题，运行时缺失的 API 只有真机打开才会暴露，有些（如运行中 agent 的状态环）连上主机才出现。真机调试方法见 [legacy-web-ui.md](legacy-web-ui.md)。
- 运行 `--verify` 后如果 `package-lock.json` 被改动，说明 `npm install` 重写了锁文件。确认是否要提交，别让它混进下一次同步。
