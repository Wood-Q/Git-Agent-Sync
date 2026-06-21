import { spawnSync } from "node:child_process";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import figlet from "figlet";
import gradient from "gradient-string";

// ---------------------------------------------------------------------------
// Agent-Sync TUI
//
// A small raw-terminal, full-screen, single-key toolkit that mirrors the
// interaction model of the codex-session-cloner TUI: a home screen of
// workspace tabs, a flat hotkey action list per workspace, and modal action
// screens that run a single `git agent-sync ...` command and wait for Enter.
//
// Two entry shapes share the same data model:
//   * runTui({ io })         — deterministic readline prompt flow (tests)
//   * runTui() on a real TTY — raw full-screen single-key experience
// On a non-TTY stdout we just print the rendered menu string and return.
// ---------------------------------------------------------------------------

type TuiLocale = "en" | "cn";
type TuiCategoryId = "remote" | "local" | "doctor";

type TuiPrompt = {
  label: string;
  placeholder: string;
  token?: string;
};

type TuiChoice = {
  key: string;
  category: TuiCategoryId;
  badge: string;
  label: string;
  description: string;
  args: string[];
  prompt?: TuiPrompt;
  // When set, the prompted value is appended as `<promptSuffix> <value>`
  // instead of a bare positional arg, and an empty answer is allowed.
  promptSuffix?: string;
  // When set, the action first opens a session browser (sourced from
  // `log --latest --json`) instead of running its command immediately.
  //   "log"     — browse then return
  //   "restore" — browse, pick a number, then restore that index
  browser?: "log" | "restore";
  confirm?: string;
  handoff?: boolean;
  exits?: boolean;
};

type TuiCategory = {
  id: TuiCategoryId;
  index: number;
  key: string;
  title: string;
  subtitle: string;
  toolkitTitle: string;
  accent: "cyan" | "magenta" | "green";
};

type TuiCommandResult = number | {
  status?: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
};

type TuiRunner = (args: string[], cwd: string) => TuiCommandResult | Promise<TuiCommandResult>;

// ---------------------------------------------------------------------------
// Data: workspaces + actions
// ---------------------------------------------------------------------------

const TUI_CATEGORIES: TuiCategory[] = [
  {
    id: "remote",
    index: 1,
    key: "1",
    title: "Remote Sync",
    subtitle: "Push, pull, restore, log, init, and hooks through the sidecar store.",
    toolkitTitle: "REMOTE SYNC",
    accent: "cyan"
  },
  {
    id: "local",
    index: 2,
    key: "2",
    title: "Local Transfer",
    subtitle: "Codex/Claude migration, provider clone, and watch mode.",
    toolkitTitle: "LOCAL TRANSFER",
    accent: "magenta"
  },
  {
    id: "doctor",
    index: 3,
    key: "3",
    title: "Doctor",
    subtitle: "Health checks and current session match status.",
    toolkitTitle: "DOCTOR",
    accent: "green"
  }
];

const MENU_CHOICES: TuiChoice[] = [
  // --- remote -------------------------------------------------------------
  {
    key: "p",
    category: "remote",
    badge: "PUSH",
    label: "Push sessions",
    description: "Snapshot matched sessions into the sidecar store.",
    args: ["push"],
    confirm: "Push current-project agent sessions to the sidecar store?"
  },
  {
    key: "l",
    category: "remote",
    badge: "PULL",
    label: "Pull sessions",
    description: "Fetch restorable sidecar bundles from the remote store.",
    args: ["pull"]
  },
  {
    key: "r",
    category: "remote",
    badge: "RESTORE",
    label: "Restore by index",
    description: "Browse synced sessions and restore one by its number.",
    args: ["restore", "--index"],
    browser: "restore",
    // Display-only token: the actual index is picked from the browser list,
    // not typed via this prompt.
    prompt: { label: "Restore index", placeholder: "Pick from the browser list", token: "<restore-index>" },
    confirm: "Restore this session into the local agent history?"
  },
  {
    key: "g",
    category: "remote",
    badge: "LOG",
    label: "Log latest sessions",
    description: "Browse the newest synced conversations.",
    args: ["log", "--latest", "--oneline", "-20"],
    browser: "log"
  },
  {
    key: "i",
    category: "remote",
    badge: "INIT",
    label: "Init sidecar store",
    description: "Create the local config and sidecar store (remote optional).",
    args: ["init"],
    promptSuffix: "--remote",
    prompt: { label: "Remote URL", placeholder: "git@github.com:you/agent-session-store.git (optional)" }
  },
  {
    key: "k",
    category: "remote",
    badge: "HOOK",
    label: "Install pre-push hook",
    description: "Queue background Agent-Sync jobs during git push.",
    args: ["install-hooks"],
    confirm: "Install the Agent-Sync managed pre-push hook in this repository?"
  },
  // --- local --------------------------------------------------------------
  {
    key: "c",
    category: "local",
    badge: "CLONE",
    label: "Clone Codex to current provider",
    description: "Copy current-project Codex sessions under the active provider.",
    args: ["clone-local"]
  },
  {
    key: "e",
    category: "local",
    badge: "REGISTER",
    label: "Register local clones",
    description: "Add Agent-Sync provider clones to local Codex indexes.",
    args: ["register-local"]
  },
  {
    key: "w",
    category: "local",
    badge: "WATCH",
    label: "Watch provider changes",
    description: "Hand off to the long-running local watch command.",
    args: ["watch-local"],
    handoff: true
  },
  {
    key: "a",
    category: "local",
    badge: "CLAUDE",
    label: "Migrate bundle to Claude JSONL",
    description: "Export a synced bundle as readable Claude JSONL.",
    args: ["tool", "export", "--to", "claude", "--mode", "readable", "--session"],
    prompt: { label: "Bundle id", placeholder: "Paste a synced bundle id" }
  },
  {
    key: "o",
    category: "local",
    badge: "CODEX",
    label: "Migrate bundle to Codex JSONL",
    description: "Export a synced bundle as readable Codex JSONL.",
    args: ["tool", "export", "--to", "codex", "--mode", "readable", "--session"],
    prompt: { label: "Bundle id", placeholder: "Paste a synced bundle id" }
  },
  // --- doctor -------------------------------------------------------------
  {
    key: "d",
    category: "doctor",
    badge: "DOCTOR",
    label: "Run doctor",
    description: "Check config, sidecar store, sparse checkout, and bindings.",
    args: ["doctor"]
  },
  {
    key: "s",
    category: "doctor",
    badge: "STATUS",
    label: "Show session status",
    description: "Refresh the current project match status.",
    args: ["status"]
  }
];

// ---------------------------------------------------------------------------
// Locale overrides (Chinese)
// ---------------------------------------------------------------------------

const CN_CATEGORY_TEXT: Record<TuiCategoryId, Partial<TuiCategory>> = {
  remote: {
    title: "远程同步",
    subtitle: "通过 sidecar 仓库推送 / 拉取 / 恢复 / 日志 / 初始化 / 钩子。",
    toolkitTitle: "远程同步"
  },
  local: {
    title: "本地迁移",
    subtitle: "Codex/Claude 互转、provider 克隆与监控模式。",
    toolkitTitle: "本地迁移"
  },
  doctor: {
    title: "诊断",
    subtitle: "健康检查与会话匹配状态。",
    toolkitTitle: "诊断"
  }
};

const CN_CHOICE_TEXT: Record<string, Partial<TuiChoice>> = {
  p: { badge: "推送", label: "推送会话", description: "把匹配到的会话快照写入 sidecar 仓库。", confirm: "推送当前项目的 agent 会话到 sidecar 仓库？" },
  l: { badge: "拉取", label: "拉取会话", description: "从远程仓库拉取可恢复的 sidecar bundle。" },
  r: { badge: "恢复", label: "按编号恢复", description: "恢复 agent-sync log 中对应编号的会话。", prompt: { label: "恢复编号", placeholder: "输入 agent-sync log 显示的编号" }, confirm: "把这个会话恢复到本机 agent 历史吗？" },
  g: { badge: "日志", label: "查看最新会话", description: "显示最近同步的对话。" },
  i: { badge: "初始化", label: "初始化 sidecar 仓库", description: "创建本地配置与 sidecar 仓库（远程地址可选）。", prompt: { label: "远程地址", placeholder: "git@github.com:you/agent-session-store.git（可选）" } },
  k: { badge: "钩子", label: "安装 pre-push 钩子", description: "在 git push 时入队后台 Agent-Sync 任务。", confirm: "在本仓库安装 Agent-Sync 管理的 pre-push 钩子吗？" },
  c: { badge: "克隆", label: "克隆 Codex 到当前 provider", description: "把当前项目的 Codex 会话复制到当前 provider 下。" },
  e: { badge: "注册", label: "注册本地副本", description: "把 Agent-Sync provider 副本加入本地 Codex 索引。" },
  w: { badge: "监控", label: "监控 provider 变化", description: "移交给长期运行的本地监控命令。" },
  a: { badge: "转Claude", label: "迁移为 Claude JSONL", description: "把已同步的 bundle 导出为可读的 Claude JSONL。", prompt: { label: "Bundle id", placeholder: "粘贴已同步的 bundle id" } },
  o: { badge: "转Codex", label: "迁移为 Codex JSONL", description: "把已同步的 bundle 导出为可读的 Codex JSONL。", prompt: { label: "Bundle id", placeholder: "粘贴已同步的 bundle id" } },
  d: { badge: "诊断", label: "运行 doctor", description: "检查配置、sidecar 仓库、sparse checkout 与 bindings。" },
  s: { badge: "状态", label: "查看会话状态", description: "刷新当前项目的会话匹配状态。" }
};

const COPY = {
  en: {
    kitLine: "Agent Sync Kit",
    tagline: "Git for your AI coding sessions.",
    homeTitle: (projectName: string) => `Agent Sync Kit - ${projectName || "project"}`,
    chooseHint: "Choose a workspace, press Enter to open.",
    openHint: "Enter open  ·  ↑/↓ select  ·  1/2/3 jump  ·  h help  ·  q quit",
    categoryHint: (title: string) => `${title} · press a hotkey or Enter to run`,
    actionHint: "↑/↓ select  ·  Enter run  ·  ←/q back  ·  →/Tab next  ·  h help  ·  0 quit",
    selectWorkspace: "Select workspace [1/2/3, q to quit]",
    selectAction: "Action key [home/q]",
    running: "Running…",
    done: "Done.",
    failed: (status: number) => `Command exited with status ${status}.`,
    cancelled: "Cancelled.",
    valueRequired: (label: string) => `${label} is required.`,
    pressEnter: "Press Enter to return…",
    confirmSuffix: "(y/n)",
    bye: "Bye."
  },
  cn: {
    kitLine: "Agent Sync 中文工具箱",
    tagline: "Git for your AI coding sessions.",
    homeTitle: (projectName: string) => `Agent Sync 中文工具箱 - ${projectName || "项目"}`,
    chooseHint: "选择一个工作区，回车进入。",
    openHint: "Enter 进入  ·  ↑/↓ 选择  ·  1/2/3 跳转  ·  h 帮助  ·  q 退出",
    categoryHint: (title: string) => `${title} · 按热键或回车执行`,
    actionHint: "↑/↓ 选择  ·  Enter 执行  ·  ←/q 返回  ·  →/Tab 下一区  ·  h 帮助  ·  0 退出",
    selectWorkspace: "选择工作区 [1/2/3，q 退出]",
    selectAction: "动作热键 [home/q]",
    running: "执行中…",
    done: "完成。",
    failed: (status: number) => `命令退出码 ${status}。`,
    cancelled: "已取消。",
    valueRequired: (label: string) => `${label} 不能为空。`,
    pressEnter: "按 Enter 返回…",
    confirmSuffix: "(y/n)",
    bye: "再见。"
  }
};

// ---------------------------------------------------------------------------
// Public data accessors (used by the prompt flow, render, and tests)
// ---------------------------------------------------------------------------

export function getTuiCategories(options: Record<string, any> = {}): TuiCategory[] {
  const locale = normalizeTuiLocale(options);
  return TUI_CATEGORIES.map((category) => localizeCategory(category, locale));
}

export function getTuiChoices(options: Record<string, any> = {}): TuiChoice[] {
  const locale = normalizeTuiLocale(options);
  return MENU_CHOICES.map((choice) => localizeChoice(choice, locale));
}

export function resolveTuiCategory(value: string, options: Record<string, any> = {}): TuiCategory | null {
  const key = String(value || "").trim().toLowerCase();
  const categories = getTuiCategories(options);
  return categories.find((category) => {
    return key === String(category.index) || key === category.id || key === category.key.toLowerCase();
  }) || null;
}

export function resolveTuiChoice(value: string, categoryId = "", options: Record<string, any> = {}): TuiChoice | null {
  const key = String(value || "").trim().toLowerCase();
  const choices = getTuiChoices(options);
  return choices.find((choice) => choice.key === key && (!categoryId || choice.category === categoryId)) ||
    choices.find((choice) => choice.key === key) ||
    null;
}

export function filterTuiChoices(choices: TuiChoice[], query = ""): TuiChoice[] {
  const needle = String(query || "").trim().toLowerCase();
  const cloned = choices.map(cloneChoice);
  if (!needle) {
    return cloned;
  }
  return cloned.filter((choice) => {
    const haystack = [choice.key, choice.badge, choice.label, choice.description, formatTuiCommand(choice)].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

export function formatTuiCommand(choice: TuiChoice, prompted = ""): string {
  if (choice.exits) {
    return "exit";
  }
  const value = prompted || promptToken(choice.prompt);
  const args = value ? buildChoiceArgs(choice, value) : [...choice.args];
  return `git agent-sync ${args.map(quoteArg).join(" ")}`;
}

// ---------------------------------------------------------------------------
// Locale helpers
// ---------------------------------------------------------------------------

function normalizeTuiLocale(options: Record<string, any> = {}): TuiLocale {
  return options.locale === "cn" || options.cn ? "cn" : "en";
}

function getCopy(locale: TuiLocale) {
  return locale === "cn" ? COPY.cn : COPY.en;
}

function localizeCategory(category: TuiCategory, locale: TuiLocale): TuiCategory {
  if (locale !== "cn") {
    return { ...category };
  }
  return { ...category, ...(CN_CATEGORY_TEXT[category.id] || {}) };
}

function localizeChoice(choice: TuiChoice, locale: TuiLocale): TuiChoice {
  const cloned = cloneChoice(choice);
  if (cloned.prompt) {
    cloned.prompt.token = promptToken(choice.prompt);
  }
  if (locale !== "cn") {
    return cloned;
  }
  const override = CN_CHOICE_TEXT[choice.key] || {};
  const basePrompt = cloned.prompt;
  const overridePrompt = override.prompt;
  return {
    ...cloned,
    ...override,
    args: cloned.args,
    prompt: (basePrompt || overridePrompt) ? {
      label: overridePrompt?.label ?? basePrompt?.label ?? "",
      placeholder: overridePrompt?.placeholder ?? basePrompt?.placeholder ?? "",
      token: basePrompt?.token
    } : undefined
  };
}

function cloneChoice(choice: TuiChoice): TuiChoice {
  return {
    ...choice,
    args: [...choice.args],
    prompt: choice.prompt ? { ...choice.prompt } : undefined
  };
}

// ---------------------------------------------------------------------------
// Argument helpers
// ---------------------------------------------------------------------------

function buildChoiceArgs(choice: TuiChoice, prompted = ""): string[] {
  const base = [...choice.args];
  if (!prompted) {
    return base;
  }
  if (choice.promptSuffix) {
    return [...base, choice.promptSuffix, prompted];
  }
  return [...base, prompted];
}

function promptToken(prompt?: TuiPrompt): string {
  if (!prompt) {
    return "";
  }
  if (prompt.token) {
    return prompt.token;
  }
  const token = prompt.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `<${token || "value"}>`;
}

function quoteArg(value: string): string {
  if (!/\s/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\\\"")}"`;
}

function isConfirmAccepted(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

function isWatchChoice(choice: TuiChoice): boolean {
  return choice.args[0] === "watch-local" && choice.args.length === 1;
}

// ---------------------------------------------------------------------------
// CLI execution
// ---------------------------------------------------------------------------

function runCliCommand(args: string[], cwd: string, options: Record<string, any> = {}) {
  const cliEntry = process.argv[1] || "agent-sync";
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: options.inherit ? undefined : "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"]
  } as any);
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function normalizeCommandResult(result: TuiCommandResult) {
  if (typeof result === "number") {
    return { status: result, stdout: "", stderr: "" };
  }
  return {
    status: result?.status ?? 0,
    stdout: bufferToString(result?.stdout),
    stderr: bufferToString(result?.stderr)
  };
}

function bufferToString(value: string | Buffer | null | undefined): string {
  if (!value) {
    return "";
  }
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

function compactOutput(value: string): string {
  const lines = value.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  if (lines.length <= 16) {
    return lines.join("\n");
  }
  return [...lines.slice(0, 14), `... ${lines.length - 14} more line(s)`].join("\n");
}

// ---------------------------------------------------------------------------
// Terminal primitives (ANSI, width math, box drawing, single-key reads)
// ---------------------------------------------------------------------------

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  underline: "\x1b[4m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
  brightCyan: "\x1b[96m"
};

const ACCENT_CODE: Record<TuiCategory["accent"], string> = {
  cyan: ANSI.cyan,
  magenta: ANSI.magenta,
  green: ANSI.green
};

const COLOR_ENABLED = detectColor();

function detectColor(): boolean {
  if (process.env.NO_COLOR) {
    return false;
  }
  return Boolean(defaultOutput.isTTY);
}

function style(code: string, text: string, ...mods: string[]): string {
  if (!COLOR_ENABLED || !code) {
    return text;
  }
  return [...mods, code].join("") + text + ANSI.reset;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function displayWidth(text: string): number {
  const stripped = stripAnsi(text);
  let width = 0;
  for (const ch of stripped) {
    if (ch === "\t") {
      width += 4 - (width % 4);
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      continue;
    }
    const code = ch.codePointAt(0) || 0;
    // Approximate east-asian wide range (CJK + fullwidth) → 2 cells.
    const wide = code >= 0x1100 && (
      code <= 0x115f || // Hangul Jamo
      (code >= 0x2e80 && code <= 0x303e) ||
      (code >= 0x3041 && code <= 0x33ff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xa000 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    );
    width += wide ? 2 : 1;
  }
  return width;
}

function padRight(text: string, width: number): string {
  const padding = width - displayWidth(text);
  if (padding <= 0) {
    return text;
  }
  return text + " ".repeat(padding);
}

function ellipsizeMiddle(text: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }
  if (displayWidth(text) <= maxWidth) {
    return text;
  }
  if (maxWidth <= 4) {
    return stripAnsi(text).slice(0, maxWidth);
  }
  const ellipsis = "…";
  const stripped = stripAnsi(text);
  const prefixWidth = Math.floor((maxWidth - 1) / 2);
  const suffixWidth = maxWidth - 1 - prefixWidth;
  return `${stripped.slice(0, prefixWidth)}${ellipsis}${stripped.slice(stripped.length - suffixWidth)}`;
}

function centerPad(text: string, width: number): string {
  const padding = Math.max(0, width - displayWidth(text));
  return `${" ".repeat(Math.floor(padding / 2))}${text}`;
}

function termWidth(): number {
  return defaultOutput.columns || 80;
}

function termHeight(): number {
  return defaultOutput.rows || 24;
}

function renderBox(lines: string[], width: number, borderCode = ""): string[] {
  const inner = Math.max(1, width - 4);
  const out: string[] = [];
  const top = `┌${"─".repeat(width - 2)}┐`;
  const bottom = `└${"─".repeat(width - 2)}┘`;
  out.push(style(borderCode || ANSI.dim, top, ANSI.dim));
  const resetSuffix = COLOR_ENABLED ? ANSI.reset : "";
  for (const line of lines) {
    const content = padRight(ellipsizeMiddle(line, inner), inner);
    const border = style(borderCode || ANSI.dim, "│", ANSI.dim);
    out.push(`${border} ${content} ${border}`.replace(/\x1b\[0m$/, "") + resetSuffix);
  }
  out.push(style(borderCode || ANSI.dim, bottom, ANSI.dim));
  return out;
}

function clearScreen(): void {
  defaultOutput.write("\x1b[2J\x1b[H");
}

function writeCenteredLines(lines: string[]): void {
  const width = termWidth();
  for (const line of lines) {
    defaultOutput.write(centerPad(line, width) + "\n");
  }
}

function writeCenteredBox(lines: string[], borderCode = ""): void {
  const width = Math.min(termWidth(), 92);
  writeCenteredLines(renderBox(lines, width, borderCode));
}

// Read one normalized key from a raw TTY stdin. Returns tokens like
// "ENTER", "UP", "ESC", "CTRL_C", "BACKSPACE", or a single printable char.
function readKey(): Promise<string | null> {
  return new Promise((resolve) => {
    const cleanup = () => {
      defaultInput.removeListener("data", onData);
      defaultInput.removeListener("end", onEnd);
    };
    const onData = (buf: Buffer) => {
      cleanup();
      resolve(normalizeKey(buf));
    };
    const onEnd = () => {
      cleanup();
      resolve(null);
    };
    defaultInput.once("data", onData);
    defaultInput.once("end", onEnd);
  });
}

function normalizeKey(buf: Buffer): string {
  const s = buf.toString("utf8");
  if (s === "\r" || s === "\n") {
    return "ENTER";
  }
  if (s === "\x03") {
    return "CTRL_C";
  }
  if (s === "\x04") {
    return "CTRL_D";
  }
  if (s === "\x7f" || s === "\x08") {
    return "BACKSPACE";
  }
  if (s === "\t") {
    return "TAB";
  }
  if (s === "\x1b") {
    return "ESC";
  }
  if (s === "\x1b[A") {
    return "UP";
  }
  if (s === "\x1b[B") {
    return "DOWN";
  }
  if (s === "\x1b[C") {
    return "RIGHT";
  }
  if (s === "\x1b[D") {
    return "LEFT";
  }
  if (s === "\x1b[5~") {
    return "PAGE_UP";
  }
  if (s === "\x1b[6~") {
    return "PAGE_DOWN";
  }
  return s;
}

// Minimal raw-mode line editor: echo printable chars, handle backspace, ESC.
async function readLineEditor(promptText: string): Promise<string | null> {
  defaultOutput.write(promptText);
  let buf = "";
  while (true) {
    const key = await readKey();
    if (key === null || key === "ESC" || key === "CTRL_C" || key === "CTRL_D") {
      return null;
    }
    if (key === "ENTER") {
      defaultOutput.write("\n");
      return buf;
    }
    if (key === "BACKSPACE") {
      if (buf) {
        buf = buf.slice(0, -1);
        defaultOutput.write("\b \b");
      }
      continue;
    }
    if (key.length === 1 && /[\x20-\x7e]/.test(key)) {
      buf += key;
      defaultOutput.write(key);
    }
  }
}

async function readYesNo(): Promise<boolean> {
  while (true) {
    const key = await readKey();
    if (key === null) {
      return false;
    }
    if (key === "CTRL_C" || key === "CTRL_D") {
      return false;
    }
    const lower = String(key).toLowerCase();
    if (lower === "y") {
      return true;
    }
    if (lower === "n" || key === "ESC") {
      return false;
    }
  }
}

async function readEnter(): Promise<void> {
  while (true) {
    const key = await readKey();
    if (key === null || key === "ENTER" || key === "CTRL_C" || key === "CTRL_D" || key === "ESC") {
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Brand header (figlet + gradient)
// ---------------------------------------------------------------------------

const FIGLET_FONT = "ANSI Shadow";
const LOGO_WORDS: Record<"home" | TuiCategoryId, string> = {
  home: "AGENT SYNC",
  remote: "REMOTE SYNC",
  local: "LOCAL",
  doctor: "DOCTOR"
};
const LOGO_GRADIENTS: Record<"home" | TuiCategoryId, string[]> = {
  home: ["#27f8ff", "#0467ff"],
  remote: ["#27f8ff", "#0467ff"],
  local: ["#22d3ee", "#f000ff"],
  doctor: ["#34d399", "#059669"]
};

function getLogoLines(kind: "home" | TuiCategoryId): string[] {
  try {
    const rendered = figlet.textSync(LOGO_WORDS[kind], { font: FIGLET_FONT });
    return rendered.split(/\r?\n/).map((line) => line.replace(/\s+$/, "")).filter((line, index, arr) => {
      // Drop trailing blank lines figlet sometimes appends.
      return index < arr.length - 1 || line.length > 0;
    });
  } catch {
    return [LOGO_WORDS[kind]];
  }
}

function gradientLogoLines(kind: "home" | TuiCategoryId): string[] {
  const lines = getLogoLines(kind);
  if (!COLOR_ENABLED) {
    return lines;
  }
  const painter = gradient(LOGO_GRADIENTS[kind]);
  return lines.map((line) => (line ? painter(line) : line));
}

// ---------------------------------------------------------------------------
// Content builders (shared by renderTuiMenu string + full-screen redraw)
// ---------------------------------------------------------------------------

function choicesForCategory(choices: TuiChoice[], categoryId: TuiCategoryId): TuiChoice[] {
  return choices.filter((choice) => choice.category === categoryId);
}

function buildHomeLines(config: Record<string, any>, locale: TuiLocale, selectedCategoryIndex: number): string[] {
  const copy = getCopy(locale);
  const categories = getTuiCategories({ locale });
  const lines: string[] = [];
  lines.push(...gradientLogoLines("home"));
  lines.push(style(ANSI.bold + ANSI.cyan, copy.kitLine, ANSI.bold));
  lines.push(style(ANSI.dim, copy.tagline));
  lines.push(style(ANSI.dim, copy.homeTitle(config.projectName || config.projectRoot || "")));
  lines.push("");
  lines.push(style(ANSI.dim, copy.chooseHint));
  lines.push("");

  const pointer = "›";
  const body: string[] = [];
  categories.forEach((category, index) => {
    const accent = ACCENT_CODE[category.accent];
    const header = `[${category.key}] ${category.title}`;
    const count = choicesForCategory(getTuiChoices({ locale }), category.id).length;
    if (index === selectedCategoryIndex) {
      body.push(`${style(ANSI.bold + ANSI.brightCyan, pointer)} ${style(accent, header, ANSI.bold)}`);
    } else {
      body.push(`  ${style(ANSI.dim, header)}`);
    }
    body.push(`    ${style(ANSI.dim, category.subtitle)}`);
    body.push(`    ${style(ANSI.dim, `${count} action(s)`)}`);
  });
  lines.push(...renderBox(body, Math.min(termWidth(), 92), ACCENT_CODE.cyan));
  lines.push("");
  lines.push(style(ANSI.dim, copy.openHint));
  return lines;
}

function buildCategoryLines(config: Record<string, any>, locale: TuiLocale, categoryId: TuiCategoryId, selectedActionIndex: number): string[] {
  const copy = getCopy(locale);
  const categories = getTuiCategories({ locale });
  const category = categories.find((item) => item.id === categoryId);
  if (!category) {
    return buildHomeLines(config, locale, 0);
  }
  const accent = ACCENT_CODE[category.accent];
  const allChoices = getTuiChoices({ locale });
  const actions = choicesForCategory(allChoices, category.id);

  const lines: string[] = [];
  lines.push(...gradientLogoLines(category.id));
  lines.push(style(ANSI.bold + accent, category.toolkitTitle, ANSI.bold));
  lines.push(style(ANSI.dim, category.subtitle));
  lines.push("");

  // Workspace tabs row.
  const tabs = categories.map((item, index) => {
    const label = `[${item.key}] ${item.title}`;
    return index === categories.findIndex((entry) => entry.id === categoryId)
      ? style(ANSI.bold + ACCENT_CODE[item.accent], label, ANSI.underline)
      : style(ANSI.dim, label);
  });
  lines.push(tabs.join("   "));
  lines.push("");

  const pointer = "›";
  const body: string[] = [];
  actions.forEach((choice, index) => {
    const badge = style(ANSI.bold + accent, `[${choice.badge}]`);
    const hotkey = style(ANSI.dim + accent, `[${choice.key}]`);
    const labelLine = `${badge} ${hotkey} ${choice.label}`;
    if (index === selectedActionIndex) {
      body.push(`${style(ANSI.bold + ANSI.brightCyan, pointer)} ${style(ANSI.bold + ANSI.underline + accent, labelLine, ANSI.bold)}`);
    } else {
      body.push(`  ${labelLine}`);
    }
    body.push(style(ANSI.dim, choice.description));
    body.push(style(ANSI.dim, formatTuiCommand(choice)));
    body.push("");
  });
  if (body.length && body[body.length - 1] === "") {
    body.pop();
  }
  lines.push(...renderBox(body, Math.min(termWidth(), 110), accent));
  lines.push("");
  lines.push(style(ANSI.dim, copy.actionHint));
  return lines;
}

// ---------------------------------------------------------------------------
// renderTuiMenu: plain string preview (tests + non-TTY fallback)
// ---------------------------------------------------------------------------

export function renderTuiMenu(config: Record<string, any>, options: Record<string, any> = {}): string {
  const locale = normalizeTuiLocale(options);
  if (options.categoryId) {
    return buildCategoryLines(config, locale, options.categoryId, 0).join("\n");
  }
  return buildHomeLines(config, locale, 0).join("\n");
}

// ---------------------------------------------------------------------------
// runTui entry + prompt (deterministic) flow
// ---------------------------------------------------------------------------

export async function runTui(gitRoot: string, config: Record<string, any>, options: Record<string, any> = {}) {
  const locale = normalizeTuiLocale(options);
  if (options.io) {
    await runPromptTui(gitRoot, config, { ...options, locale });
    return;
  }
  if (!defaultInput.isTTY || !defaultOutput.isTTY) {
    defaultOutput.write(`${renderTuiMenu(config, { locale })}\n`);
    return;
  }
  await runFullscreenTui(gitRoot, config, { ...options, locale });
}

async function runPromptTui(gitRoot: string, config: Record<string, any>, options: Record<string, any> = {}) {
  const io = options.io;
  const runner: TuiRunner = options.runner || ((args: string[], cwd: string) => runCliCommand(args, cwd));
  const locale = normalizeTuiLocale(options);
  const copy = getCopy(locale);

  while (true) {
    defaultOutput.write(`\n${renderTuiMenu(config, { locale })}\n`);
    const categoryAnswer = String(await io.question(`\n${copy.selectWorkspace}: `)).trim();
    if (categoryAnswer.toLowerCase() === "q") {
      defaultOutput.write(`${copy.bye}\n`);
      return;
    }
    const category = resolveTuiCategory(categoryAnswer, { locale });
    if (!category) {
      defaultOutput.write(`${copy.selectWorkspace}\n`);
      continue;
    }

    while (true) {
      defaultOutput.write(`\n${renderTuiMenu(config, { locale, categoryId: category.id })}\n`);
      const answer = String(await io.question(`\n${copy.selectAction}: `)).trim();
      const normalized = answer.toLowerCase();
      if (normalized === "home" || normalized === "back" || normalized === "b") {
        break;
      }
      if (normalized === "q") {
        defaultOutput.write(`${copy.bye}\n`);
        return;
      }
      const choice = resolveTuiChoice(answer, category.id, { locale });
      if (!choice || choice.category !== category.id) {
        defaultOutput.write(`${copy.selectAction}\n`);
        continue;
      }
      if (choice.exits) {
        defaultOutput.write(`${copy.bye}\n`);
        return;
      }

      // log/restore first print the full session list (untruncated) so the
      // user can find a number; restore then asks for it.
      let prompted = "";
      if (choice.browser) {
        const listResult = normalizeCommandResult(await runner(["log", "--latest", "--oneline", "-40"], gitRoot));
        const listText = [listResult.stdout, listResult.stderr].filter(Boolean).join("\n").trim();
        defaultOutput.write(`\n${choice.label}:\n${listText || (locale === "cn" ? "(无会话)" : "(no sessions)")}\n`);
        if (listResult.status !== 0) {
          await io.question(`\n${copy.pressEnter}`);
          continue;
        }
        if (choice.browser === "log") {
          await io.question(`\n${copy.pressEnter}`);
          continue;
        }
        // restore: ask for the number shown above.
        prompted = String(await io.question(`${choice.label} ${locale === "cn" ? "编号" : "index"}: `)).trim();
        if (!/^\d+$/.test(prompted)) {
          defaultOutput.write(`${locale === "cn" ? "需要数字编号" : "Numeric index required"}\n`);
          continue;
        }
      } else if (choice.prompt) {
        prompted = String(await io.question(`${choice.prompt.label}: `)).trim();
        if (!prompted && !choice.promptSuffix) {
          defaultOutput.write(`${copy.valueRequired(choice.prompt.label)}\n`);
          continue;
        }
      }

      defaultOutput.write(`${formatTuiCommand(choice, prompted)}\n`);
      if (choice.confirm) {
        const confirmation = String(await io.question(`${choice.confirm} ${copy.confirmSuffix}: `)).trim();
        if (!isConfirmAccepted(confirmation)) {
          defaultOutput.write(`${copy.cancelled}\n`);
          continue;
        }
      }

      const result = normalizeCommandResult(await runner(buildChoiceArgs(choice, prompted), gitRoot));
      if (result.status !== 0) {
        defaultOutput.write(`${copy.failed(result.status)}\n`);
      }
      if (!isWatchChoice(choice)) {
        await io.question(`\n${copy.pressEnter}`);
      } else {
        return;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// runFullscreenTui: raw full-screen single-key experience
// ---------------------------------------------------------------------------

async function runFullscreenTui(gitRoot: string, config: Record<string, any>, options: Record<string, any> = {}) {
  const locale = normalizeTuiLocale(options);
  const copy = getCopy(locale);
  const runner: TuiRunner = options.runner || ((args: string[], cwd: string) => runCliCommand(args, cwd));
  const categories = getTuiCategories({ locale });

  let view: "home" | "category" = "home";
  let categoryIndex = 0;
  let actionIndex = 0;

  const enterRaw = () => {
    setRawMode(true);
    defaultInput.resume();
  };
  const exitRaw = () => {
    setRawMode(false);
  };

  const drawFrame = () => {
    if (view === "home") {
      const lines = buildHomeLines(config, locale, categoryIndex);
      writeFrame(lines);
    } else {
      const cat = categories[categoryIndex];
      const lines = buildCategoryLines(config, locale, cat.id, actionIndex);
      writeFrame(lines);
    }
  };

  enterRaw();
  defaultOutput.write("\x1b[?1049h\x1b[?25l"); // alt screen + hide cursor
  try {
    let needsRedraw = true;
    while (true) {
      if (needsRedraw) {
        drawFrame();
        needsRedraw = false;
      }
      const key = await readKey();
      if (key === null || key === "CTRL_C" || key === "CTRL_D") {
        break;
      }
      if (view === "home") {
        if (key === "UP" || key === "k") {
          categoryIndex = wrap(categoryIndex - 1, categories.length);
          needsRedraw = true;
        } else if (key === "DOWN" || key === "j") {
          categoryIndex = wrap(categoryIndex + 1, categories.length);
          needsRedraw = true;
        } else if (key === "ENTER" || key === "RIGHT") {
          view = "category";
          actionIndex = 0;
          needsRedraw = true;
        } else if (key === "ESC" || key === "q") {
          break;
        } else if (key === "h" || key === "?") {
          await showHelp(locale, "home");
          needsRedraw = true;
        } else {
          const cat = resolveTuiCategory(key, { locale });
          if (cat) {
            categoryIndex = Math.max(0, categories.findIndex((item) => item.id === cat.id));
            view = "category";
            actionIndex = 0;
            needsRedraw = true;
          }
        }
      } else {
        const cat = categories[categoryIndex];
        const actions = choicesForCategory(getTuiChoices({ locale }), cat.id);
        if (key === "UP" || key === "k") {
          actionIndex = wrap(actionIndex - 1, actions.length);
          needsRedraw = true;
        } else if (key === "DOWN" || key === "j") {
          actionIndex = wrap(actionIndex + 1, actions.length);
          needsRedraw = true;
        } else if (key === "LEFT" || key === "ESC" || key === "q" || key === "b") {
          view = "home";
          needsRedraw = true;
        } else if (key === "RIGHT" || key === "TAB" || key === "PAGE_DOWN") {
          categoryIndex = wrap(categoryIndex + 1, categories.length);
          view = "category";
          actionIndex = 0;
          needsRedraw = true;
        } else if (key === "PAGE_UP") {
          categoryIndex = wrap(categoryIndex - 1, categories.length);
          view = "category";
          actionIndex = 0;
          needsRedraw = true;
        } else if (key === "0") {
          break;
        } else if (key === "h" || key === "?") {
          await showHelp(locale, "category");
          needsRedraw = true;
        } else if (key === "ENTER") {
          const choice = actions[actionIndex];
          if (choice) {
            if (await runAction(choice, { gitRoot, runner, copy, locale })) {
              break;
            }
            needsRedraw = true;
          }
        } else {
          const choice = actions.find((item) => item.key === String(key).toLowerCase());
          if (choice) {
            if (await runAction(choice, { gitRoot, runner, copy, locale })) {
              break;
            }
            needsRedraw = true;
          }
        }
      }
    }
  } finally {
    defaultOutput.write("\x1b[?25h\x1b[?1049l"); // show cursor + leave alt screen
    exitRaw();
  }
}

function writeFrame(lines: string[]): void {
  // Incremental overdraw: hide cursor, home, clear-to-eol per line, clear-to-eos.
  const out = lines.map((line) => `${line}\x1b[K`).join("\n");
  defaultOutput.write(`\x1b[?25l\x1b[H${out}\n\x1b[J`);
}

async function runAction(
  choice: TuiChoice,
  ctx: { gitRoot: string; runner: TuiRunner; copy: ReturnType<typeof getCopy>; locale: TuiLocale }
): Promise<boolean> {
  const { gitRoot, runner, copy, locale } = ctx;
  let prompted = "";

  if (choice.browser) {
    const picked = await browseSessions(choice, ctx);
    if (choice.browser === "log") {
      // log only browses; nothing to run afterwards.
      return false;
    }
    if (picked === null) {
      // restore cancelled / no selection.
      return false;
    }
    prompted = picked;
  } else if (choice.prompt) {
    clearScreen();
    writeCenteredLines([...brandHeader(choice.category, locale), ""]);
    const info = [
      `${style(ANSI.dim, "Action")} : ${style(ANSI.bold, choice.label)}`,
      `${style(ANSI.dim, "Command")} : ${style(ANSI.dim, formatTuiCommand(choice))}`
    ];
    writeCenteredBox(info, ANSI.dim);
    defaultOutput.write("\n");
    const line = await readLineEditor(`${style(ANSI.bold + ANSI.cyan, `${choice.prompt.label}: `)}`);
    if (line === null) {
      await flashMessage(copy.cancelled, locale);
      return false;
    }
    prompted = line.trim();
    if (!prompted && !choice.promptSuffix) {
      await flashMessage(copy.valueRequired(choice.prompt.label), locale);
      return false;
    }
  }

  if (choice.confirm) {
    clearScreen();
    writeCenteredLines([...brandHeader(choice.category, locale), ""]);
    const info = [
      `${style(ANSI.yellow, "⚠ Confirm")}`,
      `${style(ANSI.dim, "Action")} : ${style(ANSI.bold, choice.label)}`,
      `${style(ANSI.dim, "Command")} : ${style(ANSI.dim, formatTuiCommand(choice, prompted))}`,
      "",
      choice.confirm,
      `${style(ANSI.dim, copy.confirmSuffix)}`
    ];
    writeCenteredBox(info, ANSI.yellow);
    defaultOutput.write("\n");
    const ok = await readYesNo();
    if (!ok) {
      await flashMessage(copy.cancelled, locale);
      return false;
    }
  }

  if (choice.handoff) {
    // Leave the fullscreen surface, then run the long-lived watch in foreground.
    defaultOutput.write("\x1b[?25h\x1b[?1049l");
    setRawMode(false);
    runCliCommand(buildChoiceArgs(choice, prompted), gitRoot, { inherit: true });
    return true;
  }

  clearScreen();
  writeCenteredLines([...brandHeader(choice.category, locale), ""]);
  writeCenteredLine(style(ANSI.bold + ANSI.cyan, `▶ ${choice.label}`, ANSI.bold));
  defaultOutput.write("\n");
  const runInfo = [
    `${style(ANSI.dim, "Running")} : ${style(ANSI.bold, copy.running)}`,
    `${style(ANSI.dim, "Command")} : ${style(ANSI.dim, formatTuiCommand(choice, prompted))}`
  ];
  writeCenteredBox(runInfo, ANSI.dim);
  defaultOutput.write("\n");

  let result: { status: number; stdout: string; stderr: string };
  try {
    result = normalizeCommandResult(await runner(buildChoiceArgs(choice, prompted), gitRoot));
  } catch (error) {
    result = { status: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }

  const combined = compactOutput([result.stdout, result.stderr].filter(Boolean).join("\n"));
  const statusLine = result.status === 0
    ? style(ANSI.green, copy.done, ANSI.bold)
    : style(ANSI.yellow, copy.failed(result.status), ANSI.bold);
  const outLines: string[] = [statusLine];
  if (combined) {
    outLines.push("", ...combined.split(/\r?\n/).map((line) => style(ANSI.dim, line)));
  }
  writeCenteredBox(outLines, result.status === 0 ? ANSI.green : ANSI.yellow);
  defaultOutput.write("\n");
  writeCenteredLine(style(ANSI.dim, copy.pressEnter));
  await readEnter();
  return false;
}

// --- Session browser (log / restore) --------------------------------------
//
// Both `log` and `restore` need to show the full synced conversation list so
// the user can find a number. We source it from `log --latest --json` (one
// structured call) and render every entry ourselves — this avoids the
// `compactOutput` ceiling that used to truncate `log --oneline -20` to ~4
// visible rows. `log` just browses; `restore` lets the user pick a number and
// returns it so runAction can run `restore --index <n>`.

type BindingEntry = {
  index: number;        // 1-based, matches `restore --index` semantics
  title: string;
  agent: string;
  date: string;
  commit: string;
  bundleId: string;
};

async function fetchBindingEntries(ctx: { gitRoot: string; runner: TuiRunner }): Promise<{ entries: BindingEntry[]; error: string | null }> {
  let result;
  try {
    result = normalizeCommandResult(await ctx.runner(["log", "--latest", "--json"], ctx.gitRoot));
  } catch (error) {
    return { entries: [], error: error instanceof Error ? error.message : String(error) };
  }
  if (result.status !== 0) {
    return { entries: [], error: [result.stderr, result.stdout].filter(Boolean).join("\n").trim() || `log exited with status ${result.status}` };
  }
  let parsed: any[];
  try {
    parsed = JSON.parse(result.stdout || "[]");
  } catch {
    return { entries: [], error: "log --json returned invalid JSON." };
  }
  if (!Array.isArray(parsed)) {
    return { entries: [], error: "log --json did not return a list." };
  }
  const entries: BindingEntry[] = parsed.map((binding, index) => ({
    index: index + 1,
    title: String(binding?.title || binding?.bundleId || "(untitled)"),
    agent: String(binding?.agent || "?"),
    date: String(binding?.conversationAt || binding?.syncedAt || binding?.boundAt || "").replace("T", " ").replace(/\.\d+Z$/, "").replace(/Z$/, ""),
    commit: String(binding?.projectCommit || "").slice(0, 8),
    bundleId: String(binding?.bundleId || "")
  }));
  return { entries, error: null };
}

function ellipsizeBindingText(text: string, width: number): string {
  return displayWidth(text) <= width ? text : `${stripAnsi(text).slice(0, Math.max(1, width - 1))}…`;
}

async function browseSessions(
  choice: TuiChoice,
  ctx: { gitRoot: string; runner: TuiRunner; copy: ReturnType<typeof getCopy>; locale: TuiLocale }
): Promise<string | null> {
  const { runner, locale } = ctx;
  const isRestore = choice.browser === "restore";

  // Loading frame.
  clearScreen();
  writeCenteredLines([...brandHeader(choice.category, locale), ""]);
  writeCenteredLine(style(ANSI.bold + ANSI.cyan, `▶ ${choice.label}`, ANSI.bold));
  defaultOutput.write("\n");
  writeCenteredBox([style(ANSI.dim, getCopy(locale).running)], ANSI.dim);
  defaultOutput.write("\n");

  const { entries, error } = await fetchBindingEntries(ctx);
  if (error) {
    await flashMessage(error, locale);
    return null;
  }
  if (!entries.length) {
    await flashMessage(locale === "cn" ? "没有可浏览的会话。先 push 或 pull。" : "No sessions to browse. Try push or pull first.", locale);
    return null;
  }

  // Browse loop.
  const pointer = "›";
  let selected = 0;
  const innerWidth = Math.min(termWidth(), 110) - 6;
  const page = Math.max(6, termHeight() - 12);
  let needsRedraw = true;

  const hint = isRestore
    ? (locale === "cn" ? "↑/↓ 选择 · Enter 恢复该编号 · q/Esc 返回" : "↑/↓ select · Enter restore this index · q/Esc back")
    : (locale === "cn" ? "↑/↓ 浏览 · Enter/q 返回" : "↑/↓ browse · Enter/q back");

  while (true) {
    if (needsRedraw) {
      const lines: string[] = [];
      lines.push(...brandHeader(choice.category, locale));
      lines.push(style(ANSI.bold + ANSI.cyan, choice.label, ANSI.bold));
      lines.push(style(ANSI.dim, `${entries.length} session(s) · ${hint}`));
      lines.push("");
      let start = Math.max(0, selected - Math.floor(page / 2));
      start = Math.min(start, Math.max(0, entries.length - page));
      const end = Math.min(entries.length, start + page);
      if (start > 0) {
        lines.push(style(ANSI.dim, `  … ${start} earlier`));
      }
      for (let i = start; i < end; i += 1) {
        const entry = entries[i];
        const num = `${String(entry.index).padStart(3, " ")}`;
        const agent = `[${entry.agent}]`.padEnd(9, " ");
        const commit = entry.commit ? ` ${entry.commit}` : "";
        const remain = Math.max(10, innerWidth - num.length - agent.length - commit.length - 3);
        const title = ellipsizeBindingText(entry.title, remain);
        const row = `${num}  ${agent} ${title}${commit}`;
        if (i === selected) {
          lines.push(`${style(ANSI.bold + ANSI.brightCyan, pointer)} ${style(ANSI.bold + ANSI.underline + ANSI.cyan, row, ANSI.bold)}`);
        } else {
          lines.push(`  ${style(ANSI.dim, num)}  ${style(ANSI.dim, agent)} ${title}${style(ANSI.dim, commit)}`);
        }
      }
      if (end < entries.length) {
        lines.push(style(ANSI.dim, `  … ${entries.length - end} more`));
      }
      writeFrame(lines);
      needsRedraw = false;
    }

    const key = await readKey();
    if (key === null || key === "CTRL_C" || key === "CTRL_D") {
      return null;
    }
    if (key === "UP" || key === "k") {
      selected = wrap(selected - 1, entries.length);
      needsRedraw = true;
      continue;
    }
    if (key === "DOWN" || key === "j") {
      selected = wrap(selected + 1, entries.length);
      needsRedraw = true;
      continue;
    }
    if (key === "q" || key === "ESC" || key === "b") {
      return null;
    }
    if (key === "ENTER") {
      if (isRestore) {
        return String(entries[selected].index);
      }
      return null;
    }
  }
}

function setRawMode(enabled: boolean): void {
  const input = defaultInput as any;
  if (input && typeof input.setRawMode === "function") {
    input.setRawMode(enabled);
  }
}

async function flashMessage(message: string, locale: TuiLocale): Promise<void> {
  clearScreen();
  writeCenteredLines([...brandHeader("home", locale), ""]);
  writeCenteredBox([style(ANSI.yellow, message)], ANSI.dim);
  defaultOutput.write("\n");
  writeCenteredLine(style(ANSI.dim, getCopy(locale).pressEnter));
  await readEnter();
}

function writeCenteredLine(text: string): void {
  defaultOutput.write(`${centerPad(text, termWidth())}\n`);
}

function brandHeader(kind: "home" | TuiCategoryId, locale: TuiLocale): string[] {
  const copy = getCopy(locale);
  const lines = [...gradientLogoLines(kind)];
  const category = getTuiCategories({ locale }).find((item) => item.id === kind);
  if (category) {
    lines.push(style(ANSI.bold + ACCENT_CODE[category.accent], category.toolkitTitle, ANSI.bold));
    lines.push(style(ANSI.dim, category.subtitle));
  } else {
    lines.push(style(ANSI.bold + ANSI.cyan, copy.kitLine, ANSI.bold));
    lines.push(style(ANSI.dim, copy.tagline));
  }
  return lines;
}

async function showHelp(locale: TuiLocale, screen: "home" | "category"): Promise<void> {
  const copy = getCopy(locale);
  clearScreen();
  writeCenteredLines([...brandHeader("home", locale), ""]);
  const lines: string[] = [
    style(ANSI.bold, "Keys"),
    screen === "home"
      ? `↑/↓ or j/k  select workspace`
      : `↑/↓ or j/k  select action`,
    `1/2/3      jump to workspace`,
    `Enter      ${screen === "home" ? "open workspace" : "run selected action"}`,
    `←/q/Esc    ${screen === "home" ? "quit" : "back to home"}`,
    `→/Tab/PgDn next workspace · PgUp previous`,
    `h or ?     this help`,
    `0 / Ctrl-C quit`,
    "",
    style(ANSI.bold, "Tips"),
    locale === "cn"
      ? "每个动作都是一次 git agent-sync 子命令；危险或写操作会先确认。"
      : "Every action is one git agent-sync subcommand; writes confirm first."
  ];
  writeCenteredBox(lines, ANSI.dim);
  defaultOutput.write("\n");
  writeCenteredLine(style(ANSI.dim, copy.pressEnter));
  await readEnter();
}

// ---------------------------------------------------------------------------
// Small utils
// ---------------------------------------------------------------------------

function wrap(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return (index + length) % length;
}
