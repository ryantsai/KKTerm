import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("IPAM Address Records persist and import discovered device identity", async () => {
  const [types, panel, state, storage, scan, manual] = await Promise.all([
    read("src/types.ts"),
    read("src/modules/itops/IpamPanel.tsx"),
    read("src/modules/itops/state.ts"),
    read("src-tauri/src/storage.rs"),
    read("src-tauri/src/itops/ipam_scan.rs"),
    read("docs/manual/12-it-ops.md"),
  ]);

  assert.match(
    types,
    /interface IpAddressRecord[\s\S]*dnsName: string;[\s\S]*deviceType: IpamDeviceType \| null;[\s\S]*deviceModel: string;/,
  );
  assert.match(
    types,
    /interface IpamScanResult[\s\S]*hostname: string;[\s\S]*deviceType: IpamDeviceType \| null;[\s\S]*deviceModel: string;/,
  );
  assert.match(
    state,
    /interface AddressInput[\s\S]*dnsName: string;[\s\S]*deviceType: IpamDeviceType \| null;[\s\S]*deviceModel: string;/,
  );
  assert.match(
    state,
    /function addressArgs[\s\S]*deviceType: input\.deviceType,[\s\S]*deviceModel: input\.deviceModel/,
  );

  assert.match(panel, /itops\.hosts\.hostnameLabel/);
  assert.match(panel, /itops\.ipam\.deviceTypeLabel/);
  assert.match(panel, /itops\.racks\.vendorLabel/);
  assert.match(panel, /dnsName: entry\.hostname/);
  assert.match(panel, /deviceType: entry\.deviceType/);
  assert.match(panel, /deviceModel: entry\.deviceModel/);

  assert.match(storage, /const SCHEMA_USER_VERSION: i32 = 55;/);
  assert.match(storage, /device_type\s+TEXT NOT NULL DEFAULT ''/);
  assert.match(storage, /device_model\s+TEXT NOT NULL DEFAULT ''/);
  assert.match(storage, /if stored_version < 53/);

  assert.match(scan, /probe_reverse_dns/);
  assert.match(scan, /SYS_DESCR_OID/);
  assert.match(scan, /SYS_OBJECT_ID_OID/);
  assert.match(scan, /SYS_NAME_OID/);
  assert.match(scan, /infer_device_identity/);
  assert.match(manual, /PTR result becomes the suggested hostname/);
  assert.match(manual, /only distinctive printing, RTSP-camera, or SIP ports/);
});
