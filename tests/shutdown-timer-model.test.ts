import assert from "node:assert/strict";
import test from "node:test";
import {
  formatShutdownTimerDuration,
  formatShutdownTimerRemaining,
  shutdownTimerDelaysMinutes,
} from "../src/app/shutdownTimerModel";

test("shutdown timer exposes the requested schedule durations", () => {
  assert.deepEqual(shutdownTimerDelaysMinutes, [15, 30, 60, 120, 240, 480, 1_440]);
});

test("shutdown timer formats scheduled and warning deadlines independently", () => {
  const now = 1_000_000;
  const status = {
    phase: "scheduled" as const,
    scheduledForUnixMs: now + 3_661_000,
    shutdownAtUnixMs: now + 3_721_000,
  };

  assert.equal(formatShutdownTimerRemaining(status, now), "1:01:01");
  assert.equal(
    formatShutdownTimerRemaining({ ...status, phase: "warning" }, now + 3_661_000),
    "01:00",
  );
});

test("shutdown timer rounds partial seconds up and clamps elapsed time", () => {
  const status = {
    phase: "scheduled" as const,
    scheduledForUnixMs: 10_001,
    shutdownAtUnixMs: 70_001,
  };

  assert.equal(formatShutdownTimerRemaining(status, 9_002), "00:01");
  assert.equal(formatShutdownTimerRemaining(status, 20_000), "00:00");
});

test("shutdown timer durations use locale-aware units", () => {
  assert.equal(formatShutdownTimerDuration(15, "en"), "15 minutes");
  assert.equal(formatShutdownTimerDuration(60, "en"), "1 hour");
  assert.equal(formatShutdownTimerDuration(120, "en"), "2 hours");
});
