import * as vscode from "vscode";
import {
  AgentSyncBinding,
  AgentSyncCli,
  AgentSyncCliError,
  LocalTransferResponse,
  RestoreResponse,
  buildCliCommandLine
} from "./agentSyncCli";
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

  context.subscriptions.push(vscode.commands.registerCommand("agentSync.pull", async () => {
    await withErrorHandling(output, async () => {
      const cwd = getWorkspaceRoot();
      await syncSidecarAndRefresh(cli, historyView, cwd, "pull");
    });
  }));

  context.subscriptions.push(vscode.commands.registerCommand("agentSync.push", async () => {
    await withErrorHandling(output, async () => {
      const cwd = getWorkspaceRoot();
      await syncSidecarAndRefresh(cli, historyView, cwd, "push");
    });
  }));

  registerCliAction(context, output, cli, "agentSync.syncStatus", "Sync Status", ["sync", "status"]);
  registerCliAction(context, output, cli, "agentSync.syncBackground", "Background Sync", ["sync", "--background"]);
  registerCliAction(context, output, cli, "agentSync.syncFlush", "Flush Sync Queue", ["sync", "--flush"]);
  registerCliAction(context, output, cli, "agentSync.syncRetry", "Retry Failed Sync Jobs", ["sync", "retry", "all"]);
  registerCliAction(context, output, cli, "agentSync.syncCancel", "Cancel Pending Sync Jobs", ["sync", "cancel", "all"]);
  registerCliAction(context, output, cli, "agentSync.daemonStatus", "Daemon Status", ["daemon", "status"]);
  registerCliAction(context, output, cli, "agentSync.privacyScan", "Privacy Scan", ["privacy", "scan"]);
  registerCliAction(context, output, cli, "agentSync.privacyRedactDryRun", "Privacy Redaction Preview", ["privacy", "redact", "--dry-run"]);
  registerCliAction(context, output, cli, "agentSync.conflictsList", "Conflicts", ["conflicts", "list"]);
  registerCliAction(context, output, cli, "agentSync.registerLocal", "Register Local Codex Clones", ["register-local"]);
  registerCliAction(context, output, cli, "agentSync.repairLocal", "Repair Local Codex Registration", ["repair-local"]);
  registerCliAction(context, output, cli, "agentSync.cleanLocal", "Preview Local Clone Cleanup", ["clean-local"]);

  context.subscriptions.push(vscode.commands.registerCommand("agentSync.toolInspect", async () => {
    await withErrorHandling(output, async () => {
      const cwd = getWorkspaceRoot();
      await runToolCommand(cli, output, cwd, "inspect");
    });
  }));

  context.subscriptions.push(vscode.commands.registerCommand("agentSync.toolExportReadable", async () => {
    await withErrorHandling(output, async () => {
      const cwd = getWorkspaceRoot();
      await runToolCommand(cli, output, cwd, "export-readable");
    });
  }));

  context.subscriptions.push(vscode.commands.registerCommand("agentSync.showBundle", async (bundleId?: string) => {
    await withErrorHandling(output, async () => {
      const cwd = getWorkspaceRoot();
      const selectedBundleId = bundleId || await pickBundleId(cli, cwd);
      if (!selectedBundleId) {
        return;
      }
      await runCliAction(cli, output, cwd, "Show Bundle", ["show", selectedBundleId]);
    });
  }));

  context.subscriptions.push(vscode.commands.registerCommand("agentSync.localClone", async () => {
    await withErrorHandling(output, async () => {
      const cwd = getWorkspaceRoot();
      await runLocalProviderClone(cli, output, cwd);
    });
  }));

  context.subscriptions.push(vscode.commands.registerCommand("agentSync.watchLocalCopy", async () => {
    await withErrorHandling(output, async () => {
      const cwd = getWorkspaceRoot();
      await startLocalWatchTerminal(cwd);
    });
  }));

  context.subscriptions.push(vscode.commands.registerCommand("agentSync.openTui", async () => {
    await withErrorHandling(output, async () => {
      const cwd = getWorkspaceRoot();
      startTuiTerminal(cwd);
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

async function syncSidecarAndRefresh(cli: AgentSyncCli, historyView: HistoryView, cwd: string, direction: "pull" | "push") {
  const label = direction === "pull" ? "Pull" : "Push";
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Agent Sync: ${label}`,
    cancellable: false
  }, async () => {
    if (direction === "pull") {
      await cli.pull(cwd);
    } else {
      await cli.push(cwd);
    }
    const bindings = await cli.log(cwd);
    historyView.refresh(bindings);
  });
  vscode.window.showInformationMessage(`Agent Sync: ${direction} complete.`);
}

async function runLocalProviderClone(cli: AgentSyncCli, output: vscode.OutputChannel, cwd: string) {
  const result = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Agent Sync: Clone Codex sessions to current provider",
    cancellable: false
  }, () => cli.localTransfer(cwd));
  const summary = summarizeLocalTransfer(result);
  vscode.window.showInformationMessage(summary, "Show Output").then((selection) => {
    if (selection === "Show Output") {
      output.show();
    }
  });
}

function registerCliAction(
  context: vscode.ExtensionContext,
  output: vscode.OutputChannel,
  cli: AgentSyncCli,
  command: string,
  label: string,
  args: string[]
) {
  context.subscriptions.push(vscode.commands.registerCommand(command, async () => {
    await withErrorHandling(output, async () => {
      const cwd = getWorkspaceRoot();
      await runCliAction(cli, output, cwd, label, args);
    });
  }));
}

async function runCliAction(cli: AgentSyncCli, output: vscode.OutputChannel, cwd: string, label: string, args: string[]) {
  const stdout = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Agent Sync: ${label}`,
    cancellable: false
  }, () => cli.run(cwd, args));
  const summary = summarizeCliOutput(label, stdout);
  vscode.window.showInformationMessage(summary, "Show Output").then((selection) => {
    if (selection === "Show Output") {
      output.show();
    }
  });
}

async function runToolCommand(cli: AgentSyncCli, output: vscode.OutputChannel, cwd: string, mode: "inspect" | "export-readable") {
  const bindings = await cli.log(cwd);
  const picked = await pickBinding(bindings, mode === "inspect" ? "Inspect Agent-Sync Bundle IR" : "Export Readable Claude JSONL");
  if (!picked?.bundleId) {
    return;
  }
  const args = mode === "inspect"
    ? ["tool", "inspect", "--session", picked.bundleId]
    : ["tool", "export", "--to", "claude", "--mode", "readable", "--session", picked.bundleId];
  await runCliAction(cli, output, cwd, mode === "inspect" ? "Tool Inspect" : "Tool Export Readable", args);
}

async function pickBinding(bindings: AgentSyncBinding[], title: string) {
  if (!bindings.length) {
    vscode.window.showInformationMessage("Agent Sync: no sessions found.");
    return null;
  }
  return vscode.window.showQuickPick(bindings.map((binding, index) => ({
    label: `${index + 1}. ${binding.title || "(untitled session)"}`,
    description: [binding.agent, shortCommit(binding.projectCommit), binding.projectBranch || "detached"].filter(Boolean).join(" · "),
    detail: `${binding.bundleId || ""} · ${formatDate(binding.conversationAt || binding.syncedAt || binding.boundAt || "")}`,
    binding
  })), {
    title,
    placeHolder: "Select a synced session"
  }).then((picked) => picked?.binding || null);
}

async function pickBundleId(cli: AgentSyncCli, cwd: string): Promise<string | null> {
  const bindings = await cli.log(cwd);
  const picked = await pickBinding(bindings, "Show Agent-Sync Bundle");
  return picked?.bundleId || null;
}

function summarizeCliOutput(label: string, stdout: string) {
  const firstLine = stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  if (!firstLine) {
    return `Agent Sync: ${label} complete.`;
  }
  const clipped = firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine;
  return `Agent Sync: ${label} complete. ${clipped}`;
}

async function startLocalWatchTerminal(cwd: string) {
  const terminal = vscode.window.createTerminal({
    name: "Agent Sync Watch Codex Provider",
    cwd
  });
  terminal.show();
  terminal.sendText(buildCliCommandLine(["watch-local"]));
}

function startTuiTerminal(cwd: string) {
  const terminal = vscode.window.createTerminal({
    name: "Agent Sync TUI",
    cwd
  });
  terminal.show();
  terminal.sendText(buildCliCommandLine(["tui"]));
}

function summarizeLocalTransfer(result: LocalTransferResponse): string {
  const cloned = result.stats.cloned || 0;
  const skipped = (result.stats.skipped_exists || 0) + (result.stats.skipped_target || 0) + (result.stats.skipped_collision || 0);
  return `Agent Sync: cloned Codex sessions to ${result.provider}: ${cloned} cloned, ${skipped} skipped.`;
}

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
