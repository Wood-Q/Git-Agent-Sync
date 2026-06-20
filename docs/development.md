# Development

[English](development.md) | [中文](development.zh-CN.md)

## Source Layout

The CLI entrypoint is intentionally small. `src/cli.ts` handles command dispatch, while the behavior lives in focused TypeScript modules:

```text
src/
  args.ts            # CLI argument and selector validation
  agents.ts          # Agent discovery and scan matching
  bindings.ts        # Git context binding history
  scan-cache.ts      # Incremental session scan cache
  codex-archive.ts   # Codex archived-session detection and cache
  codex-session.ts   # Codex JSONL metadata extraction and restore adaptation
  claude-session.ts  # Claude Code JSONL metadata extraction and restore adaptation
  config.ts          # Local project config and identity
  git.ts             # Git root, remote, and worktree context
  restore.ts         # Restore flow and target paths
  store.ts           # Sidecar Git store and manifest
  utils.ts           # Shared JSON, hash, path, and walk helpers
```

`npm run build` compiles the root CLI sources into `dist/`. The `bin/git-agent-sync.js` wrapper loads `dist/cli.js`, and the root test scripts import `dist` modules so local tests exercise the same runtime path that is packaged.

## Branching

Use `develop` for day-to-day development. Open pull requests from feature branches into `develop`, then merge `develop` into `main` only for release-ready changes. The release workflows publish from tags, so tagging should happen after the release commit is on `main`.

## Verification

Run the full MVP test suite:

```bash
npm run test
```

The suite includes:

- `npm run check`: TypeScript build, compiled JavaScript syntax checks, and `git diff --check`.
- `npm run smoke`: CLI entrypoint help output.
- `npm run test:bindings`: v2 `bindings.jsonl` validation and invalid-line handling.
- `npm run test:codex-session`: Windows / macOS / Linux style Codex path adaptation.
- `npm run test:claude-session`: Claude Code metadata extraction, ownership checks, and restore path mapping.
- `npm run test:scan-cache`: unchanged Codex and Claude session files are reused from the local scan cache.
- `npm run test:archive-cache`: archived Codex session sets are reused until archive state changes.
- `npm run test:store-promisor`: sidecar sparse checkout keeps its promisor remote and `blob:none` filter configuration.
- `npm run test:e2e`: two temporary project clones plus a bare sidecar remote, covering `push`, `pull`, `log --current`, `log --branch`, `log --commit`, `restore`, `doctor`, and verification that `.agent-sync-store` is not tracked by the business repo.
- `npm run test:vscode`: VS Code adapter CLI path, Windows shim lookup, error wrapping, History Webview actions, and command-line display.

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
