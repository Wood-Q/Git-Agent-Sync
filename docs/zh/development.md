# 开发说明

[English](/en/development) | [中文](/zh/development)

## 源码结构

CLI 入口保持很薄。`src/cli.ts` 只负责命令分发，具体行为拆到按职责划分的 TypeScript 模块：

```text
src/
  args.ts            # CLI 参数与 selector 校验
  agents.ts          # agent 发现与扫描匹配
  bindings.ts        # Git context binding 历史索引
  scan-cache.ts      # 增量扫描缓存
  codex-archive.ts   # Codex 归档识别与缓存
  codex-session.ts   # Codex JSONL 元数据提取与恢复适配
  claude-session.ts  # Claude Code JSONL 元数据提取与恢复适配
  config.ts          # 本地项目配置与项目 identity
  git.ts             # Git root、remote 与工作区上下文
  restore.ts         # restore 流程与目标路径
  store.ts           # sidecar Git store 与 manifest
  utils.ts           # JSON、hash、路径、遍历等共享工具
```

`npm run build` 会把根 CLI 源码编译到 `dist/`。`bin/git-agent-sync.js` 包装入口加载 `dist/cli.js`，根包测试脚本也导入 `dist` 模块，因此本地测试覆盖的是实际打包运行路径。

## 分支规范

日常开发使用 `develop` 分支。功能分支先合入 `develop`，只有准备发版的改动再从 `develop` 合入 `main`。发布 workflow 通过 tag 触发，因此 tag 应该打在 `main` 上已经确认可发布的提交。

## 开发验证

运行完整 MVP 测试：

```bash
npm run test
```

测试内容包括：

- `npm run check`：TypeScript 构建、编译后 JavaScript 语法检查和 `git diff --check`
- `npm run smoke`：CLI 入口帮助输出
- `npm run test:bindings`：v2 `bindings.jsonl` 校验和坏行容错
- `npm run test:codex-session`：Windows / macOS / Linux 风格 Codex 路径适配
- `npm run test:claude-session`：Claude Code 元数据提取、归属判断和恢复路径映射
- `npm run test:scan-cache`：验证未变化 Codex / Claude session 文件会复用本地扫描缓存
- `npm run test:archive-cache`：验证 Codex 归档集合会复用缓存，并在归档状态变化时刷新
- `npm run test:store-promisor`：验证 sidecar sparse checkout 会保留 promisor remote 和 `blob:none` filter 配置
- `npm run test:e2e`：用两个临时业务 clone 和一个 bare sidecar remote 覆盖 `push`、`pull`、`log --current`、`log --branch`、`log --commit`、`restore`、`doctor`，并验证 `.agent-sync-store` 不会被业务仓库跟踪
- `npm run test:vscode`：验证 VS Code adapter 的 CLI path、Windows shim 查找、错误包装、History Webview 操作入口和命令行展示

## 发版检查

下一次 CLI 发版前：

```bash
npm pack --dry-run
```

下一次 VS Code 插件发版前：

```bash
cd extensions/vscode
npm run compile
npx vsce package --no-dependencies
```
