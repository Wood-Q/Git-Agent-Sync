import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

export interface AgentSyncBinding {
  title?: string | null;
  authorName?: string | null;
  authorEmail?: string | null;
  conversationAt?: string | null;
  syncedAt?: string | null;
  boundAt?: string | null;
  projectBranch?: string | null;
  projectCommit?: string | null;
  agent?: string | null;
  bundleId?: string | null;
  commitMessage?: string | null;
}

export type AgentSyncLogSelector = "all" | "latest" | "current" | "branch" | "commit";

export interface AgentSyncLogFilter {
  selector: AgentSyncLogSelector;
  value?: string;
}

export interface RestoreResult {
  status: "restored" | "skipped";
  agent?: string | null;
  bundleId?: string | null;
  source?: string | null;
  target?: string | null;
  adapted?: boolean;
  reason?: string | null;
  registered?: {
    ok?: boolean;
    kind?: string;
    sessionId?: string;
    reason?: string;
  };
}

export interface RestoreResponse {
  ok: boolean;
  results: RestoreResult[];
}

export class AgentSyncCliError extends Error {
  constructor(
    message: string,
    readonly stdout = "",
    readonly stderr = "",
    readonly code: number | string | null = null
  ) {
    super(message);
  }
}

export class AgentSyncCli {
  constructor(private readonly output: vscode.OutputChannel) {}

  async log(cwd: string, filter: AgentSyncLogFilter = defaultLogFilter()): Promise<AgentSyncBinding[]> {
    const stdout = await this.run(cwd, ["log", ...logSelectorArgs(filter), "--json"]);
    return parseJson<AgentSyncBinding[]>(stdout, "agent-sync log --json");
  }

  async restoreByIndex(cwd: string, index: number, filter: AgentSyncLogFilter = defaultLogFilter()): Promise<RestoreResponse> {
    const stdout = await this.run(cwd, ["restore", ...restoreSelectorArgs(filter, index), "--json"]);
    return parseJson<RestoreResponse>(stdout, `agent-sync restore --index ${index} --json`);
  }

  async run(cwd: string, args: string[]): Promise<string> {
    const command = getCliPath();
    const line = `${command} ${args.join(" ")}`;
    this.output.appendLine(`$ ${line}`);
    try {
      const result = await execFileAsync(command, args, {
        cwd,
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 20
      });
      if (result.stdout) {
        this.output.appendLine(result.stdout.trimEnd());
      }
      if (result.stderr) {
        this.output.appendLine(result.stderr.trimEnd());
      }
      return result.stdout;
    } catch (error) {
      const failure = error as {
        message?: string;
        stdout?: string;
        stderr?: string;
        code?: number | string | null;
      };
      if (failure.stdout) {
        this.output.appendLine(failure.stdout.trimEnd());
      }
      if (failure.stderr) {
        this.output.appendLine(failure.stderr.trimEnd());
      }
      const detail = failure.stderr?.trim() || failure.message || "Agent-Sync command failed";
      throw new AgentSyncCliError(detail, failure.stdout || "", failure.stderr || "", failure.code ?? null);
    }
  }
}

export function getCliPath(): string {
  return vscode.workspace.getConfiguration("agentSync").get<string>("cliPath")?.trim() || "agent-sync";
}

export function defaultLogFilter(): AgentSyncLogFilter {
  return { selector: "all" };
}

export function normalizeLogFilter(filter?: Partial<AgentSyncLogFilter> | null): AgentSyncLogFilter {
  const selector = filter?.selector || "all";
  if (selector === "branch" || selector === "commit") {
    return {
      selector,
      value: filter?.value?.trim() || ""
    };
  }
  if (selector === "latest" || selector === "current") {
    return { selector };
  }
  return defaultLogFilter();
}

function logSelectorArgs(filter: AgentSyncLogFilter): string[] {
  if (filter.selector === "latest") {
    return ["--latest"];
  }
  if (filter.selector === "current") {
    return ["--current"];
  }
  if (filter.selector === "branch" && filter.value) {
    return ["--branch", filter.value];
  }
  if (filter.selector === "commit" && filter.value) {
    return ["--commit", filter.value];
  }
  return [];
}

function restoreSelectorArgs(filter: AgentSyncLogFilter, index: number): string[] {
  if (filter.selector === "latest") {
    return ["--latest", String(index)];
  }
  if (filter.selector === "current") {
    return ["--current", String(index)];
  }
  if (filter.selector === "branch" && filter.value) {
    return ["--branch", filter.value, String(index)];
  }
  if (filter.selector === "commit" && filter.value) {
    return ["--commit", filter.value, String(index)];
  }
  return ["--index", String(index)];
}

export function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AgentSyncCliError(`${label} returned invalid JSON: ${message}`, text);
  }
}
