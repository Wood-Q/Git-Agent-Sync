# Git Agent Sync

Browse, pull, push, and restore Agent-Sync sessions from VS Code.

This extension calls the `agent-sync` CLI from your PATH by default. On Windows it also checks common npm global install locations and supports the `agent-sync.cmd` shim created by npm. If the CLI is installed somewhere else, set `agentSync.cliPath` to the command or absolute path.

The History view toolbar includes Pull, Push, Clone, Watch, TUI, Refresh, and Clear actions. Pull and Push run the sidecar CLI commands for the current workspace and refresh the history table after completion. Clone and Watch run local Codex `model_provider` sync commands; TUI opens `agent-sync tui` in an integrated terminal.

Marketplace:

- URL: `https://marketplace.visualstudio.com/items?itemName=mokio.agent-sync-vscode`
- Extension ID: `mokio.agent-sync-vscode`

Published metadata:

- Extension package: `agent-sync-vscode`
- Display name: `Git Agent Sync`
- Version: `0.1.3`
- Publisher: `mokio`
- Repository: `https://github.com/Wood-Q/Git-Agent-Sync`
