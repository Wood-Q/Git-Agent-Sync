# Usage Guide

[English](/en/usage) | [中文](/zh/usage)

Agent-Sync is a toolbox for everything around AI coding-agent conversations. After installing, pick the feature page for what you want to do.

## Install

CLI package:

```bash
npm install -g git-agent-sync
```

VS Code extension:

- Marketplace: [Git Agent Sync](https://marketplace.visualstudio.com/items?itemName=mokio.agent-sync-vscode)
- Extension ID: `mokio.agent-sync-vscode`

The extension runs the CLI from `agentSync.cliPath`, defaulting to `agent-sync`. On Windows it also checks common npm global install locations and supports npm's `agent-sync.cmd` shim. The History view toolbar can pull, push, inspect sync status, run privacy scan, add privacy allow patterns, list/diff/resolve sidecar conflicts, inspect Conversation IR, clone/register/clean local provider sessions, open the TUI, refresh, search or clear filters, show bundle details, and restore sessions for the current workspace; the Command Palette also exposes background sync, queue flush/retry/cancel, daemon status, register-local, repair-local, clean-local preview, privacy redaction preview, privacy allow pattern, conflict diff/resolve, show bundle, and readable tool export.

For local development:

```bash
cd ~/Agent-Sync
npm install
npm link
git agent-sync --help
```

## Feature Tour

Organized by capability track. Open each page for full usage.

- **[Remote Sync](/en/usage/remote-sync)** — `push` / `pull` / `restore` between machines via a private sidecar repo, plus auto-sync hooks, background queue, conflict quarantine, and privacy redaction.
- **[Local Migration](/en/usage/local-migration)** — clone, register, and watch Codex sessions when switching `model_provider`, all local with no remote.
- **[Cross-Tool Transform](/en/usage/cross-tool)** — inspect bundles via Conversation IR and re-emit readable JSONL between Codex and Claude.
- **[Terminal TUI](/en/usage/tui)** — a three-workspace fullscreen single-key toolbox (Remote / Local / Doctor).
- **[Custom Session Roots](/en/usage/custom-paths)** — override the default Codex / Claude session roots with environment variables.

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
