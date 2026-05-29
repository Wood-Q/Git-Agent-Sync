<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

type Locale = "en" | "zh";
type LaneKey = "project" | "sessions" | "store" | "machine";

interface Step {
  title: string;
  short: string;
  actor: string;
  command: string;
  status: string;
  from: LaneKey;
  to: LaneKey;
  tag: string;
  note: string;
  dataTitle: string;
  data: string[];
  terminal: string[];
}

const props = defineProps<{
  locale?: Locale;
}>();

const laneKeys: LaneKey[] = ["project", "sessions", "store", "machine"];

const copy = {
  zh: {
    eyebrow: "Workflow",
    title: "一次完整同步流程",
    intro: "示例项目是 shop-admin。左侧是时序图，每一步都会出现新的动作；右侧显示这一步写入、读取或改变的具体数据。",
    terminalTitle: "git-agent-sync simulator",
    lanes: {
      project: "业务 Git",
      sessions: "本机会话",
      store: "Sidecar 仓库",
      machine: "另一台机器"
    },
    stepLabel: "STEP",
    prev: "上一步",
    replay: "重播",
    start: "开始",
    pause: "暂停",
    dataLabel: "本步数据变化",
    outputLabel: "终端输出",
    steps: [
      {
        title: "初始化项目",
        short: "生成 project identity",
        actor: "CLI",
        command: "git agent-sync init --remote git@github.com:wood-q/agent-session-store.git",
        status: "completed",
        from: "project",
        to: "store",
        tag: "init",
        note: "工具先读取当前业务仓库 remote，再创建本地配置和独立 sidecar Git 仓库。",
        dataTitle: ".agent-sync/config.json",
        data: [
          "{",
          "  \"projectName\": \"shop-admin\",",
          "  \"projectIdentity\": \"git:github.com/wood-q/shop-admin\",",
          "  \"projectId\": \"shop-admin-a18c4f2d09\",",
          "  \"storePath\": \"/repo/shop-admin/.agent-sync-store\",",
          "  \"remote\": \"git@github.com:wood-q/agent-session-store.git\"",
          "}"
        ],
        terminal: [
          "agent-sync initialized for shop-admin",
          "store: /repo/shop-admin/.agent-sync-store",
          "project id: shop-admin-a18c4f2d09"
        ]
      },
      {
        title: "读取 Git 上下文",
        short: "记录 branch / HEAD / dirty",
        actor: "CLI",
        command: "git rev-parse HEAD && git status --porcelain",
        status: "completed",
        from: "project",
        to: "project",
        tag: "git facts",
        note: "后续恢复时，主要按这里记录的业务 commit 和 branch 找回会话。",
        dataTitle: "current git context",
        data: [
          "{",
          "  \"branch\": \"feature/profile-avatar\",",
          "  \"headCommit\": \"8e21c4a6f3b0c9d4a51e\",",
          "  \"baseCommit\": \"8e21c4a6f3b0c9d4a51e\",",
          "  \"dirty\": true",
          "}"
        ],
        terminal: [
          "branch feature/profile-avatar",
          "HEAD 8e21c4a6f3b0",
          "worktree has uncommitted UI changes"
        ]
      },
      {
        title: "读取 Codex 索引",
        short: "从 state_5.sqlite 定位线程",
        actor: "Codex",
        command: "git agent-sync status",
        status: "completed",
        from: "sessions",
        to: "project",
        tag: "codex state",
        note: "Codex 优先使用 state_5.sqlite 的 threads 表，而不是全文搜索聊天内容。",
        dataTitle: "state_5.sqlite / threads",
        data: [
          "{",
          "  \"id\": \"thread_7f4a\",",
          "  \"title\": \"profile avatar upload\",",
          "  \"cwd\": \"/repo/shop-admin\",",
          "  \"git_origin_url\": \"git@github.com:wood-q/shop-admin.git\",",
          "  \"git_branch\": \"feature/profile-avatar\",",
          "  \"rollout_path\": \"~/.codex/sessions/2026/05/29/thread_7f4a.jsonl\"",
          "}"
        ],
        terminal: [
          "codex state: ok",
          "1 thread matched by git_origin_url",
          "archived sessions skipped"
        ]
      },
      {
        title: "读取 Claude 项目 JSONL",
        short: "从 cwd / workdir 判断归属",
        actor: "Claude Code",
        command: "scan ~/.claude/projects/**/*.jsonl",
        status: "completed",
        from: "sessions",
        to: "project",
        tag: "claude jsonl",
        note: "Claude 没有 Codex 那样的 state 表，所以读取项目 JSONL 里的结构化字段。",
        dataTitle: "claude session metadata",
        data: [
          "{",
          "  \"sessionId\": \"claude-0a61\",",
          "  \"cwd\": \"/repo/shop-admin\",",
          "  \"gitBranch\": \"feature/profile-avatar\",",
          "  \"toolWorkdirs\": [\"/repo/shop-admin\"],",
          "  \"title\": \"review profile avatar flow\"",
          "}"
        ],
        terminal: [
          "claude candidates: 4",
          "matched by cwd: claude-0a61",
          "foreign project sessions rejected"
        ]
      },
      {
        title: "过滤不安全候选",
        short: "跳过归档和外部项目",
        actor: "Matcher",
        command: "strict project ownership check",
        status: "completed",
        from: "sessions",
        to: "project",
        tag: "filter",
        note: "正文里出现 shop-admin 不算证据；必须是 cwd、workdir 或 remote 这些结构化事实。",
        dataTitle: "scan summary",
        data: [
          "{",
          "  \"candidates\": 11,",
          "  \"matched\": 2,",
          "  \"skipped\": {",
          "    \"archivedCodex\": 2,",
          "    \"foreignGitRemote\": 4,",
          "    \"missingProjectMetadata\": 3",
          "  }",
          "}"
        ],
        terminal: [
          "strict match enabled",
          "2 session file(s) belong to shop-admin",
          "0 transcript-only matches accepted"
        ]
      },
      {
        title: "写入扫描缓存",
        short: "记录 stat / hash / match",
        actor: "Cache",
        command: "write .agent-sync/scan-cache.json",
        status: "completed",
        from: "project",
        to: "project",
        tag: "cache",
        note: "下次扫描时，如果 mtime、size、hash 和上下文没有变化，就不用重新读取整份 JSONL。",
        dataTitle: ".agent-sync/scan-cache.json",
        data: [
          "{",
          "  \"contextKey\": \"project:shop-admin-a18c4f2d09\",",
          "  \"files\": {",
          "    \"thread_7f4a.jsonl\": { \"size\": 93241, \"sha256\": \"b42e...91d\" },",
          "    \"claude-0a61.jsonl\": { \"size\": 48110, \"sha256\": \"7a02...e6b\" }",
          "  }",
          "}"
        ],
        terminal: [
          "cache refreshed: 2",
          "cache reused: 0",
          "last-scan.json updated"
        ]
      },
      {
        title: "复制会话到 sidecar",
        short: "生成 bundle 文件",
        actor: "Store",
        command: "copy matched sessions into .agent-sync-store/projects/<projectId>/",
        status: "completed",
        from: "sessions",
        to: "store",
        tag: "copy",
        note: "业务仓库不提交会话文件；会话只进入独立 sidecar Git 仓库。",
        dataTitle: "sidecar files",
        data: [
          ".agent-sync-store/projects/shop-admin-a18c4f2d09/",
          "  codex/codex-b42e91d.jsonl",
          "  claude/claude-7a02e6b.jsonl",
          "",
          "storeRelativePath = projects/shop-admin-a18c4f2d09/codex/codex-b42e91d.jsonl"
        ],
        terminal: [
          "copied codex-b42e91d.jsonl",
          "copied claude-7a02e6b.jsonl",
          "business repo remains clean"
        ]
      },
      {
        title: "写入 manifest",
        short: "最新快照索引",
        actor: "Store",
        command: "write manifest.json",
        status: "completed",
        from: "project",
        to: "store",
        tag: "manifest",
        note: "manifest 表示当前项目最新可恢复快照，pull 后会用它判断这个 bundle 是否兼容当前项目。",
        dataTitle: "manifest.json",
        data: [
          "{",
          "  \"projectId\": \"shop-admin-a18c4f2d09\",",
          "  \"projectIdentity\": \"git:github.com/wood-q/shop-admin\",",
          "  \"gitContext\": { \"branch\": \"feature/profile-avatar\", \"dirty\": true },",
          "  \"matches\": [",
          "    { \"agent\": \"codex\", \"bundleId\": \"codex-b42e91d\" },",
          "    { \"agent\": \"claude\", \"bundleId\": \"claude-7a02e6b\" }",
          "  ]",
          "}"
        ],
        terminal: [
          "manifest matches: 2",
          "legacyProjectIds kept for compatibility",
          "project remote normalized"
        ]
      },
      {
        title: "追加 Git binding",
        short: "把会话绑到业务 commit",
        actor: "Store",
        command: "append bindings.jsonl",
        status: "completed",
        from: "project",
        to: "store",
        tag: "binding",
        note: "这一步让 restore --current、--branch、--commit 可以像 git log 一样定位会话。",
        dataTitle: "bindings.jsonl line",
        data: [
          "{",
          "  \"syncRunId\": \"2026-05-29T15:42:10Z:8e21c4a6f3b0\",",
          "  \"bundleId\": \"codex-b42e91d\",",
          "  \"agent\": \"codex\",",
          "  \"title\": \"profile avatar upload\",",
          "  \"projectBranch\": \"feature/profile-avatar\",",
          "  \"projectCommit\": \"8e21c4a6f3b0c9d4a51e\",",
          "  \"projectDirty\": true",
          "}"
        ],
        terminal: [
          "bindings added: 2",
          "bindings.idx.json rebuilt",
          "selector latest/current/branch/commit ready"
        ]
      },
      {
        title: "提交并推送 sidecar",
        short: "只发布会话仓库",
        actor: "Sidecar Git",
        command: "git -C .agent-sync-store commit && git push origin main",
        status: "completed",
        from: "store",
        to: "store",
        tag: "push",
        note: "业务代码仓库没有新增会话文件；sidecar 仓库独立产生一次 Git commit。",
        dataTitle: "sidecar commit",
        data: [
          "commit 91fa7d2 sync shop-admin agent sessions",
          "",
          "changed:",
          "  projects/shop-admin-a18c4f2d09/manifest.json",
          "  projects/shop-admin-a18c4f2d09/bindings.jsonl",
          "  projects/shop-admin-a18c4f2d09/codex/codex-b42e91d.jsonl",
          "  projects/shop-admin-a18c4f2d09/claude/claude-7a02e6b.jsonl"
        ],
        terminal: [
          "committed 2 matched session file(s)",
          "pushed sidecar repo",
          "source Git history unchanged"
        ]
      },
      {
        title: "另一台机器拉取",
        short: "查询 latest 批次",
        actor: "New machine",
        command: "git agent-sync pull && git agent-sync log --latest",
        status: "completed",
        from: "store",
        to: "machine",
        tag: "pull",
        note: "另一台机器 clone 业务项目后，只需要连接同一个 sidecar remote，就能看到可恢复对话。",
        dataTitle: "log --latest",
        data: [
          "Index  Agent   Bundle          Title",
          "1      codex   codex-b42e91d   profile avatar upload",
          "2      claude  claude-7a02e6b  review profile avatar flow",
          "",
          "selector: latest syncRunId 2026-05-29T15:42:10Z:8e21c4a6f3b0"
        ],
        terminal: [
          "pulled sidecar repo",
          "2 session file(s) available for restore",
          "using compatible project bundle shop-admin-a18c4f2d09"
        ]
      },
      {
        title: "恢复为本机会话",
        short: "适配路径并注册索引",
        actor: "Restore",
        command: "git agent-sync restore --latest 1",
        status: "completed",
        from: "store",
        to: "machine",
        tag: "restore",
        note: "恢复不会改 sidecar 原文件，只修改写回本机的副本，让 Codex / Claude 能继续显示和接上。",
        dataTitle: "restore result",
        data: [
          "{",
          "  \"target\": \"~/.codex/sessions/2026/05/29/thread_7f4a.jsonl\",",
          "  \"adapted\": true,",
          "  \"fromProjectRoot\": \"/repo/shop-admin\",",
          "  \"toProjectRoot\": \"/Users/mokio/work/shop-admin\",",
          "  \"registered\": {",
          "    \"state_5.sqlite\": \"thread_7f4a\",",
          "    \"session_index.jsonl\": \"profile avatar upload\"",
          "  }",
          "}"
        ],
        terminal: [
          "restored codex: thread_7f4a.jsonl",
          "adapted project paths",
          "registered codex thread: thread_7f4a"
        ]
      }
    ] as Step[]
  },
  en: {
    eyebrow: "Workflow",
    title: "A complete sync, replayed as a concrete example.",
    intro: "The example project is shop-admin. The left side is a sequence diagram; every step adds an action. The right side shows the exact data created, read, or changed.",
    terminalTitle: "git-agent-sync simulator",
    lanes: {
      project: "Project Git",
      sessions: "Local Sessions",
      store: "Sidecar Repo",
      machine: "New Machine"
    },
    stepLabel: "STEP",
    prev: "Previous",
    replay: "Replay",
    start: "Start",
    pause: "Pause",
    dataLabel: "Data changed in this step",
    outputLabel: "Terminal output",
    steps: [
      {
        title: "Initialize project",
        short: "Create project identity",
        actor: "CLI",
        command: "git agent-sync init --remote git@github.com:wood-q/agent-session-store.git",
        status: "completed",
        from: "project",
        to: "store",
        tag: "init",
        note: "The tool reads the current project remote, then creates local config plus a standalone sidecar Git repository.",
        dataTitle: ".agent-sync/config.json",
        data: [
          "{",
          "  \"projectName\": \"shop-admin\",",
          "  \"projectIdentity\": \"git:github.com/wood-q/shop-admin\",",
          "  \"projectId\": \"shop-admin-a18c4f2d09\",",
          "  \"storePath\": \"/repo/shop-admin/.agent-sync-store\",",
          "  \"remote\": \"git@github.com:wood-q/agent-session-store.git\"",
          "}"
        ],
        terminal: ["agent-sync initialized for shop-admin", "store: /repo/shop-admin/.agent-sync-store", "project id: shop-admin-a18c4f2d09"]
      },
      {
        title: "Read Git context",
        short: "Record branch / HEAD / dirty",
        actor: "CLI",
        command: "git rev-parse HEAD && git status --porcelain",
        status: "completed",
        from: "project",
        to: "project",
        tag: "git facts",
        note: "Later restores primarily use this project commit and branch to find the right sessions.",
        dataTitle: "current git context",
        data: ["{", "  \"branch\": \"feature/profile-avatar\",", "  \"headCommit\": \"8e21c4a6f3b0c9d4a51e\",", "  \"baseCommit\": \"8e21c4a6f3b0c9d4a51e\",", "  \"dirty\": true", "}"],
        terminal: ["branch feature/profile-avatar", "HEAD 8e21c4a6f3b0", "worktree has uncommitted UI changes"]
      },
      {
        title: "Read Codex index",
        short: "Locate thread from state_5.sqlite",
        actor: "Codex",
        command: "git agent-sync status",
        status: "completed",
        from: "sessions",
        to: "project",
        tag: "codex state",
        note: "Codex uses the threads table in state_5.sqlite first, instead of searching transcript text.",
        dataTitle: "state_5.sqlite / threads",
        data: ["{", "  \"id\": \"thread_7f4a\",", "  \"title\": \"profile avatar upload\",", "  \"cwd\": \"/repo/shop-admin\",", "  \"git_origin_url\": \"git@github.com:wood-q/shop-admin.git\",", "  \"git_branch\": \"feature/profile-avatar\",", "  \"rollout_path\": \"~/.codex/sessions/2026/05/29/thread_7f4a.jsonl\"", "}"],
        terminal: ["codex state: ok", "1 thread matched by git_origin_url", "archived sessions skipped"]
      },
      {
        title: "Read Claude JSONL",
        short: "Match by cwd / workdir",
        actor: "Claude Code",
        command: "scan ~/.claude/projects/**/*.jsonl",
        status: "completed",
        from: "sessions",
        to: "project",
        tag: "claude jsonl",
        note: "Claude project JSONL is matched through structured fields because it does not have a Codex-style state table.",
        dataTitle: "claude session metadata",
        data: ["{", "  \"sessionId\": \"claude-0a61\",", "  \"cwd\": \"/repo/shop-admin\",", "  \"gitBranch\": \"feature/profile-avatar\",", "  \"toolWorkdirs\": [\"/repo/shop-admin\"],", "  \"title\": \"review profile avatar flow\"", "}"],
        terminal: ["claude candidates: 4", "matched by cwd: claude-0a61", "foreign project sessions rejected"]
      },
      {
        title: "Filter unsafe candidates",
        short: "Skip archived and foreign sessions",
        actor: "Matcher",
        command: "strict project ownership check",
        status: "completed",
        from: "sessions",
        to: "project",
        tag: "filter",
        note: "Mentioning shop-admin in transcript text is not enough. Ownership must come from cwd, workdir, or remote.",
        dataTitle: "scan summary",
        data: ["{", "  \"candidates\": 11,", "  \"matched\": 2,", "  \"skipped\": {", "    \"archivedCodex\": 2,", "    \"foreignGitRemote\": 4,", "    \"missingProjectMetadata\": 3", "  }", "}"],
        terminal: ["strict match enabled", "2 session file(s) belong to shop-admin", "0 transcript-only matches accepted"]
      },
      {
        title: "Write scan cache",
        short: "Store stat / hash / match",
        actor: "Cache",
        command: "write .agent-sync/scan-cache.json",
        status: "completed",
        from: "project",
        to: "project",
        tag: "cache",
        note: "Next scan can reuse the result if mtime, size, hash, and matching context are unchanged.",
        dataTitle: ".agent-sync/scan-cache.json",
        data: ["{", "  \"contextKey\": \"project:shop-admin-a18c4f2d09\",", "  \"files\": {", "    \"thread_7f4a.jsonl\": { \"size\": 93241, \"sha256\": \"b42e...91d\" },", "    \"claude-0a61.jsonl\": { \"size\": 48110, \"sha256\": \"7a02...e6b\" }", "  }", "}"],
        terminal: ["cache refreshed: 2", "cache reused: 0", "last-scan.json updated"]
      },
      {
        title: "Copy sessions to sidecar",
        short: "Create bundle files",
        actor: "Store",
        command: "copy matched sessions into .agent-sync-store/projects/<projectId>/",
        status: "completed",
        from: "sessions",
        to: "store",
        tag: "copy",
        note: "The business repo does not receive session files. They only enter the independent sidecar repository.",
        dataTitle: "sidecar files",
        data: [".agent-sync-store/projects/shop-admin-a18c4f2d09/", "  codex/codex-b42e91d.jsonl", "  claude/claude-7a02e6b.jsonl", "", "storeRelativePath = projects/shop-admin-a18c4f2d09/codex/codex-b42e91d.jsonl"],
        terminal: ["copied codex-b42e91d.jsonl", "copied claude-7a02e6b.jsonl", "business repo remains clean"]
      },
      {
        title: "Write manifest",
        short: "Latest snapshot index",
        actor: "Store",
        command: "write manifest.json",
        status: "completed",
        from: "project",
        to: "store",
        tag: "manifest",
        note: "The manifest describes the latest restorable snapshot and compatibility metadata for this project.",
        dataTitle: "manifest.json",
        data: ["{", "  \"projectId\": \"shop-admin-a18c4f2d09\",", "  \"projectIdentity\": \"git:github.com/wood-q/shop-admin\",", "  \"gitContext\": { \"branch\": \"feature/profile-avatar\", \"dirty\": true },", "  \"matches\": [", "    { \"agent\": \"codex\", \"bundleId\": \"codex-b42e91d\" },", "    { \"agent\": \"claude\", \"bundleId\": \"claude-7a02e6b\" }", "  ]", "}"],
        terminal: ["manifest matches: 2", "legacyProjectIds kept for compatibility", "project remote normalized"]
      },
      {
        title: "Append Git binding",
        short: "Bind sessions to project commit",
        actor: "Store",
        command: "append bindings.jsonl",
        status: "completed",
        from: "project",
        to: "store",
        tag: "binding",
        note: "This is what powers restore --current, --branch, and --commit.",
        dataTitle: "bindings.jsonl line",
        data: ["{", "  \"syncRunId\": \"2026-05-29T15:42:10Z:8e21c4a6f3b0\",", "  \"bundleId\": \"codex-b42e91d\",", "  \"agent\": \"codex\",", "  \"title\": \"profile avatar upload\",", "  \"projectBranch\": \"feature/profile-avatar\",", "  \"projectCommit\": \"8e21c4a6f3b0c9d4a51e\",", "  \"projectDirty\": true", "}"],
        terminal: ["bindings added: 2", "bindings.idx.json rebuilt", "selector latest/current/branch/commit ready"]
      },
      {
        title: "Commit and push sidecar",
        short: "Publish only session repo",
        actor: "Sidecar Git",
        command: "git -C .agent-sync-store commit && git push origin main",
        status: "completed",
        from: "store",
        to: "store",
        tag: "push",
        note: "The source repository has no session-file commit. The sidecar repository gets its own commit.",
        dataTitle: "sidecar commit",
        data: ["commit 91fa7d2 sync shop-admin agent sessions", "", "changed:", "  projects/shop-admin-a18c4f2d09/manifest.json", "  projects/shop-admin-a18c4f2d09/bindings.jsonl", "  projects/shop-admin-a18c4f2d09/codex/codex-b42e91d.jsonl", "  projects/shop-admin-a18c4f2d09/claude/claude-7a02e6b.jsonl"],
        terminal: ["committed 2 matched session file(s)", "pushed sidecar repo", "source Git history unchanged"]
      },
      {
        title: "Pull on another machine",
        short: "Query latest sync batch",
        actor: "New machine",
        command: "git agent-sync pull && git agent-sync log --latest",
        status: "completed",
        from: "store",
        to: "machine",
        tag: "pull",
        note: "After cloning the business project, the new machine connects to the same sidecar remote and sees recoverable sessions.",
        dataTitle: "log --latest",
        data: ["Index  Agent   Bundle          Title", "1      codex   codex-b42e91d   profile avatar upload", "2      claude  claude-7a02e6b  review profile avatar flow", "", "selector: latest syncRunId 2026-05-29T15:42:10Z:8e21c4a6f3b0"],
        terminal: ["pulled sidecar repo", "2 session file(s) available for restore", "using compatible project bundle shop-admin-a18c4f2d09"]
      },
      {
        title: "Restore local session",
        short: "Adapt paths and register index",
        actor: "Restore",
        command: "git agent-sync restore --latest 1",
        status: "completed",
        from: "store",
        to: "machine",
        tag: "restore",
        note: "The original sidecar file stays unchanged. Only the restored local copy is adapted for this machine.",
        dataTitle: "restore result",
        data: ["{", "  \"target\": \"~/.codex/sessions/2026/05/29/thread_7f4a.jsonl\",", "  \"adapted\": true,", "  \"fromProjectRoot\": \"/repo/shop-admin\",", "  \"toProjectRoot\": \"/Users/mokio/work/shop-admin\",", "  \"registered\": {", "    \"state_5.sqlite\": \"thread_7f4a\",", "    \"session_index.jsonl\": \"profile avatar upload\"", "  }", "}"],
        terminal: ["restored codex: thread_7f4a.jsonl", "adapted project paths", "registered codex thread: thread_7f4a"]
      }
    ] as Step[]
  }
};

const locale = computed<Locale>(() => props.locale === "en" ? "en" : "zh");
const content = computed(() => copy[locale.value]);
const activeIndex = ref(0);
const isPlaying = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;
const sequenceRowPitch = 84;

const activeStep = computed(() => content.value.steps[activeIndex.value]);
const visibleSteps = computed(() => content.value.steps.slice(0, activeIndex.value + 1));
const sequenceOffset = computed(() => `${Math.max(0, activeIndex.value - 5) * -sequenceRowPitch}px`);
const recentOutput = computed(() => activeStep.value.terminal);
const progressRatio = computed(() => {
  const lastStep = content.value.steps.length - 1;
  return lastStep > 0 ? activeIndex.value / lastStep : 0;
});
const progressStyle = computed(() => ({
  "--progress": progressRatio.value
}));

function laneIndex(lane: LaneKey) {
  return laneKeys.indexOf(lane);
}

function laneCenter(index: number) {
  return ((index + 0.5) / laneKeys.length) * 100;
}

function laneStyle(index: number) {
  return {
    "--lane-x": `${laneCenter(index)}%`
  };
}

function eventStyle(step: Step) {
  const from = laneIndex(step.from);
  const to = laneIndex(step.to);
  const fromCenter = laneCenter(from);
  const toCenter = laneCenter(to);
  const lineLeft = Math.min(fromCenter, toCenter);
  const lineWidth = Math.abs(toCenter - fromCenter);
  const cardX = from === to ? fromCenter : (fromCenter + toCenter) / 2;
  return {
    "--line-left": `${lineLeft}%`,
    "--line-width": `${lineWidth}%`,
    "--card-x": `${cardX}%`
  };
}

function directionClass(step: Step) {
  const from = laneIndex(step.from);
  const to = laneIndex(step.to);
  if (from === to) {
    return "self";
  }
  return from < to ? "forward" : "backward";
}

function setStep(index: number) {
  activeIndex.value = (index + content.value.steps.length) % content.value.steps.length;
}

function nextStep() {
  setStep(activeIndex.value + 1);
}

function prevStep() {
  setStep(activeIndex.value - 1);
}

function stop() {
  isPlaying.value = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function start() {
  stop();
  isPlaying.value = true;
  timer = setInterval(nextStep, 2400);
}

function togglePlay() {
  if (isPlaying.value) {
    stop();
  } else {
    start();
  }
}

function replay() {
  setStep(0);
  start();
}

onBeforeUnmount(stop);
</script>

<template>
  <section class="landing-section workflow-simulator-section">
    <p class="landing-eyebrow">{{ content.eyebrow }}</p>
    <h2>{{ content.title }}</h2>
    <p class="workflow-intro">{{ content.intro }}</p>

    <div class="workflow-simulator">
      <div class="sequence-board">
        <div class="lane-heads">
          <button
            v-for="(lane, index) in laneKeys"
            :key="lane"
            class="lane-head"
            :class="{ active: activeStep.from === lane || activeStep.to === lane }"
            type="button"
            @click="setStep(Math.min(index * 3, content.steps.length - 1))"
          >
            <span class="lane-icon">{{ index + 1 }}</span>
            <span>{{ content.lanes[lane] }}</span>
          </button>
        </div>

        <div class="sequence-body">
          <div class="lane-guides">
            <span v-for="(lane, index) in laneKeys" :key="lane" :style="laneStyle(index)" />
          </div>
          <div class="sequence-list" :style="{ '--sequence-offset': sequenceOffset }">
            <button
              v-for="(step, index) in visibleSteps"
              :key="`${step.tag}-${index}`"
              class="sequence-row"
              :class="[
                directionClass(step),
                { active: index === activeIndex, complete: index < activeIndex }
              ]"
              :style="eventStyle(step)"
              type="button"
              @click="setStep(index)"
            >
              <span class="event-line" />
              <span class="message-card">
                <span class="message-card-kicker">
                  <small>{{ step.tag }}</small>
                  <span class="row-meta">
                    {{ content.stepLabel }} {{ String(index + 1).padStart(2, "0") }}
                  </span>
                </span>
                <strong>{{ step.short }}</strong>
                <em>{{ step.actor }}</em>
              </span>
            </button>
          </div>
        </div>
      </div>

      <div class="data-terminal">
        <div class="terminal-top">
          <span class="window-dot red" />
          <span class="window-dot yellow" />
          <span class="window-dot green" />
          <span class="terminal-name">{{ content.terminalTitle }}</span>
          <span class="step-count">{{ activeIndex + 1 }}/{{ content.steps.length }}</span>
        </div>

        <div class="terminal-screen">
          <section class="step-summary">
            <div>
              <span class="step-label">{{ content.stepLabel }} {{ String(activeIndex + 1).padStart(2, "0") }}</span>
              <h3>{{ activeStep.title }}</h3>
              <p>{{ activeStep.note }}</p>
            </div>
            <span class="status-pill">{{ activeStep.status }}</span>
          </section>

          <section class="command-card">
            <span>$</span>
            <code>{{ activeStep.command }}</code>
          </section>

          <section class="data-card" :key="`data-${activeIndex}`">
            <div class="card-head">
              <strong>{{ content.dataLabel }}</strong>
              <span>{{ activeStep.dataTitle }}</span>
            </div>
            <pre><code><span v-for="line in activeStep.data" :key="line">{{ line }}</span></code></pre>
          </section>

          <section class="output-card" :key="`output-${activeIndex}`">
            <div class="card-head">
              <strong>{{ content.outputLabel }}</strong>
              <span>{{ activeStep.actor }}</span>
            </div>
            <p v-for="line in recentOutput" :key="line">{{ line }}</p>
          </section>
        </div>

        <div class="terminal-controls">
          <div class="progress-panel">
            <div class="progress-copy">
              <span>{{ content.stepLabel }} {{ activeIndex + 1 }}/{{ content.steps.length }}</span>
              <strong>{{ activeStep.short }}</strong>
            </div>
            <div class="dots" :style="progressStyle">
              <button
                v-for="(_, index) in content.steps"
                :key="index"
                class="progress-dot"
                :class="{ active: activeIndex === index, done: index < activeIndex }"
                type="button"
                :aria-label="`${content.stepLabel} ${index + 1}`"
                @click="setStep(index)"
              />
            </div>
          </div>
          <div class="control-buttons">
            <button type="button" @click="prevStep">{{ content.prev }}</button>
            <button type="button" @click="replay">{{ content.replay }}</button>
            <button class="primary" type="button" @click="togglePlay">
              {{ isPlaying ? content.pause : content.start }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.workflow-simulator-section {
  box-sizing: border-box;
  width: min(100%, 1600px);
  max-width: 1600px;
  padding-right: clamp(20px, 3vw, 36px);
  padding-left: clamp(20px, 3vw, 36px);
}

.workflow-intro {
  max-width: 960px;
  margin: 14px 0 0;
  color: var(--vp-c-text-2);
  font-size: 16px;
  line-height: 1.76;
}

.workflow-simulator {
  display: grid;
  grid-template-columns: minmax(660px, 1.18fr) minmax(460px, 0.82fr);
  gap: 24px;
  margin-top: 30px;
}

.sequence-board,
.data-terminal {
  min-height: 620px;
  border: 1px solid rgba(240, 97, 48, 0.2);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.09);
}

.sequence-board {
  --sequence-pad-x: clamp(20px, 4vw, 32px);
  background:
    linear-gradient(180deg, rgba(255, 250, 242, 0.96), rgba(255, 248, 236, 0.84)),
    radial-gradient(circle at 18% 8%, rgba(240, 97, 48, 0.1), transparent 18rem);
}

.dark .sequence-board {
  background:
    linear-gradient(180deg, rgba(31, 38, 50, 0.98), rgba(22, 29, 39, 0.92)),
    radial-gradient(circle at 18% 8%, rgba(240, 97, 48, 0.16), transparent 18rem);
}

.lane-heads {
  position: relative;
  z-index: 4;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  min-height: 96px;
  padding: 0 var(--sequence-pad-x);
  border-bottom: 1px solid rgba(240, 97, 48, 0.16);
  background: rgba(255, 251, 244, 0.78);
  backdrop-filter: blur(18px);
}

.dark .lane-heads {
  background: rgba(17, 24, 34, 0.86);
}

.lane-head {
  display: grid;
  gap: 8px;
  align-content: center;
  justify-items: center;
  padding: 12px;
  border: 0;
  color: var(--vp-c-text-2);
  background: transparent;
  font: inherit;
  font-weight: 760;
  cursor: pointer;
  transition: color 180ms ease, transform 180ms ease;
}

.lane-head:hover,
.lane-head.active {
  color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.lane-icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 2px solid currentColor;
  border-radius: 50%;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  box-shadow: inset 0 0 0 5px rgba(240, 97, 48, 0.08);
}

.sequence-body {
  position: relative;
  height: 524px;
  overflow: hidden;
}

.lane-guides {
  position: absolute;
  inset: 0 var(--sequence-pad-x);
  pointer-events: none;
}

.lane-guides span {
  position: absolute;
  top: 0;
  bottom: 0;
  left: var(--lane-x);
  width: 2px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(240, 97, 48, 0.18), rgba(43, 116, 255, 0.14));
  transform: translateX(-50%);
}

.sequence-list {
  position: relative;
  z-index: 2;
  display: grid;
  gap: 10px;
  padding: 16px var(--sequence-pad-x) 28px;
  transform: translateY(var(--sequence-offset));
  transition: transform 380ms ease;
}

.sequence-row {
  position: relative;
  display: block;
  width: 100%;
  height: 74px;
  min-height: 74px;
  border: 0;
  background: transparent;
  color: var(--vp-c-text-1);
  font: inherit;
  cursor: pointer;
  opacity: 0.78;
}

.sequence-row.active,
.sequence-row:hover {
  opacity: 1;
}

.row-meta {
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
  font-size: 9px;
  font-weight: 800;
  white-space: nowrap;
}

.event-line {
  position: absolute;
  z-index: 1;
  top: 50%;
  left: var(--line-left);
  width: var(--line-width);
  height: 2px;
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(240, 97, 48, 0.88), rgba(43, 116, 255, 0.72));
  transform: translateY(-50%);
}

.sequence-row.backward .event-line {
  background: linear-gradient(90deg, rgba(43, 116, 255, 0.72), rgba(240, 97, 48, 0.88));
}

.sequence-row.self .event-line {
  display: none;
}

.event-line::before,
.event-line::after {
  position: absolute;
  top: 50%;
  content: "";
  transform: translateY(-50%);
}

.event-line::before {
  left: 0;
  width: 7px;
  height: 7px;
  border: 2px solid rgba(240, 97, 48, 0.72);
  border-radius: 50%;
  background: var(--vp-c-bg);
}

.event-line::after {
  right: -1px;
  width: 0;
  height: 0;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 8px solid #2b74ff;
}

.sequence-row.backward .event-line::before {
  right: 0;
  left: auto;
  border-color: rgba(43, 116, 255, 0.72);
}

.sequence-row.backward .event-line::after {
  right: auto;
  left: -1px;
  border-right: 8px solid #2b74ff;
  border-left: 0;
}

.message-card {
  position: absolute;
  z-index: 2;
  top: 50%;
  left: var(--card-x);
  display: grid;
  width: clamp(118px, 16%, 148px);
  max-height: 72px;
  gap: 2px;
  padding: 7px 9px;
  border: 1px solid rgba(240, 97, 48, 0.24);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 14px 30px rgba(15, 23, 42, 0.08);
  overflow: hidden;
  text-align: left;
  transform: translate(-50%, -50%);
}

.message-card-kicker {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
  min-width: 0;
}

.message-card small {
  width: fit-content;
  max-width: 72px;
  padding: 1px 5px;
  border-radius: 999px;
  color: var(--vp-c-brand-1);
  background: rgba(240, 97, 48, 0.1);
  font-family: var(--vp-font-family-mono);
  font-size: 8px;
  font-weight: 850;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-transform: uppercase;
}

.dark .message-card {
  background: rgba(19, 27, 39, 0.9);
}

.sequence-row.active .message-card {
  border-color: rgba(240, 97, 48, 0.72);
  animation: cardPop 260ms ease;
}

.sequence-row.complete .message-card {
  border-color: rgba(54, 179, 126, 0.34);
}

.message-card strong {
  display: -webkit-box;
  overflow: hidden;
  color: var(--vp-c-text-1);
  font-size: 12px;
  line-height: 1.25;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.message-card em {
  overflow: hidden;
  color: var(--vp-c-text-2);
  font-size: 11px;
  font-style: normal;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.data-terminal {
  display: grid;
  grid-template-rows: auto 1fr auto;
  background: #0d1219;
  color: #d9e2ef;
}

.terminal-top {
  display: flex;
  gap: 8px;
  align-items: center;
  min-height: 46px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.1);
  background: #151b24;
}

.window-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.window-dot.red { background: #ff5f57; }
.window-dot.yellow { background: #ffbd2e; }
.window-dot.green { background: #28c840; }

.terminal-name {
  margin-left: 4px;
  color: #8f9aaa;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

.step-count {
  margin-left: auto;
  padding: 4px 8px;
  border-radius: 999px;
  color: #ffb08c;
  background: rgba(240, 97, 48, 0.18);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
}

.terminal-screen {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 18px;
  overflow: hidden;
}

.step-summary,
.command-card,
.data-card,
.output-card {
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
}

.step-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 16px;
  padding: 16px;
  border: 1px dashed rgba(240, 97, 48, 0.5);
}

.step-label {
  color: #ff8d64;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 850;
}

.step-summary h3 {
  margin: 7px 0 7px;
  color: #f8fafc;
  font-size: 20px;
  line-height: 1.25;
}

.step-summary p {
  margin: 0;
  color: #a9b4c3;
  font-size: 14px;
  line-height: 1.6;
}

.status-pill {
  align-self: start;
  padding: 5px 8px;
  border-radius: 999px;
  color: #65d88d;
  background: rgba(47, 185, 104, 0.12);
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
}

.command-card {
  display: flex;
  gap: 10px;
  padding: 13px 14px;
  border: 1px solid rgba(226, 232, 240, 0.1);
}

.command-card span {
  color: #62d491;
  font-family: var(--vp-font-family-mono);
}

.command-card code {
  color: #edf2f7;
  white-space: normal;
  word-break: break-word;
}

.data-card,
.output-card {
  border: 1px solid rgba(226, 232, 240, 0.1);
  overflow: hidden;
  animation: dataIn 260ms ease;
}

.card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.1);
  color: #8f9aaa;
  font-size: 12px;
}

.card-head strong {
  color: #ffbd7a;
}

.data-card pre {
  max-height: 226px;
  margin: 0;
  padding: 14px;
  overflow: auto;
  color: #7df29c;
  background: rgba(3, 8, 11, 0.26);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.62;
}

.data-card code {
  display: grid;
  gap: 1px;
}

.output-card {
  padding-bottom: 10px;
}

.output-card p {
  margin: 8px 14px 0;
  color: #a9b4c3;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.45;
}

.output-card p::before {
  margin-right: 8px;
  color: #62d491;
  content: ">";
}

.terminal-controls {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
  align-items: center;
  padding: 12px 16px 14px;
  border-top: 1px solid rgba(226, 232, 240, 0.1);
  background: #151b24;
}

.progress-panel {
  display: grid;
  grid-template-columns: minmax(118px, 150px) minmax(0, 1fr);
  gap: 14px;
  align-items: center;
}

.control-buttons {
  display: flex;
  align-items: center;
}

.progress-panel,
.control-buttons {
  min-width: 0;
}

.progress-copy {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.progress-copy span {
  color: #ff8d64;
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0.03em;
}

.progress-copy strong {
  overflow: hidden;
  color: #e6edf3;
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dots,
.control-buttons {
  display: flex;
  gap: 8px;
  align-items: center;
}

.dots {
  position: relative;
  width: 100%;
  min-width: 0;
  flex-wrap: nowrap;
  justify-content: space-between;
  gap: 0;
  padding: 4px 0;
}

.dots::before,
.dots::after {
  position: absolute;
  top: 50%;
  left: 6px;
  height: 2px;
  border-radius: 999px;
  content: "";
  transform: translateY(-50%);
}

.dots::before {
  right: 6px;
  background: rgba(255, 255, 255, 0.09);
}

.dots::after {
  width: calc((100% - 12px) * var(--progress));
  background: linear-gradient(90deg, #ef835d, #ffbd7a);
}

.progress-dot {
  position: relative;
  z-index: 1;
  flex: 0 0 12px;
  width: 12px;
  height: 12px;
  border: 2px solid #3b4658;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}

.progress-dot.done {
  border-color: #ef835d;
  background: #ef835d;
}

.progress-dot.active {
  border-color: #ff8d64;
  background: #ff8d64;
  box-shadow: 0 0 0 4px rgba(240, 97, 48, 0.22);
}

.control-buttons button {
  min-height: 36px;
  padding: 7px 12px;
  border: 1px solid rgba(226, 232, 240, 0.14);
  border-radius: 8px;
  color: #d9e2ef;
  background: rgba(255, 255, 255, 0.04);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.control-buttons {
  justify-content: flex-end;
  flex-wrap: wrap;
}

.control-buttons .primary {
  border-color: rgba(240, 97, 48, 0.56);
  color: #ffb08c;
  background: rgba(240, 97, 48, 0.16);
}

@keyframes cardPop {
  from {
    opacity: 0.2;
    transform: translate(-50%, calc(-50% + 6px)) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translate(-50%, -50%) scale(1);
  }
}

@keyframes dataIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 1280px) {
  .workflow-simulator {
    grid-template-columns: minmax(0, 1.08fr) minmax(420px, 0.92fr);
  }
}

@media (max-width: 1120px) {
  .workflow-simulator {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .sequence-board,
  .data-terminal {
    min-height: auto;
  }

  .lane-heads {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sequence-body {
    height: auto;
    min-height: 520px;
    overflow: visible;
  }

  .lane-guides {
    display: none;
  }

  .sequence-list {
    transform: none !important;
  }

  .sequence-row,
  .sequence-row.self {
    height: auto;
    min-height: auto;
  }

  .event-line {
    display: none;
  }

  .message-card {
    position: relative;
    top: auto;
    left: auto;
    width: 100%;
    animation: none !important;
    transform: none;
  }

  .terminal-controls,
  .step-summary {
    align-items: flex-start;
    grid-template-columns: 1fr;
  }

  .terminal-controls {
    justify-items: stretch;
  }

  .progress-panel {
    width: 100%;
    grid-template-columns: 1fr;
    align-items: stretch;
  }

  .progress-copy {
    min-width: 0;
  }

  .dots {
    justify-content: space-between;
    width: 100%;
    gap: 0;
  }

  .control-buttons {
    flex-wrap: wrap;
  }
}
</style>
