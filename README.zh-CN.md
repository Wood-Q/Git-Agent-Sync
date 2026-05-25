# git-agent-sync

`git-agent-sync` 是一个 Git 风格的 AI 编程会话同步工具。

它解决一个很具体的问题：业务代码可以通过 `git clone` 到另一台机器，但 Codex、Claude Code 这类 code agent 的本地会话通常不会跟过去。

这个工具会优先扫描本机的 Codex 会话，找出和当前 Git 项目相关的文件，然后同步到一个独立的私有 Git 仓库里。

> Git for your AI coding sessions.

## 当前能力

- 作为 Git 子命令使用：`git agent-sync ...`
- 优先从 Codex `state_5.sqlite` 的 `threads` 表读取当前项目会话，并通过 `rollout_path` 定位 JSONL 文件
- 默认跳过 Codex 已归档会话：`~/.codex/archived_sessions/**/*.jsonl`，以及 `state_5.sqlite` 里 `threads.archived = 1` 的线程
- 从 Claude Code 的 `~/.claude/projects/**/*.jsonl` 读取项目会话 JSONL
- 使用本地 mtime/size/hash 缓存，未变化的 session 文件不会每次都重新读全文
- Codex 会话只根据 Codex state 或 JSONL 的结构化项目元数据匹配项目；缺少项目元数据，或已记录其他 Git remote / 项目路径时，会被拒绝同步
- Claude Code 会话只根据 `cwd`、Git remote/branch/commit、tool input 里的 `cwd` / `workdir` 等结构化元数据匹配项目；不会因为正文提到项目名就同步
- 把匹配到的会话复制到 sidecar Git 仓库 `.agent-sync-store/`
- 支持把 sidecar 仓库推送到专门的私有远程仓库
- 支持在另一台机器拉取 sidecar 仓库并恢复 Codex / Claude Code 会话
- 支持恢复时对 Codex / Claude Code session 做项目路径适配，不修改 sidecar 原文件
- 为每次同步的会话快照记录业务项目 `HEAD` commit
- 使用 `log` 浏览会话历史，使用 `show` 查看单条快照，并按 latest/current/branch/commit 恢复
- 支持 `pre-push` hook，在业务仓库 `git push` 前自动同步会话
- 使用业务仓库 remote 生成跨平台稳定的 `projectId`
- 兼容旧版本按本地绝对路径生成的历史 bundle
- 不会把 `.codex` / `.claude` 文件加入业务项目的 Git 提交

完整内部执行链路见：[工具执行链路](docs/execution-flow.zh-CN.md)。

## 安装

本地开发阶段：

```bash
cd ~/Agent-Sync
npm install
npm link
git agent-sync --help
```

发布到 npm 后：

```bash
npm install -g git-agent-sync
```

## 完整使用流程

先创建一个专门保存 agent 会话的私有仓库，例如：

```text
git@github.com:yourname/agent-session-store.git
```

不要直接把会话存进业务代码仓库。会话里可能包含私有代码、API key、终端输出、本地路径、prompt 和调试信息。

在已有会话的机器上：

```bash
cd your-project
git agent-sync init --remote git@github.com:yourname/agent-session-store.git
git agent-sync status
git agent-sync push
```

在另一台机器上：

```bash
git clone git@github.com:yourname/your-project.git
cd your-project
git agent-sync init --remote git@github.com:yourname/agent-session-store.git
git agent-sync pull
git agent-sync log --latest
git agent-sync restore --latest 1
```

`init` 也支持把远程地址作为第一个位置参数：

```bash
git agent-sync init git@github.com:yourname/agent-session-store.git
```

## 自动同步

安装 Git hook：

```bash
git agent-sync install-hooks
```

它会写入：

```text
.git/hooks/pre-push
```

之后你正常执行：

```bash
git push
```

hook 会先运行：

```bash
git-agent-sync push
```

如果当前项目缺少 `.agent-sync/config.json`，或者 sidecar Git 仓库还不存在，hook 会直接成功退出，不会阻塞业务仓库自己的 `git push`。如果需要移除 hook：

```bash
git agent-sync uninstall-hooks
```

## 命令列表

```bash
git agent-sync init [--remote <url>|<url>] [--store <path>]
git agent-sync status [--json]
git agent-sync log [--oneline] [-n <count>|-<count>] [--json]
git agent-sync log --latest [--oneline] [-n <count>|-<count>] [--json]
git agent-sync log --current [--json]
git agent-sync log --branch <name> [--json]
git agent-sync log --commit <sha> [--json]
git agent-sync show <bundle-id>
git agent-sync show --latest 1
git agent-sync show --current 1
git agent-sync scan [--json]
git agent-sync push [--m <message>]
git agent-sync pull
git agent-sync restore <bundle-id>
git agent-sync restore --index <n>
git agent-sync restore --i <n>
git agent-sync restore --all
git agent-sync restore --latest
git agent-sync restore --latest 1
git agent-sync restore --current
git agent-sync restore --current 1
git agent-sync restore --branch <name>
git agent-sync restore --branch <name> 1
git agent-sync restore --commit <sha>
git agent-sync restore --commit <sha> 1
git agent-sync restore --current --no-adapt
git agent-sync restore --current --no-register
git agent-sync install-hooks
git agent-sync uninstall-hooks
git agent-sync doctor
```

`doctor` 会以 `ok` / `warn` / `fail` 形式检查 Git 项目根目录、本地配置、sidecar store、远程仓库可达性、sidecar 分支/upstream、`manifest.json`、`bindings.jsonl`、实际解析后的 Codex / Claude 会话目录、项目 identity、当前 `projectId` 和兼容旧数据使用的 legacy id。
它也会显示 Codex 归档线程的统计，帮助确认归档会话没有被算进本次同步。

## 跨平台项目身份

旧版本用“业务项目本地绝对路径”计算 `projectId`。这会导致同一个项目在 Windows、macOS、Linux，甚至同一台机器的不同目录下生成不同 ID。

现在的规则：

- 如果业务项目配置了 Git remote，优先用规范化后的 remote URL 生成 `projectId`
- 同一个 GitHub 仓库的 SSH / HTTPS 地址会规范化成同一个 identity
- 如果业务项目没有 remote，则退回用目录名生成 identity
- 旧版路径生成的 ID 会保存在 `legacyProjectIds`
- `pull` 和 `restore` 会按当前 ID、legacy ID、项目 identity、项目名查找兼容 bundle
- 新备份会记录会话相对于 agent 根目录的路径，恢复时映射到当前机器的 Codex / Claude 目录，而不是源机器的绝对路径

示例配置：

```json
{
  "projectId": "MokioAgent-1a2b3c4d5e",
  "projectIdentity": "git:github.com/wood-q/mokioagent",
  "legacyProjectIds": ["MokioAgent-f49ebafc58"]
}
```

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

为了避免不同项目的对话互相污染，Codex session 只使用结构化项目身份判断归属：`repository_url` 必须匹配当前业务仓库 remote，且 `cwd` / `workdir` 不能混入其他项目路径。已经明确属于其他 Git 仓库、其他项目路径、同一个 session 同时跨多个项目 workdir，或者完全缺少结构化项目身份的记录，即使正文里提到当前项目名，也不会被 `push`、`pull` 清理后的 manifest、或者 `restore` 接受。

```bash
git agent-sync log
git agent-sync log --latest
git agent-sync log --current
git agent-sync log --branch main
git agent-sync log --commit 4f7c2a1
git agent-sync show --latest 1
```

普通输出以对话为主，类似 `git log` 显示 `Index`、`Title`、`Author`、`Date` 和同步说明。`Date` 优先使用 Codex 对话时间，拿不到时再回退到 session 文件时间。`--json` 会保留机器可读的原始 binding 列表。

可以使用简洁或限制数量输出：

```bash
git agent-sync log --oneline
git agent-sync log -n 3
git agent-sync log -3
```

当 human 输出超过终端高度时，Agent-Sync 会打开配置的 pager（`GIT_PAGER`、`PAGER`，否则用 `less`）。在 `less` 里按 Space 向下翻页，按 `b` 向上翻页，按 `q` 退出。

默认 `log` 里的编号可以直接用来恢复：

```bash
git agent-sync restore --index 1
git agent-sync restore --i 1
```

配置了 sidecar remote 时，`pull` 会启用 sparse checkout：本地 `.agent-sync-store/` 只完整展开当前项目的会话 bundle，其他项目只保留轻量 `manifest.json` 用于识别兼容项目。

恢复命令也支持相同 selector：

```bash
git agent-sync restore --latest
git agent-sync restore --current
git agent-sync restore --branch main
git agent-sync restore --commit 4f7c2a1
```

如果 selector 匹配多条 session，可以追加编号只恢复其中一条：

```bash
git agent-sync restore --latest 1
git agent-sync restore --latest --index 1
git agent-sync restore --current 1
git agent-sync restore --branch main 2
git agent-sync restore --commit 4f7c2a1 3
```

不带 selector 时，`--index` / `--i` 使用默认 `git agent-sync log` 的编号。带 selector 时，编号只在该 selector 的输出范围内生效。`--latest` 匹配最近一次 sidecar 同步批次。`--current` 匹配当前业务项目 `HEAD` commit；如果没有 commit binding，再回退匹配当前 branch。`--commit` 匹配同步时记录的业务项目 commit。branch 只是同步发生时的历史标签，不代表会跟随可变分支指针。detached HEAD 同步时会记录 `branch: null`，仍然可以通过 commit 查询。

## 跨平台恢复适配

Agent session 文件里可能记录创建会话时的 shell、工作目录和项目根目录。例如 Windows 上创建的 session 可能包含 `powershell.exe` 和 `C:\...\MokioAgent` 路径。把这类 session 恢复到 macOS 或 Linux 后，如果这些旧引用不变，继续会话时就可能一直尝试使用错误终端，或者引用一个当前机器不存在的项目目录。

默认情况下，`restore` 不会修改 sidecar store 中的原始文件，只会在恢复到本机的副本里适配项目路径：

- `session_meta.payload.cwd`、`turn_context.payload.cwd`、`event_msg.payload.cwd` 会映射为当前业务仓库根目录。
- `exec_command` function call 里的 `workdir` 会映射为当前业务仓库根目录。
- `exec_command` function call 里的 `shell` 会映射为当前机器 shell，例如 macOS / Linux 上的 `$SHELL`。
- transcript 字符串、命令参数、命令输出、sandbox 元数据、已编辑文件列表里的源项目根路径引用会映射为当前业务仓库根目录。
- 不会翻译命令语法。历史 PowerShell 命令仍然会作为历史 transcript 保留，但命令里嵌入的源项目路径会被映射为当前项目路径。
- 恢复后的 Codex session 会在 `session_meta.payload` 写入 `agentSyncAdapted` 标记，方便后续审计。
- 恢复后的 Codex session 会注册到本机 `state_5.sqlite` 和 `session_index.jsonl`，让 Codex 插件 / App 能在对话列表里显示。
- 恢复后的 Claude session 会写入当前项目对应的 `~/.claude/projects/<project-slug>/` 目录，并在恢复后的 JSONL item 上写入 `agentSyncAdapted` 标记。

如果你需要完全按 sidecar 原文件恢复，不做任何本机适配：

```bash
git agent-sync restore --current --no-adapt
git agent-sync restore --commit 4f7c2a1 --no-adapt
```

如果只想恢复文件，不写入 Codex UI 索引：

```bash
git agent-sync restore --current --no-register
```

## Claude Code 支持与排除项

本机只读调研到的 Claude Code 组织方式和 Codex 不同：

- `~/.claude/projects/<encoded-project-path>/**/*.jsonl` 保存项目相关对话 JSONL。项目目录名是源项目路径的编码形式，嵌套的 `subagents/*.jsonl` 也使用同类 JSONL event 结构。
- Claude JSONL event 里可见 `sessionId`、`cwd`、`gitBranch`、timestamp、sidechain 标记和 `message` 对象。工具调用位于 `message.content[]`，其中 tool-use input 可包含命令和工作目录。
- `~/.claude/history.jsonl` 是按项目和 session id 记录的历史/索引，不作为同步的会话正文来源。
- `~/.claude/sessions/*.json` 是运行中进程/session 状态。
- 本机布局中没有发现类似 Codex `state_5.sqlite` 的 Claude 专用归档索引；resume / discovery 相关证据来自项目 JSONL、history 索引和运行态文件，其中只有项目 JSONL 会被同步。
- `~/.claude.json`、`~/.claude/settings.json`、`~/.claude/backups/`、`~/.claude/cache/`、`~/.claude/telemetry/`、`~/.claude/ide/`、`~/.claude/plugins/`、`~/.claude/skills/` 属于全局账号、设置、缓存、遥测、插件或技能状态，Agent-Sync 不会扫描或复制。

Claude 匹配是保守策略：只有结构化元数据指向当前项目，且没有同时指向外部项目时才接受。目录名或正文里出现当前项目名都不足以作为归属证明。恢复时目标路径会基于当前机器的 Claude root 和当前业务项目路径重建，例如 `~/.claude/projects/<current-project-slug>/...`，不会写回源机器绝对路径。

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

`last-scan.json` 是最近一次可读扫描结果。`scan-cache.json` 是内部文件索引，会按 mtime、size 和 hash 复用未变化文件的匹配结果，避免重复读完整 session。`archive-cache.json` 保存 Codex 已归档 session 集合，只有 `state_5.sqlite` 或 `archived_sessions/` 目录状态变化时才刷新。

`.agent-sync-store/` 是一个独立的 sidecar Git 仓库，用来存会话备份：

```text
.agent-sync-store/
  projects/
    <project-id>/
      manifest.json
      bindings.jsonl
      bindings.idx.json
      codex/
        codex-<hash>.jsonl
      claude/
        claude-<hash>.jsonl
```

## 源码结构

CLI 入口保持很薄。`src/cli.js` 只负责命令分发，具体行为拆到按职责划分的模块：

```text
src/
  args.js            # CLI 参数与 selector 校验
  agents.js          # agent 发现与扫描匹配
  bindings.js        # Git context binding 历史索引
  scan-cache.js      # 增量扫描缓存
  codex-archive.js   # Codex 归档识别与缓存
  codex-session.js   # Codex JSONL 元数据提取与恢复适配
  claude-session.js  # Claude Code JSONL 元数据提取与恢复适配
  config.js          # 本地项目配置与项目 identity
  git.js             # Git root、remote 与工作区上下文
  restore.js         # restore 流程与目标路径
  store.js           # sidecar Git store 与 manifest
  utils.js           # JSON、hash、路径、遍历等共享工具
```

Codex 扫描和 restore 适配会尽量沿用 Codex 的原生结构。项目归属会优先复用 `state_5.sqlite` 的 `threads.cwd`、`threads.git_origin_url`、`threads.git_branch`、`threads.git_sha` 和 `threads.rollout_path`，这也是 Codex UI 能按项目分组的关键来源。没有这些 state 项目字段时，提取器才从 JSONL 的 `session_meta.payload.cwd`、`session_meta.payload.git`、`turn_context.payload.cwd` 和 `response_item.payload.arguments.workdir` 读取 per-session 事实。恢复时的路径映射也会优先使用这些结构化字段，只有结构字段不足时才扫描 transcript 字符串兜底，并且会跳过 `encrypted_content` 这类不可解析字段。

会话标题会尽量复用 Codex UI 的来源。`push` 扫描时会优先读取 `state_5.sqlite` 的 `threads.title`，再用 `threads.preview`、`threads.first_user_message`、`session_index.jsonl` 的 `thread_name` 和 JSONL 里的标题/首条有效用户消息兜底。解析到的标题会写入 `bindings.jsonl`，所以另一台机器 `pull` 后，即使没有源机器的 `state_5.sqlite`，`log` 和 `show` 也能显示同一批标题。

Agent-Sync 不把下面这些 `.codex` 内容作为核心项目/session 判断依据：

- `session_index.jsonl` 只有 session id、标题和更新时间，只适合作为标题兜底，不足以判断项目归属。
- `config.toml` 记录可信项目路径和用户设置，但不是 per-session 事实来源。
- `.codex-global-state.json` 是应用/UI 状态，可能包含与当前项目无关的个人历史。
- `shell_snapshots/` 体积可能较大，也有隐私风险，因此不纳入 MVP 默认同步。

Claude 项目归属也只使用结构化元数据：顶层 `cwd`、Git 字段、tool-use input 里的 `cwd` / `workdir` 是有效线索；正文文本不是。`~/.claude/projects/<project>` 的编码目录名只作为文件组织线索，不能单独证明归属。

Agent-Sync 不扫描下面这些 `.claude` 内容：

- `~/.claude.json` 和 `~/.claude/backups/`：包含全局 onboarding、user id、项目设置、使用统计或账号相关状态。
- `~/.claude/settings.json`：全局配置，可能包含环境变量或权限策略。
- `~/.claude/history.jsonl`：历史/索引文件，不是会话正文源。
- `~/.claude/sessions/`、`~/.claude/ide/`、`~/.claude/cache/`、`~/.claude/telemetry/`：运行态、锁、缓存、changelog 或遥测状态。
- `~/.claude/plugins/` 和 `~/.claude/skills/`：插件/技能资产与配置，不是项目对话状态。

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

## 开发验证

运行完整 MVP 测试：

```bash
npm run test
```

测试内容包括：

- `npm run check`：JavaScript 语法检查和 `git diff --check`
- `npm run smoke`：CLI 入口帮助输出
- `npm run test:bindings`：`bindings.jsonl` 兼容旧字段和坏行容错
- `npm run test:codex-session`：Windows / macOS / Linux 风格 Codex 路径适配
- `npm run test:claude-session`：Claude Code 元数据提取、归属判断和恢复路径映射
- `npm run test:scan-cache`：验证未变化 Codex / Claude session 文件会复用本地扫描缓存
- `npm run test:archive-cache`：验证 Codex 归档集合会复用缓存，并在归档状态变化时刷新
- `npm run test:e2e`：用两个临时业务 clone 和一个 bare sidecar remote 覆盖 `push`、`pull`、`log --current`、`log --branch`、`log --commit`、`restore`、`doctor`，并验证 `.agent-sync-store` 不会被业务仓库跟踪

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

如果旧版本曾经报“当前分支没有跟踪信息”，升级后重新运行：

```bash
git agent-sync pull
```

当前版本会自动 fetch `origin/main`，在需要时创建或绑定本地 `main -> origin/main`，然后再执行 fast-forward pull。

如果 `pull` 成功但没有显示可恢复会话，运行：

```bash
git agent-sync doctor
find .agent-sync-store/projects -maxdepth 2 -name manifest.json -print
```

这可以确认远程 store 里是否有当前项目 identity 或旧版 legacy id 对应的 bundle。

## 隐私提醒

当前 MVP 会复制原始项目会话文件，还没有加密和脱敏。它不会复制 Claude 账号、token、全局配置、缓存、遥测、插件、技能、IDE lock 或运行态 session 文件。

请务必使用私有仓库。

后续建议加入：

- `--encrypt`：用 `age` 或 GPG 加密后再提交
- secret redaction：自动过滤 API key、token、私钥片段
- 会话 transcript：生成可读 Markdown
- 冲突处理：多机器同一会话变更时保留双版本

## 发布到 npm

发布前先确认包名是否可用：

```bash
npm view git-agent-sync
```

如果返回 `404`，通常表示包名还没人用。

登录 npm：

```bash
npm login
```

检查即将发布的文件：

```bash
npm pack --dry-run
```

运行完整测试：

```bash
npm run test
```

发布公开包：

```bash
npm publish --access public
```

发布成功后，其他人就可以安装：

```bash
npm install -g git-agent-sync
```

然后使用：

```bash
git agent-sync --help
```

## npm 发布前检查清单

- 修改 `package.json` 里的 `repository`、`bugs`、`homepage`
- 确认 `name` 没有被占用
- 确认 `version` 是新的版本号
- 确认 `bin/git-agent-sync.js` 第一行是 `#!/usr/bin/env node`
- 确认 `npm pack --dry-run` 里没有包含敏感文件
- 确认 npm 账号已经开启 2FA，或使用符合 npm 要求的 granular access token
- 确认远程 GitHub 仓库是公开项目仓库，session store 仓库仍然应该是私有仓库
