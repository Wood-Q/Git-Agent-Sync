<p align="center">
  <img src="logo.svg" alt="Agent-Sync logo" width="160">
</p>

# Agent-Sync

[English](README.md) | [中文](README.zh-CN.md)

**Agent-Sync** is a toolbox for everything around your AI coding-agent conversations — not just syncing them.

Codex and Claude Code sessions hold real work: design notes, debugging threads, command history, tool calls. That work normally dies on the machine where it was created. Agent-Sync finds those conversations, treats them as first-class project artifacts, and gives you one toolkit to **sync, migrate, transform, and diagnose** them — without ever polluting your source-code repository.

> Git for your AI coding sessions — and a Swiss-army knife for everything around them.

## Four things it does

| Capability | What it means |
| --- | --- |
| **Remote sync** | Move project sessions between machines through a private sidecar Git repo. `push` / `pull` / `restore` keep conversations attached to the right branch and commit. |
| **Local migration** | Switch Codex `model_provider`? `clone-local` copies current-project Codex sessions to the active provider and registers them in the local UI. `watch-local` keeps doing it automatically. |
| **Cross-tool transform** | Turn a Codex bundle into readable Claude JSONL (or vice-versa) through the Conversation IR. `tool inspect` / `convert` / `export` make conversations portable across tools. |
| **Diagnose & operate** | `doctor` checks the whole chain. `privacy` scans for secrets before any push. `conflicts` quarantines divergent sessions. The TUI ties it all together. |

## Install

CLI package:

```bash
npm install -g git-agent-sync
```

VS Code extension:

- Marketplace: [Git Agent Sync](https://marketplace.visualstudio.com/items?itemName=mokio.agent-sync-vscode)
- Extension ID: `mokio.agent-sync-vscode`

Local development:

```bash
git clone https://github.com/Wood-Q/Git-Agent-Sync.git
cd Git-Agent-Sync
npm install
npm link
git agent-sync --help
npm test
```

The full test suite covers CLI, daemon, privacy, TUI, E2E, and the VS Code adapter.

## The TUI

```bash
git agent-sync tui          # English
git agent-sync tui --cn     # 中文
```

A fast, full-screen terminal UI (raw single-key, figlet + gradient headers) with three workspaces:

- **Remote Sync** — `push`, `pull`, `restore` (with a session browser), `log`, `init`, `install-hooks`
- **Local Transfer** — clone Codex to current provider, register clones, watch provider changes, migrate a bundle to Claude/Codex JSONL
- **Doctor** — `doctor` health check, session `status`

`↑/↓` to move, `Enter` to run, hotkeys to jump, `q` to go back. `log` and `restore` open a browser that shows every synced session (with its number) so you never have to guess an index.

## Remote sync workflow

Create a private repository just for agent sessions, e.g. `git@github.com:you/agent-session-store.git`.

On the machine that already has useful sessions:

```bash
cd your-project
git agent-sync init --remote git@github.com:you/agent-session-store.git
git agent-sync status
git agent-sync push
```

On another machine:

```bash
git clone git@github.com:you/your-project.git
cd your-project
git agent-sync init --remote git@github.com:you/agent-session-store.git
git agent-sync pull
git agent-sync log --latest
git agent-sync restore --latest 1
```

Sync automatically before normal project pushes — the hook queues a background job instead of running inline:

```bash
git agent-sync install-hooks
git push
git agent-sync sync status     # watch the queue
git agent-sync daemon start    # or run a background worker
```

## Local migration (no remote needed)

When you switch Codex `model_provider` locally, your existing sessions stay under the old provider and disappear from the UI. Agent-Sync clones them to the active provider without touching the sidecar remote:

```bash
git agent-sync clone-local              # clone current-project Codex sessions to the active provider
git agent-sync register-local           # register the clones in local Codex indexes
git agent-sync watch-local              # keep syncing as the provider changes
```

## Cross-tool transform

Every synced bundle can be normalized through the **Conversation IR** and re-emitted for another tool:

```bash
git agent-sync tool inspect  --session <bundle-id>                       # summarize as IR
git agent-sync tool convert  --session <bundle-id> --to ir --json        # full IR
git agent-sync tool export   --session <bundle-id> --to claude --mode readable
git agent-sync tool export   --session <bundle-id> --to codex  --mode readable
```

`readable` exports a clean cross-tool view; `resumable` is only reported when the target tool can actually accept the schema, indexes, and dependencies.

## How it works

Agent-Sync treats conversations as Git-adjacent artifacts, not source files. It keeps a local config in `.agent-sync/` and a separate sidecar Git repo in `.agent-sync-store/`.

Project ownership is conservative: sessions are matched by **structured metadata** (Codex `state_5.sqlite` thread fields; Claude `cwd` / git fields / tool-use `workdir`). Transcript text alone never proves a session belongs to the current project, so different projects never cross-contaminate.

Each `push` writes content-addressed objects + an append-only event log + a Git-context binding (branch, `HEAD`, dirty state, sync message). `pull` fetches them; `restore` writes sessions back into the local agent directory, adapting source-machine paths. If replay detects one session id mapping to multiple object hashes, it writes a non-destructive **conflict quarantine** you resolve with `conflicts`.

Detailed internals: [Concepts](https://wood-q.github.io/Git-Agent-Sync/en/concepts) · [Execution Flow](https://wood-q.github.io/Git-Agent-Sync/en/execution-flow).

## Commands

| Area | Command | Purpose |
| --- | --- | --- |
| **Setup** | `init [--remote <url>]` | Initialize local config and sidecar store |
| | `status` / `scan` | Show / scan matching sessions |
| | `doctor` | Health-check the whole chain |
| **Remote** | `push [--m <msg>] [--privacy review\|redact\|allow\|off]` | Snapshot sessions into the sidecar store and push |
| | `pull` | Pull sidecar snapshots for this project |
| | `sync --background\|--flush\|status\|retry\|cancel` | Background sync queue |
| | `daemon start\|status\|stop` | Local background worker |
| | `log` / `show` / `restore` | Browse and restore by latest / current / branch / commit / index |
| | `install-hooks` / `uninstall-hooks` | Pre-push auto-sync hook |
| **Local** | `clone-local [provider]` | Clone Codex sessions to a provider |
| | `watch-local [--once]` | Watch provider changes and auto-clone |
| | `register-local` / `repair-local` / `clean-local` | Manage local clones |
| **Transform** | `tool inspect\|convert --session <id>` | Conversation IR |
| | `tool export --to codex\|claude` | Cross-tool readable JSONL |
| **Safety** | `privacy scan\|redact\|allow-pattern-local` | Secret scanning and redaction |
| | `conflicts list\|show\|diff\|resolve` | Quarantined conflict review |
| **UI** | `tui [--cn]` | Terminal toolbox |

Run `git agent-sync --help` for the full, exact syntax.

## Documentation

Full docs live on **[GitHub Pages](https://wood-q.github.io/Git-Agent-Sync/)**:

- [Usage Guide](https://wood-q.github.io/Git-Agent-Sync/en/usage) · [中文](https://wood-q.github.io/Git-Agent-Sync/zh/usage)
- [Concepts](https://wood-q.github.io/Git-Agent-Sync/en/concepts) · [中文](https://wood-q.github.io/Git-Agent-Sync/zh/concepts)
- [Execution Flow](https://wood-q.github.io/Git-Agent-Sync/en/execution-flow) · [中文](https://wood-q.github.io/Git-Agent-Sync/zh/execution-flow)
- [Development](https://wood-q.github.io/Git-Agent-Sync/en/development) · [中文](https://wood-q.github.io/Git-Agent-Sync/zh/development)
- [Release & Publishing](https://wood-q.github.io/Git-Agent-Sync/en/publishing) · [中文](https://wood-q.github.io/Git-Agent-Sync/zh/publishing)
- [VS Code Extension](extensions/vscode/README.md)

## Security

`push` defaults to `--privacy review`, which blocks when common secrets (tokens, keys, private keys) are detected. Inspect with `privacy scan`, allow reviewed false positives with `privacy allow-pattern-local <name>=<regex>`, or write redacted copies with `push --privacy redact`. Project-level `.agent-sync/privacy.json` adds `denyPatterns` / `allowPatterns`. Conversation files may still contain code snippets, local paths, prompts, and terminal output. Agent-Sync never copies Claude account, token, global config, cache, telemetry, plugin, skill, IDE lock, or runtime state. **Use a private remote for the sidecar store.**

## License

MIT
