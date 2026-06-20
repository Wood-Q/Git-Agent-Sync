import assert from "node:assert/strict";
import Module from "node:module";
import process from "node:process";

type MockConfiguration = {
  get<T>(key: string): T | undefined;
};

type ModuleLoader = (request: string, parent: NodeModule | null, isMain: boolean) => unknown;

const moduleWithLoad = Module as unknown as { _load: ModuleLoader };
const originalLoad = moduleWithLoad._load;
const mockVscode = {
  workspace: {
    getConfiguration(section: string): MockConfiguration {
      assert.equal(section, "agentSync");
      return {
        get<T>(key: string): T | undefined {
          assert.equal(key, "cliPath");
          return process.execPath as T;
        }
      };
    }
  }
};

moduleWithLoad._load = function load(request: string, parent: NodeModule | null, isMain: boolean) {
  if (request === "vscode") {
    return mockVscode;
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  const { AgentSyncCli, AgentSyncCliError, buildCliCommandLine, getCliPath, normalizeLogFilter, parseJson } = await import("../agentSyncCli");
  const { renderHistoryHtml } = await import("../historyView");

  assert.equal(getCliPath(), process.execPath);

  const parsed = parseJson<{ ok: boolean }>("{\"ok\":true}", "test json");
  assert.equal(parsed.ok, true);
  assert.throws(() => parseJson("{bad", "bad json"), AgentSyncCliError);

  const output = {
    name: "Agent Sync Test",
    lines: [] as string[],
    append(value: string) {
      this.lines.push(value);
    },
    appendLine(line: string) {
      this.lines.push(line);
    },
    replace(value: string) {
      this.lines = [value];
    },
    clear() {
      this.lines = [];
    },
    show() {},
    hide() {},
    dispose() {}
  };
  const cli = new AgentSyncCli(output);
  const stdout = await cli.run(process.cwd(), ["-e", "process.stdout.write(JSON.stringify({ok:true}))"]);
  assert.equal(JSON.parse(stdout).ok, true);
  assert.ok(output.lines.some((line: string) => line.includes("$ ")));
  assert.deepEqual(normalizeLogFilter({ selector: "branch", value: " main " }), { selector: "branch", value: "main" });
  assert.deepEqual(normalizeLogFilter({ selector: "latest" }), { selector: "latest" });
  assert.match(buildCliCommandLine(["watch-local"]), /watch-local/);
  assert.match(buildCliCommandLine(["tui"]), /tui/);
  assert.match(buildCliCommandLine(["privacy", "scan"]), /privacy scan/);
  assert.match(buildCliCommandLine(["conflicts", "list"]), /conflicts list/);
  assert.match(buildCliCommandLine(["register-local"]), /register-local/);
  assert.match(buildCliCommandLine(["tool", "inspect", "--session", "bundle-1"]), /tool inspect/);

  const html = renderHistoryHtml({ cspSource: "vscode-resource:" }, [{
    title: "Restore <this>",
    authorName: "Agent Sync Test",
    conversationAt: "2026-05-25T00:00:00.000Z",
    projectBranch: "main",
    projectCommit: "abcdef1234567890",
    agent: "codex",
    bundleId: "bundle-1",
    commitMessage: "sync message with a deliberately long explanation that should be clipped before it can dominate the history table row layout"
  }]);
  assert.match(html, /Agent Sync History/);
  assert.match(html, /id="pull"/);
  assert.match(html, /id="push"/);
  assert.match(html, /id="syncStatus"/);
  assert.match(html, /id="privacyScan"/);
  assert.match(html, /id="conflictsList"/);
  assert.match(html, /id="toolInspect"/);
  assert.match(html, /id="localClone"/);
  assert.match(html, /id="registerLocal"/);
  assert.match(html, /id="watchLocalCopy"/);
  assert.match(html, /id="openTui"/);
  assert.match(html, /command: 'pull'/);
  assert.match(html, /command: 'push'/);
  assert.match(html, /command: 'syncStatus'/);
  assert.match(html, /command: 'privacyScan'/);
  assert.match(html, /command: 'conflictsList'/);
  assert.match(html, /command: 'toolInspect'/);
  assert.match(html, /command: 'localClone'/);
  assert.match(html, /command: 'registerLocal'/);
  assert.match(html, /command: 'watchLocalCopy'/);
  assert.match(html, /command: 'openTui'/);
  assert.match(html, /data-filter-column="author"/);
  assert.match(html, /data-filter-column="branch"/);
  assert.match(html, /data-author="Agent Sync Test"/);
  assert.match(html, /data-branch="main"/);
  assert.match(html, /class="cellText"/);
  assert.match(html, /sync message with a deliberately long explanation that should be clippe…/);
  assert.match(html, /title="sync message with a deliberately long explanation that should be clipped before it can dominate the history table row layout"/);
  assert.match(html, /Restore &lt;this&gt;/);
  assert.match(html, /data-restore-index="1"/);

  console.log("agent-sync vscode extension tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
