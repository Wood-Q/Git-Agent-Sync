# 使用指南

[English](usage.md) | [中文](usage.zh-CN.md)

## 安装

CLI 包已经发布到 npm：

```bash
npm install -g git-agent-sync
```

VS Code 插件已经发布到 Marketplace：

- Marketplace：[Git Agent Sync](https://marketplace.visualstudio.com/items?itemName=mokio.agent-sync-vscode)
- 扩展 ID：`mokio.agent-sync-vscode`

插件会从 `agentSync.cliPath` 调用 CLI，默认命令是 `agent-sync`。Windows 下还会检查常见 npm 全局安装目录，并支持 npm 生成的 `agent-sync.cmd` shim。History 视图顶部工具栏可以对当前 workspace 执行 pull、push、刷新、清空筛选和恢复会话。

本地开发阶段：

```bash
cd ~/Agent-Sync
npm install
npm link
git agent-sync --help
```

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

## 自动同步

在需要自动同步会话的业务项目里安装 pre-push hook：

```bash
git agent-sync install-hooks
```

之后正常执行：

```bash
git push
```

hook 会先运行 `git-agent-sync push`。如果当前项目缺少 `.agent-sync/config.json`，或者 sidecar Git 仓库还不存在，hook 会直接成功退出，不会阻塞业务仓库自己的 `git push`。

移除 hook：

```bash
git agent-sync uninstall-hooks
```

## 自定义会话路径

如果你的 agent 会话不在默认路径，可以用环境变量覆盖。`AGENT_SYNC_CODEX_DIR` 可以指向 `.codex` 目录或 `.codex/sessions` 目录，`AGENT_SYNC_CLAUDE_DIR` 可以指向 Claude 的 `projects` 目录：

```bash
AGENT_SYNC_CODEX_DIR=/path/to/codex/sessions git agent-sync status
AGENT_SYNC_CLAUDE_DIR=/path/to/claude/projects git agent-sync status
```

Windows PowerShell 示例：

```powershell
$env:AGENT_SYNC_CODEX_DIR="D:\codex-sessions"
git agent-sync status
```

## 排查问题

优先运行：

```bash
git agent-sync doctor
```

`doctor` 会报告 sidecar remote 是否可达、sidecar store 是否启用 sparse checkout、`manifest.json` 和 `bindings.jsonl` 是否可读，以及当前能看到多少本地 agent session 文件。

如果 `pull` 提示没有 remote，重新初始化并传入远程仓库：

```bash
git agent-sync init --remote git@github.com:yourname/agent-session-store.git
```

如果旧版本曾经报“当前分支没有跟踪信息”，升级后重新运行 `git agent-sync pull`。当前版本会自动 fetch `origin/main`，在需要时创建或绑定本地 `main -> origin/main`，然后执行 fast-forward pull。

如果 `push` 或 `pull` 提示 sidecar 历史无关，说明本地 `.agent-sync-store/` 已经有提交，并且这些提交和配置的 sidecar remote 没有共同祖先。先备份 `.agent-sync-store/`，再显式用 Git 合并两段历史，或把 sidecar store 重置到远端后重新同步。

如果 `pull` 成功但没有显示可恢复会话，运行：

```bash
git agent-sync doctor
find .agent-sync-store/projects -maxdepth 2 -name manifest.json -print
```

这可以确认远程 store 里是否有当前项目 identity 或旧版 legacy id 对应的 bundle。
