# 使用指南

[English](/en/usage) | [中文](/zh/usage)

## 安装

CLI 包已经发布到 npm：

```bash
npm install -g git-agent-sync
```

VS Code 插件已经发布到 Marketplace：

- Marketplace：[Git Agent Sync](https://marketplace.visualstudio.com/items?itemName=mokio.agent-sync-vscode)
- 扩展 ID：`mokio.agent-sync-vscode`

插件会从 `agentSync.cliPath` 调用 CLI，默认命令是 `agent-sync`。Windows 下还会检查常见 npm 全局安装目录，并支持 npm 生成的 `agent-sync.cmd` shim。History 视图顶部工具栏可以对当前 workspace 执行 pull、push、查看同步状态、隐私扫描、列出 sidecar 冲突、Conversation IR 检查、本机 provider clone / register / clean、打开 TUI、刷新、清空筛选和恢复会话；Command Palette 还提供后台同步、队列 flush、daemon 状态、register-local、repair-local、clean-local 预览、隐私脱敏预览和 readable tool export。

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

## 本机 Codex Provider Clone

当你切换 Codex API 来源，希望当前项目的 Codex 会话在新的 `model_provider` 下继续可见时，可以做本机 clone：

```bash
git agent-sync clone-local
git agent-sync clone-local openrouter
git agent-sync clone-local openrouter --no-register
git agent-sync register-local
git agent-sync repair-local
git agent-sync clean-local
git agent-sync clean-local --force
```

省略目标 provider 时，Agent-Sync 会读取 `~/.codex/config.toml` 里的 `model_provider`。克隆后的 rollout 仍写在 `~/.codex/sessions`，会生成稳定的新 session id，并记录 `cloned_from`、`original_provider`、`clone_timestamp` 等元数据。默认还会注册本机 `state_5.sqlite` 和 `session_index.jsonl`，让 Codex UI 能看到克隆会话；如果只想写文件，可以加 `--no-register`。运行 `register-local` 可以显式把本机已存在的 Agent-Sync provider 克隆注册进 Codex UI 索引。如果底层文件已存在但 UI 看不到，运行 `repair-local` 会重新注册 Agent-Sync 生成的 provider 克隆。`clean-local` 默认只预览当前项目生成的 provider clone；加 `--force` 后才会删除这些 Agent-Sync 生成的 rollout 文件。命令只处理通过结构化项目元数据匹配当前 Git 项目的 Codex 会话或克隆。

切换 Codex API provider 时如果希望自动同步：

```bash
git agent-sync watch-local
```

`watch-local` 会轮询 `~/.codex/config.toml`；当 `model_provider` 变化时，它会把当前项目的 Codex 会话克隆到新的 provider。VS Code History 视图里也有 Clone 和 Watch 按钮，会对当前 workspace 执行同样的本机命令。

## 终端 TUI

如果希望把常用流程集中在一个终端菜单里，可以运行：

```bash
git agent-sync tui
```

TUI 可以执行 status、最新 log、pull、push、按编号 restore、`clone-local`、`register-local`、`repair-local`、`clean-local` 预览、本机 watch，以及冲突 list/show/resolve。VS Code History 视图里也有 TUI 按钮，会在集成终端打开同一个菜单。

这个终端 UI 使用 React Ink 构建。操作会分成 Dashboard、Sync Queue、Session History、Local Provider、Tool Convert、Privacy Review、Conflicts 和 Settings 视图。方向键移动，Tab 或右方向键切换视图，Enter 执行当前动作；需要 restore index 或 bundle id 时会在底部提示输入。长时间运行的 provider watch 会交给普通 CLI 命令继续执行。

## Conversation IR 与工具导出

当你想用统一模型查看已经同步的 Codex 或 Claude bundle，可以使用 `tool` 命令：

```bash
git agent-sync tool inspect --session <bundle-id>
git agent-sync tool convert --session <bundle-id> --to ir --json
git agent-sync tool export --session <bundle-id> --to claude --mode readable
```

`inspect` 会输出来源 agent、标题、事件数量和工具调用数量。`convert` 会输出 Agent-Sync Conversation IR：原始 vendor JSONL 仍保存在 provenance/vendor 字段里，同时把消息、工具调用、工具结果、项目身份、runtime provider 和依赖线索映射成统一结构。`export --mode readable` 会写出可阅读/可归档的跨工具 JSONL；如果在目标 adapter 还不能安全续聊时请求 `--mode resumable`，导出 header 会记录 `requestedMode: "resumable"`，但保持 `mode: "readable"`、`resumable: false`，并写明 readable-only 原因。

## 自动同步

在需要自动同步会话的业务项目里安装 pre-push hook：

```bash
git agent-sync install-hooks
```

之后正常执行：

```bash
git push
```

hook 会把同步任务放入本地队列，并启动后台 worker，而不是在 `git push` 过程中直接执行耗时的 sidecar push。如果当前项目缺少 `.agent-sync/config.json`，或者 sidecar Git 仓库还不存在，hook 会直接成功退出，不会阻塞业务仓库自己的 `git push`。

当两台机器从同一个 sidecar base 分别提交并推送时，如果 sidecar push 遇到 non-fast-forward 拒绝，Agent-Sync 会自动 fetch `origin/main`，合并对象/事件分片，重建事件索引，然后再次 push。完全 unrelated 的 sidecar 历史仍会明确停止，不会猜测合并。

如果事件重放发现同一个 agent session id 对应多个对象 hash，原始对象会保持不变，Agent-Sync 会写入冲突隔离记录：

```bash
git agent-sync conflicts list
git agent-sync conflicts show 1
git agent-sync conflicts resolve 1 --strategy keep-all
```

`conflicts list` 默认只显示 active 记录；加 `--all` 可以看到已解决历史。`resolve` 只会用选择的策略（`keep-all`、`keep-latest`、`keep-local`、`keep-remote`）和可选 `--notes` 更新冲突元数据，不会删除任一对象。需要发布这条 sidecar 元数据时，再运行 `git agent-sync push`。

也可以手动管理队列和后台 worker：

```bash
git agent-sync sync --background
git agent-sync sync status
git agent-sync sync --flush
git agent-sync daemon start
git agent-sync daemon status
git agent-sync daemon stop
```

推送前会默认执行隐私 review。命中常见 API key、token、private key 时，`push` 会停止并提示先检查：

```bash
git agent-sync privacy scan
git agent-sync push --privacy redact
git agent-sync push --privacy allow
```

`--privacy redact` 会把 sidecar store 中的会话副本和对象副本写成脱敏内容；原始本机会话文件不会被改写。

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
