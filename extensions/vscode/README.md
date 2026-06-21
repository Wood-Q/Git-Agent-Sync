# Git Agent Sync

Browse, pull, push, inspect, and restore Agent-Sync sessions from VS Code.

This extension calls the `agent-sync` CLI from your PATH by default. On Windows it also checks common npm global install locations and supports the `agent-sync.cmd` shim created by npm. If the CLI is installed somewhere else, set `agentSync.cliPath` to the command or absolute path.

The History view toolbar includes Pull, Push, Sync, Privacy, Allow, Conflicts, Diff, Resolve, IR, Clone, Register, Clean, Watch, TUI, Refresh, Search, and Clear actions. Pull and Push run the sidecar CLI commands for the current workspace and refresh the history table after completion. Sync shows queue state, Privacy runs a session secret scan, Allow adds a reviewed false-positive regex to `.agent-sync/privacy.json`, Conflicts lists sidecar conflict quarantine records, Diff shows a raw-content-safe conflict summary, Resolve lets you pick a conflict strategy, IR inspects a selected bundle as Conversation IR, row-level Show runs `git agent-sync show <bundle-id>`, Clone/Register/Clean/Watch cover local Codex `model_provider` sync, UI index registration, and generated clone cleanup preview, and TUI opens `agent-sync tui` in an integrated terminal. The Command Palette also exposes background sync, queue flush/retry/cancel, daemon status, register-local, repair-local, clean-local preview, privacy redaction preview, privacy allow pattern, conflict diff/resolve, show bundle, and readable tool export.

Marketplace:

- URL: `https://marketplace.visualstudio.com/items?itemName=mokio.agent-sync-vscode`
- Extension ID: `mokio.agent-sync-vscode`

Published metadata:

- Extension package: `agent-sync-vscode`
- Display name: `Git Agent Sync`
- Version: `0.1.4`
- Publisher: `mokio`
- Repository: `https://github.com/Wood-Q/Git-Agent-Sync`
