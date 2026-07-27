import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Site overview is topology-only without the old segmented control", async () => {
  const sites = await read("src/modules/itops/SitesTab.tsx");

  assert.doesNotMatch(sites, /itops\.sites\.viewLabel/);
  assert.doesNotMatch(sites, /const \[siteView|siteView ===|setSiteView/);
  assert.doesNotMatch(sites, /siteSegmentActive/);
  // The Server Room layout switcher remains; it is not Site navigation.
  assert.match(sites, /aria-label=\{t\("itops\.floorPlan\.viewLabel"\)\}/);
});

test("Hosts and Run History render as separate destination pages", async () => {
  const sites = await read("src/modules/itops/SitesTab.tsx");

  assert.match(sites, /selectedDestination === "hosts"[\s\S]*?<HostsPanel siteId=\{activeGroup\.id\} \/>/);
  assert.match(sites, /selectedDestination === "runHistory"[\s\S]*?<BatchRunsTab siteId=\{activeGroup\.id\} \/>/);
  assert.match(sites, /className="hg-detail it-destination-page"/);
});

test("Run History accepts a Site scope", async () => {
  const runs = await read("src/modules/itops/BatchRunsTab.tsx");

  // Run History: live and completed runs only show this Site's records.
  assert.match(runs, /siteId\?: string;/);
  assert.match(runs, /allRunHistory\.filter\(\(entry\) => entry\.siteId === siteId\)/);
  assert.match(runs, /activeRun && \(!siteId \|\| activeRun\.siteId === siteId\)/);
  assert.doesNotMatch(runs, /onNewBatchRun/);
});

test("Hosts page owns selected-Host Task launches", async () => {
  const hosts = await read("src/modules/itops/HostsPanel.tsx");
  const dialog = await read("src/modules/itops/BatchRunDialog.tsx");
  const rustTypes = await read("src-tauri/src/itops/types.rs");
  const storage = await read("src-tauri/src/itops/storage.rs");

  assert.match(hosts, /selectedHostIds/);
  assert.match(hosts, /requestNewBatchRun\(siteId, \{ hostIds: \[\.\.\.selectedHostIds\] \}\)/);
  assert.match(hosts, /connection\.type === "ssh"/);
  assert.match(dialog, /scope\.hostIds\?\.length/);
  assert.match(rustTypes, /pub host_ids: Vec<String>/);
  assert.match(storage, /first SSH binding/);
});
