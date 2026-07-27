import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("IT Ops empty destinations and topology setup use one compact hint component", async () => {
  const sites = await read("src/modules/itops/SitesTab.tsx");
  const hosts = await read("src/modules/itops/HostsPanel.tsx");
  const history = await read("src/modules/itops/BatchRunsTab.tsx");
  const tasks = await read("src/modules/itops/TaskLibrary.tsx");
  const hint = await read("src/modules/itops/ItOpsEmptyHint.tsx");

  assert.match(hint, /className="it-empty-hint"/);
  assert.match(sites, /i18nKey="itops\.sites\.emptyHint"/);
  assert.match(sites, /i18nKey="itops\.sites\.emptyServerRoomsHint"/);
  assert.match(sites, /<ItOpsEmptyHint>[\s\S]*emptyServerRoomsHint[\s\S]*<\/ItOpsEmptyHint>/);
  assert.match(hosts, /<ItOpsEmptyHint>[\s\S]*itops\.hosts\.empty[\s\S]*<\/ItOpsEmptyHint>/);
  assert.match(history, /<ItOpsEmptyHint>[\s\S]*itops\.batchRuns\.historyEmptyHint[\s\S]*<\/ItOpsEmptyHint>/);
  assert.match(tasks, /<ItOpsEmptyHint>[\s\S]*itops\.tasks\.emptyBody[\s\S]*<\/ItOpsEmptyHint>/);
});
