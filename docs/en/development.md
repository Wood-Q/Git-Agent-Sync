# Development

[English](/en/development) | [中文](/zh/development)

## Source Layout

The CLI entrypoint is intentionally small. `src/cli.js` handles command dispatch, while the behavior lives in focused modules:

```text
src/
  args.js            # CLI argument and selector validation
  agents.js          # Agent discovery and scan matching
  bindings.js        # Git context binding history
  scan-cache.js      # Incremental session scan cache
  codex-archive.js   # Codex archived-session detection and cache
  codex-session.js   # Codex JSONL metadata extraction and restore adaptation
  claude-session.js  # Claude Code JSONL metadata extraction and restore adaptation
  config.js          # Local project config and identity
  git.js             # Git root, remote, and worktree context
  restore.js         # Restore flow and target paths
  store.js           # Sidecar Git store and manifest
  utils.js           # Shared JSON, hash, path, and walk helpers
```

## Branching

Use `develop` for day-to-day development. Open pull requests from feature branches into `develop`, then merge `develop` into `main` only for release-ready changes. The release workflows publish from tags, so tagging should happen after the release commit is on `main`.

## Verification

Run the full MVP test suite:

```bash
npm run test
```

The suite includes:

- `npm run check`: JavaScript syntax checks and `git diff --check`.
- `npm run smoke`: CLI entrypoint help output.
- `npm run test:bindings`: v2 `bindings.jsonl` validation and invalid-line handling.
- `npm run test:codex-session`: Windows / macOS / Linux style Codex path adaptation.
- `npm run test:claude-session`: Claude Code metadata extraction, ownership checks, and restore path mapping.
- `npm run test:scan-cache`: unchanged Codex and Claude session files are reused from the local scan cache.
- `npm run test:archive-cache`: archived Codex session sets are reused until archive state changes.
- `npm run test:store-promisor`: sidecar sparse checkout keeps its promisor remote and `blob:none` filter configuration.
- `npm run test:e2e`: two temporary project clones plus a bare sidecar remote, covering `push`, `pull`, `log --current`, `log --branch`, `log --commit`, `restore`, `doctor`, and verification that `.agent-sync-store` is not tracked by the business repo.

## Release Checks

Before the next CLI release:

```bash
npm pack --dry-run
```

Before the next VS Code extension release:

```bash
cd extensions/vscode
npm run compile
npx vsce package --no-dependencies
```
