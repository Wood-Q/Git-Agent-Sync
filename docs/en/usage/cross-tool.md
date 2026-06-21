# Cross-Tool Transform

[English](/en/usage/cross-tool) | [中文](/zh/usage/cross-tool)

Inspect synced Codex or Claude bundles through one normalized Conversation IR model and re-emit readable JSONL across tools.

## Tool Commands

Use `tool` commands when you want to inspect a synced Codex or Claude bundle through one normalized conversation model:

```bash
git agent-sync tool inspect --session <bundle-id>
git agent-sync tool convert --session <bundle-id> --to ir --json
git agent-sync tool export --session <bundle-id> --to claude --mode readable
```

- `inspect` prints a short summary of the source agent, title, event count, and tool-call count.
- `convert` emits Agent-Sync Conversation IR, preserving the original vendor JSONL under provenance/vendor fields while normalizing messages, tool calls, tool results, project identity, runtime provider, and dependency hints.
- `export --mode readable` writes JSONL that another surface can display or archive; if `--mode resumable` is requested before a target adapter can safely continue the session, the export header records `requestedMode: "resumable"`, keeps `mode: "readable"`, sets `resumable: false`, and includes a readable-only reason.
