import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("known-address import confirms missing Prefixes before creating records", async () => {
  const [panel, navigator, manual] = await Promise.all([
    read("src/modules/itops/IpamPanel.tsx"),
    read("src/modules/itops/SitesTab.tsx"),
    read("docs/manual/12-it-ops.md"),
  ]);

  assert.match(panel, /suggestMissingPrefixes\(candidates, prefixes\)/);
  assert.match(panel, /prefixDrafts\[suggestion\.id\]/);
  assert.match(panel, /disabled=\{chosen\.size === 0 \|\| !prefixPlanValid \|\| busy\}/);
  assert.match(
    panel,
    /for \(const cidr of new Set\(proposedPrefixes[\s\S]*await createPrefix\([\s\S]*for \(const entry of picked\)[\s\S]*await createAddress\(/,
  );
  assert.match(panel, /uncontainedAddresses\(ipam\.addresses, ipam\.prefixes\)/);
  assert.match(panel, /itops\.ipam\.unassignedAddresses/);
  assert.match(
    navigator,
    /state\.ipam\.prefixes\.length \+ state\.ipam\.addresses\.length/,
  );
  assert.match(manual, /editable CIDR/);
});
