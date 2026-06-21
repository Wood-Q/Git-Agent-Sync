# Custom Session Roots

[English](/en/usage/custom-paths) | [中文](/zh/usage/custom-paths)

Override the agent discovery roots when your sessions are not at the default locations. Common for tests or custom installs.

`AGENT_SYNC_CODEX_DIR` can point at either `.codex` or `.codex/sessions`, and `AGENT_SYNC_CLAUDE_DIR` can point at a Claude `projects` directory:

```bash
AGENT_SYNC_CODEX_DIR=/path/to/codex/sessions git agent-sync status
AGENT_SYNC_CLAUDE_DIR=/path/to/claude/projects git agent-sync status
```

Windows PowerShell example:

```powershell
$env:AGENT_SYNC_CODEX_DIR="D:\codex-sessions"
git agent-sync status
```
