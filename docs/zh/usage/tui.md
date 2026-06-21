# 终端 TUI

[English](/en/usage/tui) | [中文](/zh/usage/tui)

把常用流程集中在一个终端菜单里。

## 启动

```bash
git agent-sync tui
git agent-sync tui --cn
```

## 三个工作区

TUI 是一个原生单键全屏工具箱，按四条能力主线分成三个工作区：

- **远程同步**：`push`、`pull`、`restore`（带会话浏览器）、`log`、`init`、`install-hooks`
- **本地迁移**：`clone-local`、`register-local`、`watch-local`、把 bundle 迁移成 Claude/Codex JSONL
- **诊断**：`doctor` 健康检查、会话 `status`

## 操作

大字标题由 `figlet` 生成，终端支持颜色时用 `gradient-string` 渲染渐变。

- `↑/↓` 移动、`Enter` 执行、热键直达、`q` 返回、`→/Tab` 切换工作区、`h` 帮助。
- `log` 和 `restore` 会打开会话浏览器，逐条展示所有已同步会话（带编号），不用再猜编号——`restore` 选中后确认即恢复对应编号。
- 写操作（push、init、install-hooks、restore）会在执行前二次确认。
- 默认英文，`--cn` 启用中文。
- VS Code History 视图里的 TUI 按钮会在集成终端打开同一个菜单。

需要队列、daemon、隐私扫描、冲突解决等更细的能力时，直接用对应的 CLI 子命令即可（参见 [远程同步](/zh/usage/remote-sync)）。
