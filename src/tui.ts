import { spawnSync } from "node:child_process";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createInterface } from "node:readline/promises";
import figlet from "figlet";
import gradient from "gradient-string";
import React, { useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";

type TuiPrompt = {
  label: string;
  placeholder: string;
  token?: string;
};

type TuiChoice = {
  key: string;
  label: string;
  description: string;
  args: string[];
  view: string;
  badge: string;
  prompt?: TuiPrompt;
  exits?: boolean;
  handoff?: boolean;
  confirm?: string;
};

type TuiCategoryId = "remote" | "local";

type TuiView = {
  id: string;
  title: string;
  subtitle: string;
  category: TuiCategoryId;
};

type TuiCategory = {
  id: TuiCategoryId;
  index: number;
  key: string;
  title: string;
  subtitle: string;
  toolkitTitle: string;
  toolkitSubtitle: string;
  accent: string;
  secondaryAccent: string;
};

type TuiCommandResult = number | {
  status?: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
};

type TuiRunner = (args: string[], cwd: string) => TuiCommandResult | Promise<TuiCommandResult>;
type TuiLocale = "en" | "cn";

const h = React.createElement;

const CN_VIEW_TEXT = {
  dashboard: { title: "Sync / Browse", subtitle: "扫描项目、浏览最新 sidecar、拉取或推送会话" },
  queue: { title: "Queue / Daemon", subtitle: "后台队列、失败重试、daemon 启停" },
  history: { title: "Session / Browse", subtitle: "浏览 bindings，并按可见编号恢复" },
  local: { title: "Provider / Clone", subtitle: "本机 Codex provider 克隆、注册和监听" },
  tool: { title: "Bundle / Transfer", subtitle: "检查 bundle，并转换为 Conversation IR" },
  privacy: { title: "Privacy / Redact", subtitle: "sidecar push 前扫描、脱敏或显式放行" },
  conflicts: { title: "Conflict / Resolve", subtitle: "查看 sidecar 冲突隔离区和解决状态" },
  ops: { title: "Repair / Maintenance", subtitle: "doctor 检查、hook 安装和维护" }
};

const CN_CATEGORY_TEXT = {
  remote: {
    title: "Sidecar Sync Toolkit",
    subtitle: "推送 / 拉取 / 隐私 / 冲突 / 后台守护",
    toolkitTitle: "SIDECAR SYNC TOOLKIT",
    toolkitSubtitle: "远程对话同步工具箱"
  },
  local: {
    title: "Codex Session Toolkit",
    subtitle: "克隆 / 浏览 / 导出 / 修复 Codex 会话",
    toolkitTitle: "CODEX SESSION TOOLKIT",
    toolkitSubtitle: "Codex 会话工具箱"
  }
};

const CN_CHOICE_TEXT = {
  "dashboard:1": { badge: "扫描", label: "状态 / 扫描本机会话", description: "刷新当前项目的会话匹配状态。" },
  "dashboard:2": { badge: "日志", label: "查看最新 sidecar 会话", description: "显示最近同步的对话。" },
  "dashboard:3": { badge: "拉取", label: "拉取 sidecar 会话", description: "获取并准备可恢复的 sidecar bundle。" },
  "dashboard:4": { badge: "推送", label: "推送 sidecar 会话", description: "带隐私 review 快照当前项目会话。", confirm: "要把当前项目的 agent 会话推送到 sidecar store 吗？" },
  "dashboard:5": {
    badge: "恢复",
    label: "按默认日志编号恢复",
    description: "恢复 agent-sync log 中显示的编号项。",
    prompt: { label: "恢复编号", placeholder: "输入 agent-sync log 中显示的编号" },
    confirm: "要把这个会话恢复到本机 agent 历史吗？"
  },
  "queue:8": { badge: "队列", label: "查看同步队列状态", description: "查看 pending、running、done、failed 和 cancelled 任务。" },
  "queue:9": { badge: "队列", label: "加入后台同步队列", description: "把 sidecar push 入队并启动 worker。" },
  "queue:f": { badge: "执行", label: "立即 flush 队列", description: "在当前终端处理队列任务。" },
  "queue:u": {
    badge: "重试",
    label: "重试失败队列任务",
    description: "把 failed 或 cancelled 同步任务放回 pending。",
    prompt: { label: "任务 id 或 all", placeholder: "输入任务 id 前缀或 all" }
  },
  "queue:K": {
    badge: "取消",
    label: "取消 pending 队列任务",
    description: "把匹配的 pending 任务移到 cancelled，不中断 running 任务。",
    prompt: { label: "任务 id 或 all", placeholder: "输入任务 id 前缀或 all" },
    confirm: "要取消匹配的 pending 同步任务吗？"
  },
  "queue:d": { badge: "守护", label: "查看 daemon 状态", description: "读取本机 worker 状态文件。" },
  "queue:b": { badge: "守护", label: "启动 daemon", description: "启动后台 worker 循环。" },
  "queue:k": { badge: "守护", label: "停止 daemon", description: "请求本机 worker 停止。" },
  "history:l": { badge: "日志", label: "查看最新 bindings", description: "用稳定编号浏览最近一次同步批次。" },
  "history:c": { badge: "HEAD", label: "查看当前 commit bindings", description: "浏览绑定到当前 commit 的会话。" },
  "history:s": {
    badge: "详情",
    label: "查看 bundle 详情",
    description: "只检查一个 sidecar bundle，不恢复。",
    prompt: { label: "Bundle id", placeholder: "粘贴 log 中的 bundle id" }
  },
  "history:r": {
    badge: "恢复",
    label: "按日志编号恢复",
    description: "把选中的历史项恢复到本机。",
    prompt: { label: "恢复编号", placeholder: "输入可见日志编号" },
    confirm: "要把这个会话恢复到本机 agent 历史吗？"
  },
  "local:6": { badge: "本机", label: "克隆 Codex 会话到当前 provider", description: "把当前项目 Codex 会话复制到活跃 provider 下。" },
  "local:n": { badge: "索引", label: "注册本机 provider 克隆", description: "把 Agent-Sync provider 克隆加入本机 Codex 索引。" },
  "local:7": { badge: "修复", label: "修复本机 Codex UI 注册", description: "重新注册 Agent-Sync provider 克隆。" },
  "local:z": { badge: "清理", label: "预览本机克隆清理", description: "列出 clean-local --force 会删除的 provider 克隆。" },
  "local:o": { badge: "监听", label: "检查一次 provider 变化", description: "执行一次本机 provider watch 检查。" },
  "local:w": { badge: "监听", label: "监听 Codex provider 变化", description: "交给长时间运行的本机 watch 命令。" },
  "tool:i": {
    badge: "IR",
    label: "用 IR 摘要检查 bundle",
    description: "汇总来源 agent、标题、事件和工具调用。",
    prompt: { label: "Bundle id", placeholder: "粘贴已同步的 bundle id" }
  },
  "tool:v": {
    badge: "IR",
    label: "转换 bundle 为 Conversation IR",
    description: "输出统一消息、工具调用、provenance 和依赖。",
    prompt: { label: "Bundle id", placeholder: "粘贴已同步的 bundle id" }
  },
  "tool:e": {
    badge: "可读",
    label: "导出可读 Claude JSONL",
    description: "从 IR 写出跨工具可读 JSONL。",
    prompt: { label: "Bundle id", placeholder: "粘贴已同步的 bundle id" }
  },
  "privacy:p": { badge: "扫描", label: "隐私扫描", description: "查找常见 token、private key 和 secret 赋值。" },
  "privacy:y": { badge: "预览", label: "预览脱敏", description: "只显示脱敏会改什么，不写文件。" },
  "privacy:P": {
    badge: "允许",
    label: "添加隐私 allow pattern",
    description: "把确认过的误报正则写入 .agent-sync/privacy.json。",
    prompt: { label: "Name=regex", placeholder: "documented_example=sk-example-[a-z]+" },
    confirm: "要把这条隐私 allow pattern 加到本地策略吗？"
  },
  "privacy:R": { badge: "脱敏", label: "脱敏后推送", description: "写入脱敏 sidecar 副本并 push。", confirm: "要写入脱敏 sidecar 副本并推送吗？" },
  "privacy:A": { badge: "放行", label: "显式放行后推送", description: "本次 push 绕过隐私阻断。", confirm: "要绕过隐私阻断，不脱敏直接推送吗？" },
  "conflicts:g": { badge: "列表", label: "列出 active 冲突", description: "显示隔离的 session object 冲突。" },
  "conflicts:m": {
    badge: "详情",
    label: "查看冲突详情",
    description: "检查 object hash、event shard、机器和 bundle 信息。",
    prompt: { label: "冲突 id 或编号", placeholder: "输入冲突 id 或可见列表编号" }
  },
  "conflicts:D": {
    badge: "DIFF",
    label: "查看冲突 diff 摘要",
    description: "比较隔离对象大小和首个差异行，不打印原始内容。",
    prompt: { label: "冲突 id 或编号", placeholder: "输入冲突 id 或可见列表编号" }
  },
  "conflicts:j": {
    badge: "解决",
    label: "保留全部并标记冲突已解决",
    description: "只标记冲突已处理，不删除任何对象。",
    prompt: { label: "冲突 id 或编号", placeholder: "输入冲突 id 或可见列表编号" },
    confirm: "要在不删除对象的情况下标记这个冲突已解决吗？"
  },
  "conflicts:J": {
    badge: "最新",
    label: "保留 latest 并标记冲突已解决",
    description: "把 latest object 标记为偏好的解决元数据。",
    prompt: { label: "冲突 id 或编号", placeholder: "输入冲突 id 或可见列表编号" },
    confirm: "要用 keep-latest 标记这个冲突已解决吗？"
  },
  "conflicts:O": {
    badge: "本机",
    label: "保留 local 并标记冲突已解决",
    description: "把 local object 标记为偏好的解决元数据。",
    prompt: { label: "冲突 id 或编号", placeholder: "输入冲突 id 或可见列表编号" },
    confirm: "要用 keep-local 标记这个冲突已解决吗？"
  },
  "conflicts:E": {
    badge: "远端",
    label: "保留 remote 并标记冲突已解决",
    description: "把 remote object 标记为偏好的解决元数据。",
    prompt: { label: "冲突 id 或编号", placeholder: "输入冲突 id 或可见列表编号" },
    confirm: "要用 keep-remote 标记这个冲突已解决吗？"
  },
  "ops:x": { badge: "检查", label: "运行 doctor", description: "检查配置、sidecar store、sparse checkout 和 bindings。" },
  "ops:H": { badge: "HOOK", label: "安装 pre-push hook", description: "git push 时把 Agent-Sync 任务加入后台队列。", confirm: "要在这个仓库安装 Agent-Sync 管理的 pre-push hook 吗？" },
  "ops:U": { badge: "HOOK", label: "卸载 pre-push hook", description: "移除 Agent-Sync 管理的 hook。", confirm: "要从这个仓库移除 Agent-Sync 管理的 pre-push hook 吗？" },
  "dashboard:q": { badge: "退出", label: "退出", description: "关闭 TUI。" }
};

const EN_COPY = {
  menuTitle(projectName) {
    return `Agent Sync Kit - ${projectName || "project"}`;
  },
  hero: "AGENT SYNC",
  kitLine: "Agent Sync Kit v0.1.4  ·  Unified Agent Conversation Toolbox",
  tagline: "Session cloning, sidecar transfer, privacy review, and repair",
  homeTitle: "Choose a toolkit",
  homeSubtitle: "Pick one function area, then enter its focused toolkit page.",
  homeFooter: "↑↓ select        Enter / number opens        Esc / q exits",
  homeShortcuts: ["  ↑/↓ or 1-2  Select", "  Enter / →   Open", "  q           Quit"],
  homeHelpLines: [
    "Keyboard",
    "  Up/Down moves between sections",
    "  Enter or Right opens the selected section",
    "  1/2 or A/B jumps directly into a section",
    "  ? toggles this help",
    "  q exits"
  ],
  categoryLabel: "Section",
  categoriesHeading: "Toolkit navigation",
  homeReady: "Ready - choose a toolkit",
  backHint: "Esc / Backspace returns to toolkit index",
  categoryFooter: "Esc back     ↑↓ actions     ←→ / Tab section     / search     Enter run     q exits",
  remoteCategoryTitle: "Sidecar Sync Toolkit",
  remoteCategorySubtitle: "Push / pull / privacy / conflicts / daemon",
  localCategoryTitle: "Codex Session Toolkit",
  localCategorySubtitle: "Clone / browse / export / repair Codex sessions",
  projectRoot: "Project root",
  store: "Store",
  project: "Project",
  sections: "Sections",
  actions: "Actions",
  navigation: "Function domain navigation",
  commandPreview: "Command preview",
  collapsedNotice: "... terminal height is tight; enlarge the window to see more ...",
  shortcuts: "Shortcuts",
  shortcutLines: ["  /  Search actions", "  ?  Toggle help", "  q  Quit"],
  views: "Views",
  footerIdle: "Arrows select, / searches, ? help, Enter runs, Tab switches views, q exits.",
  searchInline(query) {
    return `Search: ${query || "(type to filter)"}`;
  },
  noActions(query) {
    return query ? `No actions match "${query}".` : "No actions in this view.";
  },
  helpLines: [
    "Keyboard",
    "  Left/Right or Tab switches views",
    "  Up/Down moves through actions",
    "  Enter runs the selected action",
    "  / filters actions in the current view",
    "  ? toggles this help",
    "  y/n answers confirmation prompts",
    "  q exits"
  ],
  ready: "Ready",
  actionCancelled: "Action cancelled",
  confirmHint: "Press y to confirm or n to cancel",
  searchCleared: "Search cleared",
  searchClosed: "Search closed",
  filteredBy(query) {
    return `Filtered by "${query}"`;
  },
  promptCancelled: "Prompt cancelled",
  valueRequired(label) {
    return `${label || "Value"} is required`;
  },
  searchActions: "Search actions",
  confirmationRequired: "Confirmation required",
  confirmationOutput(confirm, command) {
    return `${confirm}\n${command}\nPress y to confirm or n to cancel.`;
  },
  runningCommand(args) {
    return `Running git agent-sync ${args.join(" ")}`;
  },
  handingOff: "Handing off to long-running command",
  commandCompleted: "Command completed",
  commandExited(status) {
    return `Command exited with status ${status}`;
  },
  commandFailed: "Command failed",
  emptyOutput: "(command completed without output)",
  running: "Running",
  confirm: "Confirm",
  status: "Status",
  search: "Search",
  searchPlaceholder: "type to filter actions",
  selectCategory: "Select a section",
  selectAction: "Select an action",
  selectActionWithHome: "Select an action (or type home)",
  unknownSelection: "Unknown selection.",
  unknownCategory: "Unknown section.",
  bye: "Bye.",
  commandLabel: "Command",
  confirmQuestion(confirm) {
    return `${confirm} Type y to continue: `;
  },
  cancelled: "Cancelled.",
  pressEnter: "Press Enter to return to the menu.",
  commandExitedLine(status) {
    return `Command exited with status ${status}.`;
  },
  confirmSuffix: " [confirm]"
};

const CN_COPY = {
  ...EN_COPY,
  menuTitle(projectName) {
    return `Agent Sync 中文工具箱 - ${projectName || "项目"}`;
  },
  hero: "AGENT SYNC",
  kitLine: "Agent Sync Kit v0.1.4  ·  统一 Agent 对话同步工具箱",
  tagline: "会话克隆、sidecar 传输、隐私检查和本机修复",
  homeTitle: "选择工具箱",
  homeSubtitle: "选择一个功能域，回车进入对应工具页。",
  homeFooter: "↑↓ 选择        Enter / 数字键 进入        Esc / q 退出",
  homeShortcuts: ["  ↑/↓ 或 1-2  选择", "  Enter / →    进入", "  q            退出"],
  homeHelpLines: [
    "键盘",
    "  上/下方向键切换分区",
    "  Enter 或右方向键进入当前分区",
    "  1/2 或 A/B 直接进入分区",
    "  ? 打开或关闭帮助",
    "  q 退出"
  ],
  categoryLabel: "分区",
  categoriesHeading: "功能域导航",
  homeReady: "就绪 - 请选择工具箱",
  backHint: "Esc / Backspace 返回工具箱首页",
  categoryFooter: "Esc 返回     ↑↓ 选动作     ←→ / Tab 切换分区     / 搜索     Enter 执行     q 退出",
  remoteCategoryTitle: "Sidecar Sync Toolkit",
  remoteCategorySubtitle: "推送 / 拉取 / 隐私 / 冲突 / 后台守护",
  localCategoryTitle: "Codex Session Toolkit",
  localCategorySubtitle: "克隆 / 浏览 / 导出 / 修复 Codex 会话",
  projectRoot: "项目根目录",
  store: "Sidecar 仓库",
  project: "项目",
  sections: "分区",
  actions: "动作",
  navigation: "功能域导航",
  commandPreview: "命令预览",
  collapsedNotice: "... 窗口高度不足，内容已折叠；可放大终端窗口继续查看 ...",
  shortcuts: "快捷键",
  shortcutLines: ["  /  搜索动作", "  ?  打开/关闭帮助", "  q  退出"],
  views: "视图",
  footerIdle: "方向键选择，/ 搜索，? 帮助，Enter 执行，Tab 切换视图，q 退出。",
  searchInline(query) {
    return `搜索：${query || "输入关键词筛选"}`;
  },
  noActions(query) {
    return query ? `没有动作匹配“${query}”。` : "这个视图里没有动作。";
  },
  helpLines: [
    "键盘",
    "  左/右方向键或 Tab 切换视图",
    "  上/下方向键移动动作",
    "  Enter 执行当前动作",
    "  / 筛选当前视图动作",
    "  ? 打开或关闭帮助",
    "  y/n 回答确认提示",
    "  Esc / Backspace 返回主菜单",
    "  q 退出"
  ],
  selectCategory: "选择分区（输入 1 或 2）：",
  unknownCategory: "未知分区。",
  ready: "就绪",
  actionCancelled: "操作已取消",
  confirmHint: "按 y 确认，按 n 取消",
  searchCleared: "搜索已清空",
  searchClosed: "搜索已关闭",
  filteredBy(query) {
    return `已按“${query}”筛选`;
  },
  promptCancelled: "输入已取消",
  valueRequired(label) {
    return `${label || "值"}不能为空`;
  },
  searchActions: "搜索动作",
  confirmationRequired: "需要确认",
  confirmationOutput(confirm, command) {
    return `${confirm}\n${command}\n按 y 确认，按 n 取消。`;
  },
  runningCommand(args) {
    return `正在运行 git agent-sync ${args.join(" ")}`;
  },
  handingOff: "已交给长时间运行命令",
  commandCompleted: "命令已完成",
  commandExited(status) {
    return `命令退出，状态码 ${status}`;
  },
  commandFailed: "命令失败",
  emptyOutput: "（命令完成，无输出）",
  running: "运行中",
  confirm: "确认",
  status: "状态",
  search: "搜索",
  searchPlaceholder: "输入关键词筛选动作",
  selectAction: "选择一个动作",
  selectActionWithHome: "选择一个动作（输入 home 返回主菜单）",
  unknownSelection: "未知选择。",
  bye: "再见。",
  commandLabel: "命令",
  confirmQuestion(confirm) {
    return `${confirm} 输入 y 继续：`;
  },
  cancelled: "已取消。",
  pressEnter: "按 Enter 返回菜单。",
  commandExitedLine(status) {
    return `命令退出，状态码 ${status}。`;
  },
  confirmSuffix: " [需确认]"
};

const TUI_VIEWS: TuiView[] = [
  { id: "dashboard", title: "Sync / Browse", subtitle: "Scan the project, browse latest sidecar sessions, pull, push, and restore.", category: "remote" },
  { id: "queue", title: "Queue / Daemon", subtitle: "Review background jobs, retry failures, flush the queue, and manage the worker.", category: "remote" },
  { id: "privacy", title: "Privacy / Redact", subtitle: "Scan secrets, preview redaction, add allow patterns, or push with policy.", category: "remote" },
  { id: "conflicts", title: "Conflict / Resolve", subtitle: "Inspect quarantined conflicts and mark resolution metadata safely.", category: "remote" },
  { id: "history", title: "Session / Browse", subtitle: "Browse synced bindings and restore one visible log index.", category: "local" },
  { id: "local", title: "Provider / Clone", subtitle: "Clone Codex sessions into the active provider and register local indexes.", category: "local" },
  { id: "tool", title: "Bundle / Transfer", subtitle: "Inspect bundles through Conversation IR or export readable JSONL.", category: "local" },
  { id: "ops", title: "Repair / Maintenance", subtitle: "Run doctor checks and repair local hook or UI registration state.", category: "local" }
];

const TUI_CATEGORIES: TuiCategory[] = [
  {
    id: "remote",
    index: 1,
    key: "A",
    title: "Sidecar Sync Toolkit",
    subtitle: "Push / pull / privacy / conflicts / background daemon",
    toolkitTitle: "SIDECAR SYNC TOOLKIT",
    toolkitSubtitle: "Remote conversation sync toolbox",
    accent: "cyan",
    secondaryAccent: "blue"
  },
  {
    id: "local",
    index: 2,
    key: "B",
    title: "Codex Session Toolkit",
    subtitle: "Clone / browse / export / repair Codex sessions",
    toolkitTitle: "CODEX SESSION TOOLKIT",
    toolkitSubtitle: "Local Codex session toolbox",
    accent: "magenta",
    secondaryAccent: "cyan"
  }
];

const MENU_CHOICES: TuiChoice[] = [
  { key: "1", view: "dashboard", badge: "SCAN", label: "Status / scan local sessions", description: "Refresh current project match status.", args: ["status"] },
  { key: "2", view: "dashboard", badge: "LOG", label: "Log latest sidecar sessions", description: "Show the newest synced conversations.", args: ["log", "--latest", "--oneline", "-10"] },
  { key: "3", view: "dashboard", badge: "PULL", label: "Pull sidecar sessions", description: "Fetch and prepare restorable sidecar bundles.", args: ["pull"] },
  { key: "4", view: "dashboard", badge: "PUSH", label: "Push sidecar sessions", description: "Snapshot matched sessions with privacy review.", args: ["push"], confirm: "Push current-project agent sessions to the sidecar store?" },
  {
    key: "5",
    view: "dashboard",
    badge: "RESTORE",
    label: "Restore by default log index",
    description: "Restore the numbered entry shown by agent-sync log.",
    args: ["restore", "--index"],
    prompt: {
      label: "Restore index",
      placeholder: "Enter the # shown by agent-sync log"
    },
    confirm: "Restore this session into the local agent history?"
  },
  { key: "8", view: "queue", badge: "QUEUE", label: "Show sync queue status", description: "Inspect pending, running, done, and failed jobs.", args: ["sync", "status"] },
  { key: "9", view: "queue", badge: "QUEUE", label: "Queue background sync", description: "Enqueue a sidecar push and start the worker.", args: ["sync", "--background"] },
  { key: "f", view: "queue", badge: "FLUSH", label: "Flush queue now", description: "Process queued sync jobs in this terminal.", args: ["sync", "--flush"] },
  {
    key: "u",
    view: "queue",
    badge: "RETRY",
    label: "Retry failed queue jobs",
    description: "Move failed or cancelled sync jobs back to pending.",
    args: ["sync", "retry"],
    prompt: {
      label: "Job id or all",
      placeholder: "Enter a job id prefix or all"
    }
  },
  {
    key: "K",
    view: "queue",
    badge: "CANCEL",
    label: "Cancel pending queue jobs",
    description: "Move matching pending jobs to cancelled without touching running jobs.",
    args: ["sync", "cancel"],
    prompt: {
      label: "Job id or all",
      placeholder: "Enter a job id prefix or all"
    },
    confirm: "Cancel matching pending sync job(s)?"
  },
  { key: "d", view: "queue", badge: "DAEMON", label: "Daemon status", description: "Read the local worker state file.", args: ["daemon", "status"] },
  { key: "b", view: "queue", badge: "DAEMON", label: "Start daemon", description: "Start the background worker loop.", args: ["daemon", "start"] },
  { key: "k", view: "queue", badge: "DAEMON", label: "Stop daemon", description: "Request a local worker shutdown.", args: ["daemon", "stop"] },
  { key: "l", view: "history", badge: "LOG", label: "Log latest bindings", description: "Browse the latest sync batch with stable indexes.", args: ["log", "--latest", "--oneline", "-20"] },
  { key: "c", view: "history", badge: "HEAD", label: "Log current commit bindings", description: "Browse sessions bound to the current commit.", args: ["log", "--current", "--oneline", "-20"] },
  {
    key: "s",
    view: "history",
    badge: "SHOW",
    label: "Show bundle details",
    description: "Inspect one sidecar bundle without restoring it.",
    args: ["show"],
    prompt: {
      label: "Bundle id",
      placeholder: "Paste a bundle id from log"
    }
  },
  {
    key: "r",
    view: "history",
    badge: "RESTORE",
    label: "Restore by log index",
    description: "Restore a selected history entry into this machine.",
    args: ["restore", "--index"],
    prompt: {
      label: "Restore index",
      placeholder: "Enter the visible log index"
    },
    confirm: "Restore this session into the local agent history?"
  },
  { key: "6", view: "local", badge: "LOCAL", label: "Clone Codex sessions to current provider", description: "Copy current-project Codex sessions under the active provider.", args: ["clone-local"] },
  { key: "n", view: "local", badge: "INDEX", label: "Register local provider clones", description: "Add Agent-Sync provider clones to local Codex indexes.", args: ["register-local"] },
  { key: "7", view: "local", badge: "REPAIR", label: "Repair local Codex UI registration", description: "Re-register Agent-Sync provider clones in local Codex indexes.", args: ["repair-local"] },
  { key: "z", view: "local", badge: "CLEAN", label: "Preview local clone cleanup", description: "List generated provider clones that clean-local --force would remove.", args: ["clean-local"] },
  { key: "o", view: "local", badge: "WATCH", label: "Check provider change once", description: "Run one local provider watch check.", args: ["watch-local", "--once"] },
  { key: "w", view: "local", badge: "WATCH", label: "Watch Codex provider changes", description: "Hand off to the long-running local watch command.", args: ["watch-local"], handoff: true },
  {
    key: "i",
    view: "tool",
    badge: "IR",
    label: "Inspect bundle as IR summary",
    description: "Summarize source agent, title, events, and tool calls.",
    args: ["tool", "inspect", "--session"],
    prompt: {
      label: "Bundle id",
      placeholder: "Paste a synced bundle id"
    }
  },
  {
    key: "v",
    view: "tool",
    badge: "IR",
    label: "Convert bundle to Conversation IR",
    description: "Emit normalized messages, tool calls, provenance, and dependencies.",
    args: ["tool", "convert", "--to", "ir", "--json", "--session"],
    prompt: {
      label: "Bundle id",
      placeholder: "Paste a synced bundle id"
    }
  },
  {
    key: "e",
    view: "tool",
    badge: "READABLE",
    label: "Export readable Claude JSONL",
    description: "Write readable cross-tool JSONL from the IR.",
    args: ["tool", "export", "--to", "claude", "--mode", "readable", "--session"],
    prompt: {
      label: "Bundle id",
      placeholder: "Paste a synced bundle id"
    }
  },
  { key: "p", view: "privacy", badge: "SCAN", label: "Privacy scan", description: "Find common tokens, private keys, and secret assignments.", args: ["privacy", "scan"] },
  { key: "y", view: "privacy", badge: "DRY", label: "Preview redaction", description: "Show what redaction would change without writing files.", args: ["privacy", "redact", "--dry-run"] },
  {
    key: "P",
    view: "privacy",
    badge: "ALLOW",
    label: "Add privacy allow pattern",
    description: "Record a reviewed false-positive regex in .agent-sync/privacy.json.",
    args: ["privacy", "allow-pattern-local"],
    prompt: {
      label: "Name=regex",
      placeholder: "documented_example=sk-example-[a-z]+"
    },
    confirm: "Add this privacy allow pattern to the local policy?"
  },
  { key: "R", view: "privacy", badge: "REDACT", label: "Push with redaction", description: "Write redacted sidecar copies and push.", args: ["push", "--privacy", "redact"], confirm: "Write redacted sidecar copies and push them?" },
  { key: "A", view: "privacy", badge: "ALLOW", label: "Push with explicit allow", description: "Bypass privacy blocking for this push.", args: ["push", "--privacy", "allow"], confirm: "Bypass privacy blocking and push without redaction?" },
  { key: "g", view: "conflicts", badge: "LIST", label: "List active conflicts", description: "Show quarantined session object conflicts.", args: ["conflicts", "list"] },
  {
    key: "m",
    view: "conflicts",
    badge: "SHOW",
    label: "Show conflict details",
    description: "Inspect object hashes, event shards, machines, and bundles.",
    args: ["conflicts", "show"],
    prompt: {
      label: "Conflict id or index",
      placeholder: "Enter a conflict id or visible list index"
    }
  },
  {
    key: "D",
    view: "conflicts",
    badge: "DIFF",
    label: "Show conflict diff summary",
    description: "Compare quarantined object sizes and first differing lines without printing raw content.",
    args: ["conflicts", "diff"],
    prompt: {
      label: "Conflict id or index",
      placeholder: "Enter a conflict id or visible list index"
    }
  },
  {
    key: "j",
    view: "conflicts",
    badge: "RESOLVE",
    label: "Resolve conflict by keeping all",
    description: "Mark the conflict handled without deleting either object.",
    args: ["conflicts", "resolve", "--strategy", "keep-all"],
    prompt: {
      label: "Conflict id or index",
      placeholder: "Enter a conflict id or visible list index"
    },
    confirm: "Mark this conflict as resolved without deleting either object?"
  },
  {
    key: "J",
    view: "conflicts",
    badge: "LATEST",
    label: "Resolve conflict by keeping latest",
    description: "Mark the latest object as the preferred resolution metadata.",
    args: ["conflicts", "resolve", "--strategy", "keep-latest"],
    prompt: {
      label: "Conflict id or index",
      placeholder: "Enter a conflict id or visible list index"
    },
    confirm: "Mark this conflict resolved with keep-latest?"
  },
  {
    key: "O",
    view: "conflicts",
    badge: "LOCAL",
    label: "Resolve conflict by keeping local",
    description: "Mark the local object as the preferred resolution metadata.",
    args: ["conflicts", "resolve", "--strategy", "keep-local"],
    prompt: {
      label: "Conflict id or index",
      placeholder: "Enter a conflict id or visible list index"
    },
    confirm: "Mark this conflict resolved with keep-local?"
  },
  {
    key: "E",
    view: "conflicts",
    badge: "REMOTE",
    label: "Resolve conflict by keeping remote",
    description: "Mark the remote object as the preferred resolution metadata.",
    args: ["conflicts", "resolve", "--strategy", "keep-remote"],
    prompt: {
      label: "Conflict id or index",
      placeholder: "Enter a conflict id or visible list index"
    },
    confirm: "Mark this conflict resolved with keep-remote?"
  },
  { key: "x", view: "ops", badge: "DOCTOR", label: "Run doctor", description: "Check config, sidecar store, sparse checkout, and bindings.", args: ["doctor"] },
  { key: "H", view: "ops", badge: "HOOKS", label: "Install pre-push hook", description: "Queue background Agent-Sync jobs during git push.", args: ["install-hooks"], confirm: "Install the Agent-Sync managed pre-push hook in this repository?" },
  { key: "U", view: "ops", badge: "HOOKS", label: "Uninstall pre-push hook", description: "Remove the Agent-Sync managed hook.", args: ["uninstall-hooks"], confirm: "Remove the Agent-Sync managed pre-push hook from this repository?" },
  { key: "q", view: "dashboard", badge: "EXIT", label: "Quit", description: "Close the TUI.", args: [], exits: true }
];

export function getTuiChoices(options: Record<string, any> = {}) {
  const locale = normalizeTuiLocale(options);
  return MENU_CHOICES.map((choice) => localizeChoice(choice, locale));
}

export function getTuiViews(options: Record<string, any> = {}) {
  const locale = normalizeTuiLocale(options);
  return TUI_VIEWS.map((view) => localizeView(view, locale));
}

export function getTuiCategories(options: Record<string, any> = {}) {
  const locale = normalizeTuiLocale(options);
  return TUI_CATEGORIES.map((category) => localizeCategory(category, locale));
}

export function resolveTuiChoice(value: string, viewId = "", options: Record<string, any> = {}) {
  const key = String(value || "").trim();
  const choices = getTuiChoices(options);
  return choices.find((choice) => choice.key === key && (!viewId || choice.view === viewId)) ||
    choices.find((choice) => choice.key === key) ||
    null;
}

export function resolveTuiCategory(value: string, options: Record<string, any> = {}) {
  const key = String(value || "").trim().toLowerCase();
  const categories = getTuiCategories(options);
  return categories.find((category) => {
    return key === String(category.index) || key === category.id || key === category.key.toLowerCase();
  }) || null;
}

export function filterTuiChoices(choices: TuiChoice[], query = "") {
  const needle = String(query || "").trim().toLowerCase();
  const cloned = choices.map(cloneChoice);
  if (!needle) {
    return cloned;
  }
  return cloned.filter((choice) => {
    const haystack = [
      choice.key,
      choice.badge,
      choice.label,
      choice.description,
      formatTuiCommand(choice)
    ].join(" ").toLowerCase();
    return haystack.includes(needle);
  });
}

export function formatTuiCommand(choice: TuiChoice, prompted = "") {
  if (choice.exits) {
    return "exit";
  }
  const promptValue = prompted || promptToken(choice.prompt);
  const args = buildChoiceArgs(choice, promptValue);
  return `git agent-sync ${args.map(quoteArg).join(" ")}`;
}

const FIGLET_FONT = "ANSI Shadow";
const LOGO_WORDS: Record<"home" | TuiCategoryId, string[]> = {
  home: ["AGENT", "SYNC"],
  remote: ["SIDECAR", "SYNC"],
  local: ["CODEX", "SESSION", "TOOLKIT"]
};

const LOGO_GRADIENTS: Record<"home" | TuiCategoryId, string[]> = {
  home: ["#27f8ff", "#0467ff"],
  remote: ["#27f8ff", "#0467ff"],
  local: ["#22d3ee", "#f000ff", "#1d4fff"]
};

function getLogoLines(kind: "home" | TuiCategoryId) {
  return LOGO_WORDS[kind].flatMap((word, index) => {
    const lines = figlet.textSync(word, {
      font: FIGLET_FONT as any,
      horizontalLayout: "default",
      verticalLayout: "default"
    }).split(/\r?\n/).filter((line) => line.trim().length > 0);
    return index === 0 ? lines : ["", ...lines];
  });
}

function gradientLogoLines(kind: "home" | TuiCategoryId) {
  const paint = gradient(LOGO_GRADIENTS[kind]);
  return paint.multiline(getLogoLines(kind).join("\n")).split("\n");
}

export function renderTuiMenu(config, options: Record<string, any> = {}) {
  const locale = normalizeTuiLocale(options);
  const copy = getTuiCopy(locale);
  const categories = getTuiCategories({ locale });
  const categoryViews = getTuiViews({ locale });
  const categoryId = options.categoryId as TuiCategoryId | undefined;
  if (categoryId) {
    const category = categories.find((entry) => entry.id === categoryId);
    if (!category) {
      return renderHomeMenu(config, copy, categories);
    }
    const views = categoryViews.filter((view) => view.category === categoryId);
    const choices = getTuiChoices({ locale });
    return renderToolkitMenu(config, copy, category, views, choices);
  }

  return renderHomeMenu(config, copy, categories);
}

function renderHomeMenu(config: Record<string, any>, copy: any, categories: TuiCategory[]) {
  const lines = [
    copy.menuTitle(config.projectName),
    "",
    ...gradientLogoLines("home"),
    "",
    copy.kitLine,
    copy.tagline,
    "",
    copy.homeTitle,
    copy.homeSubtitle,
    ""
  ];
  for (const [index, category] of categories.entries()) {
    lines.push(index === 0 ? `› ${menuCardLine(category, true)}` : `  ${menuCardLine(category, false)}`);
    lines.push(`  ${category.subtitle}`);
    lines.push("");
  }
  lines.push(copy.homeFooter);
  lines.push("");
  lines.push(...boxLines("", [
    `${copy.project}: ${config.projectName || "project"}    ${copy.sections}: ${categories.length}`,
    `${copy.projectRoot}: ${config.projectRoot}`,
    `${copy.store}: ${config.storePath}`
  ], 96));
  return lines.join("\n");
}

function renderToolkitMenu(config: Record<string, any>, copy: any, category: TuiCategory, views: TuiView[], choices: TuiChoice[]) {
  const categoryChoices = choices.filter((choice) => views.some((view) => view.id === choice.view) && !choice.exits);
  const lines = [
    ...gradientLogoLines(category.id),
    category.toolkitSubtitle,
    copy.tagline,
    copy.homeSubtitle,
    "",
    views.map((view, index) => `[${index + 1}] ${view.title}`).join("   "),
    "",
    ...boxLines("", [
      `${copy.project} : ${config.projectName || "project"}    ${copy.sections} : ${views.length}    ${copy.actions} : ${categoryChoices.length}`,
      `${copy.projectRoot}: ${config.projectRoot}`,
      `${copy.store}: ${config.storePath}`
    ], 118),
    "",
    ...boxLines(copy.navigation, views.map((view, index) => {
      const marker = index === 0 ? "›" : " ";
      return `${marker} [${index + 1}] ${view.title}  ${view.subtitle}`;
    }), 118),
    ""
  ];
  for (const view of views) {
    const viewChoices = categoryChoices.filter((choice) => choice.view === view.id);
    lines.push(`${view.title}`);
    lines.push(`  ${view.subtitle}`);
    for (const choice of viewChoices) {
      lines.push(`  ${choice.key.padEnd(2)} ${choice.label}`);
      lines.push(`     ${formatTuiCommand(choice)}${choice.confirm ? copy.confirmSuffix : ""}`);
    }
    lines.push("");
  }
  lines.push(copy.categoryFooter);
  return lines.join("\n");
}

function menuCardLine(category: TuiCategory, selected: boolean) {
  const prefix = selected ? `${category.index}.` : `${category.index}.`;
  return `${prefix}  ${category.title}`;
}

function boxLines(title: string, body: string[], width: number) {
  const innerWidth = Math.max(width - 2, 12);
  const topTitle = title ? ` ${title} ` : "";
  const top = `┌${topTitle}${"─".repeat(Math.max(innerWidth - topTitle.length, 0))}┐`;
  const bottom = `└${"─".repeat(innerWidth)}┘`;
  return [
    top,
    ...body.map((line) => `│ ${line.padEnd(Math.max(innerWidth - 2, 0)).slice(0, Math.max(innerWidth - 2, 0))} │`),
    bottom
  ];
}

export async function runTui(gitRoot, config, options: Record<string, any> = {}) {
  const locale = normalizeTuiLocale(options);
  if (options.io) {
    await runPromptTui(gitRoot, config, { ...options, locale });
    return;
  }

  if (!options.forceInk && (!defaultInput.isTTY || !defaultOutput.isTTY)) {
    console.log(renderTuiMenu(config, { locale }));
    return;
  }

  const runner = options.runner || ((args: string[], cwd: string) => runCliCommand(args, cwd));
  const instance = render(h(AgentSyncTuiApp, { gitRoot, config, runner, locale }));
  await instance.waitUntilExit();
}

function AgentSyncTuiApp({ gitRoot, config, runner, locale }: { gitRoot: string; config: Record<string, any>; runner: TuiRunner; locale: TuiLocale }) {
  const { exit } = useApp();
  const copy = getTuiCopy(locale);
  const categories = useMemo(() => getTuiCategories({ locale }), [locale]);
  const allViews = useMemo(() => getTuiViews({ locale }), [locale]);
  const [screen, setScreen] = useState<"home" | "category">("home");
  const [activeCategoryIndex, setActiveCategoryIndex] = useState(0);
  const activeCategory = categories[activeCategoryIndex];
  const views = useMemo(() => allViews.filter((view) => view.category === activeCategory?.id), [allViews, activeCategory]);
  const [activeViewIndex, setActiveViewIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [promptChoice, setPromptChoice] = useState<TuiChoice | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [confirmRequest, setConfirmRequest] = useState<{ choice: TuiChoice; promptValue: string } | null>(null);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState(copy.homeReady);
  const [output, setOutput] = useState("");
  const activeView = views[activeViewIndex];
  const baseChoices = useMemo(() => getChoicesForView(activeView.id, locale), [activeView.id, locale]);
  const choices = useMemo(() => filterTuiChoices(baseChoices, searchQuery), [baseChoices, searchQuery]);
  const selectedChoice = choices[Math.min(selectedIndex, Math.max(choices.length - 1, 0))];

  function enterCategory(index: number) {
    setActiveCategoryIndex(index);
    setActiveViewIndex(0);
    setSelectedIndex(0);
    setSearchMode(false);
    setSearchQuery("");
    setShowHelp(false);
    setScreen("category");
    const category = categories[index];
    setStatus(category ? category.title : copy.ready);
  }

  function goHome(nextStatus = copy.homeReady) {
    setScreen("home");
    setSelectedIndex(0);
    setActiveViewIndex(0);
    setSearchMode(false);
    setSearchQuery("");
    setShowHelp(false);
    setPromptChoice(null);
    setPromptValue("");
    setConfirmRequest(null);
    setStatus(nextStatus);
    setOutput("");
  }

  useInput((input, key) => {
    if (running) {
      return;
    }
    if (confirmRequest) {
      const normalized = String(input || "").toLowerCase();
      if (normalized === "y") {
        const request = confirmRequest;
        setConfirmRequest(null);
        setOutput("");
        void executeChoice(request.choice, request.promptValue, true);
      } else if (normalized === "n" || key.escape) {
        setConfirmRequest(null);
        setStatus(copy.actionCancelled);
        setOutput("");
      } else {
        setStatus(copy.confirmHint);
      }
      return;
    }
    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        setSearchQuery("");
        setSelectedIndex(0);
        setStatus(copy.searchCleared);
      } else if (key.return) {
        setSearchMode(false);
        setStatus(searchQuery ? copy.filteredBy(searchQuery) : copy.searchClosed);
      } else if (key.backspace || key.delete) {
        setSearchQuery((value) => value.slice(0, -1));
        setSelectedIndex(0);
      } else if (input) {
        setSearchQuery((value) => `${value}${input}`);
        setSelectedIndex(0);
      }
      return;
    }
    if (promptChoice) {
      if (key.escape) {
        setPromptChoice(null);
        setPromptValue("");
        setStatus(copy.promptCancelled);
      } else if (key.return) {
        const value = promptValue.trim();
        if (!value) {
          setStatus(copy.valueRequired(promptChoice.prompt?.label));
          return;
        }
        setPromptChoice(null);
        setPromptValue("");
        void executeChoice(promptChoice, value);
      } else if (key.backspace || key.delete) {
        setPromptValue((value) => value.slice(0, -1));
      } else if (input) {
        setPromptValue((value) => `${value}${input}`);
      }
      return;
    }

    if (input === "?") {
      setShowHelp((value) => !value);
      return;
    }
    if (input === "/") {
      setSearchMode(true);
      setSearchQuery("");
      setSelectedIndex(0);
      setStatus(copy.searchActions);
      return;
    }
    if (input === "q") {
      exit();
      return;
    }
    if (screen === "home") {
      if (key.upArrow) {
        setActiveCategoryIndex((index) => wrap(index - 1, categories.length));
        return;
      }
      if (key.downArrow) {
        setActiveCategoryIndex((index) => wrap(index + 1, categories.length));
        return;
      }
      if (key.return || key.rightArrow) {
        enterCategory(activeCategoryIndex);
        return;
      }
      if (input) {
        const quickCategory = resolveTuiCategory(input, { locale });
        if (quickCategory) {
          const categoryIndex = categories.findIndex((category) => category.id === quickCategory.id);
          if (categoryIndex >= 0) {
            enterCategory(categoryIndex);
            return;
          }
        }
      }
      return;
    }
    if ((key.escape || key.backspace) && !promptChoice && !confirmRequest) {
      goHome(copy.backHint);
      return;
    }
    if (key.leftArrow) {
      setActiveViewIndex((index) => wrap(index - 1, views.length));
      setSelectedIndex(0);
      return;
    }
    if (key.rightArrow || key.tab) {
      setActiveViewIndex((index) => wrap(index + 1, views.length));
      setSelectedIndex(0);
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((index) => wrap(index - 1, choices.length));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((index) => wrap(index + 1, choices.length));
      return;
    }
    if (key.return && selectedChoice) {
      void executeChoice(selectedChoice);
      return;
    }
    if (input) {
      const quickChoice = resolveTuiChoice(input, activeView.id, { locale });
      if (quickChoice) {
        void executeChoice(quickChoice);
      }
    }
  });

  async function executeChoice(choice: TuiChoice, promptValue = "", confirmed = false) {
    if (choice.exits) {
      exit();
      return;
    }
    if (choice.prompt && !promptValue) {
      setPromptChoice(choice);
      setPromptValue("");
      setStatus(choice.prompt.placeholder);
      return;
    }
    const args = buildChoiceArgs(choice, promptValue);
    if (choice.confirm && !confirmed) {
      setConfirmRequest({ choice, promptValue });
      setStatus(copy.confirmationRequired);
      setOutput(copy.confirmationOutput(choice.confirm, formatTuiCommand(choice, promptValue)));
      return;
    }
    setRunning(true);
    setStatus(copy.runningCommand(args));
    setOutput("");
    try {
      if (choice.handoff) {
        setStatus(copy.handingOff);
        exit();
        setTimeout(() => {
          runCliCommand(args, gitRoot, { inherit: true });
        }, 25);
        return;
      }
      const result = normalizeCommandResult(await runner(args, gitRoot));
      const text = compactOutput([result.stdout, result.stderr].filter(Boolean).join("\n"));
      setOutput(text || copy.emptyOutput);
      setStatus(result.status === 0 ? copy.commandCompleted : copy.commandExited(result.status));
    } catch (error) {
      setStatus(copy.commandFailed);
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  return h(Box, { flexDirection: "column", gap: 1 },
    h(Header, { config, copy, category: screen === "category" ? activeCategory : null }),
    screen === "home"
      ? h(HomePanel, { categories, activeCategoryIndex, copy, config })
      : h(Box, { flexDirection: "column", gap: 1 },
        h(ToolkitInfoPanel, { config, copy, category: activeCategory, views, choices: getTuiChoices({ locale }) }),
        h(Box, { flexDirection: "row", gap: 2 },
          h(ViewRail, { activeViewIndex, views, copy, category: activeCategory }),
          h(ActionPanel, { view: activeView, choices, selectedIndex, running, searchMode, searchQuery, copy, category: activeCategory })
        )
      ),
    showHelp ? h(HelpPanel, { copy, screen }) : null,
    h(StatusPanel, { status, output, promptChoice, promptValue, confirmRequest, searchMode, searchQuery, running, copy, screen })
  );
}

function Header({ config, copy, category }: { config: Record<string, any>; copy: any; category: TuiCategory | null }) {
  const logoKind = category?.id || "home";
  const logoLines = getLogoLines(logoKind);
  const accent = category?.accent || "cyan";
  const secondaryAccent = category?.secondaryAccent || "blue";
  const logoColors = LOGO_GRADIENTS[logoKind];
  return h(Box, { paddingX: 1, flexDirection: "column", alignItems: "center" },
    h(LogoBlock, { lines: logoLines, colors: logoColors, accent, secondaryAccent }),
    h(Text, { color: accent as any, bold: true }, category ? category.toolkitSubtitle : copy.kitLine),
    h(Text, { color: "gray" }, category ? category.subtitle : copy.tagline),
    h(Text, { color: "gray" }, config.projectName || "project")
  );
}

function LogoBlock({ lines, colors, accent, secondaryAccent }: { lines: string[]; colors: string[]; accent: string; secondaryAccent: string }) {
  const inkColors = colors.length ? colors : [accent, secondaryAccent];
  return h(Box, { flexDirection: "column", alignItems: "center" },
    ...lines.map((line, index) => h(Text, {
      key: String(index),
      color: (inkColors[index % inkColors.length] as any),
      bold: true
    }, line))
  );
}

function HomePanel({ categories, activeCategoryIndex, copy, config }: { categories: TuiCategory[]; activeCategoryIndex: number; copy: any; config: Record<string, any> }) {
  return h(Box, { flexDirection: "column", gap: 1 },
    h(Box, { flexDirection: "column", alignItems: "center" },
      h(Text, { color: "white", bold: true }, copy.homeTitle),
      h(Text, { color: "gray" }, copy.homeSubtitle)
    ),
    h(Box, { flexDirection: "column", marginTop: 1 },
      ...categories.map((category, index) => h(CategoryRow, {
        key: category.id,
        category,
        selected: index === activeCategoryIndex
      }))
    ),
    h(Box, { borderStyle: "single", borderColor: "gray", paddingX: 1, flexDirection: "column" },
      h(Text, { color: "gray" }, `${copy.project} : ${config.projectName || "project"}    ${copy.sections} : ${categories.length}`),
      h(Text, { color: "white" }, `${copy.projectRoot}: ${trimMiddle(config.projectRoot || "", 96)}`),
      h(Text, { color: "gray" }, `${copy.store}: ${trimMiddle(config.storePath || "", 96)}`)
    ),
    h(Box, { justifyContent: "center" },
      h(Text, { color: "gray" }, copy.homeFooter)
    )
  );
}

function ViewRail({ activeViewIndex, views, copy, category }: { activeViewIndex: number; views: TuiView[]; copy: any; category: TuiCategory }) {
  return h(Box, { borderStyle: "single", borderColor: category.secondaryAccent as any, paddingX: 1, flexDirection: "column", width: 36 },
    h(Text, { color: "white", bold: true }, copy.navigation),
    ...views.map((view, index) => h(Text, {
      key: view.id,
      color: index === activeViewIndex ? (category.accent as any) : "white",
      bold: index === activeViewIndex
    }, `${index === activeViewIndex ? "›" : " "} [${index + 1}] ${view.title}`)),
    h(Box, { marginTop: 1 },
      h(Text, { color: "gray" }, copy.backHint)
    )
  );
}

function ToolkitInfoPanel({ config, copy, category, views, choices }: { config: Record<string, any>; copy: any; category: TuiCategory; views: TuiView[]; choices: TuiChoice[] }) {
  const actionCount = choices.filter((choice) => views.some((view) => view.id === choice.view) && !choice.exits).length;
  return h(Box, { borderStyle: "single", borderColor: category.secondaryAccent as any, paddingX: 1, flexDirection: "column" },
    h(Text, { color: "gray" }, `${copy.project} : `, h(Text, { color: category.accent as any }, config.projectName || "project"), `    ${copy.sections} : ${views.length}    ${copy.actions} : ${actionCount}`),
    h(Text, { color: "white" }, `${copy.projectRoot}: ${trimMiddle(config.projectRoot || "", 108)}`),
    h(Text, { color: "gray" }, `${copy.store}: ${trimMiddle(config.storePath || "", 108)}`)
  );
}

function ActionPanel({
  view,
  choices,
  selectedIndex,
  running,
  searchMode,
  searchQuery,
  copy,
  category
}: {
  view: TuiView;
  choices: TuiChoice[];
  selectedIndex: number;
  running: boolean;
  searchMode: boolean;
  searchQuery: string;
  copy: any;
  category: TuiCategory;
}) {
  return h(Box, { borderStyle: "single", borderColor: category.accent as any, paddingX: 1, flexDirection: "column", flexGrow: 1 },
    h(Box, { flexDirection: "column", marginBottom: 1 },
      h(Text, { color: category.accent as any, bold: true }, view.title),
      h(Text, { color: "gray" }, view.subtitle)
    ),
    choices.length ? null : h(Text, { color: "gray" }, copy.noActions(searchQuery)),
    ...choices.map((choice, index) => h(ActionRow, {
      key: `${choice.view}:${choice.key}`,
      choice,
      selected: index === selectedIndex,
      disabled: running,
      accent: category.accent
    })),
    h(Box, { marginTop: 1 },
      h(Text, { color: searchMode ? "yellow" : "gray" }, searchMode ? copy.searchInline(searchQuery) : copy.categoryFooter)
    )
  );
}

function CategoryRow({ category, selected }: { category: TuiCategory; selected: boolean }) {
  const color = selected ? "black" : "white";
  const backgroundColor = selected ? category.accent : undefined;
  return h(Box, { flexDirection: "column", marginBottom: 1, borderStyle: "single", borderColor: selected ? category.accent : "gray", paddingX: 2, paddingY: 1 },
    h(Box, {},
      h(Text, { color: selected ? (category.accent as any) : "gray", bold: true }, selected ? "›  " : "   "),
      h(Text, { color, backgroundColor, bold: true }, ` ${category.index}. `),
      h(Text, { color: selected ? (category.accent as any) : "gray", bold: true }, ` ${category.title}`)
    ),
    h(Box, { paddingLeft: 4 },
      h(Text, { color: "gray" }, `${category.subtitle} [${category.key}]`)
    )
  );
}

function ActionRow({ choice, selected, disabled, accent }: { choice: TuiChoice; selected: boolean; disabled: boolean; accent: string }) {
  const color = disabled ? "gray" : selected ? "black" : "white";
  const backgroundColor = selected && !disabled ? accent : undefined;
  return h(Box, { flexDirection: "column", marginY: 0 },
    h(Box, {},
      h(Text, { color, backgroundColor, bold: selected }, ` ${choice.key} `),
      h(Text, { color: "gray" }, ` ${choice.badge.padEnd(8)} `),
      h(Text, { color: selected ? (accent as any) : "white", bold: selected }, `${choice.label}${choice.confirm ? " [confirm]" : ""}`)
    ),
    h(Box, { paddingLeft: 15 },
      h(Text, { color: "gray" }, choice.description)
    ),
    h(Box, { paddingLeft: 15 },
      h(Text, { color: selected ? (accent as any) : "gray" }, `${formatTuiCommand(choice)}`)
    )
  );
}

function HelpPanel({ copy, screen }: { copy: any; screen: "home" | "category" }) {
  const lines = screen === "home" ? copy.homeHelpLines : copy.helpLines;
  return h(Box, { borderStyle: "round", borderColor: "gray", paddingX: 1, flexDirection: "column" },
    ...lines.map((line, index) => h(Text, { key: String(index), color: index === 0 ? "cyan" : "gray", bold: index === 0 }, line))
  );
}

function StatusPanel({
  status,
  output,
  promptChoice,
  promptValue,
  confirmRequest,
  searchMode,
  searchQuery,
  running,
  copy,
  screen
}: {
  status: string;
  output: string;
  promptChoice: TuiChoice | null;
  promptValue: string;
  confirmRequest: { choice: TuiChoice; promptValue: string } | null;
  searchMode: boolean;
  searchQuery: string;
  running: boolean;
  copy: any;
  screen: "home" | "category";
}) {
  return h(Box, { borderStyle: "round", borderColor: running ? "yellow" : confirmRequest ? "red" : "gray", paddingX: 1, flexDirection: "column" },
    h(Box, {},
      h(Text, { color: running ? "yellow" : confirmRequest ? "red" : "green", bold: true }, running ? copy.running : confirmRequest ? copy.confirm : copy.status),
      h(Text, { color: "white" }, `  ${status}`)
    ),
    screen === "home" && !searchMode && !promptChoice && !confirmRequest ? h(Box, { marginTop: 1 },
      h(Text, { color: "gray" }, copy.homeFooter)
    ) : null,
    searchMode ? h(Box, {},
      h(Text, { color: "cyan" }, `${copy.search}: `),
      h(Text, { color: searchQuery ? "white" : "gray" }, searchQuery || copy.searchPlaceholder)
    ) : null,
    promptChoice ? h(Box, {},
      h(Text, { color: "cyan" }, `${promptChoice.prompt?.label}: `),
      h(Text, { color: promptValue ? "white" : "gray" }, promptValue || promptChoice.prompt?.placeholder || "")
    ) : null,
    output ? h(Box, { marginTop: 1, flexDirection: "column" },
      ...output.split("\n").slice(0, 8).map((line, index) => h(Text, { key: String(index), color: "gray" }, trimMiddle(line, 120)))
    ) : null
  );
}

async function runPromptTui(gitRoot, config, options: Record<string, any> = {}) {
  const io = options.io || createInterface({ input: defaultInput, output: defaultOutput });
  const runner = options.runner || ((args: string[], cwd: string) => runCliCommand(args, cwd));
  const locale = normalizeTuiLocale(options);
  const copy = getTuiCopy(locale);
  const categories = getTuiCategories({ locale });
  const shouldClose = !options.io;
  try {
    while (true) {
      console.log("");
      console.log(renderTuiMenu(config, { locale }));
      const categoryAnswer = await io.question(`\n${copy.selectCategory}: `);
      if (String(categoryAnswer || "").trim().toLowerCase() === "q") {
        console.log(copy.bye);
        return;
      }
      const category = resolveTuiCategory(categoryAnswer, { locale });
      if (!category) {
        console.log(copy.unknownCategory);
        continue;
      }
      while (true) {
        console.log("");
        console.log(renderTuiMenu(config, { locale, categoryId: category.id }));
        const answer = await io.question(`\n${copy.selectActionWithHome}: `);
        const normalizedAnswer = String(answer || "").trim().toLowerCase();
        if (normalizedAnswer === "home" || normalizedAnswer === "back") {
          break;
        }
        if (normalizedAnswer === "q") {
          console.log(copy.bye);
          return;
        }
        const choice = resolveTuiChoice(answer, "", { locale });
        if (!choice || !viewBelongsToCategory(choice.view, category.id, locale)) {
          console.log(copy.unknownSelection);
          continue;
        }
        if (choice.exits) {
          console.log(copy.bye);
          return;
        }

        let prompted = "";
        if (choice.prompt) {
          prompted = String(await io.question(`${choice.prompt.label}: `)).trim();
          if (!prompted) {
            console.log(copy.valueRequired(choice.prompt.label));
            continue;
          }
        }

        console.log(`${copy.commandLabel}: ${formatTuiCommand(choice, prompted)}`);
        if (choice.confirm) {
          const confirmation = String(await io.question(copy.confirmQuestion(choice.confirm))).trim();
          if (!isConfirmAccepted(confirmation)) {
            console.log(copy.cancelled);
            continue;
          }
        }

        const result = normalizeCommandResult(await runner(buildChoiceArgs(choice, prompted), gitRoot));
        if (result.status !== 0) {
          console.log(copy.commandExitedLine(result.status));
        }
        if (!isWatchChoice(choice)) {
          await io.question(`\n${copy.pressEnter}`);
        } else {
          return;
        }
        if (normalizedAnswer === "home") {
          continue;
        }
      }
    }
  } finally {
    if (shouldClose) {
      io.close();
    }
  }
}

function getChoicesForView(viewId: string, locale: TuiLocale) {
  if (!viewId) {
    return [];
  }
  return MENU_CHOICES.filter((choice) => choice.view === viewId).map((choice) => localizeChoice(choice, locale));
}

function viewBelongsToCategory(viewId: string, categoryId: TuiCategoryId, locale: TuiLocale) {
  return getTuiViews({ locale }).some((view) => view.id === viewId && view.category === categoryId);
}

function normalizeTuiLocale(options: Record<string, any> = {}): TuiLocale {
  return options.locale === "cn" || options.cn ? "cn" : "en";
}

function getTuiCopy(locale: TuiLocale) {
  return locale === "cn" ? CN_COPY : EN_COPY;
}

function localizeCategory(category: TuiCategory, locale: TuiLocale) {
  if (locale !== "cn") {
    return { ...category };
  }
  const override = CN_CATEGORY_TEXT[category.id] || {};
  return {
    ...category,
    ...override
  };
}

function localizeView(view: TuiView, locale: TuiLocale) {
  if (locale !== "cn") {
    return { ...view };
  }
  return {
    ...view,
    ...(CN_VIEW_TEXT[view.id] || {})
  };
}

function localizeChoice(choice: TuiChoice, locale: TuiLocale) {
  const cloned = cloneChoice(choice);
  if (cloned.prompt) {
    cloned.prompt.token = promptToken(choice.prompt);
  }
  if (locale !== "cn") {
    return cloned;
  }
  const override = CN_CHOICE_TEXT[`${choice.view}:${choice.key}`] || {};
  return {
    ...cloned,
    ...override,
    args: cloned.args,
    prompt: cloned.prompt || override.prompt
      ? { ...(cloned.prompt || {}), ...(override.prompt || {}) }
      : undefined
  };
}

function buildChoiceArgs(choice: TuiChoice, prompted = "") {
  return prompted ? [...choice.args, prompted] : [...choice.args];
}

function promptToken(prompt?: TuiPrompt) {
  if (!prompt) {
    return "";
  }
  if (prompt.token) {
    return prompt.token;
  }
  const token = prompt.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `<${token || "value"}>`;
}

function quoteArg(value: string) {
  if (!/\s/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\\\"")}"`;
}

function isConfirmAccepted(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

function isWatchChoice(choice: TuiChoice) {
  return choice.args[0] === "watch-local" && choice.args.length === 1;
}

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

function compactOutput(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
  if (lines.length <= 12) {
    return lines.join("\n");
  }
  return [...lines.slice(0, 10), `... ${lines.length - 10} more line(s)`].join("\n");
}

function bufferToString(value: string | Buffer | null | undefined) {
  if (!value) {
    return "";
  }
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

function cloneChoice(choice: TuiChoice) {
  return {
    ...choice,
    args: [...choice.args],
    prompt: choice.prompt ? { ...choice.prompt } : undefined
  };
}

function wrap(index: number, length: number) {
  if (length <= 0) {
    return 0;
  }
  return (index + length) % length;
}

function trimMiddle(value: string, maxLength: number) {
  const text = String(value || "");
  if (text.length <= maxLength) {
    return text;
  }
  const keep = Math.max(8, Math.floor((maxLength - 3) / 2));
  return `${text.slice(0, keep)}...${text.slice(-keep)}`;
}
