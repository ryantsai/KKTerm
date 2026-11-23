import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ensureI18nReady, switchLanguage } from "../src/i18n/config";
import type { RackDeviceInventory } from "../src/types";
import { isDeviceInventoryValid, localInventoryDate, normalizeDeviceInventory } from "../src/modules/itops/rackDeviceInventory";

const stylesheetHook = registerHooks({ load(url, context, nextLoad) {
  return url.endsWith(".css") ? { format: "module", source: "", shortCircuit: true } : nextLoad(url, context);
} });
const { RackInventoryFields } = await import("../src/modules/itops/RackInventoryFields");
stylesheetHook.deregister();
await ensureI18nReady();
await switchLanguage("en");

const service = { id: "service-1", date: "2024-02-29", notes: "Replaced disk in bay 3" };

test("inventory normalization preserves dated history and does not mutate an edit draft", () => {
  const draft: RackDeviceInventory = { cpu: " 2 × Xeon ", memory: " ", raid: " RAID 10 ",
    maintenance: [{ ...service, date: " 2024-02-29 ", notes: " Replaced disk in bay 3 " }] };
  const original = structuredClone(draft);
  assert.deepEqual(normalizeDeviceInventory(draft), {
    cpu: "2 × Xeon", raid: "RAID 10", maintenance: [service],
  });
  assert.deepEqual(draft, original);
  assert.equal(normalizeDeviceInventory({ cpu: " ", maintenance: [] }), null);
  assert.equal(isDeviceInventoryValid({}), true);
});

test("maintenance validation accepts real dates and rejects incomplete or duplicate entries", () => {
  assert.equal(isDeviceInventoryValid({ maintenance: [service] }), true);
  for (const date of ["2025-02-29", "2024-04-31", "2024-2-29", "0000-01-01", "", "tomorrow"]) {
    assert.equal(isDeviceInventoryValid({ maintenance: [{ ...service, date }] }), false, date);
  }
  for (const patch of [{ id: " " }, { id: "x".repeat(129) }, { notes: " " }, { notes: "x".repeat(2001) }]) {
    assert.equal(isDeviceInventoryValid({ maintenance: [{ ...service, ...patch }] }), false);
  }
  assert.equal(isDeviceInventoryValid({ maintenance: [service, { ...service }] }), false);
});

test("inventory limits protect persistence without truncating operator text", () => {
  assert.equal(isDeviceInventoryValid({ cpu: "界".repeat(500), maintenance: [{ ...service, notes: "界".repeat(2000) }] }), true);
  assert.equal(isDeviceInventoryValid({ network: "x".repeat(501) }), false);
  const maintenance = Array.from({ length: 100 }, (_, i) => ({ ...service, id: `entry-${i}` }));
  assert.equal(isDeviceInventoryValid({ maintenance }), true);
  assert.equal(isDeviceInventoryValid({ maintenance: [...maintenance, { ...service, id: "extra" }] }), false);
  assert.equal(normalizeDeviceInventory({ cpu: "x".repeat(501) })?.cpu?.length, 501);
  assert.equal(localInventoryDate(new Date(2026, 0, 2, 23, 59)), "2026-01-02");
});

function render(value: RackDeviceInventory, disabled = false) {
  return renderToStaticMarkup(createElement(RackInventoryFields, { value, onChange: () => {}, disabled }));
}

test("properties render every requested hardware specification and saved service entry", () => {
  const markup = render({ cpu: "2 × Xeon", memory: "256 GB ECC", storage: "8 × 2 TB SSD",
    network: "2 × 25 GbE", raid: "RAID 10", maintenance: [service] });
  for (const text of ["Hardware specifications", "CPU", "RAM", "Disks", "Network adapters", "RAID mode",
    "2 × Xeon", "256 GB ECC", "8 × 2 TB SSD", "2 × 25 GbE", "RAID 10", "Hardware maintenance",
    "2024-02-29", "Replaced disk in bay 3", "Remove entry"]) assert.ok(markup.includes(text), text);
  assert.match(markup, /data-tutorial-id="itops.rackInventory"/);
  assert.match(markup, /type="date"/);
  assert.doesNotMatch(markup, /role="alert"/);
});

test("incomplete entries show inline validation and the entry limit disables adding", () => {
  assert.match(render({ maintenance: [{ ...service, notes: "" }] }), /role="alert"/);
  assert.doesNotMatch(render({}), /role="alert"/);
  const markup = render({ maintenance: Array.from({ length: 100 }, (_, i) => ({ ...service, id: `entry-${i}` })) });
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Add entry<\/button>/);
  assert.match(render({ cpu: "Xeon" }, true), /<textarea[^>]*disabled=""/);
});
