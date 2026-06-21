# 自定义会话路径

[English](/en/usage/custom-paths) | [中文](/zh/usage/custom-paths)

如果你的 agent 会话不在默认路径，可以用环境变量覆盖。常用于测试或自定义安装。

`AGENT_SYNC_CODEX_DIR` 可以指向 `.codex` 目录或 `.codex/sessions` 目录，`AGENT_SYNC_CLAUDE_DIR` 可以指向 Claude 的 `projects` 目录：

```bash
AGENT_SYNC_CODEX_DIR=/path/to/codex/sessions git agent-sync status
AGENT_SYNC_CLAUDE_DIR=/path/to/claude/projects git agent-sync status
```

Windows PowerShell 示例：

```powershell
$env:AGENT_SYNC_CODEX_DIR="D:\codex-sessions"
git agent-sync status
```
