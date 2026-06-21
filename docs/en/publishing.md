# Release and Publishing

[English](/en/publishing) | [中文](/zh/publishing)

## npm CLI Package

Published package:

- Package: `git-agent-sync`
- Version: `0.1.3`
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

CI publishes from `.github/workflows/release-npm.yml`. Configure the repository secret `NPM_TOKEN` with publish permission for `git-agent-sync`, then publish either by running the workflow manually or by pushing a release tag after the version bump is on `main`:

```bash
git tag v0.1.4
git push origin v0.1.4
```

The npm package intentionally includes only `bin/`, `src/`, the root READMEs, and `LICENSE`; the documentation site is published separately through GitHub Pages.

## VS Code Extension

Published extension:

- Extension package: `agent-sync-vscode`
- Marketplace display name: `Git Agent Sync`
- Version: tracks `extensions/vscode/package.json` `version` (released in lockstep with the CLI)
- Publisher: `mokio`
- Extension ID: `mokio.agent-sync-vscode`
- Marketplace: `https://marketplace.visualstudio.com/items?itemName=mokio.agent-sync-vscode`
- Repository: `https://github.com/Wood-Q/Git-Agent-Sync`

The extension calls the `agent-sync` CLI from `PATH` by default. On Windows it also checks common npm global install locations and supports npm's `agent-sync.cmd` shim. Users can override the executable with the `agentSync.cliPath` setting.

> **Current release status**: The VS Code extension is **not published to the Marketplace via CI** (Marketplace publishing requires registering a Microsoft organization with a payment method). The manual flow below still works — package a `.vsix` locally and sideload it (`code --install-extension agent-sync-vscode.vsix`), or run `vsce publish` yourself once you have completed the Microsoft publisher registration.

For manual packaging, bump `extensions/vscode/package.json` `version`, then build and package:

```bash
cd extensions/vscode
npm ci
npm run compile
npx vsce package --no-dependencies      # produces agent-sync-vscode-<version>.vsix
code --install-extension agent-sync-vscode-<version>.vsix   # local sideload
```

To publish to the Marketplace later, first complete the Microsoft publisher registration and log in:

```bash
npx vsce login mokio
npx vsce publish
```

Published Marketplace versions cannot be overwritten. Any change to `displayName`, `icon`, README, commands, configuration, or code requires bumping `extensions/vscode/package.json` `version` and publishing (or repackaging) a new version.

## Public Release Privacy Check

Before pushing release tags, scan the repository and package contents:

```bash
rg -n "(token|secret|password|_authToken|BEGIN .*PRIVATE KEY|/Users/|C:\\\\Users\\\\|AppData|\\.npmrc)" .
npm pack --dry-run
```

Keep real publishing metadata such as package names, repository URLs, and Marketplace publisher IDs. Replace only local-machine paths, private remotes, account identifiers, tokens, and raw agent session artifacts.

## GitHub Pages Checks

This repository is served at `https://wood-q.github.io/Git-Agent-Sync/`, so `docs/.vitepress/config.mts` must keep `base: "/Git-Agent-Sync/"`. If the repository name or Pages URL changes, update the VitePress `base`, root redirect in `docs/index.md`, favicon URL, and Open Graph image URL together before deploying.

The Marketplace icon comes from the extension manifest:

```json
{
  "icon": "resources/marketplace-icon.png"
}
```

VS Code Marketplace extension icons must be PNG files included in the extension package. Command/menu icons can still use the SVG files under `resources/icons/`.
