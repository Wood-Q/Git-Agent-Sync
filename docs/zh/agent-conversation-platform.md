# Agent-Sync 项目发展规划：全能 Agent 对话处理平台

本文把 Agent-Sync 从“同步本地 AI 编程会话”的工具，扩展成“跨设备、跨配置、跨工具的 agent 对话处理平台”的工程规划。它不是简单愿景，而是围绕当前代码基线、已知痛点、数据模型、命令体验、TUI、VS Code 插件和验证标准给出的落地方案。

## 1. 产品目标

Agent-Sync 的长期目标是成为 agent conversation processing platform：

- 让 Codex、Claude Code 等 agent 的项目会话像代码一样可同步、可恢复、可审计。
- 让用户在多台设备、多种 Codex provider、多种 agent 工具之间迁移上下文时，不需要手工复制 JSONL、猜路径或冒险改全局状态。
- 让同步过程默认不污染业务仓库，默认不上传全局账号、缓存、遥测、插件运行态等私有状态。
- 让失败可恢复：任何冲突、脱敏命中、格式不兼容都应该进入可解释状态，而不是覆盖原始会话或损坏 JSONL。
- 让入口足够清楚：CLI 适合自动化，TUI 适合选择和确认，VS Code 插件适合在日常项目里顺手完成同步和恢复。

## 2. 当前能力基线

当前 Agent-Sync 已经具备这些基础能力：

- **Sidecar store**：会话不会进入业务仓库，而是复制到 `.agent-sync-store/` 这个独立 Git 仓库。
- **项目身份识别**：通过业务仓库 remote、项目路径、branch、commit、agent session 里的 `cwd` / `workdir` 等结构化信息判断归属。
- **严格匹配**：正文里出现项目名不算归属证据，只有结构化元数据能让会话进入当前项目的同步集合。
- **Codex / Claude Code 扫描**：能扫描 Codex session、Codex state 索引、Claude project JSONL，并跳过归档或外部项目会话。
- **bindings 历史**：`bindings.jsonl` 记录会话 bundle 与业务 Git commit / branch / 同步批次之间的关系，`bindings.idx.json` 是可重建查询缓存。
- **恢复适配**：恢复时会把源机器的路径映射到当前机器的 Codex / Claude 目录，并给恢复文件写入 `agentSyncAdapted` 标记。
- **Codex UI 注册**：恢复 Codex 会话时会写入本机 `state_5.sqlite` 和 `session_index.jsonl`，让 Codex 插件 / App 能看到恢复后的会话。
- **本机 provider 同步**：`clone-local` 会把当前项目的 Codex 会话克隆到指定或当前 `model_provider`；`watch-local` 会监听 provider 变化后触发克隆；`register-local` / `repair-local` 会把 Agent-Sync 本机 provider 克隆注册进 Codex UI 索引；`clean-local` 会预览或删除当前项目由 Agent-Sync 生成的 provider clone。
- **冲突隔离与 review**：事件重放发现同一 agent session id 对应多个对象 hash 时，会写入 `conflicts/` 隔离记录；`conflicts list/show/resolve` 可以查看并用非破坏性的元数据标记解决。
- **TUI 入口**：`git agent-sync tui` 提供交互式终端菜单，降低常用操作的记忆成本。
- **VS Code 入口**：扩展可以调用 CLI 执行 push、pull、restore、show bundle、sync status/background/flush、privacy scan/redact dry-run、conflicts list、Conversation IR inspect/export、打开 TUI、触发本机 provider clone/register/watch/repair/clean。

当前最大的边界也很明确：

- 跨设备同步已经支持 shared-history 场景下的 sidecar push retry：non-fast-forward 后 fetch、合并对象/事件分片、重建索引并重试；完全 unrelated 的 sidecar 历史仍会停止，避免猜测合并。
- 本机 provider 同步只处理 Codex provider 内部克隆，不等价于 Codex 与 Claude Code 之间的完整格式转换。
- 跨工具转换已经有 Conversation IR、inspect/convert/readable export；真正可继续对话的 resumable handoff 仍需要按目标工具能力谨慎放开。
- 隐私保护已经有 push 前 scan/review/redact pipeline，并支持 `.agent-sync/privacy.json` 里的 `denyPatterns` / `allowPatterns`；更细的交互式逐条 review 仍在 TUI / VS Code 体验层继续增强。
- 后台同步 daemon 和异步队列已有 CLI 主路径；更丰富的队列可视化和失败操作仍在 TUI / VS Code 体验层继续增强。

## 3. 核心设计原则

后续扩展应坚持这些原则：

- **原始会话不可破坏**：任何转换、脱敏、合并、恢复都只写副本或派生产物，不直接覆盖用户原始 agent session。
- **结构化证据优先**：项目归属、工具调用、provider、路径、commit 等判断必须来自结构化字段，不能靠正文关键词猜测。
- **可重建索引不是事实源**：`manifest.json`、`bindings.idx.json`、搜索索引、UI 缓存都应该可以由对象和事件日志重建。
- **并发写入要分片**：多设备同时同步时，避免多个机器 append 同一个 JSONL 文件；每台设备或每次同步写独立 event shard。
- **失败进入隔离区**：冲突、无法解析、脱敏风险、未知 schema 都进入 `conflicts/` 或 review queue，不进入正常恢复路径。
- **命令名表达作用域**：凡是只改本机 agent 会话目录或本机配置的命令，都保留 `-local` 标识，例如 `clone-local`、`watch-local`、未来的 `repair-local`。
- **体验分层**：CLI 给自动化和脚本，TUI 给人工选择和批量确认，VS Code 插件给项目内工作流。

## 4. 跨设备同步方案

### 4.1 痛点

两台机器 A、B 都产生新会话并运行同步时，单纯依靠 Git 对 `.jsonl` 或 `.json` 做文本合并会有三个风险：

- JSONL 行被交错合并，导致单行 JSON 损坏。
- `manifest.json` 这种快照文件被同时改写，Git 可能产生冲突或错误保留其中一侧。
- `bindings.jsonl` 如果多端同时 append 同一个文件，虽然语义上可以合并，但 Git 文本冲突仍然常见。

### 4.2 目标 store 结构

建议把 sidecar store 从“项目目录里保存快照文件”升级为“内容寻址对象 + 事件日志 + 可重建索引”：

```text
.agent-sync-store/
  objects/
    codex/
      sha256/<hash>.jsonl
    claude/
      sha256/<hash>.jsonl
  events/
    <machine-id>/
      <sync-run-id>.jsonl
  projects/
    <project-id>/
      manifest.json
      bindings.idx.json
  conflicts/
    <project-id>/
      <session-id>/
        <sync-run-id>.json
  policies/
    redaction.json
```

这里的事实源是 `objects/` 和 `events/`：

- `objects/<agent>/sha256/<hash>.jsonl` 保存原始会话内容的不可变副本。相同内容只存一份。
- `events/<machine-id>/<sync-run-id>.jsonl` 保存本次同步发现了哪些对象、它们归属哪个项目、绑定哪个业务 commit、脱敏状态是什么。
- `manifest.json` 和 `bindings.idx.json` 只作为查询缓存，由事件重放生成。
- `conflicts/` 保存无法自动合并或需要人工确认的项目。

### 4.3 合并策略

合并分三层：

- **对象层**：按 sha256 去重。对象文件不可变，不需要 Git 文本合并。
- **事件层**：每次同步写独立 event shard，文件名包含 machine id、时间戳和 uuid，避免多端写同一个文件。
- **索引层**：pull 后重建 `manifest.json`、`bindings.idx.json`。索引冲突不需要手工解决，可以删除后重建。

如果两端产生的是不同会话，合并结果是两个对象和两条 binding event。如果两端产生的是同一 session id 但内容不同，需要判断是正常追加、分叉还是冲突：

- 同一 session id，旧 hash 是新 hash 的前缀历史：视为追加，保留新对象并记录 supersedes。
- 同一 session id，双方都从同一旧 hash 分叉：进入 conflict quarantine，不自动覆盖。
- metadata 不一致但对象内容一致：以对象为准，metadata 进入 merge review。

### 4.4 Git 流程

当前 `push` 会先 `syncStoreFromRemote`，遇到 diverged 会报错。后续应改为业务层合并：

1. fetch sidecar remote。
2. 读取本地 pending events 和远端 events。
3. 在临时工作区重放事件，生成新的索引。
4. 如果没有业务层冲突，创建一个合并后的 sidecar commit。
5. push；若 push 被拒绝，重复 fetch 和重放。
6. 若仍有冲突，只提交非冲突对象，把冲突写入 `conflicts/` 并提示用户 review。

这样 Git 只负责传输和版本记录，不负责理解 JSONL 的语义。

当前实现已经在 shared-history 场景下支持 sidecar push retry：non-fast-forward push 被拒后会 fetch 远端、合并对象/事件分片、重建事件索引、提交必要索引变化并再次 push；完全 unrelated 的 sidecar 历史仍会停止，避免猜测合并。

### 4.5 后台同步

Git pull / push 可能很慢，不能阻塞用户终端。建议新增 daemon：

```text
CLI command -> enqueue job -> return quickly
daemon -> acquire lock -> fetch -> merge events -> rebuild indexes -> push -> update status
```

本地状态文件：

```text
.agent-sync/
  queue/
    pending/*.json
    running/*.json
    done/*.json
    failed/*.json
  daemon-state.json
  sync-lock
```

命令设计：

```bash
git agent-sync daemon start
git agent-sync daemon status
git agent-sync daemon stop
git agent-sync sync --background
git agent-sync sync --flush
git agent-sync sync status
```

hooks 只入队，不直接做耗时 Git 操作：

- `post-commit`：记录当前 commit 对应的 agent session sync job。
- `pre-push`：默认只检查是否有高危未处理隐私命中，不执行长时间同步。
- `post-push`：可选触发 sidecar background push。

### 4.6 隐私保护

跨设备 push 前需要脱敏和审查流水线：

```text
scan sessions -> classify sensitive spans -> apply policy -> write redacted object -> event records redaction metadata -> push
```

默认规则应包含：

- OpenAI、Anthropic、GitHub、AWS、Google、Azure、Stripe、Slack 等常见 token pattern。
- PEM private key、SSH private key、JWT、Bearer token、Basic auth header。
- `.env` 风格 `KEY=value` 中命中 secret 名称的值。
- URL 中的 username/password、query token。

策略文件示例：

```json
{
  "version": 1,
  "mode": "review",
  "defaultAction": "redact",
  "allowPatterns": [],
  "denyPatterns": [
    { "name": "generic_api_key", "pattern": "(?i)(api[_-]?key|token|secret)\\s*[:=]\\s*['\\\"]?[^\\s'\\\"]+" }
  ],
  "replacement": "[REDACTED:$name]",
  "storeOriginalLocalOnly": false
}
```

推荐命令：

```bash
git agent-sync privacy scan
git agent-sync privacy scan --json
git agent-sync privacy redact --dry-run
git agent-sync push --privacy review
git agent-sync push --privacy redact
```

用户体验要求：

- 默认不静默上传高置信 secret。
- TUI 和 VS Code 都能显示命中片段、规则名、文件来源和处理动作。
- 原始未脱敏对象默认只留在本机，不进入 sidecar remote。
- 所有脱敏都要记录 provenance，方便解释“这条消息为什么变成了 `[REDACTED:github_token]`”。

## 5. 跨配置方案：Codex Provider 同步

### 5.1 当前实现

当前本机 provider 同步有两个入口：

```bash
git agent-sync clone-local
git agent-sync clone-local openrouter
git agent-sync watch-local
```

语义如下：

- `clone-local [target-provider]`：扫描当前项目的 Codex 会话，把匹配的会话复制成目标 `model_provider` 版本。
- 不传 `target-provider` 时，读取 Codex 配置里的当前 provider。
- `watch-local`：定期读取 `~/.codex/config.toml` 的 `model_provider`，发现变化后触发 `clone-local`。
- 克隆后的会话会写入 lineage 信息，例如来源 provider、clone timestamp、original provider。

这个命名已经把“本机操作”与跨设备 `push` / `pull` 区分开。当前已实现的本机索引入口也沿用 `-local`：

```bash
git agent-sync register-local
git agent-sync repair-local
```

后续新增本机操作也应沿用 `-local`：

```bash
git agent-sync import-local
```

### 5.2 缓存不一致风险

Codex 可能只在启动时或特定触发时加载会话列表。如果工具直接写底层 JSONL，但没有同步更新 Codex UI 所依赖的 SQLite / index，可能出现：

- 文件已经存在，但 Codex 会话列表看不到。
- 会话列表看到了，但标题、provider、cwd 仍是旧值。
- provider 切换后，UI 缓存仍指向旧 provider 的会话。

当前 restore 已经会注册 `state_5.sqlite` 和 `session_index.jsonl`。后续 provider clone 也应统一使用同一套 register pipeline。

### 5.3 目标流程

Provider 克隆应使用幂等流程：

1. 读取当前项目匹配到的 Codex sessions。
2. 读取目标 provider。
3. 生成目标 session id 和目标路径。
4. 原子写入克隆 JSONL。
5. 写入 `agentSyncAdapted` / `agentSyncCloned` / lineage metadata。
6. 注册 Codex state DB 和 `session_index.jsonl`。
7. 校验注册结果。
8. 如发现缓存不可刷新，提示用户 reload Codex 或运行 `repair-local`。

目标命令：

```bash
git agent-sync clone-local openrouter --register
git agent-sync clone-local openrouter --no-register
git agent-sync watch-local --interval 5
git agent-sync watch-local --once
git agent-sync repair-local
```

其中 `repair-local` 只做本机修复：

- 扫描已存在的 Agent-Sync 克隆会话。
- 补齐 Codex state DB 记录。
- 重建或修补 `session_index.jsonl`。
- 检查 orphaned cloned sessions。

## 6. 跨工具方案：Conversation IR

跨 Codex 和 Claude Code 不能靠直接改字段完成。两边的 JSONL schema、tool call 表达、cwd 记录、权限和恢复机制都不同。正确做法是先建立中间格式 Conversation IR。

### 6.1 IR 目标

IR 需要满足：

- 能无损归档原始 vendor 事件。
- 能把 user / assistant / system 消息映射到统一 message model。
- 能统一表达 tool call、tool result、stdout、stderr、exit code、artifact、workdir。
- 能记录项目身份、cwd、git remote、branch、commit、provider、model、sandbox、approval policy。
- 能记录技能、MCP、插件、依赖和环境要求。
- 能区分“可恢复继续对话”和“仅可查看归档”。

### 6.2 IR 草案

```json
{
  "version": 1,
  "conversation": {
    "id": "ir_...",
    "sourceAgent": "codex",
    "title": "debug login flow",
    "createdAt": "2026-06-20T10:00:00.000Z",
    "updatedAt": "2026-06-20T10:30:00.000Z"
  },
  "project": {
    "cwd": "/repo/app",
    "identity": "git:github.com/org/app",
    "branch": "feature/login",
    "commit": "abc123",
    "dirty": true
  },
  "runtime": {
    "model": "gpt-5",
    "provider": "openai",
    "shell": "zsh",
    "sandbox": "workspace-write",
    "approvalPolicy": "on-request"
  },
  "events": [],
  "dependencies": {
    "skills": [],
    "mcpServers": [],
    "plugins": [],
    "files": []
  },
  "provenance": {
    "sourcePath": "~/.codex/sessions/...",
    "sourceHash": "sha256:...",
    "adapter": "codex@1"
  },
  "vendor": {}
}
```

### 6.3 Codex 映射

Codex 常见字段：

- `session_meta.payload.id`
- `session_meta.payload.cwd`
- `session_meta.payload.git`
- `session_meta.payload.model_provider`
- `session_meta.payload.thread_name`
- `turn_context.payload.cwd`
- `response_item.payload.message`
- `response_item.payload.function_call`

映射策略：

| Codex 字段 | IR 字段 | 说明 |
| --- | --- | --- |
| `session_meta.payload.id` | `conversation.id` 或 `vendor.codex.id` | IR id 可重新生成，原始 id 保留在 vendor |
| `session_meta.payload.cwd` | `project.cwd` | 项目归属主证据之一 |
| `session_meta.payload.git` | `project.identity` / `branch` / `commit` | 用于匹配和恢复 |
| `model_provider` | `runtime.provider` | provider clone 的关键字段 |
| `thread_name` | `conversation.title` | 展示标题 |
| `response_item.payload.message` | `events[].message` | user / assistant 消息 |
| `function_call` | `events[].toolCall` | 统一 tool call model |

### 6.4 Claude Code 映射

Claude Code 常见字段：

- 顶层 `sessionId`
- 顶层 `cwd`
- 顶层 `timestamp`
- 顶层 `isSidechain`
- `message.role`
- `message.content[]`
- `tool_use`
- `tool_result`
- tool input 里的 `cwd` / `workdir`

映射策略：

| Claude 字段 | IR 字段 | 说明 |
| --- | --- | --- |
| `sessionId` | `conversation.id` 或 `vendor.claude.sessionId` | 原始 id 保留 |
| `cwd` | `project.cwd` | 项目归属证据 |
| `timestamp` | `events[].createdAt` | 事件时间 |
| `message.role` | `events[].message.role` | user / assistant / system |
| `tool_use.name` | `events[].toolCall.name` | 工具名称 |
| `tool_use.input` | `events[].toolCall.input` | 参数保持结构化 |
| `tool_result` | `events[].toolResult` | 输出、错误、artifact 引用 |
| `workdir` / `cwd` | `events[].toolCall.workdir` | 执行目录 |

### 6.5 转换级别

跨工具能力应分级交付，避免过度承诺：

- **Level 0：Lossless archive**  
  原始 Codex / Claude 会话完整入库，可查看、可检索、可绑定业务 commit。

- **Level 1：Readable convert**  
  转成 IR 后能在 TUI / VS Code 中用统一视图阅读消息和工具调用。

- **Level 2：Best-effort export**  
  从 IR 导出到目标工具可识别的会话格式，但不保证目标工具能继续完整执行所有上下文。

- **Level 3：Resumable handoff**  
  目标工具能继续对话。只有当目标工具支持必要字段、索引注册、权限和工具调用上下文时才标记为 resumable。

推荐命令：

```bash
git agent-sync tool inspect --session <bundle-id>
git agent-sync tool convert --from codex --to ir --session <bundle-id>
git agent-sync tool convert --from claude --to ir --session <bundle-id>
git agent-sync tool export --to claude --session <bundle-id> --mode readable
git agent-sync tool export --to codex --session <bundle-id> --mode resumable
```

当前实现已经支持 `inspect`、`convert --to ir` 和 readable export。请求 `--mode resumable` 时，如果目标 adapter 还不能安全写入可继续会话所需的 schema、索引、provider/runtime 上下文和依赖，导出会明确保持 `mode: "readable"`、`resumable: false`，并写入 readable-only 原因，避免把归档视图伪装成可继续 handoff。

### 6.6 依赖图

现有 `extractSessionDependencies` 已能识别 Codex function call 中的 skill 和 Claude `SkillTool`。后续应扩展为 requirement graph：

```json
{
  "skills": [],
  "mcpServers": [],
  "plugins": [],
  "binaries": [],
  "environmentVariables": [],
  "workspaceFiles": [],
  "externalServices": []
}
```

恢复或跨工具导出时，先检查目标环境是否具备依赖：

- 缺少 skill：提示安装或降级为 readable。
- 缺少 MCP server：保留 tool call 历史，但标记不可自动重放。
- 缺少本地文件：提示 artifact 不可用。
- 环境变量命中 secret：不导出明文，只记录变量名和 redaction marker。

## 7. CLI 命令设计

CLI 的原则是“动词清楚、作用域清楚、本机操作带 `-local`”。

当前保留：

```bash
git agent-sync init
git agent-sync status
git agent-sync scan
git agent-sync push
git agent-sync pull
git agent-sync log
git agent-sync show
git agent-sync restore
git agent-sync doctor
git agent-sync sync status
git agent-sync sync --background
git agent-sync sync --flush
git agent-sync daemon start
git agent-sync daemon status
git agent-sync daemon stop
git agent-sync privacy scan
git agent-sync privacy redact
git agent-sync conflicts list
git agent-sync conflicts show
git agent-sync conflicts resolve
git agent-sync clone-local
git agent-sync watch-local
git agent-sync register-local
git agent-sync repair-local
git agent-sync clean-local
git agent-sync tool inspect
git agent-sync tool convert
git agent-sync tool export
git agent-sync tui
```

未来扩展：

```bash
git agent-sync import-local
```

命名边界：

- `push` / `pull` / `sync`：跨设备 sidecar remote。
- `clone-local` / `watch-local` / `register-local` / `repair-local` / `clean-local`：只改本机 Codex / Claude 会话目录或本机索引。
- `tool convert` / `tool export`：跨 agent 格式处理。
- `privacy scan` / `privacy redact`：隐私检查与脱敏。
- `conflicts list` / `conflicts show` / `conflicts resolve`：sidecar 冲突隔离区 review 和非破坏性解决标记。
- `daemon`：后台队列和异步 Git 操作。

## 8. TUI 方案

TUI 适合使用 React Ink。目标不是把 CLI 命令包一层菜单，而是提供“可视化选择 + 风险确认 + 批量操作”。

当前实现已经把 `git agent-sync tui` 切换为 React Ink 操作台：左侧是视图导航，右侧是动作列表，底部显示运行状态、prompt 和命令输出摘要；动作行显示等价 CLI，支持 `/` 搜索和 `?` 帮助，restore / push / conflict resolve / hook 这类高风险动作会二次确认；非 TTY 环境会输出同一套动作和命令的文本菜单，方便测试和脚本环境查看。Local Provider 视图已接入 `clone-local`、`register-local`、`repair-local`、`clean-local` 预览和 `watch-local`；Conflicts 视图已接入 `conflicts list/show/resolve --strategy keep-all`，作为后续 richer diff/review UI 的 CLI 一致入口。

信息架构：

- **Dashboard**：显示当前项目、sidecar remote、最近同步、待处理队列、隐私风险、冲突数量。
- **Sync Queue**：展示 pending / running / failed jobs，可重试、取消、flush。
- **Session History**：按 latest、current、branch、commit 浏览 bindings，支持恢复、查看详情、筛选 agent。
- **Local Provider**：显示当前 Codex `model_provider`、可克隆会话、watch 状态、注册状态。
- **Tool Convert**：选择 Codex / Claude 会话，查看 IR 解析结果，导出为 readable 或 resumable。
- **Privacy Review**：逐条查看 secret 命中，选择 redact、allow once、allow pattern、skip push。
- **Conflicts**：展示跨设备冲突，选择保留 A、保留 B、都保留、生成新 session。
- **Settings**：配置 sidecar remote、privacy policy、daemon、自定义 agent root。

交互要求：

- 键盘优先：方向键移动、Enter 确认、Space 多选、`/` 搜索、`r` 重试、`d` diff、`?` 帮助。
- 状态明确：成功、警告、阻塞、隐私风险、冲突要有一致颜色和文案。
- 长任务不冻结：daemon job 只显示进度和日志 tail。
- destructive action 必须二次确认。
- 所有命令都显示等价 CLI，方便用户学习和复制到自动化脚本。

## 9. VS Code 插件方案

VS Code 插件应服务于“我正在这个项目里工作”的场景。

核心视图：

- **History View**：已有能力继续强化，支持 latest/current/branch/commit selector、搜索、恢复、show bundle。
- **Sync Status View**：显示 daemon 状态、远端状态、待 push / pull、最近错误。
- **Conflicts View**：展示 conflict quarantine，支持 diff 和选择解决策略。
- **Privacy Review Webview**：展示脱敏命中，允许逐条处理。
- **Provider Controls**：显示当前 Codex provider，提供 `clone-local`、`watch-local`、`repair-local`。
- **Tool Conversion View**：用统一结构展示 Codex / Claude 消息和工具调用，支持导出。

当前 VS Code 实现保持“只调用 CLI”的边界：History toolbar 和 Command Palette 已接入 pull、push、sync status/background/flush、daemon status、privacy scan/redact dry-run、conflicts list、tool inspect/export readable、show bundle、clone-local、register-local、watch-local、repair-local、clean-local 预览、TUI 和 restore；History Webview 支持自由搜索、列过滤、行级 show / restore。

体验要求：

- 所有 CLI 调用必须通过统一 adapter，保留 stdout / stderr 到 Output Channel。
- 长任务使用 VS Code progress，不阻塞编辑器。
- 失败信息要包含建议动作，例如运行 `doctor`、`repair-local`、`privacy scan`。
- 插件不直接重新实现同步逻辑，只调用 CLI，避免双份业务逻辑发散。

## 10. 分阶段路线

### Phase 0：稳固当前能力

目标：

- 保持 `clone-local` / `watch-local` 命名稳定。
- 补齐本机 provider 同步、TUI、VS Code 入口的文档。
- 为本机 provider 克隆增加更多 fixture，覆盖 provider 缺失、重复克隆、dry-run、watch once。

验收：

- `npm run test:local-transfer`
- `npm run test:tui`
- VS Code smoke compile
- docs build 通过

### Phase 1：对象化 sidecar store

目标：

- 引入 `objects/` 和 `events/`。
- 让 `manifest.json` 和 `bindings.idx.json` 从事件重建。
- 保持旧 store 兼容读取，提供 migration。

验收：

- 双机并发 push 不损坏 JSONL。
- 删除索引后可完整重建。
- 旧版本 store 可读可迁移。

### Phase 2：后台 daemon 与队列

目标：

- 实现 queue、daemon、lock、retry、status。
- hooks 只入队，不阻塞用户 Git 操作。

验收：

- `sync --background` 在短时间内返回。
- daemon crash 后可恢复 running job。
- push 被拒绝时自动 fetch + replay + retry。

### Phase 3：隐私脱敏引擎

目标：

- 默认 secret regex。
- policy config。
- TUI / VS Code review。
- redacted object 与 original local-only 分离。

验收：

- fixture 覆盖常见 API key。
- 高置信 secret 默认阻止 push 或进入 review。
- redaction metadata 可解释。

### Phase 4：Codex provider 注册与修复

目标：

- `clone-local` 默认注册 Codex state。
- 新增 `repair-local`。
- 处理 Codex UI 缓存不一致。

验收：

- 克隆后 Codex UI 索引可见。
- 重复运行幂等。
- 损坏 index 可修复。

### Phase 5：Conversation IR 与 adapters

目标：

- Codex -> IR。
- Claude -> IR。
- IR unified viewer。
- readable export。

验收：

- golden fixture 保持 vendor 原始字段。
- tool call / tool result 映射完整。
- 不支持字段进入 `vendor`，不丢失。

### Phase 6：跨工具 resumable handoff

目标：

- 在格式和索引允许的场景下导出可继续对话的目标工具 session。
- 对不可继续的场景明确标记 readable-only。

验收：

- Codex -> Claude readable fixture。
- Claude -> Codex readable fixture。
- 可恢复场景 smoke test。
- 不可恢复场景不会伪装成 resumable。

### Phase 7：完整 TUI / VS Code 体验

目标：

- TUI 覆盖 sync queue、privacy review、conflicts、tool convert、provider local。
- VS Code 插件覆盖同样关键流程。

验收：

- 常用操作不需要记命令。
- 所有高风险操作都有确认和回退。
- CLI、TUI、VS Code 输出一致。

## 11. 验证矩阵

必须建立这些测试：

- **双设备并发同步 E2E**：两个临时 clone、同一个 bare sidecar remote，同时产生不同会话并 push。
- **JSONL 损坏防护**：人为制造并发 append，确认最终对象仍是合法 JSONL。
- **事件重放测试**：删除 `manifest.json` 和 `bindings.idx.json` 后由 events 重建。
- **冲突隔离测试**：同 session id 分叉时进入 `conflicts/`，不会覆盖原始对象；list/show/resolve 能查看和标记解决，事件索引重建不会抹掉 resolved 元数据。
- **daemon 测试**：queue 状态迁移、锁、retry、crash recovery。
- **隐私 fixture**：覆盖常见 token、误报 allowlist、dry-run diff。
- **provider clone 测试**：provider 变化、重复 clone、注册 Codex state、register-local、repair-local、clean-local dry-run/force。
- **Codex adapter golden test**：session meta、turn context、message、function_call。
- **Claude adapter golden test**：message content、tool_use、tool_result、workdir。
- **跨工具 export smoke**：导出 readable session 后能在目标 viewer 中打开。
- **VS Code adapter 测试**：CLI path、Windows shim、错误展示、进度状态。

当前测试矩阵已包含 `test:store-merge`，覆盖两个业务 clone 共享同一个 sidecar base 后，本地 sidecar commit 与远端 sidecar commit 分叉、随后自动 fetch/merge/rebuild/retry push 的路径。`test:conflicts` 覆盖冲突隔离记录的 list/show/resolve、dry-run、active/all 过滤，以及 resolved 状态在事件索引重建后的保留。`test:privacy` 覆盖默认 secret 规则、redact 写入 sidecar 副本、原始本机会话不被改写，以及 `allowPatterns` 对误报 fixture 的扫描/脱敏跳过。

## 12. 风险与决策

| 风险 | 决策 |
| --- | --- |
| Git 文本合并损坏 JSONL | 不合并原始 JSONL；改用内容寻址对象和事件日志 |
| 用户隐私被上传 | push 前加入 privacy pipeline，高置信 secret 默认 review / redact |
| Codex 缓存不刷新 | 所有本机写入走 register pipeline，提供 `repair-local` |
| 跨工具 schema 不兼容 | 先 IR 归档和 readable convert，再谨慎标记 resumable |
| 命令混淆本机与远端 | 本机操作统一 `-local`，跨设备操作使用 push / pull / sync |
| TUI / VS Code 与 CLI 逻辑发散 | TUI / VS Code 只调用 CLI，不复制核心同步逻辑 |
| 老用户 store 兼容 | 读取旧布局，提供显式 migration，迁移前备份 |

## 13. 完美实现的定义

这里的“完美”不是承诺没有复杂性，而是工程上满足这些标准：

- 不损坏用户原始会话。
- 不把会话写入业务仓库。
- 不把高风险 secret 静默推送到远端。
- 多设备并发同步可自动合并普通新增会话。
- 无法自动合并时进入可解释、可恢复的冲突区。
- 跨 provider 本机克隆幂等，并尽量让 Codex UI 立即可见。
- 跨工具转换先保证可归档、可阅读、字段不丢失，再逐步提升到可继续对话。
- CLI、TUI、VS Code 三个入口命令语义一致，失败信息能指导用户下一步操作。

这条路线能让 Agent-Sync 从当前的 Git-native session sync 工具，逐步成长为可靠的 agent 对话基础设施：底层足够稳，上层足够好用，遇到复杂情况也不会把风险甩给用户。
