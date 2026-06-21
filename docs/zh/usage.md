# 使用指南

[English](/en/usage) | [中文](/zh/usage)

Agent-Sync 是围绕 AI 编程 agent 对话的全能工具箱。安装后，按你想做的事情挑对应的功能页。

## 安装

CLI 包已经发布到 npm：

```bash
npm install -g git-agent-sync
```

VS Code 插件已经发布到 Marketplace：

- Marketplace：[Git Agent Sync](https://marketplace.visualstudio.com/items?itemName=mokio.agent-sync-vscode)
- 扩展 ID：`mokio.agent-sync-vscode`

插件会从 `agentSync.cliPath` 调用 CLI，默认命令是 `agent-sync`。Windows 下还会检查常见 npm 全局安装目录，并支持 npm 生成的 `agent-sync.cmd` shim。History 视图顶部工具栏可以对当前 workspace 执行 pull、push、查看同步状态、隐私扫描、添加隐私 allow pattern、列出/diff/resolve sidecar 冲突、Conversation IR 检查、本机 provider clone / register / clean、打开 TUI、刷新、搜索或清空筛选、show bundle 详情和恢复会话；Command Palette 还提供后台同步、队列 flush/retry/cancel、daemon 状态、register-local、repair-local、clean-local 预览、隐私脱敏预览、隐私 allow pattern、冲突 diff/resolve、show bundle 和 readable tool export。

本地开发阶段：

```bash
cd ~/Agent-Sync
npm install
npm link
git agent-sync --help
```

## 功能导览

按能力主线组织。点进每个页面查看完整用法。

- **[远程同步](/zh/usage/remote-sync)** —— 通过私有 sidecar 仓库在多机之间 `push` / `pull` / `restore`，含自动同步 hook、后台队列、冲突隔离和隐私脱敏。
- **[本地迁移](/zh/usage/local-migration)** —— 切换 Codex `model_provider` 时，在本机克隆、注册、监控会话，无需远程仓库。
- **[跨工具转换](/zh/usage/cross-tool)** —— 用 Conversation IR 检查 bundle，并在 Codex / Claude 之间互导为可读 JSONL。
- **[终端 TUI](/zh/usage/tui)** —— 三工作区的全屏单键工具箱（远程 / 本地 / 诊断）。
- **[自定义会话路径](/zh/usage/custom-paths)** —— 用环境变量覆盖默认的 Codex / Claude 会话根目录。

## 排查问题

优先运行：

```bash
git agent-sync doctor
```

`doctor` 会报告 sidecar remote 是否可达、sidecar store 是否启用 sparse checkout、`manifest.json` 和 `bindings.jsonl` 是否可读，以及当前能看到多少本地 agent session 文件。

如果 `pull` 提示没有 remote，重新初始化并传入远程仓库：

```bash
git agent-sync init --remote git@github.com:yourname/agent-session-store.git
```

如果旧版本曾经报“当前分支没有跟踪信息”，升级后重新运行 `git agent-sync pull`。当前版本会自动 fetch `origin/main`，在需要时创建或绑定本地 `main -> origin/main`，然后执行 fast-forward pull。

如果 `push` 或 `pull` 提示 sidecar 历史无关，说明本地 `.agent-sync-store/` 已经有提交，并且这些提交和配置的 sidecar remote 没有共同祖先。先备份 `.agent-sync-store/`，再显式用 Git 合并两段历史，或把 sidecar store 重置到远端后重新同步。

如果 `pull` 成功但没有显示可恢复会话，运行：

```bash
git agent-sync doctor
find .agent-sync-store/projects -maxdepth 2 -name manifest.json -print
```

这可以确认远程 store 里是否有当前项目 identity 或旧版 legacy id 对应的 bundle。
