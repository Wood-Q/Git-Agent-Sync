# 发布与发版指南

[English](/en/publishing) | [中文](/zh/publishing)

## npm CLI 包

已发布包：

- 包名：`git-agent-sync`
- 版本：`0.1.3`
- npm：`https://www.npmjs.com/package/git-agent-sync`
- GitHub 仓库：`https://github.com/Wood-Q/Git-Agent-Sync`

安装：

```bash
npm install -g git-agent-sync
```

下一次 CLI 发版时，先提升 `package.json` 里的 `version`，再执行：

```bash
npm view git-agent-sync
npm login
npm whoami
npm run test
npm pack --dry-run
npm publish --access public
```

如果发布时报：

```text
Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

说明 npm 要求当前发布操作使用账号 2FA，或使用开启了 bypass 2FA 的 granular access token。推荐先在 npm 账号设置里开启 2FA，保存 recovery codes，然后重新登录并发布：

```bash
npm publish --access public --otp <当前一次性验证码>
```

CI 通过 `.github/workflows/release-npm.yml` 发布。先在 GitHub 仓库里配置 `NPM_TOKEN` secret，并确保它对 `git-agent-sync` 有发布权限；之后可以手动运行 workflow，或者在版本提交合入 `main` 后推送 release tag：

```bash
git tag v0.1.4
git push origin v0.1.4
```

npm 包只包含 `bin/`、`src/`、根目录 README 和 `LICENSE`；文档站点通过 GitHub Pages 单独发布，不进入 npm tarball。

## VS Code 插件

扩展元数据（`extensions/vscode/package.json`）：

- 扩展包名：`agent-sync-vscode`
- Marketplace 显示名：`Git Agent Sync`
- 版本：跟随 `extensions/vscode/package.json` 的 `version`（与 CLI 同步发版）
- Publisher：`mokio`
- 扩展 ID：`mokio.agent-sync-vscode`
- GitHub 仓库：`https://github.com/Wood-Q/Git-Agent-Sync`

插件默认调用用户 `PATH` 里的 `agent-sync` CLI。Windows 下还会检查常见 npm 全局安装目录，并支持 npm 生成的 `agent-sync.cmd` shim。如果 CLI 安装在其他位置，用户可以通过 `agentSync.cliPath` 配置。

> **当前发布状态**：VS Code 扩展**暂不通过 CI 自动发布到 Marketplace**（Marketplace 发布需要注册 Microsoft 组织并绑定支付方式）。下面的手动流程仍然可用——本地打包成 `.vsix` 后可以侧载安装（`code --install-extension agent-sync-vscode.vsix`），或在你完成 Microsoft 发布者注册后再用 `vsce publish` 推送。

手动打包时，先提升 `extensions/vscode/package.json` 里的 `version`，再编译打包：

```bash
cd extensions/vscode
npm ci
npm run compile
npx vsce package --no-dependencies      # 产出 agent-sync-vscode-<version>.vsix
code --install-extension agent-sync-vscode-<version>.vsix   # 本地侧载
```

如果之后要正式发布到 Marketplace，需要先完成 Microsoft 发布者注册并登录：

```bash
npx vsce login mokio
npx vsce publish
```

已经发布到 Marketplace 的版本不能覆盖。修改 `displayName`、`icon`、README、命令、配置或代码后，需要提升 `extensions/vscode/package.json` 里的 `version`，再发布或重新打包新版本。

## 公开发布前隐私检查

推送 release tag 前，先扫描仓库和打包内容：

```bash
rg -n "(token|secret|password|_authToken|BEGIN .*PRIVATE KEY|/Users/|C:\\\\Users\\\\|AppData|\\.npmrc)" .
npm pack --dry-run
```

包名、GitHub 仓库地址、Marketplace publisher 等真实发布元数据应保留；需要替换的是本机路径、私有 remote、个人账号标识、token，以及原始 agent session 文件。

## GitHub Pages 检查

当前仓库的 Pages 地址是 `https://wood-q.github.io/Git-Agent-Sync/`，因此 `docs/.vitepress/config.mts` 必须保持 `base: "/Git-Agent-Sync/"`。如果后续仓库名或 Pages 地址变化，需要同时更新 VitePress `base`、`docs/index.md` 根路径跳转、favicon URL 和 Open Graph 图片 URL，再重新部署。

Marketplace 图标来自插件 manifest：

```json
{
  "icon": "resources/marketplace-icon.png"
}
```

VS Code Marketplace 扩展图标必须是包含在扩展包里的 PNG 文件。命令或菜单图标仍然可以使用 `resources/icons/` 里的 SVG。
