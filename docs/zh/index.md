---
layout: home

hero:
  name: Agent-Sync
  text: Git for your AI coding sessions
  tagline: 把 Codex 和 Claude Code 的本地项目会话，像代码一样带到另一台机器。业务仓库保持干净，会话历史进入独立私有 sidecar Git 仓库。
  image:
    src: /logo.svg
    alt: Agent-Sync logo
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/usage
    - theme: alt
      text: 查看执行链路
      link: /zh/execution-flow
    - theme: alt
      text: English
      link: /en/

features:
  - title: 不把会话塞进业务仓库
    details: Agent-Sync 创建独立的 .agent-sync-store/ sidecar Git 仓库，源码提交仍然只包含源码。
  - title: 只同步属于当前项目的会话
    details: Codex 和 Claude Code 会话通过 cwd、remote、branch、commit、workdir 等结构化元数据匹配，正文提到项目名不算归属证据。
  - title: 跨机器恢复上下文
    details: pull 后可以按 latest、current、branch、commit 或 bundle id 恢复，并自动适配当前机器的项目路径和 shell。
---

<section class="landing-section">
  <p class="landing-eyebrow">Why it exists</p>
  <h2>代码能 clone，AI 编程会话也应该能跟着项目走。</h2>
  <div class="landing-grid">
    <article class="landing-card">
      <h3>换机器不丢上下文</h3>
      <p>在一台机器上和 agent 讨论过的设计、调试记录和命令历史，可以在另一台机器拉取并恢复。</p>
    </article>
    <article class="landing-card">
      <h3>Git 风格的操作</h3>
      <p>作为 Git 子命令使用：init、status、push、pull、log、show、restore，习惯不需要重新学习。</p>
    </article>
    <article class="landing-card">
      <h3>隐私边界更清楚</h3>
      <p>只扫描项目会话 JSONL 和必要索引，跳过账号、全局设置、缓存、遥测、插件和运行态文件。</p>
    </article>
  </div>
</section>

<section class="landing-section">
  <p class="landing-eyebrow">Workflow</p>
  <h2>一次初始化，之后让项目和会话并行移动。</h2>
  <div class="landing-flow">
    <div class="flow-step">
      <strong>1. init</strong>
      <span>连接一个私有 session store，生成当前项目 identity。</span>
    </div>
    <div class="flow-step">
      <strong>2. push</strong>
      <span>扫描当前项目会话，写入 sidecar store 并记录 Git 上下文。</span>
    </div>
    <div class="flow-step">
      <strong>3. pull</strong>
      <span>在另一台机器拉取 sidecar store 中的项目快照。</span>
    </div>
    <div class="flow-step">
      <strong>4. restore</strong>
      <span>按 latest、current、branch 或 commit 恢复 Codex / Claude Code 会话。</span>
    </div>
  </div>
</section>

<section class="landing-section landing-install">
  <p class="landing-eyebrow">Install</p>
  <h2>CLI 和 VS Code 扩展都已经可以使用。</h2>
</section>

```bash
npm install -g git-agent-sync
git agent-sync --help
```

```bash
git agent-sync init --remote git@github.com:you/agent-session-store.git
git agent-sync push --m "sync current agent sessions"
git agent-sync restore --latest 1
```
