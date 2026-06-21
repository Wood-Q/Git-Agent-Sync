# Terminal TUI

[English](/en/usage/tui) | [中文](/zh/usage/tui)

Bring the common workflows together in one terminal menu.

## Launch

```bash
git agent-sync tui
git agent-sync tui --cn
```

## Three Workspaces

The TUI is a native single-key fullscreen toolbox organized into three workspaces along the four capability tracks:

- **Remote Sync**: `push`, `pull`, `restore` (with a session browser), `log`, `init`, `install-hooks`
- **Local Transfer**: `clone-local`, `register-local`, `watch-local`, and bundle migration to Claude/Codex JSONL
- **Doctor**: `doctor` health check and session `status`

## Controls

Large headers are generated with `figlet` and colored through `gradient-string` when the terminal supports color.

- Use `↑/↓` to move, `Enter` to run, hotkeys to jump, `q` to go back, `→/Tab` to switch workspaces, and `h` for help.
- `log` and `restore` open a session browser that lists every synced session with its number, so you never guess an index — `restore` confirms and restores the picked index.
- Write actions (push, init, install-hooks, restore) ask for confirmation before running.
- English by default, `--cn` for Chinese.
- The VS Code History view's TUI button opens the same menu in an integrated terminal.

For finer-grained capabilities like the sync queue, daemon, privacy scanning, or conflict resolution, use the matching CLI subcommands directly (see [Remote Sync](/en/usage/remote-sync)).
