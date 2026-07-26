import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Network Maps open as a gallery and keep map switching inside the focused workspace", async () => {
  const designer = await read("src/modules/itops/NetworkMapDesigner.tsx");
  const styles = await read("src/modules/itops/itops.css");

  assert.match(designer, /className="nm-gallery"/);
  assert.match(designer, /<NetworkMapPreview map=\{map\}/);
  assert.match(designer, /className="nm-detail-nav"/);
  assert.match(designer, /className="nm-tabs" role="tablist"/);
  assert.match(designer, /onClick=\{\(\) => setSelectedId\(""\)\}/);
  assert.match(designer, /className="nm-toolbar it-drill-toolbar"/);
  assert.match(designer, /className="nm-mode-action"/);
  assert.doesNotMatch(designer, /className="rm-segmented"/);
  assert.match(designer, /className="it-drill-actions"/);
  assert.match(designer, /className="au-side nm-side kk-surface"/);
  assert.match(designer, /className="nm-picker-grid"/);
  assert.doesNotMatch(designer, /className="nm-palette"|className="nm-palette-btn"/);

  assert.match(styles, /\.nm-gallery-card\s*\{/);
  assert.match(styles, /@keyframes nmPreviewFlow/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /\.nm-picker-grid\s*\{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(styles, /\.nm-palette-btn/);
});

test("Network Nodes use the expanded device catalog and links expose complete documented properties", async () => {
  const [designer, types] = await Promise.all([
    read("src/modules/itops/NetworkMapDesigner.tsx"),
    read("src/types.ts"),
  ]);

  assert.match(designer, /function NetworkNodeArtwork/);
  assert.match(designer, /className="nm-device-art"/);
  assert.match(designer, /"gateway"/);
  assert.match(designer, /"switchL3"/);
  assert.match(designer, /"vpnGateway"/);
  assert.match(designer, /"wirelessController"/);
  assert.match(designer, /"camera"/);
  assert.match(designer, /NODE_CATEGORIES/);
  assert.match(designer, /function NetworkLinkEdge/);
  assert.match(designer, /edgeTypes=\{edgeTypes\}/);
  assert.match(designer, /itops\.networkMap\.linkKindLabel/);
  assert.match(designer, /itops\.networkMap\.statusLabel/);
  // Parallel links are an editable list, one row per physical link, so a port
  // name and a speed can differ per member of a LAG.
  assert.match(designer, /itops\.networkMap\.strandsLabel/);
  assert.match(designer, /itops\.networkMap\.strandAdd/);
  assert.match(designer, /itops\.networkMap\.strandNamePlaceholder/);
  assert.match(designer, /itops\.networkMap\.strandSpeedPlaceholder/);
  assert.match(designer, /<datalist id=\{speedListId\}>/);
  assert.match(designer, /COMMON_LINK_SPEEDS/);
  assert.match(designer, /strandCount > 1 \? `×\$\{strandCount\}`/);
  // The pre-strand link-level count and speed are gone from the model.
  assert.doesNotMatch(designer, /itops\.networkMap\.linkCountLabel/);
  assert.doesNotMatch(designer, /connectionCount/);
  assert.match(types, /strands: NetworkLinkStrand\[\];/);
  assert.match(types, /interface NetworkLinkStrand/);
  assert.match(types, /speed: string;/);
  assert.match(types, /status: NetworkMapStatus;/);
  assert.match(types, /\| "wirelessController"/);
});

test("VLANs are durable global records that Network Links reference and the overlay spotlights", async () => {
  const [designer, types, sites, styles] = await Promise.all([
    read("src/modules/itops/NetworkMapDesigner.tsx"),
    read("src/types.ts"),
    read("src/modules/itops/SitesTab.tsx"),
    read("src/modules/itops/itops.css"),
  ]);

  // The model: a global record, a soft reference from IP Prefixes, and the
  // access/trunk pair on a link. No VLAN node kind, and no VLAN on a Node.
  assert.match(types, /interface Vlan \{/);
  assert.match(types, /vlanId\?: string \| null;/);
  assert.match(types, /nativeVlanId\?: string \| null;/);
  assert.match(types, /taggedVlanIds: string\[\];/);
  assert.doesNotMatch(designer, /"vlan"(?=,?\s*\])/);

  // The overlay: a legend that dims, an access/trunk chip, and a trunk tick.
  assert.match(designer, /function VlanLegend/);
  assert.match(designer, /spotlightVlanId/);
  assert.match(designer, /itops\.networkMap\.vlanSpotlightHint/);
  assert.match(designer, /itops\.networkMap\.vlanAccessChip/);
  assert.match(designer, /itops\.networkMap\.vlanTrunkChip/);
  assert.match(designer, /nm-edge-trunk-tick/);
  assert.match(styles, /\.react-flow__edge\.nm-edge\.dimmed \{ opacity: 0\.35; \}/);

  // Reachability stays VLAN-blind in v1: the analysis takes only the What-If
  // switched-off set, so no VLAN filter may reach it.
  assert.doesNotMatch(designer, /analyzeWhatIf\([^)]*vlan/i);

  // The destination lives in the navigator's Library section beside IPAM.
  assert.match(sites, /<VlanPanel \/>/);
  assert.match(sites, /itops\.vlan\.heading/);
});

test("leaving the IT Ops Module exits the focused Network Map editor", async () => {
  const [page, module, sites, designer] = await Promise.all([
    read("src/modules/itops/ItOpsPage.tsx"),
    read("src/modules/itops/ItOpsModule.tsx"),
    read("src/modules/itops/SitesTab.tsx"),
    read("src/modules/itops/NetworkMapDesigner.tsx"),
  ]);

  assert.match(page, /<ItOpsModule[\s\S]*active=\{active\}/);
  assert.match(module, /<SitesTab[\s\S]*active=\{active\}/);
  assert.match(sites, /<NetworkMapDesigner active=\{active\} \/>/);
  assert.match(
    designer,
    /useEffect\(\(\) => \{\s*if \(!active\) \{\s*setSelectedId\(""\);[\s\S]*setDialog\(undefined\);[\s\S]*setPendingDelete\(null\);/,
  );
});
