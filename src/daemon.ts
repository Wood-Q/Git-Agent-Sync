import { existsSync, mkdirSync, openSync, closeSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { CONFIG_DIR } from "./constants.js";
import { readJson, toSlash, writeFileAtomic, writeJson } from "./utils.js";

const QUEUE_DIR = join(CONFIG_DIR, "queue");
const DAEMON_STATE = join(CONFIG_DIR, "daemon-state.json");
const SYNC_LOCK = join(CONFIG_DIR, "sync-lock");
const DEFAULT_DAEMON_INTERVAL_SECONDS = 15;
const DEFAULT_MAX_ATTEMPTS = 3;

type SyncJob = Record<string, any>;

export function enqueueSyncJob(gitRoot, config, options: Record<string, any> = {}) {
  const now = new Date().toISOString();
  const job = {
    version: 1,
    id: createJobId(),
    type: "sync",
    action: options.action || "push",
    reason: options.reason || "manual",
    status: "pending",
    attempts: 0,
    maxAttempts: options.maxAttempts || DEFAULT_MAX_ATTEMPTS,
    createdAt: now,
    updatedAt: now,
    projectRoot: gitRoot,
    projectId: config.projectId || null,
    projectIdentity: config.projectIdentity || null,
    projectName: config.projectName || null
  };
  const paths = getQueuePaths(gitRoot);
  mkdirSync(paths.pending, { recursive: true });
  writeJson(join(paths.pending, `${job.id}.json`), job);
  return job;
}

export function flushSyncQueue(gitRoot, options: Record<string, any> = {}) {
  const lock = acquireSyncLock(gitRoot);
  if (!lock.acquired) {
    return {
      version: 1,
      locked: true,
      message: lock.message,
      processed: 0,
      succeeded: 0,
      failed: 0,
      retried: 0,
      results: []
    };
  }

  const results = [];
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let retried = 0;
  try {
    const runner = options.runner || runJobCommand;
    for (const pendingPath of listQueueFiles(gitRoot, "pending")) {
      const job = readJson<SyncJob>(pendingPath);
      const runningPath = moveJob(gitRoot, pendingPath, "running", {
        ...job,
        status: "running",
        attempts: Number(job.attempts || 0) + 1,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      const runningJob = readJson<SyncJob>(runningPath);
      const result = runner(runningJob, gitRoot);
      processed += 1;
      const completedAt = new Date().toISOString();
      const updatedJob: SyncJob = {
        ...runningJob,
        status: result.status === 0 ? "done" : "failed",
        completedAt,
        updatedAt: completedAt,
        exitCode: result.status,
        stdout: result.stdout || "",
        stderr: result.stderr || ""
      };
      if (result.status === 0) {
        moveJob(gitRoot, runningPath, "done", updatedJob);
        succeeded += 1;
      } else if (updatedJob.attempts < Number(updatedJob.maxAttempts || DEFAULT_MAX_ATTEMPTS)) {
        moveJob(gitRoot, runningPath, "pending", {
          ...updatedJob,
          status: "pending",
          retryAfter: completedAt
        });
        retried += 1;
      } else {
        moveJob(gitRoot, runningPath, "failed", updatedJob);
        failed += 1;
      }
      results.push({
        id: updatedJob.id,
        action: updatedJob.action,
        status: updatedJob.status,
        attempts: updatedJob.attempts,
        exitCode: result.status
      });
    }
  } finally {
    releaseSyncLock(lock);
  }

  return {
    version: 1,
    locked: false,
    processed,
    succeeded,
    failed,
    retried,
    results
  };
}

export function getSyncQueueStatus(gitRoot) {
  const paths = getQueuePaths(gitRoot);
  const states = ["pending", "running", "done", "failed"];
  const jobs = {};
  for (const state of states) {
    jobs[state] = listQueueFiles(gitRoot, state).map((file) => {
      try {
        return readJson(file);
      } catch {
        return { id: file, status: "invalid" };
      }
    });
  }
  return {
    version: 1,
    queuePath: toSlash(relative(gitRoot, paths.root)),
    lock: existsSync(paths.lock),
    daemon: readDaemonState(gitRoot),
    counts: Object.fromEntries(states.map((state) => [state, jobs[state].length])),
    jobs
  };
}

export function formatSyncQueueStatus(status) {
  const lines = [
    `queue: ${status.queuePath}`,
    `lock: ${status.lock ? "held" : "free"}`,
    `daemon: ${status.daemon.status || "stopped"}`,
    `pending: ${status.counts.pending}`,
    `running: ${status.counts.running}`,
    `done: ${status.counts.done}`,
    `failed: ${status.counts.failed}`
  ];
  const visibleJobs = [...status.jobs.pending, ...status.jobs.running, ...status.jobs.failed].slice(0, 10);
  for (const job of visibleJobs) {
    lines.push(`- ${job.status} ${job.id} ${job.action || "sync"} attempts=${job.attempts || 0}`);
  }
  return lines.join("\n");
}

export function startBackgroundSync(gitRoot) {
  const child = spawn(process.execPath, [getCliEntry(), "sync", "--flush"], {
    cwd: gitRoot,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  writeDaemonState(gitRoot, {
    status: "worker-started",
    pid: child.pid,
    startedAt: new Date().toISOString(),
    mode: "flush"
  });
  return { pid: child.pid };
}

export function startDaemonProcess(gitRoot, options: Record<string, any> = {}) {
  const child = spawn(process.execPath, [getCliEntry(), "daemon", "run", "--interval", String(options.intervalSeconds || DEFAULT_DAEMON_INTERVAL_SECONDS)], {
    cwd: gitRoot,
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  writeDaemonState(gitRoot, {
    status: "running",
    pid: child.pid,
    startedAt: new Date().toISOString(),
    intervalSeconds: options.intervalSeconds || DEFAULT_DAEMON_INTERVAL_SECONDS
  });
  return { mode: "background", pid: child.pid };
}

export async function runDaemonLoop(gitRoot, options: Record<string, any> = {}) {
  const intervalSeconds = options.intervalSeconds || DEFAULT_DAEMON_INTERVAL_SECONDS;
  writeDaemonState(gitRoot, {
    status: "running",
    pid: process.pid,
    startedAt: new Date().toISOString(),
    intervalSeconds
  });

  while (true) {
    const result = flushSyncQueue(gitRoot, options);
    writeDaemonState(gitRoot, {
      ...readDaemonState(gitRoot),
      status: "running",
      pid: process.pid,
      lastFlushAt: new Date().toISOString(),
      lastFlush: result
    });
    if (options.once || readDaemonState(gitRoot).stopRequestedAt) {
      break;
    }
    await sleep(intervalSeconds * 1000);
  }

  writeDaemonState(gitRoot, {
    ...readDaemonState(gitRoot),
    status: "stopped",
    stoppedAt: new Date().toISOString()
  });
  return getSyncQueueStatus(gitRoot);
}

export function stopDaemon(gitRoot) {
  const state = readDaemonState(gitRoot);
  const stoppedAt = new Date().toISOString();
  writeDaemonState(gitRoot, {
    ...state,
    status: "stop-requested",
    stopRequestedAt: stoppedAt
  });
  return readDaemonState(gitRoot);
}

function runJobCommand(job, gitRoot) {
  const result = spawnSync(process.execPath, [getCliEntry(), job.action || "push"], {
    cwd: gitRoot,
    env: process.env,
    encoding: "utf8"
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || result.error?.message || ""
  };
}

function acquireSyncLock(gitRoot) {
  const lockPath = join(gitRoot, SYNC_LOCK);
  mkdirSync(dirname(lockPath), { recursive: true });
  try {
    const fd = openSync(lockPath, "wx");
    writeFileSync(fd, JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }));
    return { acquired: true, lockPath, fd };
  } catch {
    return { acquired: false, lockPath, message: `sync lock is already held at ${lockPath}` };
  }
}

function releaseSyncLock(lock) {
  if (!lock.acquired) {
    return;
  }
  try {
    closeSync(lock.fd);
  } catch {
    // ignore close errors during cleanup
  }
  try {
    unlinkSync(lock.lockPath);
  } catch {
    // ignore stale lock cleanup errors
  }
}

function moveJob(gitRoot, fromPath, state, job) {
  const paths = getQueuePaths(gitRoot);
  const targetDir = paths[state];
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, `${job.id}.json`);
  writeJson(fromPath, job);
  renameSync(fromPath, targetPath);
  return targetPath;
}

function listQueueFiles(gitRoot, state) {
  const dir = getQueuePaths(gitRoot)[state];
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(dir, name));
}

function getQueuePaths(gitRoot) {
  const root = join(gitRoot, QUEUE_DIR);
  return {
    root,
    pending: join(root, "pending"),
    running: join(root, "running"),
    done: join(root, "done"),
    failed: join(root, "failed"),
    lock: join(gitRoot, SYNC_LOCK)
  };
}

function readDaemonState(gitRoot) {
  const path = join(gitRoot, DAEMON_STATE);
  if (!existsSync(path)) {
    return { status: "stopped" };
  }
  try {
    return readJson(path);
  } catch {
    return { status: "invalid" };
  }
}

function writeDaemonState(gitRoot, state) {
  writeJson(join(gitRoot, DAEMON_STATE), state);
}

function createJobId() {
  return `${new Date().toISOString().replace(/[^0-9A-Za-z._-]/g, "_")}-${randomUUID()}`;
}

function getCliEntry() {
  return process.argv[1] || "agent-sync";
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
