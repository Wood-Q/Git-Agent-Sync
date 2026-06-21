---
layout: home

hero:
  name: Agent-Sync
  text: AI 编程会话的全能工具箱
  tagline: 同步、迁移、转换、诊断你的 Codex 和 Claude Code 对话——绝不让它们污染源码仓库。一套工具搞定 agent 会话的方方面面。
  image:
    src: /logo.svg
    alt: Agent-Sync logo
  actions:
    - theme: brand
      text: 快速开始
      link: /zh/usage
    - theme: alt
      text: 概念说明
      link: /zh/concepts
    - theme: alt
      text: English
      link: /en/

features:
  - title: 远程同步
    details: 通过独立的私有 sidecar Git 仓库在多机之间移动项目会话。对话始终绑在正确的分支和 commit 上——绝不进源码历史。
  - title: 本地迁移
    details: 切换 Codex model_provider？clone-local 把当前项目的 Codex 会话克隆到当前 provider 并注册进 UI；watch-local 持续自动完成。
  - title: 跨工具转换
    details: 通过 Conversation IR 把任意已同步 bundle 归一化，再导出为可读的 Claude 或 Codex JSONL。对话跨工具流动。
  - title: 诊断与安全
    details: doctor 检查整条链路，privacy 在推送前扫描密钥，conflicts 隔离分叉会话，TUI 把这一切串起来。
---

<section class="landing-section">
  <p class="landing-eyebrow">为什么需要它</p>
  <h2>Agent 对话是真正的工作成果，理应被这样对待</h2>
  <div class="landing-grid">
    <article class="landing-card">
      <h3>不只是同步</h3>
      <p>远程同步是起点——但同一套工具箱现在还能本地迁移 provider、跨工具转换会话、诊断整条链路。</p>
    </article>
    <article class="landing-card">
      <h3>结构化归属</h3>
      <p>会话靠 cwd、remote、branch、commit、workdir 匹配——不是正文文本。不同项目的会话不会互相污染。</p>
    </article>
    <article class="landing-card">
      <h3>源码保持干净</h3>
      <p>会话存在独立的 .agent-sync-store/ sidecar 仓库里。业务提交只包含源码。</p>
    </article>
  </div>
</section>

<WorkflowSimulator locale="zh" />

<section class="landing-section landing-install">
  <p class="landing-eyebrow">Install</p>
  <h2>CLI 和 VS Code 扩展都已经可以使用</h2>
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
