<p align="center">
  <img src="logo.svg" alt="Git Agent Sync logo" width="160">
</p>

# git-agent-sync

[English](README.md) | [中文](README.zh-CN.md)

`git-agent-sync` is a Git-style helper for syncing local AI coding-agent sessions through a separate private Git repository.

It solves one specific problem: source code can move with `git clone`, but local Codex and Claude Code conversations normally stay on the machine where they were created.

> Git for your AI coding sessions.

## What It Does

- Works as a Git subcommand: `git agent-sync ...`
- Finds current-project Codex and Claude Code session files through structured metadata
- Skips archived Codex sessions and global/runtime agent state
- Copies matched sessions into a sidecar Git repository at `.agent-sync-store/`
- Pushes and pulls that sidecar repository without adding sessions to your business repo commits
- Restores pulled sessions back into the local Codex or Claude Code session directory
- Adapts restored session paths across machines and operating systems
- Records the business repo branch, `HEAD` commit, dirty state, and sync message for each snapshot
- Lets you browse and restore by latest sync, current commit, branch, commit, bundle id, or log index
- Provides a React Ink TUI for dashboard, sync queue, history, local provider, tool conversion, privacy review, conflicts, and settings workflows

## Install

CLI package:

```bash
npm install -g git-agent-sync
```

VS Code extension:

- Marketplace: [Git Agent Sync](https://marketplace.visualstudio.com/items?itemName=mokio.agent-sync-vscode)
- Extension ID: `mokio.agent-sync-vscode`

For local development:

```bash
cd ~/Agent-Sync
npm install
npm link
git agent-sync --help
```

## Basic Workflow

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

If the sidecar remote already has a `main` branch and this project's local `.agent-sync-store/` has no commits yet, `init` automatically checks out that remote history. A new project can run `push` directly after `init`.

On another machine:

```bash
git clone git@github.com:you/your-project.git
cd your-project
git agent-sync init --remote git@github.com:you/agent-session-store.git
git agent-sync pull
git agent-sync log --latest
git agent-sync restore --latest 1
```

Automatic sync before normal project pushes:

```bash
git agent-sync install-hooks
git push
```

The hook queues a background sync job instead of running the sidecar push inline. You can also manage the queue directly:

```bash
git agent-sync sync --background
git agent-sync sync status
git agent-sync sync --flush
git agent-sync daemon start
git agent-sync daemon status
git agent-sync daemon stop
```

Remove the hook with:

```bash
git agent-sync uninstall-hooks
```

## How It Works

Agent-Sync treats agent conversations like Git-adjacent project artifacts, not as source files. It keeps a local config in `.agent-sync/` and a separate sidecar Git repository in `.agent-sync-store/`.

Project ownership is intentionally conservative. Codex sessions are matched with Codex state and JSONL project metadata such as `cwd`, Git remote, branch, commit, and rollout path. Claude Code sessions are matched with JSONL fields such as `cwd`, Git metadata, and tool-use `cwd` / `workdir`. Transcript text alone is never used as proof that a session belongs to the current project.

Each `push` copies accepted session files into the sidecar store and appends a Git-context binding that records the current business repo branch, `HEAD` commit, dirty state, bundle id, titles, and sync message. `pull` fetches the sidecar store, and `restore` writes selected sessions back into the current machine's Codex or Claude Code session directory, adapting source-machine paths when needed. For local-only Codex provider switches, `clone-local` and `watch-local` can clone current-project Codex sessions to the active `model_provider` without using the sidecar remote.

Detailed internals live in [Concepts](docs/concepts.md) and [Execution Flow](docs/execution-flow.md).

## Commands

| Command | Purpose |
| --- | --- |
| `git agent-sync init [--remote <url>\|<url>] [--store <path>]` | Initialize local config and sidecar store |
| `git agent-sync status [--json]` | Show sync status for the current project |
| `git agent-sync scan [--json]` | Scan matching local Codex / Claude sessions |
| `git agent-sync push [--m <message>]` | Snapshot matched sessions into the sidecar store and push the sidecar remote |
| `git agent-sync pull` | Pull sidecar snapshots for this project |
| `git agent-sync sync --background` | Queue a sidecar sync job and start a background worker |
| `git agent-sync sync status` | Show queued, running, completed, and failed sync jobs |
| `git agent-sync sync --flush` | Process queued sync jobs in the current terminal |
| `git agent-sync daemon <start\|status\|stop>` | Manage the local background sync worker |
| `git agent-sync privacy scan` | Scan current-project sessions for common secrets |
| `git agent-sync push --privacy redact` | Write redacted sidecar copies when secrets are found |
| `git agent-sync tool inspect --session <bundle-id>` | Summarize a sidecar bundle as Conversation IR |
| `git agent-sync tool convert --session <bundle-id> --to ir` | Convert a Codex or Claude bundle to Agent-Sync Conversation IR |
| `git agent-sync tool export --session <bundle-id> --to <codex\|claude> --mode readable` | Export readable cross-tool JSONL from the IR |
| `git agent-sync clone-local [target-provider]` | Clone local current-project Codex sessions to a Codex `model_provider` |
| `git agent-sync watch-local [--interval <seconds>]` | Watch Codex `model_provider` changes and clone sessions to the active provider |
| `git agent-sync repair-local` | Repair local Codex UI registration for provider clones |
| `git agent-sync tui` | Open an interactive terminal menu for common Agent-Sync operations |
| `git agent-sync log [--oneline] [-n <count>\|-<count>] [--json]` | Browse restorable session history |
| `git agent-sync log --latest [--oneline] [-n <count>\|-<count>] [--json]` | Browse sessions from the latest sync batch |
| `git agent-sync log --current [--json]` | Browse sessions bound to the current business repo commit |
| `git agent-sync log --branch <name> [--json]` | Browse sessions synced from a branch label |
| `git agent-sync log --commit <sha> [--json]` | Browse sessions bound to a specific business repo commit |
| `git agent-sync show <bundle-id>` | Inspect a snapshot bundle |
| `git agent-sync show --latest 1` | Inspect one session from the latest selector output |
| `git agent-sync show --current 1` | Inspect one session from the current-commit selector output |
| `git agent-sync restore <bundle-id>` | Restore a bundle directly |
| `git agent-sync restore --index <n>` / `--i <n>` | Restore by default log index |
| `git agent-sync restore --all` | Restore all matched sessions |
| `git agent-sync restore --latest [n]` | Restore latest sync sessions or one indexed session |
| `git agent-sync restore --current [n]` | Restore sessions for the current commit or one indexed session |
| `git agent-sync restore --branch <name> [n]` | Restore sessions from a historical branch label |
| `git agent-sync restore --commit <sha> [n]` | Restore sessions bound to a commit |
| `git agent-sync restore --current --no-adapt` | Restore without local path adaptation |
| `git agent-sync restore --current --no-register` | Restore without registering Codex UI indexes |
| `git agent-sync install-hooks` | Install the pre-push hook |
| `git agent-sync uninstall-hooks` | Remove the pre-push hook |
| `git agent-sync doctor` | Run project, store, remote, manifest, binding, and session-root checks |

## Documentation

- [Docs Index](docs/README.md)
- [Usage Guide](docs/usage.md)
- [Concepts](docs/concepts.md)
- [Execution Flow](docs/execution-flow.md)
- [Development](docs/development.md)
- [Release and Publishing](docs/publishing.md)
- [VS Code Extension](extensions/vscode/README.md)

## Security Note

This MVP copies project conversation files. `push` defaults to `--privacy review`, which blocks when common secrets are detected; use `git agent-sync privacy scan` to inspect findings or `git agent-sync push --privacy redact` to write redacted sidecar copies. Conversation files may still include code snippets, local paths, prompts, and terminal output. Agent-Sync does not copy Claude account, token, global config, cache, telemetry, plugin, skill, IDE lock, or runtime session files.

Use a private remote for the sidecar session store. A production version should add default encryption and secret redaction before remote push.
