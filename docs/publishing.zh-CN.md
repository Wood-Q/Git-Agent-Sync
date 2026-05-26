# 发布与发版指南

[English](publishing.md) | [中文](publishing.zh-CN.md)

## npm CLI 包

已发布包：

- 包名：`git-agent-sync`
- 版本：`0.1.0`
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

CI/CD 发布则应使用 npm trusted publishing，或使用有 read/write 权限且开启 bypass 2FA 的 granular access token。

## VS Code 插件

已发布插件：

- 扩展包名：`agent-sync-vscode`
- Marketplace 显示名：`Git Agent Sync`
- 当前插件版本：`0.1.2`
- Publisher：`mokio`
- 扩展 ID：`mokio.agent-sync-vscode`
- Marketplace：`https://marketplace.visualstudio.com/items?itemName=mokio.agent-sync-vscode`
- GitHub 仓库：`https://github.com/Wood-Q/Git-Agent-Sync`

插件默认调用用户 `PATH` 里的 `agent-sync` CLI。如果 CLI 安装在其他位置，用户可以通过 `agentSync.cliPath` 配置。

下一次插件发版时，先提升 `extensions/vscode/package.json` 里的 `version`，再打包发布：

```bash
cd extensions/vscode
npm ci
npm run compile
npx vsce package --no-dependencies
npx vsce login mokio
npx vsce publish
```

已经发布到 Marketplace 的版本不能覆盖。修改 `displayName`、`icon`、README、命令、配置或代码后，需要提升 `extensions/vscode/package.json` 里的 `version`，再发布新版本。

Marketplace 图标来自插件 manifest：

```json
{
  "icon": "resources/marketplace-icon.png"
}
```

VS Code Marketplace 扩展图标必须是包含在扩展包里的 PNG 文件。命令或菜单图标仍然可以使用 `resources/icons/` 里的 SVG。
