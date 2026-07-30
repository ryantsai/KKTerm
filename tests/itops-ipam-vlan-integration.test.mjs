import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("IPAM manages VLANs and IP Prefixes in one typed grid", async () => {
  const [ipam, sites, styles, manual] = await Promise.all([
    read("src/modules/itops/IpamPanel.tsx"),
    read("src/modules/itops/SitesTab.tsx"),
    read("src/modules/itops/itops.css"),
    read("docs/manual/12-it-ops.md"),
  ]);

  assert.doesNotMatch(sites, /<VlanPanel \/>/);
  assert.doesNotMatch(sites, /setRootSurface\("vlans"\)/);
  assert.match(sites, /destination === "vlans" \|\| destination === "ipam"/);
  assert.match(sites, /setRootSurface\("ipam"\)/);

  assert.match(ipam, /\{t\("common\.add"\)\}/);
  assert.match(ipam, /role="menuitem"[\s\S]*itops\.ipam\.cidrLabel/);
  assert.match(ipam, /role="menuitem"[\s\S]*itops\.ipam\.vlanLabel/);
  assert.match(ipam, /<VlanDialog vlan=\{vlanDialog\}/);
  assert.match(ipam, /itops\.ipam\.columnType/);
  assert.match(ipam, /itops\.ipam\.columnRecord/);
  assert.match(ipam, /siteGroup\.vlans\.map/);
  assert.match(ipam, /siteGroup\.prefixes\.map/);
  assert.match(styles, /\.it-destination-page-head > \.ft-add-wrap,[\s\S]*flex: 0 0 auto;/);
  assert.match(
    styles,
    /\.it-ipam-page > \.it-destination-page-head > \.ft-add-wrap > \.ft-add-menu\s*\{[^}]*position:\s*static;/,
    "the IPAM New menu should expand the header instead of covering the toolbar",
  );
  assert.match(styles, /grid-template-columns: 84px minmax\(250px, 2fr\)/);
  assert.match(manual, /shows VLAN and IP Prefix records together/);
  assert.match(manual, /without covering the import and export toolbar/);
});
