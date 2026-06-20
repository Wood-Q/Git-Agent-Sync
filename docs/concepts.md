# Concepts

[English](concepts.md) | [中文](concepts.zh-CN.md)

## Project Identity

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
  "projectId": "SampleAgent-1a2b3c4d5e",
  "projectIdentity": "git:github.com/example-org/sampleagent",
  "legacyProjectIds": ["SampleAgent-f49ebafc58"]
}
```

## Matching Rules

Agent-Sync matches sessions only with structured project facts.

Codex scanning and restore adaptation follow Codex's native data shape. Project ownership first reuses `state_5.sqlite` fields such as `threads.cwd`, `threads.git_origin_url`, `threads.git_branch`, `threads.git_sha`, and `threads.rollout_path`. When those state project fields are missing, the extractor falls back to JSONL facts from `session_meta.payload.cwd`, `session_meta.payload.git`, `turn_context.payload.cwd`, and `response_item.payload.arguments.workdir`.

Codex project ownership is strict: `repository_url` must match the current project remote, and `cwd` / `workdir` must not include another project path. A session that belongs to another Git repository, another project path, multiple project workdirs, or has no structured project metadata is skipped even if its transcript text mentions this project name.

Claude project ownership follows the same rule with Claude's JSONL shape: top-level `cwd`, Git fields, and tool-use input directories are valid ownership signals; transcript body text is not. The encoded `~/.claude/projects/<project>` directory is treated as file organization evidence, not as sufficient proof by itself.

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

Human-readable `log` output is conversation-first and Git-log-like: it shows `Index`, `Title`, `Author`, `Date`, and the sync message. `Date` is the Codex conversation time when available, falling back to session file time. `--json` keeps returning raw machine-readable bindings.

When human-readable output is longer than the terminal, Agent-Sync opens the configured pager (`GIT_PAGER`, `PAGER`, or `less`).

## Restore Adaptation

Agent session files can contain the shell, working directory, and project-root paths used on the source machine. For example, a session created on Windows may contain `powershell.exe` and `C:\...\SampleAgent` paths. When restored on macOS or Linux, stale references can make the continued session try to use a missing terminal or a project directory that does not exist.

By default, `restore` keeps the sidecar source file unchanged and adapts only the restored local copy when it detects source project paths:

- `session_meta.payload.cwd`, `turn_context.payload.cwd`, and `event_msg.payload.cwd` are mapped to the current project root.
- `exec_command` function-call `workdir` is mapped to the current project root.
- `exec_command` function-call `shell` is mapped to the current machine shell, such as `$SHELL` on macOS or Linux.
- Source project-root path references inside transcript strings, command arguments, outputs, sandbox metadata, and edited-file lists are mapped to the current project root.
- Command syntax is not translated. A historical PowerShell command remains a PowerShell command in the transcript, but embedded source project paths are remapped.
- Restored Codex sessions get an `agentSyncAdapted` marker in `session_meta.payload` and are registered in local `state_5.sqlite` and `session_index.jsonl` so the Codex plugin/App can show them.
- Restored Claude sessions are written under the current project's `~/.claude/projects/<project-slug>/` directory and get an `agentSyncAdapted` marker on the restored JSONL item.

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
.agent-sync/queue/
.agent-sync/daemon-state.json
```

`queue/` stores background sync jobs in `pending`, `running`, `done`, and `failed` states. `daemon-state.json` records the local worker's latest start, stop, and flush state; these are local runtime files and are not committed to the business Git history.

`.agent-sync-store/` is an independent Git repository:

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

`projects/<project-id>/manifest.json`, `bindings.jsonl`, and `bindings.idx.json` remain the compatibility read path for today's `log` and `restore` commands. The new `objects/` tree stores immutable content-addressed session copies, `events/` writes append-only event shards per machine and sync run, and `manifest.events.json` plus `bindings.events.idx.json` are rebuilt from those events. That lets later multi-device sync merge objects and events first, then move the primary query path to rebuildable indexes.

When a sidecar remote is configured, `pull` uses sparse checkout so the local `.agent-sync-store/` expands objects, events, this project's full session bundle, and lightweight `manifest.json` files for other projects. The sidecar remote is also kept as a Git promisor remote with a `blob:none` filter, so commits can safely reference non-current project blobs that remain on the remote instead of being expanded locally.

## Privacy Boundaries

`push` defaults to `--privacy review`. Before writing a sidecar commit, Agent-Sync scans matched current-project sessions with built-in rules for OpenAI / Anthropic / GitHub tokens, AWS access keys, private keys, Bearer tokens, and common `api_key` / `token` / `secret` / `password` assignments. Findings are not uploaded silently; run `git agent-sync privacy scan` to inspect them, or explicitly use `git agent-sync push --privacy redact` to write redacted sidecar copies.

Redaction only affects the copies inside `.agent-sync-store/`, including object-store copies. It does not rewrite the original local Codex / Claude session files. `projects/<project-id>/privacy-report.json` records the matched rule and location for later explanation.

Agent-Sync intentionally does not use these `.codex` files as core project/session truth:

- `session_index.jsonl`, because it only contains session id, title, and update time.
- `config.toml`, because it contains trusted project paths and user settings but is not a per-session record.
- `.codex-global-state.json`, because it is app/UI state and can include personal history unrelated to a project.
- `shell_snapshots/`, because it can be large and privacy-sensitive.

Agent-Sync intentionally does not scan these `.claude` files or directories:

- `~/.claude.json` and `~/.claude/backups/`, because they contain global onboarding, user id, project settings, and usage/account state.
- `~/.claude/settings.json`, because it is global configuration and may include environment variables or permission policy.
- `~/.claude/history.jsonl`, because it is a history/index file rather than the conversation transcript source.
- `~/.claude/sessions/`, `~/.claude/ide/`, `~/.claude/cache/`, and `~/.claude/telemetry/`, because they are runtime, lock, cache, changelog, or telemetry state.
- `~/.claude/plugins/` and `~/.claude/skills/`, because they are installed plugin/skill assets and configuration, not project conversation state.
