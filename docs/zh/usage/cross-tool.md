# 跨工具转换

[English](/en/usage/cross-tool) | [中文](/zh/usage/cross-tool)

通过 Conversation IR 用统一模型查看已同步的 Codex 或 Claude bundle，并在工具之间互导为可读 JSONL。

## 工具命令

当你想用统一模型查看已经同步的 Codex 或 Claude bundle，可以使用 `tool` 命令：

```bash
git agent-sync tool inspect --session <bundle-id>
git agent-sync tool convert --session <bundle-id> --to ir --json
git agent-sync tool export --session <bundle-id> --to claude --mode readable
```

- `inspect` 会输出来源 agent、标题、事件数量和工具调用数量。
- `convert` 会输出 Agent-Sync Conversation IR：原始 vendor JSONL 仍保存在 provenance/vendor 字段里，同时把消息、工具调用、工具结果、项目身份、runtime provider 和依赖线索映射成统一结构。
- `export --mode readable` 会写出可阅读/可归档的跨工具 JSONL；如果在目标 adapter 还不能安全续聊时请求 `--mode resumable`，导出 header 会记录 `requestedMode: "resumable"`，但保持 `mode: "readable"`、`resumable: false`，并写明 readable-only 原因。
