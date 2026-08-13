import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("IP Address editor supports direct, Host-implied, and segment-inherited Site bindings", async () => {
  const [panel, state, types, storage, ipamStorage, manual] = await Promise.all([
    read("src/modules/itops/IpamPanel.tsx"),
    read("src/modules/itops/state.ts"),
    read("src/types.ts"),
    read("src-tauri/src/storage.rs"),
    read("src-tauri/src/itops/ipam_storage.rs"),
    read("docs/manual/12-it-ops.md"),
  ]);

  assert.match(types, /interface IpAddressRecord[\s\S]*siteId\?: string \| null;/);
  assert.match(types, /interface IpAddressRecord[\s\S]*siteInherited\?: boolean;/);
  assert.match(state, /interface AddressInput[\s\S]*siteId: string \| null;/);
  assert.match(state, /function addressArgs[\s\S]*siteId: input\.siteId/);

  assert.match(panel, /itops\.ipam\.addressSiteHint/);
  assert.match(panel, /itops\.ipam\.hostHint/);
  assert.match(panel, /siteId: siteInherited \? null : siteId \|\| null/);
  assert.match(panel, /if \(host\) \{[\s\S]*setSiteId\(host\.siteId\);[\s\S]*setSiteInherited\(false\)/);
  assert.match(panel, /host\.id === hostId\)\?\.siteId !== nextSiteId[\s\S]*setHostId\(""\)/);
  assert.match(
    panel,
    /siteId: siteInherited \? null : siteId \|\| null,[\s\S]*hostId: hostId \|\| null/,
  );
  assert.match(manual, /A Site can be selected without a Host/);
  assert.match(manual, /inherits the Site of its most-specific containing IP Prefix/);

  // The v52 repair stays in place under later bumps; only the current version
  // moves, so this guard tracks the constant rather than pinning it to 52.
  assert.match(storage, /const SCHEMA_USER_VERSION: i32 = 59;/);
  assert.match(storage, /if stored_version < 52/);
  assert.match(storage, /"itops_ip_address_records",\s*"site_id"/s);
  assert.match(ipamStorage, /fn apply_prefix_site_bindings/);
  assert.match(ipamStorage, /max_by_key\(\|\(_, prefix\)\| prefix\.length\)/);
});
