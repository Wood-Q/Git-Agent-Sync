import * as vscode from "vscode";
import { AgentSyncBinding } from "./agentSyncCli";

type FilterColumn = "author" | "date" | "branch" | "commit" | "agent" | "bundle";

export class HistoryView {
  private panel: vscode.WebviewPanel | undefined;
  private bindings: AgentSyncBinding[] = [];

  constructor(private readonly extensionUri: vscode.Uri) {}

  show(bindings: AgentSyncBinding[]) {
    this.bindings = bindings;
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        "agentSyncHistory",
        "Agent Sync History",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          localResourceRoots: [this.extensionUri]
        }
      );
      this.panel.iconPath = {
        light: vscode.Uri.joinPath(this.extensionUri, "resources", "icons", "agent-sync-light.svg"),
        dark: vscode.Uri.joinPath(this.extensionUri, "resources", "icons", "agent-sync-dark.svg")
      };
      this.panel.onDidDispose(() => {
        this.panel = undefined;
      });
      this.panel.webview.onDidReceiveMessage((message) => {
        if (message?.command === "restore" && Number.isInteger(message.index)) {
          vscode.commands.executeCommand("agentSync.restoreIndex", message.index);
        } else if (message?.command === "refresh") {
          vscode.commands.executeCommand("agentSync.refreshHistory");
        } else if (message?.command === "pull") {
          vscode.commands.executeCommand("agentSync.pull");
        } else if (message?.command === "push") {
          vscode.commands.executeCommand("agentSync.push");
        } else if (message?.command === "localClone") {
          vscode.commands.executeCommand("agentSync.localClone");
        } else if (message?.command === "watchLocalCopy") {
          vscode.commands.executeCommand("agentSync.watchLocalCopy");
        } else if (message?.command === "openTui") {
          vscode.commands.executeCommand("agentSync.openTui");
        }
      });
    }
    this.panel.webview.html = renderHistoryHtml(this.panel.webview, bindings);
    this.panel.reveal(vscode.ViewColumn.Active);
  }

  refresh(bindings: AgentSyncBinding[]) {
    this.show(bindings);
  }
}

export function renderHistoryHtml(webview: Pick<vscode.Webview, "cspSource">, bindings: AgentSyncBinding[]): string {
  const nonce = createNonce();
  const rows = bindings.map((binding, index) => renderRow(binding, index + 1)).join("");
  const options = buildFilterOptions(bindings);
  const empty = bindings.length
    ? ""
    : `<div class="empty">No Agent-Sync sessions found.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Agent Sync History</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    body {
      margin: 0;
      padding: 0;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }
    .toolbar {
      position: sticky;
      top: 0;
      z-index: 1;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border-bottom: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
    }
    .title {
      font-weight: 600;
      margin-right: auto;
      min-width: 170px;
    }
    select {
      height: 28px;
      border: 1px solid var(--vscode-input-border, transparent);
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      padding: 3px 8px;
      font: inherit;
    }
    button {
      border: 1px solid var(--vscode-button-border, transparent);
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      padding: 4px 10px;
      min-height: 26px;
      cursor: pointer;
    }
    button:hover {
      background: var(--vscode-button-hoverBackground);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
    }
    th, td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--vscode-panel-border);
      text-align: left;
      vertical-align: top;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    th {
      color: var(--vscode-descriptionForeground);
      font-weight: 600;
      background: var(--vscode-editor-background);
    }
    .heading {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
    }
    .headingText {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .filterButton {
      width: 20px;
      min-width: 20px;
      height: 20px;
      min-height: 20px;
      padding: 0;
      border: 0;
      color: var(--vscode-icon-foreground);
      background: transparent;
      line-height: 18px;
    }
    .filterButton:hover,
    .filterButton.active {
      color: var(--vscode-button-foreground);
      background: var(--vscode-toolbar-hoverBackground, var(--vscode-button-secondaryHoverBackground));
    }
    .filterButton.active {
      outline: 1px solid var(--vscode-focusBorder);
    }
    .filterMenu {
      position: fixed;
      z-index: 10;
      min-width: 180px;
      max-width: 320px;
      max-height: 280px;
      overflow: auto;
      border: 1px solid var(--vscode-dropdown-border);
      color: var(--vscode-dropdown-foreground);
      background: var(--vscode-dropdown-background);
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
    }
    .filterOption {
      display: block;
      width: 100%;
      border: 0;
      padding: 6px 10px;
      color: inherit;
      background: transparent;
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .filterOption:hover,
    .filterOption.active {
      color: var(--vscode-list-activeSelectionForeground);
      background: var(--vscode-list-activeSelectionBackground);
    }
    .count {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .index {
      width: 4%;
      color: var(--vscode-descriptionForeground);
    }
    .titleCell {
      width: 28%;
    }
    .author {
      width: 10%;
    }
    .date {
      width: 15%;
    }
    .branch {
      width: 9%;
    }
    .cellText {
      display: block;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .titleText {
      display: -webkit-box;
      overflow: hidden;
      white-space: normal;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      line-height: 1.35;
    }
    .meta {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      margin-top: 3px;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mono {
      font-family: var(--vscode-editor-font-family);
    }
    .commit {
      width: 11%;
    }
    .agent {
      width: 8%;
    }
    .bundle {
      width: 11%;
    }
    .restore {
      width: 10%;
      text-align: right;
    }
    .restore button {
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .empty {
      padding: 24px 14px;
      color: var(--vscode-descriptionForeground);
    }
    @media (max-width: 780px) {
      th, td {
        padding-inline: 8px;
      }
      .titleCell {
        width: 34%;
      }
      .bundle {
        display: none;
      }
      .restore {
        width: 11%;
      }
    }
    @media (max-width: 620px) {
      .date {
        width: 18%;
      }
      .branch,
      .agent {
        width: 9%;
      }
      .restore button {
        padding-inline: 6px;
      }
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <div class="title">Agent Sync History</div>
    <div class="count"><span id="visibleCount">${bindings.length}</span> / ${bindings.length}</div>
    <button type="button" id="pull" title="Pull sidecar sessions">Pull</button>
    <button type="button" id="push" title="Push local sessions">Push</button>
    <button type="button" id="localClone" title="Clone Codex sessions to current provider">Clone</button>
    <button type="button" id="watchLocalCopy" title="Watch Codex provider changes">Watch</button>
    <button type="button" id="openTui" title="Open Agent Sync TUI">TUI</button>
    <button type="button" id="refresh">Refresh</button>
    <button type="button" id="clear">Clear</button>
  </div>
  ${empty}
  <table aria-label="Agent Sync History">
    <thead>
      <tr>
        <th class="index">#</th>
        <th class="titleCell">Title</th>
        ${renderFilterHeader("Author", "author", options.author)}
        ${renderFilterHeader("Date", "date", options.date)}
        ${renderFilterHeader("Branch", "branch", options.branch)}
        ${renderFilterHeader("Commit", "commit", options.commit)}
        ${renderFilterHeader("Agent", "agent", options.agent)}
        ${renderFilterHeader("Bundle", "bundle", options.bundle)}
        <th class="restore">Restore</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const filters = {};
    let menu = null;
    const rows = Array.from(document.querySelectorAll('tbody tr'));
    const visibleCount = document.getElementById('visibleCount');

    const closeMenu = () => {
      if (menu) {
        menu.remove();
        menu = null;
      }
    };
    const applyFilters = () => {
      let visible = 0;
      rows.forEach((row) => {
        const shown = Object.entries(filters).every(([column, value]) => {
          return !value || row.dataset[column] === value;
        });
        row.hidden = !shown;
        if (shown) {
          visible += 1;
        }
      });
      visibleCount.textContent = String(visible);
      document.querySelectorAll('[data-filter-column]').forEach((button) => {
        button.classList.toggle('active', Boolean(filters[button.dataset.filterColumn]));
      });
    };
    const openMenu = (button) => {
      closeMenu();
      const column = button.dataset.filterColumn;
      const values = JSON.parse(button.dataset.filterValues || '[]');
      menu = document.createElement('div');
      menu.className = 'filterMenu';
      [{ label: 'All', value: '' }, ...values].forEach((item) => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'filterOption';
        option.textContent = item.label || '(empty)';
        option.title = item.label || '(empty)';
        option.classList.toggle('active', (filters[column] || '') === item.value);
        option.addEventListener('click', () => {
          filters[column] = item.value;
          closeMenu();
          applyFilters();
        });
        menu.appendChild(option);
      });
      document.body.appendChild(menu);
      const rect = button.getBoundingClientRect();
      menu.style.left = Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8) + 'px';
      menu.style.top = Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + 'px';
    };

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.filterMenu') && !event.target.closest('[data-filter-column]')) {
        closeMenu();
      }
    });
    document.querySelectorAll('[data-filter-column]').forEach((button) => {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        openMenu(button);
      });
    });
    document.getElementById('refresh').addEventListener('click', () => {
      vscode.postMessage({ command: 'refresh' });
    });
    document.getElementById('pull').addEventListener('click', () => {
      vscode.postMessage({ command: 'pull' });
    });
    document.getElementById('push').addEventListener('click', () => {
      vscode.postMessage({ command: 'push' });
    });
    document.getElementById('localClone').addEventListener('click', () => {
      vscode.postMessage({ command: 'localClone' });
    });
    document.getElementById('watchLocalCopy').addEventListener('click', () => {
      vscode.postMessage({ command: 'watchLocalCopy' });
    });
    document.getElementById('openTui').addEventListener('click', () => {
      vscode.postMessage({ command: 'openTui' });
    });
    document.getElementById('clear').addEventListener('click', () => {
      Object.keys(filters).forEach((key) => delete filters[key]);
      closeMenu();
      applyFilters();
    });
    document.querySelectorAll('[data-restore-index]').forEach((button) => {
      button.addEventListener('click', () => {
        vscode.postMessage({ command: 'restore', index: Number(button.dataset.restoreIndex) });
      });
    });
    applyFilters();
  </script>
</body>
</html>`;
}

function renderRow(binding: AgentSyncBinding, index: number): string {
  const title = binding.title || "(untitled session)";
  const date = binding.conversationAt || binding.syncedAt || binding.boundAt || "";
  const displayDate = formatDate(date);
  const dateKey = formatDateKey(date);
  const commit = binding.projectCommit ? binding.projectCommit.slice(0, 12) : "";
  const message = truncateText(binding.commitMessage || "", 72);
  return `<tr data-author="${escapeHtml(binding.authorName || "")}" data-date="${escapeHtml(dateKey)}" data-branch="${escapeHtml(binding.projectBranch || "detached")}" data-commit="${escapeHtml(commit)}" data-agent="${escapeHtml(binding.agent || "")}" data-bundle="${escapeHtml(binding.bundleId || "")}">
    <td class="index"><span class="cellText">${index}</span></td>
    <td class="titleCell" title="${escapeHtml(title)}">
      <div class="titleText">${escapeHtml(title)}</div>
      <div class="meta" title="${escapeHtml(binding.commitMessage || "")}">${escapeHtml(message)}</div>
    </td>
    <td class="author" title="${escapeHtml(binding.authorEmail || "")}"><span class="cellText">${escapeHtml(binding.authorName || "")}</span></td>
    <td class="date" title="${escapeHtml(displayDate)}"><span class="cellText">${escapeHtml(displayDate)}</span></td>
    <td class="branch"><span class="cellText">${escapeHtml(binding.projectBranch || "detached")}</span></td>
    <td class="mono commit" title="${escapeHtml(binding.projectCommit || "")}"><span class="cellText">${escapeHtml(commit)}</span></td>
    <td class="agent"><span class="cellText">${escapeHtml(binding.agent || "")}</span></td>
    <td class="mono bundle" title="${escapeHtml(binding.bundleId || "")}"><span class="cellText">${escapeHtml(binding.bundleId || "")}</span></td>
    <td class="restore"><button type="button" data-restore-index="${index}" title="Restore session ${index}">Restore</button></td>
  </tr>`;
}

function renderFilterHeader(label: string, column: FilterColumn, values: string[]): string {
  return `<th class="${column}">
    <div class="heading">
      <span class="headingText">${label}</span>
      <button type="button" class="filterButton" data-filter-column="${column}" data-filter-values="${escapeHtml(JSON.stringify(values.map((value) => ({ label: value || "(empty)", value }))))}" title="Filter ${label}">▾</button>
    </div>
  </th>`;
}

function buildFilterOptions(bindings: AgentSyncBinding[]): Record<FilterColumn, string[]> {
  const options: Record<FilterColumn, Set<string>> = {
    author: new Set(),
    date: new Set(),
    branch: new Set(),
    commit: new Set(),
    agent: new Set(),
    bundle: new Set()
  };
  for (const binding of bindings) {
    const date = binding.conversationAt || binding.syncedAt || binding.boundAt || "";
    options.author.add(binding.authorName || "");
    options.date.add(formatDateKey(date));
    options.branch.add(binding.projectBranch || "detached");
    options.commit.add(binding.projectCommit ? binding.projectCommit.slice(0, 12) : "");
    options.agent.add(binding.agent || "");
    options.bundle.add(binding.bundleId || "");
  }
  return {
    author: sortFilterValues(options.author),
    date: sortFilterValues(options.date),
    branch: sortFilterValues(options.branch),
    commit: sortFilterValues(options.commit),
    agent: sortFilterValues(options.agent),
    bundle: sortFilterValues(options.bundle)
  };
}

function sortFilterValues(values: Set<string>): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
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

function formatDateKey(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString();
}

function createNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let i = 0; i < 32; i += 1) {
    value += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function truncateText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 1))}…`;
}
