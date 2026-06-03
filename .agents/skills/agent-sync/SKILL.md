---
name: agent-sync
description: Use when the user asks to sync, push, pull, log, show, restore, initialize, or troubleshoot Agent-Sync sessions for the current Git project, including requests like sync current project conversations, 同步当前项目对话, 查看会话历史, or 恢复会话.
---

# Agent-Sync

Use Agent-Sync as the source of truth for syncing Codex and Claude Code session files through the current project's sidecar Git store.

## Core Rules

- Use the current workspace Git root by default.
- Do not infer project ownership from transcript text. Let `agent-sync` inspect structured project metadata.
- Prefer read-only commands before write commands when the user's intent is unclear.
- Ask at most one concise question when action, remote, project, or restore target is ambiguous.
- Do not ask for confirmation on clearly requested read-only operations.
- Do not run `restore --all` unless the user explicitly asks to restore all matching sessions.
- Do not print raw session JSONL contents unless the user explicitly asks to inspect raw files.
- Match the user's language in the final summary.

## Command Discovery

Use the first available executable:

1. `agent-sync`
2. `git-agent-sync`
3. `node ./bin/git-agent-sync.js` when the current workspace is the Agent-Sync repository

If none is available, tell the user to install the CLI:

```bash
npm install -g git-agent-sync
```

## Intent Routing

Route by user intent, not by exposing every CLI flag.

| User intent | Default action |
| --- | --- |
| Sync current project conversations, "同步当前项目对话" | Check config, run `status`, then run `push` |
| See local scan result | Run `status --json` or `scan --json` |
| Browse synced sessions | Run `log`, usually `log -n 10` or `log --oneline -n 10` |
| Browse latest sync batch | Run `log --latest -n 10` |
| Browse sessions for current commit | Run `log --current -n 10` |
| Browse by branch or commit | Run `log --branch <name>` or `log --commit <sha>` |
| Inspect one session | Run `show <bundle-id>` or `show [filters] <index>` |
| Pull remote sidecar state | Run `pull` |
| Restore a session | Resolve a bundle/index/selector, then run `restore` |
| Initialize a project | Run `init --remote <url>` when remote is known |
| Troubleshoot | Run `doctor`, then inspect config/status as needed |
| Enable automatic pre-push sync | Run `install-hooks` only after explicit request |
| Disable automatic pre-push sync | Run `uninstall-hooks` only after explicit request |

## Default Sync Flow

When the user starts a fresh Codex thread and asks to sync the current project:

1. Confirm the current directory is inside a Git repository.
2. Check whether `.agent-sync/config.json` exists.
3. If config is missing, ask for the sidecar remote URL or explicit local-only initialization.
4. Run `agent-sync status --json` when available and summarize matched sessions.
5. Run `agent-sync push` unless the user asked only to inspect.
6. Summarize whether a sidecar commit was created, pushed, or skipped as a no-op.

If the user says "sync" without specifying direction, prefer `push` because Agent-Sync's normal workflow syncs current local agent sessions into the sidecar store.

## Restore Flow

Restores write files into local Codex or Claude session directories, so be more careful:

1. If the user did not provide a bundle id, index, or selector, run `log -n 10` and ask which item to restore.
2. If the user says "latest one" or "最近一个", use `restore --latest 1`.
3. If the user says "current commit", use `restore --current 1` unless they gave another index.
4. If multiple matches are possible, show a short numbered list and ask one question.
5. After restore, summarize target agent, bundle id, adaptation status, and registration result.

## Question Policy

Ask a question only when it changes behavior materially.

Ask when:

- The project is not a Git repository.
- `.agent-sync/config.json` is missing and no remote URL was provided.
- The user asks to restore but gives no target.
- The user asks to restore "all" but the scope is broad or unclear.
- The command would install or remove hooks and the request was indirect.

Do not ask when:

- The user clearly asks to sync the current project.
- The user asks for status, log, show, or doctor.
- A safe default selector is already stated, such as latest/current/index/bundle.

## Output Style

Keep the final response short and operational:

- What command family ran.
- How many sessions matched, synced, restored, skipped, or were already up to date.
- Any follow-up command the user can naturally ask Codex to run next.

Avoid dumping full command output unless it contains an error the user needs to see.
