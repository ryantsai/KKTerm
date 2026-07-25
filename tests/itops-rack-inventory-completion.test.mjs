import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Rack Device dialog has live graphical preview and 乖乖 size/style controls", async () => {
  const dialog = await readFile(new URL("../src/modules/itops/RackItemDialog.tsx", import.meta.url), "utf8");
  const device = await readFile(new URL("../src/modules/itops/RackDevice.tsx", import.meta.url), "utf8");

  assert.match(dialog, /rack-item-preview/);
  assert.match(dialog, /kuaiguaiSize/);
  assert.match(dialog, /kuaiguaiStyle/);
  // Pose and size merge into the single Package style select.
  assert.match(dialog, /itops\.racks\.kuaiguaiStyleLabel/);
  assert.doesNotMatch(dialog, /itops\.racks\.kuaiguaiSizeLabel/);
  assert.match(device, /kuaiguaiSize\?:/);
  assert.match(device, /kuaiguaiStyle\?:/);
  assert.match(device, /data-kuaiguai-size/);
  assert.match(device, /data-kuaiguai-style/);
});

test("Rack Device property dialog omits removed relationship metadata", async () => {
  const dialog = await readFile(new URL("../src/modules/itops/RackItemDialog.tsx", import.meta.url), "utf8");
  const stage = await readFile(new URL("../src/modules/itops/RackStage.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(dialog, /auditRecordRows|addAuditRecord|relationshipLabel|ipamLabel/);
  assert.doesNotMatch(dialog, /connection-binding-list/);
  assert.match(stage, /connectionIds/);
});

test("Rack Device keeps the SNMP command boundary without exposing its no-op transport", async () => {
  const snmp = await readFile(new URL("../src-tauri/src/net/snmp.rs", import.meta.url), "utf8");
  const commands = await readFile(new URL("../src-tauri/src/itops/commands.rs", import.meta.url), "utf8");
  const tauri = await readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8");
  const dialog = await readFile(new URL("../src/modules/itops/RackItemDialog.tsx", import.meta.url), "utf8");

  assert.match(snmp, /SnmpPortSample/);
  assert.match(snmp, /parse_port_speed/);
  assert.match(snmp, /Ok\(Vec::new\(\)\)/);
  assert.match(commands, /itops_refresh_rack_item_snmp/);
  assert.match(tauri, /itops_refresh_rack_item_snmp/);
  assert.doesNotMatch(dialog, /handleRefreshSnmp|itops\.racks\.refreshSnmp|itops\.racks\.snmpLabel/);
});

test("IT Ops manual reserves SNMP metadata for future automatic discovery", async () => {
  const manual = await readFile(new URL("../docs/manual/12-it-ops.md", import.meta.url), "utf8");

  assert.match(manual, /SNMP/);
  assert.doesNotMatch(manual, /rack-audit|relationship details/);
  assert.match(manual, /not exposed in the Rack Device editor/i);
  assert.match(manual, /future automatic SNMP discovery/i);
  assert.doesNotMatch(manual, /background SNMP polling|user-triggered manual refresh|target\/OID hints/i);
  // IPAM is now a real destination, but it stays a separate global page: the
  // Rack Device editor must not grow per-device address metadata.
  const rackDeviceParagraph = manual
    .split("\n")
    .find((line) => line.includes("not exposed in the Rack Device editor"));
  assert.doesNotMatch(rackDeviceParagraph, /IPAM/);
});

test("IPAM and Network Maps document that they carry no live device state", async () => {
  const manual = await readFile(new URL("../docs/manual/12-it-ops.md", import.meta.url), "utf8");

  assert.match(manual, /^## IPAM$/m);
  assert.match(manual, /^## Network Maps$/m);
  // The SNMP scaffolding is future preparation, so nothing on these pages may
  // claim to reflect, poll, or discover live devices.
  assert.match(manual, /does not poll, monitor, or discover devices/i);
  assert.match(manual, /never a live scan/i);
  assert.doesNotMatch(manual, /IPAM (scans|discovers|probes)/i);
});
