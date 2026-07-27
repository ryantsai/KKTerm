import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const batchRuns = readFileSync("src/modules/itops/BatchRunsTab.tsx", "utf8");
const runner = readFileSync("src-tauri/src/itops/runner.rs", "utf8");
const state = readFileSync("src/modules/itops/state.ts", "utf8");

test("Batch Run transport failures do not display a fabricated exit code", () => {
  assert.match(batchRuns, /host\.exitCode != null/);
  assert.match(batchRuns, /itops\.batchRuns\.codeFailed/);
});

test("SSH transport failures retain output streamed before the failure", () => {
  assert.match(runner, /outcome_from_streaming_result/);
  assert.match(runner, /streamed_output/);
});

test("live Batch Run output is bounded in frontend state", () => {
  assert.match(state, /MAX_LIVE_OUTPUT/);
  assert.match(state, /appendLiveOutput/);
});
