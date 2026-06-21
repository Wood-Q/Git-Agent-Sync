import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  enqueueSyncJob,
  flushSyncQueue,
  formatSyncQueueStatus,
  getSyncQueueStatus,
  stopDaemon
} from "../dist/daemon.js";

const base = mkdtempSync(join(tmpdir(), "agent-sync-daemon-"));
const gitRoot = join(base, "project");
mkdirSync(join(gitRoot, ".agent-sync"), { recursive: true });

const config = {
  projectId: "project-123",
  projectIdentity: "git:https://github.com/example/project",
  projectName: "Project"
};

const job = enqueueSyncJob(gitRoot, config, { reason: "test", maxAttempts: 2 });
let status = getSyncQueueStatus(gitRoot);
assert.equal(status.counts.pending, 1);
assert.equal(status.jobs.pending[0].id, job.id);
assert.match(formatSyncQueueStatus(status), /pending: 1/);

const flushed = flushSyncQueue(gitRoot, {
  runner(runningJob) {
    assert.equal(runningJob.id, job.id);
    return { status: 0, stdout: "ok", stderr: "" };
  }
});
assert.equal(flushed.processed, 1);
assert.equal(flushed.succeeded, 1);
status = getSyncQueueStatus(gitRoot);
assert.equal(status.counts.pending, 0);
assert.equal(status.counts.done, 1);
assert.equal(status.jobs.done[0].stdout, "ok");

const retryJob = enqueueSyncJob(gitRoot, config, { reason: "retry-test", maxAttempts: 2 });
const firstFailure = flushSyncQueue(gitRoot, {
  runner() {
    return { status: 2, stdout: "", stderr: "temporary failure" };
  }
});
assert.equal(firstFailure.retried, 1);
status = getSyncQueueStatus(gitRoot);
assert.equal(status.counts.pending, 1);
assert.equal(status.jobs.pending[0].id, retryJob.id);
assert.equal(status.jobs.pending[0].attempts, 1);

const secondFailure = flushSyncQueue(gitRoot, {
  runner() {
    return { status: 2, stdout: "", stderr: "permanent failure" };
  }
});
assert.equal(secondFailure.failed, 1);
status = getSyncQueueStatus(gitRoot);
assert.equal(status.counts.failed, 1);
assert.equal(status.jobs.failed[0].attempts, 2);

const lockPath = join(gitRoot, ".agent-sync", "sync-lock");
writeFileSync(lockPath, "locked");
const locked = flushSyncQueue(gitRoot, {
  runner() {
    throw new Error("runner must not execute while locked");
  }
});
assert.equal(locked.locked, true);
assert.equal(existsSync(lockPath), true);

const stopped = stopDaemon(gitRoot);
assert.equal(stopped.status, "stop-requested");
assert.match(readFileSync(join(gitRoot, ".agent-sync", "daemon-state.json"), "utf8"), /stop-requested/);

console.log("daemon queue test passed");
