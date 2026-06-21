# Platform Roadmap

[English](/en/agent-conversation-platform) | [中文](/zh/agent-conversation-platform)

Agent-Sync started as "sync AI coding sessions to another machine", but those sessions deserve to be treated as first-class project artifacts. This page records where the project is heading: from a single remote-sync tool into a full toolbox around code-agent conversations.

## Four capability tracks

- **Remote sync**: move project sessions between machines through a private sidecar Git repo, with conversations attached to the right branch and commit. This is where the project started and remains the core.
- **Local migration**: when switching Codex `model_provider`, `clone-local` / `watch-local` / `register-local` carry sessions across providers without touching the remote.
- **Cross-tool transform**: the Conversation IR normalizes Codex and Claude Code sessions and re-emits them as readable JSONL for the other tool, so conversations are not locked into one agent.
- **Diagnose & operate**: `doctor` checks the chain, `privacy` scans for secrets before push, `conflicts` quarantines divergent sessions, and the TUI ties every capability into one terminal toolbox.

## What has already landed

- **Event & object store**: the sidecar evolved from "bundle snapshots + bindings" into "content-addressed objects + append-only events + rebuildable indexes", laying the groundwork for concurrent multi-machine sync and conflict quarantine.
- **Conversation IR**: a unified cross-tool intermediate representation that distinguishes `readable` views from `resumable` handoff — resumable is only reported when the target tool can actually accept the schema, indexes, and dependencies.
- **Background sync queue & daemon**: the pre-push hook enqueues sync to a background worker, and stale `running` jobs left by a crashed daemon are recovered under the lock.
- **TUI rebuild**: the complex React Ink multi-view UI was simplified into a native single-key fullscreen toolbox modeled on codex-session-cloner, exposing only the common actions.

## Where it is heading

These are directions on the roadmap — not ordered, not all guaranteed:

- **Resumable handoff**: once a target tool can accept the full schema, provider/runtime context, and dependencies, make the `resumable` path of `tool export` real, not just readable.
- **Query-path migration**: gradually move the primary `log` / `show` / `restore` read path from the compatibility bundle indexes to the event-derived rebuildable indexes.
- **Default encryption**: provide default encryption and redaction before sidecar remote push, reducing risk beyond a private remote.
- **More agents**: onboard more code-agent session sources while preserving the structured-ownership principle.
- **VS Code & TUI parity**: expose the same four capabilities from both the extension and the TUI, closing the gap between CLI and UI.

## Principles

Whatever evolves, these stay constant:

- **Source repo stays clean**: sessions always go to a separate sidecar repo, never into business commits.
- **Structured ownership**: a session belongs to a project only by structured metadata, never by transcript text.
- **Non-destructive by default**: conflicts are quarantined, not overwritten; redaction only touches copies, never originals.
- **Private by default**: the sidecar remote should be private; secrets and account state are never synced.

If a direction here is relevant to your use case, feedback is welcome on [GitHub Issues](https://github.com/Wood-Q/Git-Agent-Sync/issues).
