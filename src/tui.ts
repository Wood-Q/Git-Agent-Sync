import { spawnSync } from "node:child_process";
import { stdin as defaultInput, stdout as defaultOutput } from "node:process";
import { createInterface } from "node:readline/promises";

type TuiChoice = {
  key: string;
  label: string;
  args: string[];
  prompt?: {
    label: string;
    placeholder: string;
  };
  exits?: boolean;
};

const MENU_CHOICES: TuiChoice[] = [
  { key: "1", label: "Status / scan local sessions", args: ["status"] },
  { key: "2", label: "Log latest sidecar sessions", args: ["log", "--latest", "--oneline", "-10"] },
  { key: "3", label: "Pull sidecar sessions", args: ["pull"] },
  { key: "4", label: "Push sidecar sessions", args: ["push"] },
  {
    key: "5",
    label: "Restore by default log index",
    args: ["restore", "--index"],
    prompt: {
      label: "Restore index",
      placeholder: "Enter the # shown by agent-sync log"
    }
  },
  { key: "6", label: "Clone Codex sessions to current provider", args: ["clone-local"] },
  { key: "w", label: "Watch Codex provider changes", args: ["watch-local"] },
  { key: "q", label: "Quit", args: [], exits: true }
];

export function getTuiChoices() {
  return MENU_CHOICES.map((choice) => ({ ...choice, args: [...choice.args] }));
}

export function resolveTuiChoice(value: string) {
  const key = String(value || "").trim();
  return getTuiChoices().find((choice) => choice.key === key) || null;
}

export function renderTuiMenu(config) {
  const title = `Agent Sync TUI - ${config.projectName || "project"}`;
  const lines = [
    title,
    "=".repeat(title.length),
    `Project root: ${config.projectRoot}`,
    `Store: ${config.storePath}`,
    "",
    "Sidecar",
    "  1  Status / scan",
    "  2  Log latest",
    "  3  Pull",
    "  4  Push",
    "  5  Restore by index",
    "",
    "Local Codex provider sync",
    "  6  Clone Codex sessions to current provider",
    "  w  Watch Codex provider changes",
    "",
    "  q  Quit"
  ];
  return lines.join("\n");
}

export async function runTui(gitRoot, config, options: Record<string, any> = {}) {
  if (!options.io && (!defaultInput.isTTY || !defaultOutput.isTTY)) {
    console.log(renderTuiMenu(config));
    return;
  }

  const io = options.io || createInterface({ input: defaultInput, output: defaultOutput });
  const runner = options.runner || runCliCommand;
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

      const args = [...choice.args];
      if (choice.prompt) {
        const prompted = String(await io.question(`${choice.prompt.label}: `)).trim();
        if (!prompted) {
          console.log(`${choice.prompt.label} is required.`);
          continue;
        }
        args.push(prompted);
      }

      const status = runner(args, gitRoot);
      if (status && status !== 0) {
        console.log(`Command exited with status ${status}.`);
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

function isWatchChoice(choice: TuiChoice) {
  return choice.args[0] === "watch-local";
}

function runCliCommand(args: string[], cwd: string) {
  const cliEntry = process.argv[1] || "agent-sync";
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    stdio: "inherit"
  });
  return result.status ?? 1;
}
