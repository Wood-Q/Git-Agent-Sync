<p align="center">
  <img src="logo.svg" alt="Agent-Sync logo" width="160">
</p>

# Agent-Sync

[English](README.md) | [中文](README.zh-CN.md)

**Agent-Sync** 是一个围绕 AI 编程 agent 对话的全能工具箱——不只是同步。

Codex 和 Claude Code 的会话里装着真正的工作成果：设计讨论、调试线索、命令历史、工具调用。这些内容通常只能留在创建它们的机器上。Agent-Sync 找到这些对话，把它们当作一等的项目产物，用一套工具帮你**同步、迁移、转换、诊断**——绝不让它们污染你的源码仓库。

> 像管理代码一样管理 AI 编程会话，外加一把处理会话周边的瑞士军刀。

## 它做四件事

| 能力 | 含义 |
| --- | --- |
| **远程同步** | 通过独立的私有 sidecar Git 仓库在多机之间移动项目会话。`push` / `pull` / `restore` 让对话始终绑在正确的分支和 commit 上。 |
| **本地迁移** | 切换 Codex `model_provider`？`clone-local` 把当前项目的 Codex 会话克隆到当前 provider，并注册进本地 UI。`watch-local` 持续自动完成。 |
| **跨工具转换** | 通过 Conversation IR 把 Codex bundle 转成可读的 Claude JSONL（或反向）。`tool inspect` / `convert` / `export` 让对话跨工具流动。 |
| **诊断与运维** | `doctor` 检查整条链路。`privacy` 在推送前扫描密钥。`conflicts` 隔离分叉的会话。TUI 把这一切串起来。 |

## 安装

CLI 包：

```bash
npm install -g git-agent-sync
```

VS Code 插件：

- Marketplace：[Git Agent Sync](https://marketplace.visualstudio.com/items?itemName=mokio.agent-sync-vscode)
- 插件 ID：`mokio.agent-sync-vscode`

本地开发：

```bash
git clone https://github.com/Wood-Q/Git-Agent-Sync.git
cd Git-Agent-Sync
npm install
npm link
git agent-sync --help
npm test
```

完整测试覆盖 CLI、daemon、隐私、TUI、E2E 与 VS Code 适配。

## TUI

```bash
git agent-sync tui          # English
git agent-sync tui --cn     # 中文
```

一个快速的全屏终端 UI（原生单键、figlet + 渐变标题），三个工作区：

- **远程同步** —— `push`、`pull`、`restore`（带会话浏览器）、`log`、`init`、`install-hooks`
- **本地迁移** —— 克隆 Codex 到当前 provider、注册副本、监控 provider 变化、把 bundle 迁移成 Claude/Codex JSONL
- **诊断** —— `doctor` 健康检查、会话 `status`

`↑/↓` 移动、`Enter` 执行、热键直达、`q` 返回。`log` 和 `restore` 会打开浏览器，展示每一条已同步会话（带编号），不用再猜编号。

## 远程同步流程

为 agent 会话建一个私有仓库，例如 `git@github.com:you/agent-session-store.git`。

在有现成会话的机器上：

```bash
cd your-project
git agent-sync init --remote git@github.com:you/agent-session-store.git
git agent-sync status
git agent-sync push
```

在另一台机器上：

```bash
git clone git@github.com:you/your-project.git
cd your-project
git agent-sync init --remote git@github.com:you/agent-session-store.git
git agent-sync pull
git agent-sync log --latest
git agent-sync restore --latest 1
```

在正常项目 push 之前自动同步——钩子会把同步任务入队到后台，而不是内联执行：

```bash
git agent-sync install-hooks
git push
git agent-sync sync status     # 查看队列
git agent-sync daemon start    # 或跑一个后台 worker
```

## 本地迁移（无需远程）

当你在本地切换 Codex `model_provider` 时，旧 provider 下的会话会从 UI 消失。Agent-Sync 把它们克隆到当前 provider，无需触碰 sidecar 远程：

```bash
git agent-sync clone-local              # 把当前项目的 Codex 会话克隆到当前 provider
git agent-sync register-local           # 把副本注册进本地 Codex 索引
git agent-sync watch-local              # provider 变化时持续同步
```

## 跨工具转换

每条已同步的 bundle 都能通过 **Conversation IR** 归一化，再为另一个工具重新导出：

```bash
git agent-sync tool inspect  --session <bundle-id>                       # 以 IR 摘要
git agent-sync tool convert  --session <bundle-id> --to ir --json        # 完整 IR
git agent-sync tool export   --session <bundle-id> --to claude --mode readable
git agent-sync tool export   --session <bundle-id> --to codex  --mode readable
```

`readable` 导出干净的跨工具视图；只有当目标工具确实能接受 schema、索引和依赖时，才会报告 `resumable`。

## 工作原理

Agent-Sync 把对话当作 Git 邻接的产物，而不是源文件。它在 `.agent-sync/` 存本地配置，在 `.agent-sync-store/` 存独立的 sidecar Git 仓库。

项目归属很保守：会话靠**结构化元数据**匹配（Codex 的 `state_5.sqlite` 线程字段；Claude 的 `cwd` / git 字段 / 工具调用的 `workdir`）。正文提到项目名永远不能单独证明归属，所以不同项目的会话不会互相污染。

每次 `push` 写入内容寻址的对象 + append-only 事件日志 + 一条 Git 上下文绑定（分支、`HEAD`、dirty 状态、同步说明）。`pull` 拉取它们；`restore` 把会话写回本地 agent 目录，并适配源机器的路径。如果重放发现同一个会话 id 指向多个对象 hash，会写入非破坏性的**冲突隔离**记录，用 `conflicts` 解决。

详细内部机制：[概念说明](https://wood-q.github.io/Git-Agent-Sync/zh/concepts) · [工具执行链路](https://wood-q.github.io/Git-Agent-Sync/zh/execution-flow)。

## 命令一览

| 领域 | 命令 | 用途 |
| --- | --- | --- |
| **初始化** | `init [--remote <url>]` | 初始化本地配置与 sidecar 仓库 |
| | `status` / `scan` | 查看 / 扫描匹配的会话 |
| | `doctor` | 整条链路健康检查 |
| **远程** | `push [--m <msg>] [--privacy review\|redact\|allow\|off]` | 把会话快照写入 sidecar 并推送 |
| | `pull` | 拉取本项目的 sidecar 快照 |
| | `sync --background\|--flush\|status\|retry\|cancel` | 后台同步队列 |
| | `daemon start\|status\|stop` | 本地后台 worker |
| | `log` / `show` / `restore` | 按 latest / current / branch / commit / index 浏览与恢复 |
| | `install-hooks` / `uninstall-hooks` | pre-push 自动同步钩子 |
| **本地** | `clone-local [provider]` | 把 Codex 会话克隆到某个 provider |
| | `watch-local [--once]` | 监控 provider 变化并自动克隆 |
| | `register-local` / `repair-local` / `clean-local` | 管理本地副本 |
| **转换** | `tool inspect\|convert --session <id>` | Conversation IR |
| | `tool export --to codex\|claude` | 跨工具可读 JSONL |
| **安全** | `privacy scan\|redact\|allow-pattern-local` | 密钥扫描与脱敏 |
| | `conflicts list\|show\|diff\|resolve` | 冲突隔离审查 |
| **界面** | `tui [--cn]` | 终端工具箱 |

运行 `git agent-sync --help` 查看完整精确的语法。

## 文档

完整文档在 **[GitHub Pages](https://wood-q.github.io/Git-Agent-Sync/)**：

- [使用指南](https://wood-q.github.io/Git-Agent-Sync/zh/usage) · [English](https://wood-q.github.io/Git-Agent-Sync/en/usage)
- [概念说明](https://wood-q.github.io/Git-Agent-Sync/zh/concepts) · [English](https://wood-q.github.io/Git-Agent-Sync/en/concepts)
- [工具执行链路](https://wood-q.github.io/Git-Agent-Sync/zh/execution-flow) · [English](https://wood-q.github.io/Git-Agent-Sync/en/execution-flow)
- [开发说明](https://wood-q.github.io/Git-Agent-Sync/zh/development) · [English](https://wood-q.github.io/Git-Agent-Sync/en/development)
- [发布与发版指南](https://wood-q.github.io/Git-Agent-Sync/zh/publishing) · [English](https://wood-q.github.io/Git-Agent-Sync/en/publishing)
- [VS Code 插件](extensions/vscode/README.md)

## 安全说明

`push` 默认 `--privacy review`，检测到常见密钥（token、key、私钥）时会阻塞。用 `privacy scan` 查看命中，用 `privacy allow-pattern-local <name>=<regex>` 放行已确认的误报，或用 `push --privacy redact` 写入脱敏副本。项目级 `.agent-sync/privacy.json` 可加 `denyPatterns` / `allowPatterns`。对话文件仍可能含代码片段、本地路径、提示词和终端输出。Agent-Sync 绝不复制 Claude 账号、token、全局配置、缓存、遥测、插件、技能、IDE 锁或运行态。**sidecar 仓库务必使用私有远程。**

## License

MIT
