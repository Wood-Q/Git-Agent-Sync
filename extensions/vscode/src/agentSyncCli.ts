import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);
const WINDOWS_EXECUTABLE_EXTENSIONS = [".cmd", ".exe", ".bat", ".com"];

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

export type LocalTransferAgent = "codex" | "claude";
export type LocalTransferMode = "clone" | "copy";

export interface LocalTransferResponse {
  mode: LocalTransferMode;
  from: LocalTransferAgent;
  to: LocalTransferAgent;
  candidates: number;
  stats: Record<string, number>;
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

  async pull(cwd: string): Promise<string> {
    return this.run(cwd, ["pull"]);
  }

  async push(cwd: string): Promise<string> {
    return this.run(cwd, ["push"]);
  }

  async localTransfer(cwd: string, mode: LocalTransferMode, from: LocalTransferAgent, to: LocalTransferAgent): Promise<LocalTransferResponse> {
    const command = `${mode}-local`;
    const stdout = await this.run(cwd, [command, "--from", from, "--to", to, "--json"]);
    return parseJson<LocalTransferResponse>(stdout, `agent-sync ${command} --json`);
  }

  async run(cwd: string, args: string[]): Promise<string> {
    const invocation = resolveCliInvocation();
    const line = [invocation.command, ...args].map(quoteForDisplay).join(" ");
    this.output.appendLine(`$ ${line}`);
    try {
      const result = await execFileAsync(invocation.command, args, {
        cwd,
        env: invocation.env,
        shell: invocation.shell,
        timeout: 120000,
        maxBuffer: 1024 * 1024 * 20,
        windowsHide: true
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
      const detail = formatCliFailure(invocation, failure);
      throw new AgentSyncCliError(detail, failure.stdout || "", failure.stderr || "", failure.code ?? null);
    }
  }
}

interface CliInvocation {
  command: string;
  env: NodeJS.ProcessEnv;
  shell: boolean;
}

export function getCliPath(): string {
  return vscode.workspace.getConfiguration("agentSync").get<string>("cliPath")?.trim() || "agent-sync";
}

export function resolveCliInvocation(): CliInvocation {
  const env = createCliEnv();
  const configured = getCliPath();
  const command = isWindows() ? resolveWindowsCliPath(configured, env) : configured;
  return {
    command,
    env,
    shell: shouldUseShell(command)
  };
}

export function buildCliCommandLine(args: string[]): string {
  const invocation = resolveCliInvocation();
  return [invocation.command, ...args].map(quoteForDisplay).join(" ");
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

function createCliEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  if (!isWindows()) {
    return env;
  }

  const pathKey = getPathKey(env);
  const currentPath = env[pathKey] || "";
  const entries = unique([
    ...getWindowsNpmSearchDirs(env),
    ...currentPath.split(delimiter)
  ].filter(Boolean));
  env[pathKey] = entries.join(delimiter);
  return env;
}

function resolveWindowsCliPath(command: string, env: NodeJS.ProcessEnv): string {
  const hasPath = command.includes("\\") || command.includes("/") || isAbsolute(command);
  if (hasPath) {
    return findWindowsCommandAtPath(command) || command;
  }
  return findWindowsCommandOnPath(command, env) || command;
}

function findWindowsCommandOnPath(command: string, env: NodeJS.ProcessEnv): string | null {
  const pathValue = env[getPathKey(env)] || "";
  const names = getWindowsCommandNames(command);
  for (const dir of pathValue.split(delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function findWindowsCommandAtPath(command: string): string | null {
  if (existsSync(command)) {
    return command;
  }
  if (extname(command)) {
    return null;
  }
  for (const extension of WINDOWS_EXECUTABLE_EXTENSIONS) {
    const candidate = `${command}${extension}`;
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getWindowsCommandNames(command: string): string[] {
  if (extname(command)) {
    return [command];
  }
  return WINDOWS_EXECUTABLE_EXTENSIONS.map((extension) => `${command}${extension}`);
}

function getWindowsNpmSearchDirs(env: NodeJS.ProcessEnv): string[] {
  return [
    env.npm_config_prefix,
    env.APPDATA ? join(env.APPDATA, "npm") : "",
    env.NVM_SYMLINK,
    env.ProgramFiles ? join(env.ProgramFiles, "nodejs") : "",
    env["ProgramFiles(x86)"] ? join(env["ProgramFiles(x86)"] as string, "nodejs") : ""
  ].filter(isNonEmptyString);
}

function shouldUseShell(command: string): boolean {
  if (!isWindows()) {
    return false;
  }
  const extension = extname(command).toLowerCase();
  return !extension || extension === ".cmd" || extension === ".bat";
}

function formatCliFailure(
  invocation: CliInvocation,
  failure: { message?: string; stdout?: string; stderr?: string; code?: number | string | null }
): string {
  if (failure.code === "ENOENT") {
    return `could not find Agent-Sync CLI "${invocation.command}". Install it with "npm install -g git-agent-sync", or set "agentSync.cliPath" to the full agent-sync executable path.`;
  }
  return failure.stderr?.trim() || failure.message || "Agent-Sync command failed";
}

function getPathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") || "Path";
}

function quoteForDisplay(value: string): string {
  return /\s/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function isWindows(): boolean {
  return process.platform === "win32";
}

function isNonEmptyString(value: string | undefined): value is string {
  return Boolean(value);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
