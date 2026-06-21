# 平台发展规划

[English](/en/agent-conversation-platform) | [中文](/zh/agent-conversation-platform)

Agent-Sync 从「把 AI 编程会话同步到另一台机器」开始，但会话本身值得被当成一等的项目产物来对待。这份规划记录项目正在演进的方向：从单一的远程同步，变成一套围绕 code agent 对话的全能工具箱。

## 四条能力主线

- **远程同步（Remote sync）**：通过私有 sidecar Git 仓库在多机之间移动项目会话，对话始终绑在正确的分支与 commit 上。这是项目的起点，仍然是核心。
- **本地迁移（Local migration）**：切换 Codex `model_provider` 时，`clone-local` / `watch-local` / `register-local` 让会话跟随 provider，无需触碰远程仓库。
- **跨工具转换（Cross-tool transform）**：通过 Conversation IR 把 Codex 与 Claude Code 的会话归一化，再互导为可读 JSONL，让对话不再被锁死在某一个工具里。
- **诊断与运维（Diagnose & operate）**：`doctor` 检查链路、`privacy` 在推送前扫描密钥、`conflicts` 隔离分叉会话、TUI 把全部能力串成一个终端工具箱。

## 已经落地的演进

- **事件与对象存储**：sidecar 仓库从「bundle 快照 + bindings」演进到「内容寻址对象 + append-only 事件 + 可重建索引」，为多机并发同步与冲突隔离打基础。
- **Conversation IR**：统一的跨工具中间表示，区分 `readable`（可读视图）与 `resumable`（可续接），只有目标工具确实能接受 schema、索引和依赖时才标记为可续接。
- **后台同步队列与守护进程**：pre-push 钩子把同步入队到后台，崩溃残留的 running 任务会在锁内自动回收。
- **TUI 重构**：从复杂的 React Ink 多视图，简化为参照 codex-session-cloner 的原生单键全屏工具箱，只暴露常用动作。

## 接下来的方向

这些是规划中的方向，未必按顺序，也未必全部落地：

- **可续接 handoff**：在目标工具能接受完整 schema、provider/runtime 上下文与依赖时，把 `tool export` 的 `resumable` 路径真正打通，而不只是 readable。
- **查询主路径迁移**：把 `log` / `show` / `restore` 的主查询路径从兼容的 bundle 索引逐步切到事件派生的可重建索引上。
- **默认加密**：在 sidecar 远程推送前提供默认的加密与脱敏，降低私有远程之外的风险。
- **更多 agent**：在保持「结构化归属」原则的前提下，接入更多 code agent 的会话源。
- **VS Code 与 TUI 能力对齐**：让插件与 TUI 暴露同一套四能力，减少 CLI 与 UI 之间的功能差。

## 原则

无论怎么演进，下面这些不变：

- **源码仓库保持干净**：会话永远进独立的 sidecar 仓库，不进业务提交。
- **结构化归属**：只靠结构化元数据判断会话属于哪个项目，正文文本不算证据。
- **非破坏性优先**：冲突隔离而不是覆盖，脱敏只作用于副本而不是原始文件。
- **私有优先**：sidecar 远程默认应当是私有的；密钥与账号态永远不同步。

如果某条方向和你想用的场景相关，欢迎在 [GitHub Issues](https://github.com/Wood-Q/Git-Agent-Sync/issues) 反馈。
