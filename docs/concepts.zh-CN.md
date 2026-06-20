# 概念说明

[English](concepts.md) | [中文](concepts.zh-CN.md)

## 项目身份

旧版本用“业务项目本地绝对路径”计算 `projectId`。这会导致同一个项目在 Windows、macOS、Linux，甚至同一台机器的不同目录下生成不同 ID。

现在的规则：

- 如果业务项目配置了 Git remote，优先用规范化后的 remote URL 生成 `projectId`。
- 同一个 GitHub 仓库的 SSH / HTTPS 地址会规范化成同一个 identity。
- 如果业务项目没有 remote，则退回用目录名生成 identity。
- 旧版路径生成的 ID 会保存在 `legacyProjectIds`。
- `pull` 和 `restore` 会按当前 ID、legacy ID、项目 identity、项目名查找兼容 bundle。
- 新备份会记录会话相对于 agent 根目录的路径，恢复时映射到当前机器的 Codex / Claude 目录，而不是源机器的绝对路径。

示例配置：

```json
{
  "projectId": "SampleAgent-1a2b3c4d5e",
  "projectIdentity": "git:github.com/example-org/sampleagent",
  "legacyProjectIds": ["SampleAgent-f49ebafc58"]
}
```

## 匹配规则

Agent-Sync 只使用结构化项目事实来匹配 session。

Codex 扫描和 restore 适配会尽量沿用 Codex 的原生结构。项目归属会优先复用 `state_5.sqlite` 的 `threads.cwd`、`threads.git_origin_url`、`threads.git_branch`、`threads.git_sha` 和 `threads.rollout_path`。没有这些 state 项目字段时，提取器才从 JSONL 的 `session_meta.payload.cwd`、`session_meta.payload.git`、`turn_context.payload.cwd` 和 `response_item.payload.arguments.workdir` 读取 per-session 事实。

Codex 项目归属判断很严格：`repository_url` 必须匹配当前业务仓库 remote，且 `cwd` / `workdir` 不能混入其他项目路径。已经明确属于其他 Git 仓库、其他项目路径、同一个 session 同时跨多个项目 workdir，或者完全缺少结构化项目身份的记录，即使正文里提到当前项目名，也不会被同步或恢复。

Claude 项目归属也使用同样原则，但读取 Claude JSONL 的结构：顶层 `cwd`、Git 字段、tool-use input 里的 `cwd` / `workdir` 是有效线索；正文文本不是。`~/.claude/projects/<project>` 的编码目录名只作为文件组织线索，不能单独证明归属。

## Git 上下文绑定

每次 `push` 会在 sidecar project bundle 中写入一个轻量历史索引：

```text
.agent-sync-store/
  projects/
    <project-id>/
      bindings.jsonl
      bindings.idx.json
```

`manifest.json` 仍然表示最新快照。`bindings.jsonl` 是 append-only 的 Git 风格历史，会记录 agent 快照 bundle、同步批次、业务项目 branch、业务项目 `HEAD` commit，以及业务工作区当时是否 dirty。`bindings.idx.json` 是从 `bindings.jsonl` 派生出来的可重建查询缓存，用于加速 `log`、`show` 和 selector restore。

主要锚点是执行 `git agent-sync push` 时的业务仓库 commit。agent session 内部的 Git 元数据只用于判断项目归属，不再作为恢复查询的主 commit。

可以用 `--m` 指定本次对话同步说明；它会写入 sidecar Git commit，也会显示在 `log` 里：

```bash
git agent-sync push --m "feat: add user login API"
```

普通 `log` 输出以对话为主，类似 `git log` 显示 `Index`、`Title`、`Author`、`Date` 和同步说明。`Date` 优先使用 Codex 对话时间，拿不到时再回退到 session 文件时间。`--json` 会保留机器可读的原始 binding 列表。

当 human 输出超过终端高度时，Agent-Sync 会打开配置的 pager（`GIT_PAGER`、`PAGER`，否则用 `less`）。

## 恢复适配

Agent session 文件里可能记录创建会话时的 shell、工作目录和项目根目录。例如 Windows 上创建的 session 可能包含 `powershell.exe` 和 `C:\...\SampleAgent` 路径。把这类 session 恢复到 macOS 或 Linux 后，如果这些旧引用不变，继续会话时就可能一直尝试使用错误终端，或者引用一个当前机器不存在的项目目录。

默认情况下，`restore` 不会修改 sidecar store 中的原始文件，只会在恢复到本机的副本里适配项目路径：

- `session_meta.payload.cwd`、`turn_context.payload.cwd`、`event_msg.payload.cwd` 会映射为当前业务仓库根目录。
- `exec_command` function call 里的 `workdir` 会映射为当前业务仓库根目录。
- `exec_command` function call 里的 `shell` 会映射为当前机器 shell，例如 macOS / Linux 上的 `$SHELL`。
- transcript 字符串、命令参数、命令输出、sandbox 元数据、已编辑文件列表里的源项目根路径引用会映射为当前业务仓库根目录。
- 不会翻译命令语法。历史 PowerShell 命令仍然会作为历史 transcript 保留，但命令里嵌入的源项目路径会被映射为当前项目路径。
- 恢复后的 Codex session 会在 `session_meta.payload` 写入 `agentSyncAdapted` 标记，并注册到本机 `state_5.sqlite` 和 `session_index.jsonl`，让 Codex 插件 / App 能在对话列表里显示。
- 恢复后的 Claude session 会写入当前项目对应的 `~/.claude/projects/<project-slug>/` 目录，并在恢复后的 JSONL item 上写入 `agentSyncAdapted` 标记。

## 本地目录结构

初始化后，业务项目里会出现：

```text
.agent-sync/
.agent-sync-store/
```

这两个目录会自动加入业务项目 `.gitignore`。

`.agent-sync/` 存本地配置和扫描缓存：

```text
.agent-sync/config.json
.agent-sync/last-scan.json
.agent-sync/scan-cache.json
.agent-sync/archive-cache.json
```

`.agent-sync-store/` 是一个独立的 sidecar Git 仓库：

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
      bindings.jsonl
      bindings.idx.json
      manifest.events.json
      bindings.events.idx.json
      codex/
        codex-<hash>.jsonl
      claude/
        claude-<hash>.jsonl
```

`projects/<project-id>/manifest.json`、`bindings.jsonl` 和 `bindings.idx.json` 仍然是当前 `log` / `restore` 的兼容读路径。新的 `objects/` 会按内容 hash 保存不可变会话副本，`events/` 会按机器和同步批次写入 append-only 事件，`manifest.events.json` 与 `bindings.events.idx.json` 是由这些事件重建出来的索引。这样后续多设备并发同步可以先合并对象和事件，再逐步把主查询路径切到可重建索引上。

配置了 sidecar remote 时，`pull` 会启用 sparse checkout：本地 `.agent-sync-store/` 会展开对象、事件、当前项目的会话 bundle，以及其他项目的轻量 `manifest.json` 用于识别兼容项目。sidecar remote 也会保持 Git promisor remote 和 `blob:none` filter 配置，因此提交时可以安全引用仍留在远端的非当前项目 blob，而不必把它们全部展开到本机。

## 隐私边界

Agent-Sync 不把下面这些 `.codex` 内容作为核心项目/session 判断依据：

- `session_index.jsonl` 只有 session id、标题和更新时间，只适合作为标题兜底，不足以判断项目归属。
- `config.toml` 记录可信项目路径和用户设置，但不是 per-session 事实来源。
- `.codex-global-state.json` 是应用/UI 状态，可能包含与当前项目无关的个人历史。
- `shell_snapshots/` 体积可能较大，也有隐私风险，因此不纳入 MVP 默认同步。

Agent-Sync 不扫描下面这些 `.claude` 内容：

- `~/.claude.json` 和 `~/.claude/backups/`：包含全局 onboarding、user id、项目设置、使用统计或账号相关状态。
- `~/.claude/settings.json`：全局配置，可能包含环境变量或权限策略。
- `~/.claude/history.jsonl`：历史/索引文件，不是会话正文源。
- `~/.claude/sessions/`、`~/.claude/ide/`、`~/.claude/cache/`、`~/.claude/telemetry/`：运行态、锁、缓存、changelog 或遥测状态。
- `~/.claude/plugins/` 和 `~/.claude/skills/`：插件/技能资产与配置，不是项目对话状态。
