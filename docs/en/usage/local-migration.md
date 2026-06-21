# Local Migration

[English](/en/usage/local-migration) | [中文](/zh/usage/local-migration)

Move current-project Codex sessions between local `model_provider` values without a sidecar remote, and keep them visible in the Codex UI.

## Clone Sessions After a Provider Switch

Use local clone when you switch Codex API providers and want current-project Codex sessions to appear under the active `model_provider` on the same machine:

```bash
git agent-sync clone-local
git agent-sync clone-local openrouter
git agent-sync clone-local openrouter --no-register
git agent-sync register-local
git agent-sync repair-local
git agent-sync clean-local
git agent-sync clean-local --force
```

When the target provider is omitted, Agent-Sync reads `model_provider` from `~/.codex/config.toml`. The cloned rollout stays in `~/.codex/sessions`, gets a new stable session id, and records `cloned_from`, `original_provider`, and `clone_timestamp` metadata. By default it also registers local `state_5.sqlite` and `session_index.jsonl` entries so the Codex UI can see the clone; use `--no-register` when you only want to write the file.

## Register and Repair

- Run `register-local` to explicitly register Agent-Sync provider clones that already exist on this machine.
- If the file exists but the UI cannot see it, run `repair-local` to re-register Agent-Sync provider clones.
- `clean-local` previews generated current-project provider clones by default; add `--force` to remove only those Agent-Sync clone rollout files. Only sessions that match the current Git project through structured metadata are cloned or cleaned.

## Watch Provider Changes

To keep Codex sessions available while switching API providers:

```bash
git agent-sync watch-local
```

`watch-local` polls `~/.codex/config.toml`; when `model_provider` changes, it clones current-project Codex sessions to the newly active provider. The VS Code History view includes Clone and Watch buttons that run the same local commands for the current workspace.
