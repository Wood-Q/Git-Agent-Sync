# 远程同步

[English](/en/usage/remote-sync) | [中文](/zh/usage/remote-sync)

通过独立的私有 sidecar Git 仓库在多机之间同步当前项目的 Codex / Claude Code 会话。业务仓库只管代码，会话永远不进业务提交。

## 首次同步

先创建一个专门保存 agent 会话的私有仓库：

```text
git@github.com:yourname/agent-session-store.git
```

在业务仓库里初始化 Agent-Sync，并推送属于当前项目的本机会话：

```bash
cd your-project
git agent-sync init --remote git@github.com:yourname/agent-session-store.git
git agent-sync status
git agent-sync push --m "sync current agent sessions"
```

`init` 也支持把远程地址作为第一个位置参数：

```bash
git agent-sync init git@github.com:yourname/agent-session-store.git
```

如果 sidecar remote 已经有 `main` 分支，并且本地 `.agent-sync-store/` 还没有提交，`init` 会自动 checkout 这段远程 sidecar 历史。新项目初始化后可以直接 `push`；后续需要刷新已有 store 时再运行 `pull`。

## 在另一台机器恢复

先 clone 业务项目，再使用同一个 sidecar remote 初始化、拉取和恢复：

```bash
git clone git@github.com:yourname/your-project.git
cd your-project
git agent-sync init --remote git@github.com:yourname/agent-session-store.git
git agent-sync pull
git agent-sync log --latest
git agent-sync restore --latest 1
```

常用恢复 selector：

```bash
git agent-sync restore --latest
git agent-sync restore --current
git agent-sync restore --branch main
git agent-sync restore --commit 4f7c2a1
git agent-sync restore --index 1
```

`--latest` 匹配最近一次 sidecar 同步批次。`--current` 匹配当前业务项目 `HEAD` commit；如果没有 commit binding，再回退匹配当前 branch。`--commit` 匹配同步时记录的业务项目 commit。branch 只是同步发生时的历史标签，不代表会跟随可变分支指针。

如果需要完全按 sidecar 原文件恢复，不做本机路径适配：

```bash
git agent-sync restore --current --no-adapt
```

如果只想恢复文件，不写入 Codex UI 索引：

```bash
git agent-sync restore --current --no-register
```

## 自动同步（pre-push hook）

在需要自动同步会话的业务项目里安装 pre-push hook：

```bash
git agent-sync install-hooks
```

之后正常执行：

```bash
git push
```

hook 会把同步任务放入本地队列，并启动后台 worker，而不是在 `git push` 过程中直接执行耗时的 sidecar push。如果当前项目缺少 `.agent-sync/config.json`，或者 sidecar Git 仓库还不存在，hook 会直接成功退出，不会阻塞业务仓库自己的 `git push`。

移除 hook：

```bash
git agent-sync uninstall-hooks
```

## 后台同步队列与守护进程

当两台机器从同一个 sidecar base 分别提交并推送时，如果 sidecar push 遇到 non-fast-forward 拒绝，Agent-Sync 会自动 fetch `origin/main`，合并对象/事件分片，重建事件索引，然后再次 push。完全 unrelated 的 sidecar 历史仍会明确停止，不会猜测合并。

也可以手动管理队列和后台 worker：

```bash
git agent-sync sync --background
git agent-sync sync status
git agent-sync sync --flush
git agent-sync sync retry all
git agent-sync sync cancel all
git agent-sync daemon start
git agent-sync daemon status
git agent-sync daemon stop
```

flush 时如果发现上一次 daemon 崩溃留下的 `running` 任务，会在持有同步锁后恢复回 `pending`，并在同一轮继续处理。

## 冲突隔离

如果事件重放发现同一个 agent session id 对应多个对象 hash，原始对象会保持不变，Agent-Sync 会写入冲突隔离记录：

```bash
git agent-sync conflicts list
git agent-sync conflicts show 1
git agent-sync conflicts diff 1
git agent-sync conflicts resolve 1 --strategy keep-all
```

`conflicts list` 默认只显示 active 记录；加 `--all` 可以看到已解决历史。`conflicts diff` 会比较隔离对象的大小、行数和首个不同的行号，不打印原始会话内容。`resolve` 只会用选择的策略（`keep-all`、`keep-latest`、`keep-local`、`keep-remote`）和可选 `--notes` 更新冲突元数据，不会删除任一对象。需要发布这条 sidecar 元数据时，再运行 `git agent-sync push`。

## 隐私与脱敏

推送前会默认执行隐私 review。命中常见 API key、token、private key 时，`push` 会停止并提示先检查：

```bash
git agent-sync privacy scan
git agent-sync privacy allow-pattern-local documented_example=sk-example-[a-z]+
git agent-sync push --privacy redact
git agent-sync push --privacy allow
```

`--privacy redact` 会把 sidecar store 中的会话副本和对象副本写成脱敏内容；原始本机会话文件不会被改写。

可以用 `.agent-sync/privacy.json` 调整项目策略。`denyPatterns` 增加额外 secret 规则，`allowPatterns` 会让已知安全的示例值或 fixture 同时跳过扫描和脱敏。`git agent-sync privacy allow-pattern-local <name>=<regex>` 可以追加一条确认过的本地 allow rule，不需要手工改 JSON。
