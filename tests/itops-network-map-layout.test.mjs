import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Network Maps keep overview chrome out of the focused map workspace", async () => {
  const designer = await read("src/modules/itops/NetworkMapDesigner.tsx");
  const styles = await read("src/modules/itops/itops.css");

  assert.match(designer, /className="nm-gallery"/);
  assert.match(designer, /<NetworkMapPreview map=\{map\}/);
  assert.match(designer, /\{!selected \? \([\s\S]*className="it-destination-page-head"/);
  assert.match(designer, /className="nm-editor-title" title=\{map\.name\}>\{map\.name\}<\/h2>/);
  assert.doesNotMatch(designer, /className="nm-detail-nav"/);
  assert.doesNotMatch(designer, /className="nm-tabs" role="tablist"/);
  assert.doesNotMatch(designer, /className="nm-back"/);
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
  assert.match(styles, /\.nm-editor-title\s*\{/);
  assert.doesNotMatch(styles, /\.nm-detail-nav\s*\{|\.nm-back\s*\{|\.nm-tabs\s*\{|\.nm-tab\s*\{/);
  assert.doesNotMatch(styles, /\.nm-palette-btn/);
});

test("IT Ops separates Batch Tasks from Networking in every locale", async () => {
  const sites = await read("src/modules/itops/SitesTab.tsx");
  const locales = [
    "en", "de", "es", "es-MX", "fr", "id", "it",
    "ja", "ko", "pt-BR", "th", "vi", "zh-CN", "zh-TW",
  ];

  assert.match(
    sites,
    /itops\.navigation\.batchTasks[\s\S]*itops\.tasks\.heading[\s\S]*itops\.navigation\.networking[\s\S]*itops\.ipam\.heading[\s\S]*itops\.networkMap\.heading/,
  );

  for (const locale of locales) {
    const messages = JSON.parse(await read(`src/i18n/locales/${locale}.json`));
    assert.ok(messages.itops.navigation.batchTasks, `${locale} should translate Batch Tasks`);
    assert.ok(messages.itops.navigation.networking, `${locale} should translate Networking`);
    assert.notEqual(
      messages.itops.navigation.batchTasks,
      messages.itops.tasks.heading,
      `${locale} section header should stay distinct from Task Library`,
    );
  }

  const zhTw = JSON.parse(await read("src/i18n/locales/zh-TW.json"));
  assert.equal(zhTw.itops.navigation.batchTasks, "批次工作");
  assert.equal(zhTw.itops.navigation.networking, "網路");
  assert.equal(zhTw.itops.tasks.heading, "任務庫");
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

test("Network Maps configure palette items before ghost placement and expose native node commands", async () => {
  const [designer, sites, types, rustTypes, storage, styles] = await Promise.all([
    read("src/modules/itops/NetworkMapDesigner.tsx"),
    read("src/modules/itops/SitesTab.tsx"),
    read("src/types.ts"),
    read("src-tauri/src/itops/types.rs"),
    read("src-tauri/src/itops/network_map_storage.rs"),
    read("src/modules/itops/itops.css"),
  ]);

  assert.match(types, /addresses: string\[\];/);
  assert.match(types, /fromAddress\?: string \| null;/);
  assert.match(types, /toAddress\?: string \| null;/);
  assert.match(types, /notes: NetworkMapNote\[\];/);
  assert.match(rustTypes, /pub addresses: Vec<String>/);
  assert.match(storage, /legacy_address/);
  assert.match(storage, /from_address[\s\S]*from_addresses\.contains/);
  assert.match(storage, /to_address[\s\S]*to_addresses\.contains/);

  assert.match(designer, /<NodeResizer/);
  assert.match(designer, /screenToFlowPosition/);
  assert.match(designer, /function NodePropertiesDialog/);
  assert.match(designer, /function NotePropertiesDialog/);
  assert.match(designer, /function LinkPropertiesDialog/);
  assert.match(designer, /setNodeDialog\(\{ node: newNodeDraft\(kind\), root: false, placement: true \}\)/);
  assert.match(designer, /setPlacementDraft\(\{ kind: "node", node, root \}\)/);
  assert.match(designer, /className: "nm-placement-ghost-node"/);
  assert.match(
    designer,
    /position: placementPoint,\s*width: node\.width,\s*height: node\.height,\s*zIndex: 3/,
  );
  assert.match(
    designer,
    /onPointerMoveCapture=\{\(event\) =>[\s\S]*updatePlacementPoint\(event\.clientX, event\.clientY\)/,
  );
  assert.match(
    designer,
    /onPointerDownCapture=\{\(event\) => \{[\s\S]*event\.button !== 0[\s\S]*placeDraftAt\(event\.clientX, event\.clientY\)/,
  );
  assert.match(
    designer,
    /onClickCapture=\{\(event\) => \{[\s\S]*suppressPlacementClickRef\.current[\s\S]*event\.stopPropagation\(\)/,
  );
  assert.doesNotMatch(
    designer,
    /onPaneClick=\{\(event\) => \{[\s\S]*placeDraftAt\(event\.clientX, event\.clientY\)/,
  );
  assert.match(designer, /onNodeContextMenu=\{\(event, node\) =>/);
  assert.match(designer, /onNodeClick=\{\(_event, node\) =>[\s\S]*openNoteProperties\(node\.id\)[\s\S]*openNodeProperties\(node\.id\)/);
  assert.match(
    designer,
    /onNodeDoubleClick=\{\(_event, node\) =>[\s\S]*node\.type !== "networkNode"[\s\S]*openNodeProperties\(node\.id\)/,
  );
  assert.match(designer, /onEdgeClick=\{\(_event, edge\) =>[\s\S]*openLinkProperties\(edge\.id\)/);
  assert.doesNotMatch(designer, /\) : selected(?:Node|Note|Link) \? \(/);
  assert.match(
    designer,
    /mode === "impact" \? \([\s\S]*<ImpactPanel[\s\S]*\) : \([\s\S]*itops\.networkMap\.paletteLabel/,
  );
  assert.match(
    designer,
    /label: t\("itops\.actions\.duplicate"\)[\s\S]*label: t\("itops\.actions\.delete"\)[\s\S]*kind: "separator"[\s\S]*label: t\("common\.properties"\)/,
  );
  assert.doesNotMatch(designer, /application\/x-kkterm-network-map/);
  assert.doesNotMatch(designer, /onDrop=\{dropPaletteItem\}/);
  assert.doesNotMatch(designer, /\sdraggable(?:\s|=)/);
  assert.match(designer, /itops\.networkMap\.iconBackgroundLabel/);
  assert.match(designer, /itops\.networkMap\.endpointAddressLabel/);
  assert.match(designer, /type: "networkNote"/);
  assert.match(designer, /zIndex: 0/);
  assert.match(designer, /zIndex: 1/);
  assert.match(designer, /zIndex: 2/);
  assert.match(styles, /\.nm-note\s*\{/);
  assert.match(styles, /--nm-note-accent/);
  assert.match(styles, /\.nm-placement-ghost-node\s*\{/);
  assert.match(styles, /\.nm-node\.ghost,/);
  assert.match(styles, /\.nm-side\s*\{[\s\S]*align-items: stretch;/);

  assert.match(sites, /const networkMaps = useItOpsStore\(\(state\) => state\.networkMaps\)/);
  assert.match(
    sites,
    /hasChildren=\{networkMaps\.length > 0\}[\s\S]*toggleNode\(LIBRARY_SURFACES\.networkMaps\.nodeId\)/,
  );
  assert.match(
    sites,
    /networkMaps[\s\S]*\.map\(\(map\) => \([\s\S]*depth=\{1\}[\s\S]*label=\{map\.name\}[\s\S]*setSelectedNetworkMapId\(map\.id\)/,
  );
  assert.match(
    sites,
    /<NetworkMapDesigner[\s\S]*selectedMapId=\{selectedNetworkMapId\}[\s\S]*onSelectedMapIdChange=\{setSelectedNetworkMapId\}/,
  );
});

test("Network Maps open view-only, toggle editing with the drill-view pen, and expose map tree commands", async () => {
  const [designer, sites] = await Promise.all([
    read("src/modules/itops/NetworkMapDesigner.tsx"),
    read("src/modules/itops/SitesTab.tsx"),
  ]);

  assert.match(designer, /type EditorMode = "view" \| "design" \| "impact"/);
  assert.match(designer, /useState<EditorMode>\("view"\)/);
  assert.match(
    designer,
    /className=\{`it-drill-action\$\{mode === "design" \? " active" : ""\}`\}[\s\S]*itops\.actions\.editDone[\s\S]*itops\.actions\.edit[\s\S]*setMode\(mode === "design" \? "view" : "design"\)[\s\S]*<ItIcon name=\{mode === "design" \? "check" : "edit"\}/,
  );
  assert.match(designer, /if \(mode !== "design"\) return;[\s\S]*const onConnect/);
  assert.match(designer, /nodesDraggable=\{mode === "design" && !placementDraft\}/);
  assert.match(designer, /nodesConnectable=\{mode === "design" && !placementDraft\}/);
  assert.match(designer, /disabled=\{mode !== "design"\}[\s\S]*setImporting\(true\)/);
  assert.match(
    designer,
    /\{mode !== "view" \? \(\s*<aside className="au-side nm-side kk-surface">/,
  );
  assert.match(
    designer,
    /mode === "design"\) openNodeProperties\(node\.id\);[\s\S]*setSelection\(\{ kind: "node", id: node\.id \}\)/,
  );

  assert.match(
    sites,
    /function showNetworkMapMenu\([\s\S]*label: t\("itops\.actions\.duplicate"\)[\s\S]*label: t\("itops\.actions\.delete"\)[\s\S]*kind: "separator"[\s\S]*label: t\("common\.properties"\)/,
  );
  assert.match(sites, /onContextMenu=\{\(event\) => showNetworkMapMenu\(event, map\)\}/);
  assert.match(sites, /duplicateName: nextTopologyDuplicateName\(/);
  assert.match(sites, /setPendingDelete\(\{ kind: "networkMap", map \}\)/);

  assert.match(designer, /export function NetworkMapPropertiesDialog/);
  assert.match(designer, /title=\{isProperties \? t\("common\.properties"\)/);
  assert.match(designer, /Field label=\{t\("itops\.networkMap\.nameLabel"\)\}/);
  assert.match(designer, /Field label=\{t\("itops\.networkMap\.descriptionLabel"\)\}/);
  assert.match(
    designer,
    /duplicateOf[\s\S]*createNetworkMap\([\s\S]*duplicateOf\.graph/,
  );
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

  // VLAN management is part of IPAM rather than a separate Library destination.
  assert.doesNotMatch(sites, /<VlanPanel \/>/);
  assert.doesNotMatch(sites, /itops\.vlan\.heading/);
  assert.match(sites, /state\.vlans\.length \+ state\.ipam\.prefixes\.length/);
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
  assert.match(
    sites,
    /<NetworkMapDesigner[\s\S]*active=\{active\}[\s\S]*selectedMapId=\{selectedNetworkMapId\}/,
  );
  assert.match(
    designer,
    /useEffect\(\(\) => \{\s*if \(!active\) \{\s*setLocalSelectedId\(""\);[\s\S]*onSelectedMapIdChange\?\.\(""\);[\s\S]*setDialog\(undefined\);[\s\S]*setPendingDelete\(null\);/,
  );
});
