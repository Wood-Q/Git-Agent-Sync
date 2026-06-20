# Usage Guide

[English](usage.md) | [中文](usage.zh-CN.md)

## Install

CLI package:

```bash
npm install -g git-agent-sync
```

VS Code extension:

- Marketplace: [Git Agent Sync](https://marketplace.visualstudio.com/items?itemName=mokio.agent-sync-vscode)
- Extension ID: `mokio.agent-sync-vscode`

The extension runs the CLI from `agentSync.cliPath`, defaulting to `agent-sync`. On Windows it also checks common npm global install locations and supports npm's `agent-sync.cmd` shim. The History view toolbar can pull, push, refresh, clear filters, and restore sessions for the current workspace.

For local development:

```bash
cd ~/Agent-Sync
npm install
npm link
git agent-sync --help
```

## First Sync

Create a private repository just for agent sessions:

```text
git@github.com:you/agent-session-store.git
```

Initialize Agent-Sync in a business repository and push the local sessions that belong to it:

```bash
cd your-project
git agent-sync init --remote git@github.com:you/agent-session-store.git
git agent-sync status
git agent-sync push --m "sync current agent sessions"
```

`init` also accepts the remote as the first positional argument:

```bash
git agent-sync init git@github.com:you/agent-session-store.git
```

If the sidecar remote already has a `main` branch and the local `.agent-sync-store/` has no commits, `init` automatically checks out the remote sidecar history. A new project can run `push` directly after `init`; use `pull` later when you want to refresh an existing store.

## Restore On Another Machine

Clone the business project, initialize Agent-Sync with the same sidecar remote, then pull and restore:

```bash
git clone git@github.com:you/your-project.git
cd your-project
git agent-sync init --remote git@github.com:you/agent-session-store.git
git agent-sync pull
git agent-sync log --latest
git agent-sync restore --latest 1
```

Useful restore selectors:

```bash
git agent-sync restore --latest
git agent-sync restore --current
git agent-sync restore --branch main
git agent-sync restore --commit 4f7c2a1
git agent-sync restore --index 1
```

`--latest` matches the latest sidecar sync batch. `--current` matches the current business repo `HEAD` commit, with branch fallback only when no commit binding exists. `--commit` matches the project commit recorded during sync. Branches are historical labels from sync time; they do not follow mutable branch pointers.

To restore the exact sidecar file without local path adaptation:

```bash
git agent-sync restore --current --no-adapt
```

To restore the file without registering it in the Codex UI index:

```bash
git agent-sync restore --current --no-register
```

## Local Provider Clone And Copy

Use local transfer when you want to keep working on the same project conversation in another provider on the same machine:

```bash
git agent-sync copy-local --from codex --to claude
git agent-sync clone-local --from claude --to codex
```

`copy` preserves the source session id when possible and updates target files previously created by Agent-Sync. `clone` creates a stable new target session id and skips once that clone already exists. Both commands only use sessions that match the current Git project through structured metadata.

To keep a local copy fresh while switching providers:

```bash
git agent-sync watch-local --from codex --to claude --mode copy
```

The VS Code History view includes Clone, Copy, and Watch buttons that run the same local transfer commands for the current workspace.

## Terminal TUI

Open the terminal menu when you want the common workflows in one place:

```bash
git agent-sync tui
```

The TUI can run status, latest log, pull, push, restore by index, local clone/copy, and local watch actions. The VS Code History view also has a TUI button that opens the same menu in an integrated terminal.

## Automatic Push

Install a pre-push hook in each project where you want automatic session sync:

```bash
git agent-sync install-hooks
```

After that, normal project pushes run `git-agent-sync push` first:

```bash
git push
```

The hook exits successfully without syncing when `.agent-sync/config.json` or the sidecar Git repo is missing, so it does not block normal project pushes before `init` has been completed.

Remove the hook with:

```bash
git agent-sync uninstall-hooks
```

## Custom Session Roots

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

If `pull` previously failed with "no tracking information", rerun it with the current version. The tool fetches `origin/main`, checks out or tracks it when needed, then pulls with `--ff-only`.

If `push` or `pull` reports unrelated sidecar history, the local `.agent-sync-store/` already has commits that do not share ancestry with the configured sidecar remote. Back up `.agent-sync-store/`, then either explicitly merge the histories with Git or reset the sidecar store to the remote before syncing again.

If `pull` succeeds but no sessions are available, run:

```bash
git agent-sync doctor
find .agent-sync-store/projects -maxdepth 2 -name manifest.json -print
```

This helps confirm whether the remote store contains a bundle for the current project identity or a compatible legacy id.
