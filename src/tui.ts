import { spawnSync } from "node:child_process";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createInterface } from "node:readline/promises";
import React, { useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";

type TuiPrompt = {
  label: string;
  placeholder: string;
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

type TuiView = {
  id: string;
  title: string;
  subtitle: string;
};

type TuiCommandResult = number | {
  status?: number | null;
  stdout?: string | Buffer | null;
  stderr?: string | Buffer | null;
};

type TuiRunner = (args: string[], cwd: string) => TuiCommandResult | Promise<TuiCommandResult>;

const h = React.createElement;

const TUI_VIEWS: TuiView[] = [
  { id: "dashboard", title: "Dashboard", subtitle: "Project scan, sidecar sync, and quick recovery" },
  { id: "queue", title: "Sync Queue", subtitle: "Background jobs, daemon state, and flush controls" },
  { id: "history", title: "Session History", subtitle: "Browse bindings and restore by visible index" },
  { id: "local", title: "Local Provider", subtitle: "Local-only Codex provider cloning and registration" },
  { id: "tool", title: "Tool Convert", subtitle: "Inspect bundles through Conversation IR" },
  { id: "privacy", title: "Privacy Review", subtitle: "Scan or redact before sidecar push" },
  { id: "conflicts", title: "Conflicts", subtitle: "Review sidecar conflict quarantine and resolution state" },
  { id: "ops", title: "Settings", subtitle: "Doctor checks and hook management" }
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
  { key: "x", view: "ops", badge: "DOCTOR", label: "Run doctor", description: "Check config, sidecar store, sparse checkout, and bindings.", args: ["doctor"] },
  { key: "H", view: "ops", badge: "HOOKS", label: "Install pre-push hook", description: "Queue background Agent-Sync jobs during git push.", args: ["install-hooks"], confirm: "Install the Agent-Sync managed pre-push hook in this repository?" },
  { key: "U", view: "ops", badge: "HOOKS", label: "Uninstall pre-push hook", description: "Remove the Agent-Sync managed hook.", args: ["uninstall-hooks"], confirm: "Remove the Agent-Sync managed pre-push hook from this repository?" },
  { key: "q", view: "dashboard", badge: "EXIT", label: "Quit", description: "Close the TUI.", args: [], exits: true }
];

export function getTuiChoices() {
  return MENU_CHOICES.map(cloneChoice);
}

export function getTuiViews() {
  return TUI_VIEWS.map((view) => ({ ...view }));
}

export function resolveTuiChoice(value: string, viewId = "") {
  const key = String(value || "").trim();
  const choices = getTuiChoices();
  return choices.find((choice) => choice.key === key && (!viewId || choice.view === viewId)) ||
    choices.find((choice) => choice.key === key) ||
    null;
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

export function renderTuiMenu(config) {
  const title = `Agent Sync TUI - ${config.projectName || "project"}`;
  const lines = [
    title,
    "=".repeat(title.length),
    `Project root: ${config.projectRoot}`,
    `Store: ${config.storePath}`,
    ""
  ];
  for (const view of TUI_VIEWS) {
    const choices = MENU_CHOICES.filter((choice) => choice.view === view.id && !choice.exits);
    if (!choices.length) {
      continue;
    }
    lines.push(view.title);
    for (const choice of choices) {
      lines.push(`  ${choice.key.padEnd(2)} ${choice.label}`);
      lines.push(`     ${formatTuiCommand(choice)}${choice.confirm ? " [confirm]" : ""}`);
    }
    lines.push("");
  }
  lines.push("Shortcuts");
  lines.push("  /  Search actions");
  lines.push("  ?  Toggle help");
  lines.push("  q  Quit");
  return lines.join("\n");
}

export async function runTui(gitRoot, config, options: Record<string, any> = {}) {
  if (options.io) {
    await runPromptTui(gitRoot, config, options);
    return;
  }

  if (!options.forceInk && (!defaultInput.isTTY || !defaultOutput.isTTY)) {
    console.log(renderTuiMenu(config));
    return;
  }

  const runner = options.runner || ((args: string[], cwd: string) => runCliCommand(args, cwd));
  const instance = render(h(AgentSyncTuiApp, { gitRoot, config, runner }));
  await instance.waitUntilExit();
}

function AgentSyncTuiApp({ gitRoot, config, runner }: { gitRoot: string; config: Record<string, any>; runner: TuiRunner }) {
  const { exit } = useApp();
  const [activeViewIndex, setActiveViewIndex] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [promptChoice, setPromptChoice] = useState<TuiChoice | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [confirmRequest, setConfirmRequest] = useState<{ choice: TuiChoice; promptValue: string } | null>(null);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [output, setOutput] = useState("");
  const activeView = TUI_VIEWS[activeViewIndex];
  const baseChoices = useMemo(() => getChoicesForView(activeView.id), [activeView.id]);
  const choices = useMemo(() => filterTuiChoices(baseChoices, searchQuery), [baseChoices, searchQuery]);
  const selectedChoice = choices[Math.min(selectedIndex, Math.max(choices.length - 1, 0))];

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
        setStatus("Action cancelled");
        setOutput("");
      } else {
        setStatus("Press y to confirm or n to cancel");
      }
      return;
    }
    if (searchMode) {
      if (key.escape) {
        setSearchMode(false);
        setSearchQuery("");
        setSelectedIndex(0);
        setStatus("Search cleared");
      } else if (key.return) {
        setSearchMode(false);
        setStatus(searchQuery ? `Filtered by "${searchQuery}"` : "Search closed");
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
        setStatus("Prompt cancelled");
      } else if (key.return) {
        const value = promptValue.trim();
        if (!value) {
          setStatus(`${promptChoice.prompt?.label || "Value"} is required`);
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
      setStatus("Search actions");
      return;
    }
    if (input === "q") {
      exit();
      return;
    }
    if (key.leftArrow) {
      setActiveViewIndex((index) => wrap(index - 1, TUI_VIEWS.length));
      setSelectedIndex(0);
      return;
    }
    if (key.rightArrow || key.tab) {
      setActiveViewIndex((index) => wrap(index + 1, TUI_VIEWS.length));
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
      const quickChoice = resolveTuiChoice(input, activeView.id);
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
      setStatus("Confirmation required");
      setOutput(`${choice.confirm}\n${formatTuiCommand(choice, promptValue)}\nPress y to confirm or n to cancel.`);
      return;
    }
    setRunning(true);
    setStatus(`Running git agent-sync ${args.join(" ")}`);
    setOutput("");
    try {
      if (choice.handoff) {
        setStatus("Handing off to long-running command");
        exit();
        setTimeout(() => {
          runCliCommand(args, gitRoot, { inherit: true });
        }, 25);
        return;
      }
      const result = normalizeCommandResult(await runner(args, gitRoot));
      const text = compactOutput([result.stdout, result.stderr].filter(Boolean).join("\n"));
      setOutput(text || "(command completed without output)");
      setStatus(result.status === 0 ? "Command completed" : `Command exited with status ${result.status}`);
    } catch (error) {
      setStatus("Command failed");
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  }

  return h(Box, { flexDirection: "column", gap: 1 },
    h(Header, { config }),
    h(Box, { flexDirection: "row", gap: 2 },
      h(ViewRail, { activeViewIndex }),
      h(ActionPanel, { view: activeView, choices, selectedIndex, running, searchMode, searchQuery })
    ),
    showHelp ? h(HelpPanel) : null,
    h(StatusPanel, { status, output, promptChoice, promptValue, confirmRequest, searchMode, searchQuery, running })
  );
}

function Header({ config }: { config: Record<string, any> }) {
  return h(Box, { borderStyle: "round", borderColor: "cyan", paddingX: 1, flexDirection: "column" },
    h(Box, { justifyContent: "space-between" },
      h(Text, { color: "cyan", bold: true }, "Agent Sync"),
      h(Text, { color: "gray" }, config.projectName || "project")
    ),
    h(Text, { color: "white" }, trimMiddle(config.projectRoot || "", 84)),
    h(Text, { color: "gray" }, trimMiddle(config.storePath || "", 84))
  );
}

function ViewRail({ activeViewIndex }: { activeViewIndex: number }) {
  return h(Box, { borderStyle: "round", borderColor: "gray", paddingX: 1, flexDirection: "column", width: 26 },
    h(Text, { color: "gray" }, "Views"),
    ...TUI_VIEWS.map((view, index) => h(Text, {
      key: view.id,
      color: index === activeViewIndex ? "cyan" : "white",
      bold: index === activeViewIndex
    }, `${index === activeViewIndex ? ">" : " "} ${view.title}`))
  );
}

function ActionPanel({
  view,
  choices,
  selectedIndex,
  running,
  searchMode,
  searchQuery
}: {
  view: TuiView;
  choices: TuiChoice[];
  selectedIndex: number;
  running: boolean;
  searchMode: boolean;
  searchQuery: string;
}) {
  return h(Box, { borderStyle: "round", borderColor: "cyan", paddingX: 1, flexDirection: "column", flexGrow: 1 },
    h(Box, { flexDirection: "column", marginBottom: 1 },
      h(Text, { color: "cyan", bold: true }, view.title),
      h(Text, { color: "gray" }, view.subtitle)
    ),
    choices.length ? null : h(Text, { color: "gray" }, searchQuery ? `No actions match "${searchQuery}".` : "No actions in this view."),
    ...choices.map((choice, index) => h(ActionRow, {
      key: `${choice.view}:${choice.key}`,
      choice,
      selected: index === selectedIndex,
      disabled: running
    })),
    h(Box, { marginTop: 1 },
      h(Text, { color: searchMode ? "yellow" : "gray" }, searchMode ? `Search: ${searchQuery || "(type to filter)"}` : "Arrows select, / searches, ? help, Enter runs, Tab switches views, q exits.")
    )
  );
}

function ActionRow({ choice, selected, disabled }: { choice: TuiChoice; selected: boolean; disabled: boolean }) {
  const color = disabled ? "gray" : selected ? "black" : "white";
  const backgroundColor = selected && !disabled ? "cyan" : undefined;
  return h(Box, { flexDirection: "column", marginY: 0 },
    h(Box, {},
      h(Text, { color, backgroundColor, bold: selected }, ` ${choice.key} `),
      h(Text, { color: "gray" }, ` ${choice.badge.padEnd(8)} `),
      h(Text, { color: selected ? "cyan" : "white", bold: selected }, `${choice.label}${choice.confirm ? " [confirm]" : ""}`)
    ),
    h(Box, { paddingLeft: 15 },
      h(Text, { color: "gray" }, choice.description)
    ),
    h(Box, { paddingLeft: 15 },
      h(Text, { color: selected ? "cyan" : "gray" }, formatTuiCommand(choice))
    )
  );
}

function HelpPanel() {
  const lines = [
    "Keyboard",
    "  Left/Right or Tab switches views",
    "  Up/Down moves through actions",
    "  Enter runs the selected action",
    "  / filters actions in the current view",
    "  ? toggles this help",
    "  y/n answers confirmation prompts",
    "  q exits"
  ];
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
  running
}: {
  status: string;
  output: string;
  promptChoice: TuiChoice | null;
  promptValue: string;
  confirmRequest: { choice: TuiChoice; promptValue: string } | null;
  searchMode: boolean;
  searchQuery: string;
  running: boolean;
}) {
  return h(Box, { borderStyle: "round", borderColor: running ? "yellow" : confirmRequest ? "red" : "gray", paddingX: 1, flexDirection: "column" },
    h(Box, {},
      h(Text, { color: running ? "yellow" : confirmRequest ? "red" : "green", bold: true }, running ? "Running" : confirmRequest ? "Confirm" : "Status"),
      h(Text, { color: "white" }, `  ${status}`)
    ),
    searchMode ? h(Box, {},
      h(Text, { color: "cyan" }, "Search: "),
      h(Text, { color: searchQuery ? "white" : "gray" }, searchQuery || "type to filter actions")
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
  const shouldClose = !options.io;
  try {
    while (true) {
      console.log("");
      console.log(renderTuiMenu(config));
      const answer = await io.question("\nSelect an action: ");
      const choice = resolveTuiChoice(answer);
      if (!choice) {
        console.log("Unknown selection.");
        continue;
      }
      if (choice.exits) {
        console.log("Bye.");
        return;
      }

      let prompted = "";
      if (choice.prompt) {
        prompted = String(await io.question(`${choice.prompt.label}: `)).trim();
        if (!prompted) {
          console.log(`${choice.prompt.label} is required.`);
          continue;
        }
      }

      console.log(`Command: ${formatTuiCommand(choice, prompted)}`);
      if (choice.confirm) {
        const confirmation = String(await io.question(`${choice.confirm} Type y to continue: `)).trim();
        if (!isConfirmAccepted(confirmation)) {
          console.log("Cancelled.");
          continue;
        }
      }

      const result = normalizeCommandResult(await runner(buildChoiceArgs(choice, prompted), gitRoot));
      if (result.status !== 0) {
        console.log(`Command exited with status ${result.status}.`);
      }
      if (!isWatchChoice(choice)) {
        await io.question("\nPress Enter to return to the menu.");
      } else {
        return;
      }
    }
  } finally {
    if (shouldClose) {
      io.close();
    }
  }
}

function getChoicesForView(viewId: string) {
  return MENU_CHOICES.filter((choice) => choice.view === viewId || choice.exits).map(cloneChoice);
}

function buildChoiceArgs(choice: TuiChoice, prompted = "") {
  return prompted ? [...choice.args, prompted] : [...choice.args];
}

function promptToken(prompt?: TuiPrompt) {
  if (!prompt) {
    return "";
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
