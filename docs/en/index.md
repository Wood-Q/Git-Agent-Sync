---
layout: home

hero:
  name: Agent-Sync
  text: Git for your AI coding sessions
  tagline: Carry local Codex and Claude Code project conversations to another machine like you carry source code. Your business repository stays clean while session history moves through a separate private sidecar Git repository.
  image:
    src: /logo.svg
    alt: Agent-Sync logo
  actions:
    - theme: brand
      text: Get Started
      link: /en/usage
    - theme: alt
      text: Execution Flow
      link: /en/execution-flow
    - theme: alt
      text: 简体中文
      link: /zh/

features:
  - title: Keep sessions out of source commits
    details: Agent-Sync creates an independent .agent-sync-store/ sidecar Git repository, so source commits stay focused on source code.
  - title: Match only current-project sessions
    details: Codex and Claude Code sessions are matched through structured metadata such as cwd, remote, branch, commit, and workdir. Transcript text is not ownership proof.
  - title: Restore context across machines
    details: After pull, restore by latest sync, current commit, branch, commit, bundle id, or log index, with local path and shell adaptation.
---

<section class="landing-section">
  <p class="landing-eyebrow">Why it exists</p>
  <h2>Code can move with clone. AI coding sessions should move with the project too.</h2>
  <div class="landing-grid">
    <article class="landing-card">
      <h3>Keep context when switching machines</h3>
      <p>Design notes, debugging trails, and command history from one machine can be pulled and restored on another.</p>
    </article>
    <article class="landing-card">
      <h3>Use familiar Git-style commands</h3>
      <p>Work with init, status, push, pull, log, show, and restore as a Git subcommand.</p>
    </article>
    <article class="landing-card">
      <h3>Keep privacy boundaries clear</h3>
      <p>Scan project conversation JSONL files and required indexes, while skipping accounts, global settings, cache, telemetry, plugins, and runtime files.</p>
    </article>
  </div>
</section>

<section class="landing-section">
  <p class="landing-eyebrow">Workflow</p>
  <h2>Initialize once, then let code and agent context travel side by side.</h2>
  <div class="landing-flow">
    <div class="flow-step">
      <strong>1. init</strong>
      <span>Connect a private session store and generate the current project identity.</span>
    </div>
    <div class="flow-step">
      <strong>2. push</strong>
      <span>Scan current-project sessions, write them into the sidecar store, and record Git context.</span>
    </div>
    <div class="flow-step">
      <strong>3. pull</strong>
      <span>Fetch project snapshots from the sidecar store on another machine.</span>
    </div>
    <div class="flow-step">
      <strong>4. restore</strong>
      <span>Restore Codex or Claude Code sessions by latest, current, branch, or commit selector.</span>
    </div>
  </div>
</section>

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
