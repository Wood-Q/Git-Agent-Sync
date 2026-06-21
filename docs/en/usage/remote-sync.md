# Remote Sync

[English](/en/usage/remote-sync) | [中文](/zh/usage/remote-sync)

Sync current-project Codex / Claude Code sessions between machines through a private sidecar Git repo. Your business repository only holds source code; sessions never enter business commits.

## First Sync

Create a private repository just for agent sessions:

```text
git@github.com:you/agent-session-store.git
```

Initialize Agent-Sync in a business repository and push the local sessions that belong to it:

```bash
cd your-project
git agent-sync init --remote git@github.com:you/agent-session-store.git
git agent-sync status
git agent-sync push --m "sync current agent sessions"
```

`init` also accepts the remote as the first positional argument:

```bash
git agent-sync init git@github.com:you/agent-session-store.git
```

If the sidecar remote already has a `main` branch and the local `.agent-sync-store/` has no commits, `init` automatically checks out the remote sidecar history. A new project can run `push` directly after `init`; use `pull` later when you want to refresh an existing store.

## Restore On Another Machine

Clone the business project, initialize Agent-Sync with the same sidecar remote, then pull and restore:

```bash
git clone git@github.com:you/your-project.git
cd your-project
git agent-sync init --remote git@github.com:you/agent-session-store.git
git agent-sync pull
git agent-sync log --latest
git agent-sync restore --latest 1
```

Useful restore selectors:

```bash
git agent-sync restore --latest
git agent-sync restore --current
git agent-sync restore --branch main
git agent-sync restore --commit 4f7c2a1
git agent-sync restore --index 1
```

`--latest` matches the latest sidecar sync batch. `--current` matches the current business repo `HEAD` commit, with branch fallback only when no commit binding exists. `--commit` matches the project commit recorded during sync. Branches are historical labels from sync time; they do not follow mutable branch pointers.

To restore the exact sidecar file without local path adaptation:

```bash
git agent-sync restore --current --no-adapt
```

To restore the file without registering it in the Codex UI index:

```bash
git agent-sync restore --current --no-register
```

## Automatic Sync (pre-push hook)

Install a pre-push hook in each project where you want automatic session sync:

```bash
git agent-sync install-hooks
```

After that, normal project pushes enqueue a background Agent-Sync job:

```bash
git push
```

The hook queues a local sync job and starts a background worker instead of running the potentially slow sidecar push inside `git push`. It exits successfully without syncing when `.agent-sync/config.json` or the sidecar Git repo is missing, so it does not block normal project pushes before `init` has been completed.

Remove the hook with:

```bash
git agent-sync uninstall-hooks
```

## Background Queue and Daemon

When two machines push sidecar commits from the same base, Agent-Sync retries non-fast-forward sidecar pushes by fetching `origin/main`, merging the object/event shards, rebuilding event indexes, and pushing again. Unrelated sidecar histories still stop with an explicit error instead of guessing.

You can also manage the queue manually:

```bash
git agent-sync sync --background
git agent-sync sync status
git agent-sync sync --flush
git agent-sync sync retry all
git agent-sync sync cancel all
git agent-sync daemon start
git agent-sync daemon status
git agent-sync daemon stop
```

During a flush, stale `running` jobs left by a crashed daemon are recovered back to `pending` under the sync lock and processed again in the same queue pass.

## Conflict Quarantine

If event replay finds the same agent session id with multiple object hashes, the original objects stay intact and Agent-Sync writes a conflict quarantine record:

```bash
git agent-sync conflicts list
git agent-sync conflicts show 1
git agent-sync conflicts diff 1
git agent-sync conflicts resolve 1 --strategy keep-all
```

`conflicts list` shows active records by default; add `--all` to include resolved history. `conflicts diff` compares quarantined object sizes, line counts, and first differing line without printing raw session content. `resolve` only updates conflict metadata with the chosen strategy (`keep-all`, `keep-latest`, `keep-local`, or `keep-remote`) and optional `--notes`; it does not delete either object. Run `git agent-sync push` afterwards when you want to publish the sidecar metadata.

## Privacy and Redaction

Before pushing, Agent-Sync runs privacy review by default. If common API keys, tokens, or private keys are found, `push` stops and asks you to inspect or redact:

```bash
git agent-sync privacy scan
git agent-sync privacy allow-pattern-local documented_example=sk-example-[a-z]+
git agent-sync push --privacy redact
git agent-sync push --privacy allow
```

`--privacy redact` writes redacted session and object copies to the sidecar store; it does not rewrite your original local agent session files.

Use `.agent-sync/privacy.json` to tune project policy. `denyPatterns` add extra secret rules; `allowPatterns` skip known safe examples or fixtures during both scan and redaction. `git agent-sync privacy allow-pattern-local <name>=<regex>` appends one reviewed local allow rule without hand-editing the JSON file.
