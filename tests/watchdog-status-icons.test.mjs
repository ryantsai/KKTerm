import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Watchdog status bar renders one actionable icon per watchdog", async () => {
  const source = await readFile(new URL("../src/watchdog/WatchdogStatusBar.tsx", import.meta.url), "utf8");

  assert.match(source, /const summaries = useWatchdogSummariesSorted\(\);/);
  assert.match(source, /summaries\.map\(\(summary\) =>/);
  assert.match(source, /<WatchdogStatusIcon key=\{summary\.id\} summary=\{summary\} \/>/);
  assert.doesNotMatch(source, /watchdog-status-badge/);
  assert.doesNotMatch(source, /useWatchdogTotalCount/);
  assert.match(source, /function WatchdogStatusIcon\(\{ summary \}/);
  assert.match(source, /onClick=\{\(\) => setSelected\(summary\.id\)\}/);
  assert.match(source, /return <Eye size=\{14\} className="watchdog-state-icon is-running" \/>;/);
  assert.match(source, /return <CheckCircle2 size=\{14\} className="watchdog-state-icon is-completed" \/>;/);
  assert.match(source, /return <AlertTriangle size=\{14\} className="watchdog-state-icon is-stopped" \/>;/);
});

test("Watchdog terminal states use a Completed action that dismisses the report", async () => {
  const detailSource = await readFile(new URL("../src/watchdog/WatchdogDetail.tsx", import.meta.url), "utf8");
  const locale = JSON.parse(
    await readFile(new URL("../src/i18n/locales/en.json", import.meta.url), "utf8"),
  );

  assert.match(detailSource, /terminal \? \(/);
  assert.match(detailSource, /t\("watchdog.completedAction"\)/);
  assert.equal(locale.watchdog.completedAction, "Completed");
});

test("Watchdog detail uses the shared dialog surface and platform action order", async () => {
  const detailSource = await readFile(
    new URL("../src/watchdog/WatchdogDetail.tsx", import.meta.url),
    "utf8",
  );

  assert.match(detailSource, /<DialogShell onBackdrop=\{onClose\}>/);
  assert.match(detailSource, /<Sheet[\s\S]*className="watchdog-detail"/);
  assert.match(detailSource, /footer=\{[\s\S]*<Actions/);
  assert.match(detailSource, /extraLeft=\{[\s\S]*watchdog\.saveReport/);
  assert.match(detailSource, /kind="danger"[\s\S]*watchdog\.cancel/);
  assert.match(detailSource, /watchdog\.close/);
  assert.doesNotMatch(detailSource, /watchdog-detail-(header|footer|close|button)/);
});
