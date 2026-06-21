# 本地迁移

[English](/en/usage/local-migration) | [中文](/zh/usage/local-migration)

无需 sidecar 远程，把当前项目的 Codex 会话在本机不同 `model_provider` 之间迁移，并在 Codex UI 里保持可见。

## 切换 provider 后克隆会话

当你切换 Codex API 来源，希望当前项目的 Codex 会话在新的 `model_provider` 下继续可见时，可以做本机 clone：

```bash
git agent-sync clone-local
git agent-sync clone-local openrouter
git agent-sync clone-local openrouter --no-register
git agent-sync register-local
git agent-sync repair-local
git agent-sync clean-local
git agent-sync clean-local --force
```

省略目标 provider 时，Agent-Sync 会读取 `~/.codex/config.toml` 里的 `model_provider`。克隆后的 rollout 仍写在 `~/.codex/sessions`，会生成稳定的新 session id，并记录 `cloned_from`、`original_provider`、`clone_timestamp` 等元数据。默认还会注册本机 `state_5.sqlite` 和 `session_index.jsonl`，让 Codex UI 能看到克隆会话；如果只想写文件，可以加 `--no-register`。

## 注册与修复

- 运行 `register-local` 可以显式把本机已存在的 Agent-Sync provider 克隆注册进 Codex UI 索引。
- 如果底层文件已存在但 UI 看不到，运行 `repair-local` 会重新注册 Agent-Sync 生成的 provider 克隆。
- `clean-local` 默认只预览当前项目生成的 provider clone；加 `--force` 后才会删除这些 Agent-Sync 生成的 rollout 文件。命令只处理通过结构化项目元数据匹配当前 Git 项目的 Codex 会话或克隆。

## 监控 provider 变化

切换 Codex API provider 时如果希望自动同步：

```bash
git agent-sync watch-local
```

`watch-local` 会轮询 `~/.codex/config.toml`；当 `model_provider` 变化时，它会把当前项目的 Codex 会话克隆到新的 provider。VS Code History 视图里也有 Clone 和 Watch 按钮，会对当前 workspace 执行同样的本机命令。
