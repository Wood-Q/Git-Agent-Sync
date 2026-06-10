# Execution Flow

[English](/en/execution-flow) | [中文](/zh/execution-flow)

This page summarizes the internal flow. The Chinese version contains the most detailed step-by-step notes.

## 1. Init

`git agent-sync init` resolves the business Git root, creates `.agent-sync/config.json`, computes a cross-platform project identity, and prepares `.agent-sync-store/` as an independent sidecar Git repository. If a remote is provided, it is attached to the sidecar store rather than the business repository. When the remote already has `main` and the local sidecar store has no commits, init checks out `origin/main` so the first `push` appends to the existing sidecar history.

## 2. Scan

`status`, `scan`, and `push` discover Codex and Claude Code sessions. Codex discovery prefers `state_5.sqlite` thread records and `rollout_path` before falling back to JSONL metadata. Claude discovery scans project JSONL files under `~/.claude/projects/`.

Each candidate session is accepted only when structured metadata points at the current project and does not point at another project.

## 3. Push

`push` copies accepted session files into `.agent-sync-store/projects/<project-id>/`, updates `manifest.json`, appends `bindings.jsonl`, rebuilds `bindings.idx.json`, commits the sidecar store, and pushes the sidecar remote when configured.

The binding records the business repo branch, `HEAD` commit, dirty state, bundle id, titles, and optional sync message.

## 4. Pull

`pull` fetches the sidecar remote and fast-forwards the local sidecar store. When a remote is configured, sparse checkout keeps this project's full bundle and lightweight manifests for other projects.

## 5. Query

`log` and `show` read `bindings.jsonl`, `bindings.idx.json`, and `manifest.json` to select sessions by latest sync batch, current commit, historical branch label, recorded commit, bundle id, or index.

## 6. Restore

`restore` selects bundles, verifies that they are compatible with the current project identity, maps paths from the source machine to the current machine when adaptation is enabled, and writes the restored session into the current Codex or Claude Code session root.

Codex restores can also be registered in local UI indexes so the session appears in the Codex plugin/App.

## 7. Doctor

`doctor` checks the Git project root, local config, sidecar store, remote reachability, branch/upstream state, manifests, bindings, agent session roots, current project identity, legacy ids, and archived Codex session visibility.
