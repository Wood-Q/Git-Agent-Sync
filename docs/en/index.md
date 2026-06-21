---
layout: home

hero:
  name: Agent-Sync
  text: A toolbox for your AI coding sessions
  tagline: Sync, migrate, transform, and diagnose your Codex and Claude Code conversations — without ever polluting your source repository. One toolkit for everything around agent sessions.
  image:
    src: /logo.svg
    alt: Agent-Sync logo
  actions:
    - theme: brand
      text: Get Started
      link: /en/usage
    - theme: alt
      text: Concepts
      link: /en/concepts
    - theme: alt
      text: 简体中文
      link: /zh/

features:
  - title: Remote sync
    details: Move project sessions between machines through a private sidecar Git repo. Conversations stay attached to the right branch and commit — never to your source history.
  - title: Local migration
    details: Switch Codex model_provider? clone-local copies current-project Codex sessions to the active provider and registers them in the UI; watch-local keeps doing it automatically.
  - title: Cross-tool transform
    details: Normalize any synced bundle through the Conversation IR and re-emit it as readable Claude or Codex JSONL. Conversations become portable across tools.
  - title: Diagnose & stay safe
    details: doctor checks the whole chain, privacy scans for secrets before any push, conflicts quarantines divergent sessions, and the TUI ties it all together.
---

<section class="landing-section">
  <p class="landing-eyebrow">Why it exists</p>
  <h2>Agent conversations are real work. Treat them like it.</h2>
  <div class="landing-grid">
    <article class="landing-card">
      <h3>Not just syncing</h3>
      <p>Remote sync started it — but the same toolbox now migrates providers locally, transforms sessions across tools, and diagnoses the whole chain.</p>
    </article>
    <article class="landing-card">
      <h3>Structured ownership</h3>
      <p>Sessions are matched by cwd, remote, branch, commit, and workdir — not transcript text. Different projects never cross-contaminate.</p>
    </article>
    <article class="landing-card">
      <h3>Source stays clean</h3>
      <p>Sessions live in a separate .agent-sync-store/ sidecar repo. Your business commits contain only source code.</p>
    </article>
  </div>
</section>

<WorkflowSimulator locale="en" />

<section class="landing-section landing-install">
  <p class="landing-eyebrow">Install</p>
  <h2>The CLI and VS Code extension are ready to use.</h2>
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
