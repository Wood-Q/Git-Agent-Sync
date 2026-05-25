# 工具执行链路

Agent-Sync 的核心链路可以理解为：业务仓库只负责代码，sidecar 仓库只负责 Codex / Claude Code 项目会话。两者通过项目 identity、业务项目 commit 和 session 元数据关联，但不会把会话文件写进业务仓库历史。

```text
业务仓库
  |
  | 1. init
  v
.agent-sync/config.json
  |
  | 2. scan/status
  v
本机 agent session
  |
  | 3. push
  v
.agent-sync-store/
  projects/<projectId>/
    manifest.json
    bindings.jsonl
    codex/*.jsonl
    claude/*.jsonl
  |
  | 4. sidecar git push/pull
  v
私有 session store 远程仓库
  |
  | 5. pull + log/restore
  v
另一台机器的 agent session 目录
```

## 1. 初始化：建立项目身份和 sidecar store

运行：

```bash
git agent-sync init --remote git@github.com:yourname/agent-session-store.git
```

工具会做几件事：

- 读取当前业务仓库 Git root。
- 根据业务仓库 remote 生成稳定的 `projectIdentity` 和 `projectId`。
- 创建 `.agent-sync/config.json`，保存当前机器的本地配置。
- 创建 `.agent-sync-store/`，它本身是一个独立 Git 仓库。
- 自动把 `.agent-sync/` 和 `.agent-sync-store/` 写入业务仓库 `.gitignore`。

这一阶段不会复制 session，也不会提交业务仓库代码。

## 2. 扫描：找到属于当前项目的 session

运行：

```bash
git agent-sync status
```

或：

```bash
git agent-sync scan
```

工具当前优先扫描：

- Codex：`~/.codex/sessions/**/*.jsonl`
- Claude Code：`~/.claude/projects/**/*.jsonl`

扫描分两层：

- 先读取 Codex `state_5.sqlite` 的 `threads` 表，按 `cwd` / `git_origin_url` / `git_branch` / `git_sha` 判断哪些线程属于当前项目。
- 再通过 `threads.rollout_path` 定位对应 JSONL 文件，只对这些候选文件读取 stat、计算 hash、复制到 sidecar。
- 如果 `state_5.sqlite` 不存在或没有可用项目字段，才回退到 JSONL 结构字段扫描。
- 最后根据 `.agent-sync/scan-cache.json` 里的 mtime、size、hash 和上次匹配结果判断是否需要重新读取候选文件。

如果候选文件没有变化，会直接复用上次的匹配结果；只有新增、mtime/size 变化、或者 Codex state / 项目匹配上下文变化时，才会重新读取 session 内容。

Codex 已归档识别也有独立缓存：

- `.agent-sync/archive-cache.json` 保存上次解析出的归档 session 集合。
- 当 `state_5.sqlite` 或 `archived_sessions/` 目录状态没有变化时，直接复用缓存。
- 当归档状态变化时，才重新 walk `archived_sessions/`，并查询 `state_5.sqlite` 的 `threads` 表。

Codex session 会优先读取 `state_5.sqlite` 里的线程字段，例如：

- `threads.id`
- `threads.rollout_path`
- `threads.cwd`
- `threads.git_origin_url`
- `threads.git_branch`
- `threads.git_sha`
- `threads.archived` / `threads.archived_at`
- `threads.title` / `threads.preview` / `threads.first_user_message`

这些字段也是 Codex UI 能按项目分组和显示标题的主要来源。

如果 state 不可用或缺少项目字段，才回退读取 JSONL 里的原生结构字段，例如：

- `session_meta.payload.cwd`
- `session_meta.payload.git.repository_url`
- `session_meta.payload.git.branch`
- `session_meta.payload.git.commit_hash`
- `turn_context.payload.cwd`
- `exec_command.arguments.workdir`

这些结构化字段也是项目归属的硬边界：

- 如果 `git_origin_url` / `repository_url` 指向当前业务仓库 remote，且 `cwd` / `workdir` 没有混入其他项目路径，则认为属于当前项目。
- 如果没有可用 remote，但 `cwd` / `workdir` 指向当前项目根或同名项目根，且没有混入其他项目路径，则认为属于当前项目。
- 如果 session 已经明确记录了其他 Git remote、其他项目路径，或者同时跨多个项目 workdir，即使正文里提到当前项目名，也不会被当作当前项目 session。
- 如果 session 完全缺少结构化项目身份，也不会只因为正文里出现项目名而被同步。这样会牺牲少量老格式兼容性，但可以保证不同项目的 session 不互相污染。

Claude Code 只扫描 `~/.claude/projects` 下的项目会话 JSONL。只读调研到的本机结构是：

- `~/.claude/projects/<encoded-project-path>/**/*.jsonl`：项目会话文件，包含顶层 `sessionId`、`cwd`、`gitBranch`、timestamp、sidechain 标记、`message` 对象，以及 tool-use input 中的命令工作目录。
- `~/.claude/history.jsonl`：按项目和 session id 记录的历史/索引，不是同步正文来源。
- `~/.claude/sessions/*.json`：运行中进程/session 状态。
- 本机布局中没有发现类似 Codex `state_5.sqlite` 的 Claude 专用归档索引；resume / discovery 相关证据来自项目 JSONL、history 索引和运行态文件，其中只有项目 JSONL 会被同步。
- `~/.claude.json`、`settings.json`、`backups/`、`cache/`、`telemetry/`、`ide/`、`plugins/`、`skills/`：全局账号、设置、缓存、遥测、插件或技能状态，不能同步。

Claude 项目归属只使用结构化元数据：顶层 `cwd`、Git remote/branch/commit 字段、tool-use input 里的 `cwd` / `workdir` 等。目录 slug 或正文里出现当前项目名都不能单独证明归属。已经明确属于其他 Git remote、其他项目路径、混合多个项目 workdir，或缺少结构化项目身份的 Claude JSONL 会被跳过。

扫描结果会写入：

```text
.agent-sync/last-scan.json
.agent-sync/scan-cache.json
.agent-sync/archive-cache.json
```

这些文件只是本机缓存，不会进入业务仓库提交。`last-scan.json` 是给人和工具查看的最近扫描结果，另外两个缓存用于减少重复 I/O。

## 3. 推送：把 session 写入 sidecar 仓库

运行：

```bash
git agent-sync push
```

工具会重新扫描当前项目相关 session，然后把匹配到的文件复制到：

```text
.agent-sync-store/projects/<projectId>/
```

同时写入两个关键索引：

- `manifest.json`：当前项目最新可恢复 session 快照。
- `bindings.jsonl`：append-only 历史 Git 上下文索引，用来按 latest / current / branch / commit 查询。
- `bindings.idx.json`：从 `bindings.jsonl` 派生出来的可重建查询缓存，避免每次查询都重新解析完整 JSONL 历史。

`bindings.jsonl` 会记录：

- session bundle id
- agent 类型
- sidecar 内相对路径
- 原始 session 路径
- 同步批次 `syncRunId`
- 业务项目 branch
- 业务项目 `HEAD` commit
- dirty 状态

主要锚点始终是执行 `git agent-sync push` 时的业务项目 commit。Codex session JSONL 自己记录的 git 元数据只用于判断项目归属，不作为恢复查询的主 commit。
主要锚点始终是执行 `git agent-sync push` 时的业务项目 commit。agent session JSONL 自己记录的 Git 元数据只用于判断项目归属，不作为恢复查询的主 commit。

最后，工具只会在 `.agent-sync-store/` 这个独立 Git 仓库里提交并推送：

```text
业务仓库 Git 历史：不包含 session 文件
sidecar Git 历史：包含 session 备份和索引
```

## 4. 拉取：在另一台机器同步 sidecar store

在另一台机器的同一个业务项目中运行：

```bash
git agent-sync init --remote git@github.com:yourname/agent-session-store.git
git agent-sync pull
```

工具会：

- 初始化本机 `.agent-sync/config.json`。
- 初始化或更新本机 `.agent-sync-store/`。
- 从私有 session store 远程仓库拉取 sidecar 数据。
- 对 sidecar store 启用 sparse checkout，只完整展开当前项目目录，同时保留其他项目的 `manifest.json` 作为轻量索引。
- 根据当前项目 identity、legacy id、项目名等信息找到兼容的 project bundle。
- 清理该 bundle 中已经明确属于其他 Codex / Claude 项目的历史残留，避免旧版本误同步的数据继续被恢复。

`pull` 只同步 sidecar store，不会立刻写入 `~/.codex` 或 `~/.claude`。

## 5. 查询：按当前代码位置找到 session

拉取后可以查询：

```bash
git agent-sync log
git agent-sync log --oneline
git agent-sync log -n 3
git agent-sync log -3
git agent-sync log --latest
git agent-sync log --current
git agent-sync log --branch main
git agent-sync log --commit 4f7c2a1
```

查询规则：

- `--latest` 匹配最近一次 sidecar 同步批次。
- `--commit <sha>` 匹配同步时记录的业务项目 commit，支持短 SHA。
- `--branch <name>` 匹配同步时记录的业务项目 branch 标签，不解析当前分支指针。
- `--current` 先匹配当前业务项目 `HEAD` commit；如果没有结果，再回退到当前 branch。
- 不带 selector 的 `log` 会按对话时间由近及远列出全部对话。
- 普通输出类似 `git log`，显示 `Index`、`Title`、`Author`、`Date` 和同步说明；`Date` 优先使用 agent 对话时间。
- `--oneline` 每条对话只输出一行；`-n <count>`、`--max-count <count>` 或 `-<count>` 会限制最近 N 条。
- human 输出超过终端高度时会使用 pager；在 `less` 中 Space 向下翻页，`b` 向上翻页，`q` 退出。
- 默认 `log` 输出中的 `Index` 可以直接用 `git agent-sync restore --index <n>` 或 `git agent-sync restore --i <n>` 恢复。
- `git agent-sync push --m "message"` 可以指定本次对话同步说明；`--json` 保持输出原始 binding 列表。

也就是说，当你切换到某个历史 commit 或 branch 后，可以直接找回当时相关的 agent session。

## 6. 恢复：写回当前机器的 agent session 目录

运行：

```bash
git agent-sync restore --latest
git agent-sync restore --latest 1
git agent-sync restore --latest --index 1
git agent-sync restore --current
git agent-sync restore --current 1
git agent-sync restore --branch main
git agent-sync restore --branch main 2
git agent-sync restore --commit 4f7c2a1
git agent-sync restore --commit 4f7c2a1 3
git agent-sync restore --index 1
git agent-sync restore --i 1
git agent-sync restore --all
```

工具会从 sidecar store 读取 session 文件，并恢复到当前机器对应目录：

- Codex：`~/.codex/sessions/...`
- Claude Code：`~/.claude/projects/<current-project-slug>/...`

不带 selector 时，`--index` / `--i` 使用默认 `git agent-sync log` 的编号。带 selector 时，编号只在该 selector 的输出范围内生效。

Codex session 默认会在恢复时做轻量跨平台适配：

- 把源机器项目根路径映射为当前业务仓库根路径。
- 把 Windows shell 与 POSIX shell 做安全切换。
- 修正 `cwd`、`workdir`、结构化命令参数、transcript 和已编辑文件列表里的项目路径。
- 写入本机 `state_5.sqlite` 和 `session_index.jsonl`，让 Codex 插件 / App 能显示恢复后的会话。
- 不修改 sidecar store 中的原始 session 文件。
- 不翻译 PowerShell / bash / zsh 命令语法。

Claude session 恢复时会：

- 根据当前机器的 `getAgentRoot("claude")` 和当前业务项目路径重建目标目录，不使用源机器绝对路径。
- 把 JSONL 中结构化字段和 tool-use input 里的源项目路径映射到当前业务仓库根目录。
- 写入 `agentSyncAdapted` 标记。
- 恢复前再次校验 sidecar 文件仍然属于当前项目；foreign/mixed Claude 会话会被跳过。

如果需要完全原样恢复，可以使用：

```bash
git agent-sync restore --current --no-adapt
```

如果只想恢复 JSONL 文件，不注册到 Codex UI 索引，可以使用：

```bash
git agent-sync restore --current --no-register
```

## 7. 诊断：检查整条链路是否健康

运行：

```bash
git agent-sync doctor
```

`doctor` 会检查：

- 当前 Git root
- 本地配置是否存在
- sidecar store 是否存在
- sidecar remote 是否可达
- sidecar 当前分支和 upstream
- sidecar sparse checkout 是否启用
- `manifest.json` 是否可读
- `bindings.jsonl` 是否可读、有无坏行
- Codex / Claude session 目录是否存在
- 当前能看到多少 agent session 文件

如果 `pull` 后找不到 session，或者 `restore` 没有恢复出预期文件，优先看 `doctor` 输出。
