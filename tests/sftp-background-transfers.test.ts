import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_POPUP_PROGRESS, nextSftpPopupProgress } from "../src/modules/workspace/connections/sftp/sftpPopupActivity";
import type { TransferRecord } from "../src/modules/workspace/connections/sftp/types";

const records = (...states: TransferRecord["state"][]) => states.map((state) => ({ state }));

test("queued work keeps a popup minimizable between sequential transfers", () => {
  let result = nextSftpPopupProgress(EMPTY_POPUP_PROGRESS, records("queued", "queued"), false, false);
  assert.equal(result.progress.pending, true);
  assert.equal(result.notice, undefined);
  for (const states of [records("active", "queued"), records("done", "queued"), records("done", "active")]) {
    result = nextSftpPopupProgress(result.progress, states, false, false);
    assert.equal(result.progress.pending, true);
    assert.equal(result.notice, undefined);
  }
  result = nextSftpPopupProgress(result.progress, records("done", "done"), false, false);
  assert.equal(result.progress.pending, false);
  assert.equal(result.notice, "finished");
  assert.equal(nextSftpPopupProgress(result.progress, records("done", "done"), false, false).notice, undefined);
});

test("background conflict waits for attention without reporting completion", () => {
  let result = nextSftpPopupProgress(EMPTY_POPUP_PROGRESS, records("active"), false, false);
  result = nextSftpPopupProgress(result.progress, records("active"), true, true);
  assert.equal(result.notice, "attention");
  assert.equal(result.progress.pending, true);
  result = nextSftpPopupProgress(result.progress, records("active"), true, true);
  assert.equal(result.notice, undefined, "progress updates must not repeat the prompt notice");
  result = nextSftpPopupProgress(result.progress, records("queued"), false, false);
  assert.equal(result.progress.needsAttention, false);
  assert.equal(result.progress.pending, true);
  result = nextSftpPopupProgress(result.progress, records("done"), false, false);
  assert.equal(result.notice, "finished");
  assert.equal(nextSftpPopupProgress(EMPTY_POPUP_PROGRESS, [], true, true).progress.pending, true,
    "a preflight overwrite decision also retains the browser before queue insertion");
});

test("a later successful transfer must not conceal an earlier batch failure", () => {
  let result = nextSftpPopupProgress(EMPTY_POPUP_PROGRESS, records("active", "queued"), false, false);
  result = nextSftpPopupProgress(result.progress, records("failed", "active"), false, false);
  assert.equal(result.notice, "failed");
  result = nextSftpPopupProgress(result.progress, records("failed", "done"), false, false);
  assert.equal(result.notice, "failed");
  result = nextSftpPopupProgress(result.progress, records("failed", "done"), false, false);
  assert.equal(result.notice, undefined);
  result = nextSftpPopupProgress(result.progress, records("failed", "done", "queued"), false, false);
  result = nextSftpPopupProgress(result.progress, records("failed", "done", "done"), false, false);
  assert.equal(result.notice, "finished", "old failure history must not poison a new batch");
});

test("canceled work ends background activity and independent browsers keep independent results", () => {
  const first = nextSftpPopupProgress(EMPTY_POPUP_PROGRESS, records("active", "queued"), false, false);
  const second = nextSftpPopupProgress(EMPTY_POPUP_PROGRESS, records("active"), false, false);
  const finished = nextSftpPopupProgress(first.progress, records("canceled", "canceled"), false, false);
  assert.equal(finished.progress.pending, false);
  assert.equal(finished.notice, "finished");
  assert.equal(second.progress.pending, true);
  assert.equal(nextSftpPopupProgress(finished.progress, [], false, false).notice, undefined, "clearing history is not another completion");
});
