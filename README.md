# git-agent-sync

`git-agent-sync` is a Git-style helper for syncing local AI coding-agent sessions through a separate private Git repository.

It solves one specific problem: source code can move with `git clone`, but local Codex and Claude Code conversations normally stay on the machine where they were created.

## What It Does

- Reads current-project Codex sessions from the `state_5.sqlite` `threads` table first, then uses `rollout_path` to locate JSONL files
- Skips archived Codex sessions by default: `~/.codex/archived_sessions/**/*.jsonl` and threads marked `archived = 1` in `state_5.sqlite`
- Reads current-project Claude Code session JSONL files only from `~/.claude/projects/**/*.jsonl`
- Uses local mtime/size/hash caches so unchanged session files are not reread on every scan
- Matches Codex sessions only through structured project metadata from Codex state or JSONL; sessions missing project metadata or recording another Git remote / project path are rejected
- Matches Claude Code sessions only through structured metadata such as `cwd`, Git remote/branch/commit fields, and tool-use `cwd` / `workdir`; transcript body text is never used as ownership proof
- Copies matched sessions into a sidecar Git repo at `.agent-sync-store/`
- Pushes and pulls that sidecar repo without adding sessions to your project commits
- Restores pulled sessions back into the local Codex or Claude Code session directory
- Adapts restored Codex and Claude Code sessions across project paths without changing the sidecar source
- Records the project `HEAD` commit for each pushed snapshot
- Browses session history with `log`, inspects one snapshot with `show`, and restores by latest/current/branch/commit
- Uses a cross-platform project identity based on the project Git remote when available
- Falls back to legacy path-based bundles so older stores still restore

## Install

For local development:

```bash
cd ~/Agent-Sync
npm install
npm link
git agent-sync --help
```

After publishing:

```bash
npm install -g git-agent-sync
```

## Complete Workflow

Create a private repository just for agent sessions, for example:

```text
git@github.com:you/agent-session-store.git
```

On the machine that already has useful sessions:

```bash
cd your-project
git agent-sync init --remote git@github.com:you/agent-session-store.git
git agent-sync status
git agent-sync push
```

On another machine:

```bash
git clone git@github.com:you/your-project.git
cd your-project
git agent-sync init --remote git@github.com:you/agent-session-store.git
git agent-sync pull
git agent-sync log --latest
git agent-sync restore --latest 1
```

You can also pass the session-store URL as the first positional argument:

```bash
git agent-sync init git@github.com:you/agent-session-store.git
```

## Automatic Push

Install the pre-push hook in each project where you want automatic session sync:

```bash
git agent-sync install-hooks
```

After that, normal project pushes run `git-agent-sync push` first:

```bash
git push
```

The hook exits successfully without syncing when `.agent-sync/config.json` or the sidecar Git repo is missing, so it will not block normal project pushes before `init` has been completed. To remove the hook:

```bash
git agent-sync uninstall-hooks
```

## Commands

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

`doctor` prints `ok` / `warn` / `fail` checks for the project root, config, sidecar store, remote reachability, sidecar branch/upstream, manifest, bindings, resolved Codex / Claude session roots, project identity, current project id, and legacy ids used for compatibility.
It also shows archived Codex thread counts so you can confirm archived sessions are not being treated as active sync candidates.

## Cross-Platform Project Identity

Older versions derived `projectId` from the absolute project path. That made the same project look different across Windows, macOS, Linux, or even two folders on the same machine.

Current behavior:

- If the project has a Git remote, `projectId` is derived from a normalized remote URL.
- SSH and HTTPS forms of the same GitHub repo normalize to the same identity.
- If the project has no remote, `projectId` falls back to the repo directory name.
- Old path-based ids are kept in `legacyProjectIds`.
- `pull` and `restore` can find older bundles by legacy id, project identity, or project name.
- New bundles store each session's path relative to its agent root, so restore maps sessions into the current machine's Codex or Claude directory instead of the source machine's absolute path.

Example config:

```json
{
  "projectId": "MokioAgent-1a2b3c4d5e",
  "projectIdentity": "git:github.com/wood-q/mokioagent",
  "legacyProjectIds": ["MokioAgent-f49ebafc58"]
}
```

## Git Context Bindings

Each `push` writes a lightweight historical index at:

```text
.agent-sync-store/
  projects/
    <project-id>/
      bindings.jsonl
      bindings.idx.json
```

`manifest.json` remains the latest snapshot. `bindings.jsonl` is append-only Git-style history and records the agent snapshot bundle, sync run, project branch, project `HEAD` commit, and whether the project worktree was dirty when the snapshot was synced. `bindings.idx.json` is a rebuildable lookup cache derived from `bindings.jsonl` for faster `log`, `show`, and selector-based `restore`.

The primary anchor is the business repo commit at `git agent-sync push` time. Agent session-internal Git metadata is only used for project ownership checks, not as the restore lookup commit.

Use `--m` to set the conversation sync message written to the sidecar Git commit and the log entry:

```bash
git agent-sync push --m "feat: add user login API"
```

```bash
git agent-sync log
git agent-sync log --latest
git agent-sync log --current
git agent-sync log --branch main
git agent-sync log --commit 4f7c2a1
git agent-sync show --latest 1
```

Human-readable output is conversation-first and Git-log-like: it shows `Index`, `Title`, `Author`, `Date`, and the sync message. `Date` is the Codex conversation time when available, falling back to session file time. `--json` keeps returning the raw machine-readable bindings.

For compact or limited output:

```bash
git agent-sync log --oneline
git agent-sync log -n 3
git agent-sync log -3
```

When human-readable output is longer than the terminal, Agent-Sync opens the configured pager (`GIT_PAGER`, `PAGER`, or `less`). In `less`, press Space for the next page, `b` for the previous page, and `q` to exit.

The default log index is directly restorable:

```bash
git agent-sync restore --index 1
git agent-sync restore --i 1
```

When a sidecar remote is configured, `pull` uses sparse checkout so the local `.agent-sync-store/` keeps only this project's full session bundle plus lightweight `manifest.json` files for other projects.

Restore can use the same selectors:

```bash
git agent-sync restore --latest
git agent-sync restore --current
git agent-sync restore --branch main
git agent-sync restore --commit 4f7c2a1
```

When a selector matches multiple sessions, append the displayed number to restore only one:

```bash
git agent-sync restore --latest 1
git agent-sync restore --latest --index 1
git agent-sync restore --current 1
git agent-sync restore --branch main 2
git agent-sync restore --commit 4f7c2a1 3
```

Without a selector, `--index` / `--i` uses the numbering from the default `git agent-sync log`. With a selector, the index is scoped to that selector's log output. `--latest` matches the most recent sidecar sync batch. `--current` matches the current project `HEAD` commit, with branch fallback only when no commit binding exists. `--commit` matches the project commit recorded during sync. Branches are historical labels from sync time; they do not follow mutable branch pointers. Detached HEAD syncs store `branch: null` and remain queryable by commit.

## Claude Code Support

The Claude Code layout observed on this machine is deliberately different from Codex:

- `~/.claude/projects/<encoded-project-path>/**/*.jsonl` contains project-scoped conversation JSONL files. Project directories encode the source project path, and nested `subagents/*.jsonl` files use the same JSONL event shape.
- Claude JSONL events can include top-level fields such as `sessionId`, `cwd`, `gitBranch`, timestamps, sidechain flags, and `message` objects. Tool calls appear inside `message.content[]`, including tool-use input objects with command working directories.
- `~/.claude/history.jsonl` is a prompt/history index with project and session ids, not the conversation source of truth for sync.
- `~/.claude/sessions/*.json` is runtime process/session state.
- No Claude-specific archive index equivalent to Codex `state_5.sqlite` was observed in this local layout; resume/discovery evidence is project JSONL plus history/runtime indexes, and only project JSONL is synced.
- `~/.claude.json`, `~/.claude/settings.json`, `~/.claude/backups/`, `~/.claude/cache/`, `~/.claude/telemetry/`, `~/.claude/ide/`, `~/.claude/plugins/`, and `~/.claude/skills/` are global account, settings, cache, telemetry, plugin, or skill state and are never scanned or copied by Agent-Sync.

Claude project matching is intentionally conservative. A file is accepted only when structured metadata points at the current project and does not also point at a foreign project. A directory name or transcript sentence mentioning the project is not enough. On restore, the target path is rebuilt from the current machine's Claude root and current project path, for example `~/.claude/projects/<current-project-slug>/...`; Agent-Sync does not write back to the source machine's absolute path.

## Cross-Platform Restore Adaptation

Agent session files can contain the shell, working directory, and project-root paths used on the source machine. For example, a session created on Windows may contain `powershell.exe` and `C:\...\MokioAgent` paths. When restored on macOS or Linux, those stale references can make the continued session try to use a missing terminal or a project directory that does not exist.

By default, `restore` keeps the sidecar source file unchanged and adapts only the restored local copy when it detects source project paths:

- `session_meta.payload.cwd`, `turn_context.payload.cwd`, and `event_msg.payload.cwd` are mapped to the current project root.
- `exec_command` function-call `workdir` is mapped to the current project root.
- `exec_command` function-call `shell` is mapped to the current machine shell, such as `$SHELL` on macOS or Linux.
- Source project-root path references inside transcript strings, command arguments, outputs, sandbox metadata, and edited-file lists are mapped to the current project root.
- Command syntax is not translated. A historical PowerShell command remains a PowerShell command in the transcript, but any embedded source project path is remapped.
- Restored Codex sessions get an `agentSyncAdapted` marker in `session_meta.payload` for auditability.
- Restored Codex sessions are registered in local `state_5.sqlite` and `session_index.jsonl`, so the Codex plugin/App can show them.
- Restored Claude sessions are written under the current project's `~/.claude/projects/<project-slug>/` directory and get an `agentSyncAdapted` marker on the restored JSONL item.

To restore the exact sidecar file without any local adaptation:

```bash
git agent-sync restore --current --no-adapt
git agent-sync restore --commit 4f7c2a1 --no-adapt
```

To restore the file without registering it in the Codex UI index:

```bash
git agent-sync restore --current --no-register
```

## Local Files

Initialization creates:

```text
.agent-sync/
.agent-sync-store/
```

Both directories are added to the project `.gitignore`.

`.agent-sync/` stores local machine config and scan cache:

```text
.agent-sync/config.json
.agent-sync/last-scan.json
.agent-sync/scan-cache.json
.agent-sync/archive-cache.json
```

`last-scan.json` is the latest human-readable scan result. `scan-cache.json` is an internal file index keyed by mtime, size, and hash, so unchanged session files can be reused without rereading their contents. `archive-cache.json` stores the Codex archived-session set and refreshes only when `state_5.sqlite` or `archived_sessions/` changes.

`.agent-sync-store/` is an independent Git repository:

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

## Source Layout

The CLI entrypoint is intentionally small. `src/cli.js` handles command dispatch, while the behavior lives in focused modules:

```text
src/
  args.js            # CLI argument and selector validation
  agents.js          # Agent discovery and scan matching
  bindings.js        # Git context binding history
  scan-cache.js      # Incremental session scan cache
  codex-archive.js   # Codex archived-session detection and cache
  codex-session.js   # Codex JSONL metadata extraction and restore adaptation
  claude-session.js  # Claude Code JSONL metadata extraction and restore adaptation
  config.js          # Local project config and identity
  git.js             # Git root, remote, and worktree context
  restore.js         # Restore flow and target paths
  store.js           # Sidecar Git store and manifest
  utils.js           # Shared JSON, hash, path, and walk helpers
```

Codex scanning and restore adaptation follow Codex's native data shape. Project ownership first reuses `state_5.sqlite` `threads.cwd`, `threads.git_origin_url`, `threads.git_branch`, `threads.git_sha`, and `threads.rollout_path`, which is the same kind of source Codex UI uses for project grouping. When those state project fields are missing, the extractor falls back to JSONL facts from `session_meta.payload.cwd`, `session_meta.payload.git`, `turn_context.payload.cwd`, and `response_item.payload.arguments.workdir`. Restore path mapping uses structured fields first, then scans transcript strings only as a fallback, while skipping opaque fields such as `encrypted_content`.

Session titles reuse Codex UI's own sources where possible. During `push`, Agent-Sync first reads `state_5.sqlite` `threads.title`, then falls back to `threads.preview`, `threads.first_user_message`, `session_index.jsonl` `thread_name`, JSONL thread-name events, and the first useful user message. The resolved title is written to `bindings.jsonl`, so another machine can show the same `log` / `show` title after `pull` even without the source machine's `state_5.sqlite`.

Codex project ownership is strict and based only on structured metadata: `repository_url` must match the current project remote, and `cwd` / `workdir` must not include another project path. A session that belongs to another Git repository, another project path, multiple project workdirs, or has no structured project metadata is skipped even if its transcript text mentions this project name, and restore applies the same guard before writing into the local Codex directory.

Claude project ownership follows the same rule but with Claude's JSONL shape: top-level `cwd`, Git fields, and tool-use input directories are valid ownership signals; transcript body text is not. The encoded `~/.claude/projects/<project>` directory is treated as file organization evidence, not as sufficient proof by itself.

Agent-Sync intentionally does not use these `.codex` files as core project/session truth:

- `session_index.jsonl` only contains session id, title, and update time, so it is useful as a title fallback but not for project ownership.
- `config.toml` contains trusted project paths and user settings, but it is not a per-session record.
- `.codex-global-state.json` is app/UI state and can include personal history unrelated to a project.
- `shell_snapshots/` can be large and privacy-sensitive, so it is not part of default MVP sync.

Agent-Sync intentionally does not scan these `.claude` files or directories:

- `~/.claude.json` and `~/.claude/backups/`, because they contain global onboarding, user id, project settings, and usage/account state.
- `~/.claude/settings.json`, because it is global configuration and may include environment variables or permission policy.
- `~/.claude/history.jsonl`, because it is a history/index file rather than the conversation transcript source.
- `~/.claude/sessions/`, `~/.claude/ide/`, `~/.claude/cache/`, and `~/.claude/telemetry/`, because they are runtime, lock, cache, changelog, or telemetry state.
- `~/.claude/plugins/` and `~/.claude/skills/`, because they are installed plugin/skill assets and configuration, not project conversation state.

## Non-Standard Session Paths

For tests or custom installs, override the agent discovery roots. `AGENT_SYNC_CODEX_DIR` can point at either `.codex` or `.codex/sessions`, and `AGENT_SYNC_CLAUDE_DIR` can point at a Claude `projects` directory:

```bash
AGENT_SYNC_CODEX_DIR=/path/to/codex/sessions git agent-sync status
AGENT_SYNC_CLAUDE_DIR=/path/to/claude/projects git agent-sync status
```

Windows PowerShell example:

```powershell
$env:AGENT_SYNC_CODEX_DIR="D:\codex-sessions"
git agent-sync status
```

## Development Checks

Run the full MVP test suite:

```bash
npm run test
```

The suite includes:

- `npm run check`: JavaScript syntax checks and `git diff --check`.
- `npm run smoke`: CLI entrypoint help output.
- `npm run test:bindings`: `bindings.jsonl` compatibility and invalid-line handling.
- `npm run test:codex-session`: Windows / macOS / Linux style Codex path adaptation.
- `npm run test:claude-session`: Claude Code metadata extraction, ownership checks, and restore path mapping.
- `npm run test:scan-cache`: unchanged Codex and Claude session files are reused from the local scan cache.
- `npm run test:archive-cache`: archived Codex session sets are reused until archive state changes.
- `npm run test:e2e`: two temporary project clones plus a bare sidecar remote, covering `push`, `pull`, `log --current`, `log --branch`, `log --commit`, `restore`, `doctor`, and verification that `.agent-sync-store` is not tracked by the business repo.

## Troubleshooting

Start with:

```bash
git agent-sync doctor
```

`doctor` reports whether the sidecar remote is reachable, whether sparse checkout is enabled for the sidecar store, whether `manifest.json` and `bindings.jsonl` are readable, and how many local agent session files are visible.

If `pull` says there is no remote, initialize again with a remote:

```bash
git agent-sync init --remote git@github.com:you/agent-session-store.git
```

If `pull` previously failed with "no tracking information", rerun it with the current version. The tool now fetches `origin/main`, checks out or tracks it when needed, then pulls with `--ff-only`.

If `pull` succeeds but no sessions are available, run:

```bash
git agent-sync doctor
find .agent-sync-store/projects -maxdepth 2 -name manifest.json -print
```

This helps confirm whether the remote store contains a bundle for the current project identity or a compatible legacy id.

## Security Note

This MVP copies raw project conversation files. Those files may include secrets, code snippets, local paths, prompts, and terminal output. It does not copy Claude account, token, global config, cache, telemetry, plugin, skill, IDE lock, or runtime session files.

Use a private remote. A production version should add default encryption and secret redaction before remote push.
