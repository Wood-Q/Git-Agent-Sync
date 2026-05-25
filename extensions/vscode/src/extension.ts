import * as vscode from "vscode";
import { AgentSyncBinding, AgentSyncCli, AgentSyncCliError, RestoreResponse } from "./agentSyncCli";
import { HistoryView } from "./historyView";

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("Agent Sync");
  const cli = new AgentSyncCli(output);
  const historyView = new HistoryView(context.extensionUri);

  context.subscriptions.push(output);
  context.subscriptions.push(vscode.commands.registerCommand("agentSync.history", async () => {
    await withErrorHandling(output, async () => {
      const cwd = getWorkspaceRoot();
      const bindings = await cli.log(cwd);
      historyView.show(bindings);
    });
  }));

  context.subscriptions.push(vscode.commands.registerCommand("agentSync.refreshHistory", async () => {
    await withErrorHandling(output, async () => {
      const cwd = getWorkspaceRoot();
      const bindings = await cli.log(cwd);
      historyView.refresh(bindings);
    });
  }));

  context.subscriptions.push(vscode.commands.registerCommand("agentSync.restore", async () => {
    await withErrorHandling(output, async () => {
      const cwd = getWorkspaceRoot();
      const bindings = await cli.log(cwd);
      await restoreFromPick(cli, output, cwd, bindings);
    });
  }));

  context.subscriptions.push(vscode.commands.registerCommand("agentSync.restoreIndex", async (index: number) => {
    await withErrorHandling(output, async () => {
      const cwd = getWorkspaceRoot();
      await restoreIndex(cli, output, cwd, index);
    });
  }));
}

export function deactivate() {}

async function restoreFromPick(cli: AgentSyncCli, output: vscode.OutputChannel, cwd: string, bindings: AgentSyncBinding[]) {
  if (!bindings.length) {
    vscode.window.showInformationMessage("Agent Sync: no sessions found.");
    return;
  }
  const picked = await vscode.window.showQuickPick(bindings.map((binding, index) => ({
    label: `${index + 1}. ${binding.title || "(untitled session)"}`,
    description: [binding.agent, shortCommit(binding.projectCommit), binding.projectBranch || "detached"].filter(Boolean).join(" · "),
    detail: `${binding.authorName || "agent-sync"} · ${formatDate(binding.conversationAt || binding.syncedAt || binding.boundAt || "")} · ${binding.bundleId || ""}`,
    index: index + 1
  })), {
    title: "Restore Agent-Sync Session",
    placeHolder: "Select a session to restore"
  });
  if (!picked) {
    return;
  }
  await restoreIndex(cli, output, cwd, picked.index);
}

async function restoreIndex(cli: AgentSyncCli, output: vscode.OutputChannel, cwd: string, index: number) {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error("Agent Sync restore index must be a positive integer.");
  }
  const confirmed = await vscode.window.showWarningMessage(
    `Restore Agent-Sync session #${index}?`,
    { modal: true },
    "Restore"
  );
  if (confirmed !== "Restore") {
    return;
  }
  const response = await cli.restoreByIndex(cwd, index);
  const summary = summarizeRestore(response);
  vscode.window.showInformationMessage(summary, "Show Output").then((selection) => {
    if (selection === "Show Output") {
      output.show();
    }
  });
}

function summarizeRestore(response: RestoreResponse): string {
  const restored = response.results.filter((item) => item.status === "restored").length;
  const skipped = response.results.filter((item) => item.status === "skipped").length;
  if (restored && skipped) {
    return `Agent Sync: restored ${restored} session(s), skipped ${skipped}.`;
  }
  if (restored) {
    return `Agent Sync: restored ${restored} session(s).`;
  }
  if (skipped) {
    return `Agent Sync: skipped ${skipped} session(s).`;
  }
  return "Agent Sync: no sessions restored.";
}

async function withErrorHandling(output: vscode.OutputChannel, task: () => Promise<void>) {
  try {
    await task();
  } catch (error) {
    const message = error instanceof AgentSyncCliError || error instanceof Error
      ? error.message
      : String(error);
    const selection = await vscode.window.showErrorMessage(`Agent Sync: ${message}`, "Show Output");
    if (selection === "Show Output") {
      output.show();
    }
  }
}

function getWorkspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error("open a Git workspace before using Agent Sync.");
  }
  return folder.uri.fsPath;
}

function shortCommit(value?: string | null): string {
  return value ? value.slice(0, 12) : "";
}

function formatDate(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}
