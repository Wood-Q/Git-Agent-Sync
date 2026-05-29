# Release and Publishing

[English](publishing.md) | [中文](publishing.zh-CN.md)

## npm CLI Package

Published package:

- Package: `git-agent-sync`
- Version: `0.1.0`
- npm: `https://www.npmjs.com/package/git-agent-sync`
- Repository: `https://github.com/Wood-Q/Git-Agent-Sync`

Install:

```bash
npm install -g git-agent-sync
```

For the next CLI release, bump `package.json` `version`, then run:

```bash
npm view git-agent-sync
npm login
npm whoami
npm run test
npm pack --dry-run
npm publish --access public
```

If `npm publish` fails with a 403 that says two-factor authentication or a granular access token with bypass 2FA is required, enable 2FA on the npm account and retry with:

```bash
npm publish --access public --otp <code>
```

For CI/CD, use npm trusted publishing or a granular read/write token that has bypass 2FA enabled.

## VS Code Extension

Published extension:

- Extension package: `agent-sync-vscode`
- Marketplace display name: `Git Agent Sync`
- Version: `0.1.3`
- Publisher: `mokio`
- Extension ID: `mokio.agent-sync-vscode`
- Marketplace: `https://marketplace.visualstudio.com/items?itemName=mokio.agent-sync-vscode`
- Repository: `https://github.com/Wood-Q/Git-Agent-Sync`

The extension calls the `agent-sync` CLI from `PATH` by default. On Windows it also checks common npm global install locations and supports npm's `agent-sync.cmd` shim. Users can override the executable with the `agentSync.cliPath` setting.

For the next extension release, bump `extensions/vscode/package.json` `version`, then build and publish:

```bash
cd extensions/vscode
npm ci
npm run compile
npx vsce package --no-dependencies
npx vsce login mokio
npx vsce publish
```

Published Marketplace versions cannot be overwritten. Any change to `displayName`, `icon`, README, commands, configuration, or code requires bumping `extensions/vscode/package.json` `version` and publishing a new version.

The Marketplace icon comes from the extension manifest:

```json
{
  "icon": "resources/marketplace-icon.png"
}
```

VS Code Marketplace extension icons must be PNG files included in the extension package. Command/menu icons can still use the SVG files under `resources/icons/`.
