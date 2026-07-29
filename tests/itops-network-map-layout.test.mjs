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
  assert.doesNotMatch(designer, /className="nm-mode-action"/);
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
    assert.ok(
      messages.itops.networkMap.strandDisplayLabel,
      `${locale} should translate the line display property`,
    );
    assert.ok(
      messages.itops.networkMap.strandDisplaySeparate,
      `${locale} should translate separate lines`,
    );
    assert.ok(
      messages.itops.networkMap.strandDisplayBundle,
      `${locale} should translate bundled line`,
    );
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
  const [designer, types, styles, worldMap] = await Promise.all([
    read("src/modules/itops/NetworkMapDesigner.tsx"),
    read("src/types.ts"),
    read("src/modules/itops/itops.css"),
    read("src/assets/network-map/world-map.svg"),
  ]);

  assert.match(designer, /function NetworkNodeArtwork/);
  assert.match(designer, /className="nm-device-art"/);
  assert.match(designer, /"gateway"/);
  assert.match(designer, /"switchL3"/);
  assert.match(designer, /"vpnGateway"/);
  assert.match(designer, /"wirelessController"/);
  assert.match(designer, /"camera"/);
  assert.match(designer, /"geomap"/);
  assert.match(designer, /zoom: Math\.min\(100, Math\.max\(1, viewport\.zoom\)\)/);
  assert.match(designer, /max="100"/);
  assert.doesNotMatch(designer, /className="nm-geomap-node-caption"/);
  assert.match(designer, /data-state=\{data\.kind === "geomap" \? undefined : data\.state\}/);
  assert.match(designer, /NODE_CATEGORIES/);
  assert.match(types, /\| "geomap"/);
  assert.match(types, /interface NetworkGeomapViewport/);
  assert.match(types, /geomapViewport\?: NetworkGeomapViewport \| null;/);
  assert.match(designer, /function GeomapViewportEditor/);
  assert.match(designer, /onPointerMove=.*geomap|onPointerMove=\{\(event\) =>/);
  assert.match(designer, /type="range"/);
  assert.match(designer, /geomapViewport: isGeomap \? DEFAULT_GEOMAP_VIEWPORT : null/);
  assert.match(
    designer,
    /data\.ghost \|\| data\.kind === "geomap" \? null : \(\s*<NodeResizer/,
  );
  assert.match(designer, /maxWidth=\{NODE_MAX_WIDTH\}/);
  assert.match(designer, /maxHeight=\{NODE_MAX_HEIGHT\}/);
  assert.match(designer, /connectable: node\.kind !== "geomap"/);
  assert.match(designer, /data\.ghost \|\| data\.kind === "geomap"/);
  assert.match(
    designer,
    /fromNode\.kind === "geomap" \|\|\s*toNode\.kind === "geomap"/,
  );
  assert.match(styles, /\.nm-geomap-editor-preview\s*\{[\s\S]*touch-action: none;/);
  assert.match(worldMap, /<svg[\s\S]*id="land"/);
  assert.match(designer, /function NetworkLinkEdge/);
  assert.match(designer, /edgeTypes=\{edgeTypes\}/);
  assert.match(designer, /itops\.networkMap\.linkKindLabel/);
  assert.match(designer, /itops\.networkMap\.statusLabel/);
  // The base dialog exposes only a count; a compact scrolling grid owns the
  // physical members so a large LAG cannot stretch Link Properties.
  assert.match(designer, /itops\.networkMap\.strandsLabel/);
  assert.match(designer, /function LinkMembersEditor/);
  assert.match(designer, /className="nm-member-count"/);
  assert.match(designer, /className="nm-member-grid"/);
  assert.match(designer, /itops\.networkMap\.strandAdd/);
  assert.match(designer, /itops\.networkMap\.strandNamePlaceholder/);
  assert.match(designer, /itops\.networkMap\.strandSpeedPlaceholder/);
  assert.match(designer, /<datalist id=\{speedListId\}>/);
  assert.match(designer, /COMMON_LINK_SPEEDS/);
  assert.match(designer, /appendBoundStrand/);
  assert.match(designer, /generatedInterfaceIds/);
  assert.doesNotMatch(designer, /className="nm-strand-card"/);
  assert.match(styles, /\.nm-member-grid\s*\{[\s\S]*overflow: auto;/);
  assert.match(styles, /\.nm-member-grid-row\s*\{[\s\S]*grid-template-columns:/);
  assert.match(designer, /itops\.networkMap\.strandDisplayLabel/);
  assert.match(designer, /itops\.networkMap\.strandDisplaySeparate/);
  assert.match(designer, /itops\.networkMap\.strandDisplayBundle/);
  assert.match(designer, /strandDisplay === "separate" \? count : 1/);
  assert.doesNotMatch(designer, /Math\.min\(Math\.max\(data\?\.strandCount/);
  assert.match(designer, /className="nm-edge-speed-list"/);
  assert.match(designer, /groups\.set\(speed, \(groups\.get\(speed\) \?\? 0\) \+ 1\)/);
  assert.match(styles, /\.nm-edge-label\s*\{[\s\S]*background: var\(--surface\);/);
  assert.match(styles, /\.nm-edge-speed-list\s*\{[\s\S]*flex-wrap: wrap;/);
  assert.match(
    styles,
    /\.react-flow__edgelabel-renderer\s*\{[\s\S]*z-index: 2;/,
  );
  // The pre-strand link-level count and speed are gone from the model.
  assert.doesNotMatch(designer, /itops\.networkMap\.linkCountLabel/);
  assert.doesNotMatch(designer, /connectionCount/);
  assert.match(types, /strands: NetworkLinkStrand\[\];/);
  assert.match(types, /type NetworkLinkStrandDisplay = "separate" \| "bundle"/);
  assert.match(types, /strandDisplay: NetworkLinkStrandDisplay;/);
  assert.match(types, /interface NetworkLinkStrand/);
  assert.match(types, /speed: string;/);
  assert.match(types, /status: NetworkMapStatus;/);
  assert.match(types, /type NetworkLinkStatus = "up" \| "warning" \| "down"/);
  assert.match(types, /status: NetworkLinkStatus;/);
  assert.match(designer, /itops\.networkMap\.status\.down/);
  assert.match(designer, /className="nm-edge-flow"/);
  assert.match(styles, /\.react-flow__edge\.nm-edge .react-flow__edge-path\s*\{[\s\S]*stroke: var\(--green\)/);
  assert.match(styles, /\.react-flow__edge\.nm-edge\.warning .nm-edge-flow \{ stroke: var\(--amber\); \}/);
  assert.match(styles, /\.react-flow__edge\.nm-edge\.down .nm-edge-flow[\s\S]*stroke: var\(--red\)/);
  assert.match(styles, /@keyframes nmLinkFlow/);
  assert.match(types, /\| "wirelessController"/);
});

test("Network Maps configure palette items before ghost placement and expose native node commands", async () => {
  const [designer, canvasChanges, sites, types, rustTypes, storage, styles] = await Promise.all([
    read("src/modules/itops/NetworkMapDesigner.tsx"),
    read("src/modules/itops/networkMapCanvasChanges.ts"),
    read("src/modules/itops/SitesTab.tsx"),
    read("src/types.ts"),
    read("src-tauri/src/itops/types.rs"),
    read("src-tauri/src/itops/network_map_storage.rs"),
    read("src/modules/itops/itops.css"),
  ]);

  assert.match(types, /interface NetworkNodeInterface/);
  assert.match(types, /interfaces: NetworkNodeInterface\[\];/);
  assert.match(types, /fromInterfaceId\?: string \| null;/);
  assert.match(types, /toInterfaceId\?: string \| null;/);
  assert.match(types, /notes: NetworkMapNote\[\];/);
  assert.match(rustTypes, /pub interfaces: Vec<NetworkNodeInterface>/);
  assert.match(storage, /legacy_address/);
  assert.match(storage, /from_interface_id[\s\S]*from_interfaces/);
  assert.match(storage, /to_interface_id[\s\S]*to_interfaces/);

  assert.match(designer, /<NodeResizer/);
  assert.match(styles, /\.nm-node\s*\{[\s\S]*overflow: visible;/);
  assert.match(styles, /\.nm-note\s*\{[\s\S]*overflow: visible;/);
  assert.match(styles, /\.nm-resize-handle\s*\{[\s\S]*z-index: 6 !important;/);
  assert.match(canvasChanges, /NETWORK_NODE_WIDTH = 156;/);
  assert.match(canvasChanges, /NETWORK_NODE_HEIGHT = 52;/);
  assert.match(canvasChanges, /NETWORK_NODE_MIN_WIDTH = 120;/);
  assert.match(canvasChanges, /NETWORK_NODE_MIN_HEIGHT = 44;/);
  assert.match(
    designer,
    /setGraph\(\(current\) => applyNetworkMapCanvasNodeChanges\(current, changes\)\)/,
  );
  assert.match(designer, /screenToFlowPosition/);
  assert.match(designer, /function NodePropertiesDialog/);
  assert.match(
    designer,
    /<NodePropertiesFields[\s\S]*showKindPicker=\{!placement\}/,
  );
  assert.match(
    designer,
    /\{showKindPicker \? \(\s*<Field label=\{t\("itops\.networkMap\.kindLabel"\)\}>/,
  );
  assert.match(
    designer,
    /if \(node\.kind === "geomap"\) \{[\s\S]*<GeomapViewportEditor[\s\S]*\n  \}\n\n  return \(/,
  );
  assert.match(designer, /itops\.networkMap\.geomapWidthLabel/);
  assert.match(designer, /itops\.networkMap\.geomapHeightLabel/);
  assert.match(designer, /className="nm-geomap-size-fields"/);
  assert.match(designer, /function GeomapSizeFields/);
  assert.match(designer, /value=\{widthDraft\}/);
  assert.match(designer, /setWidthDraft\(value\)/);
  assert.match(
    designer,
    /NODE_KINDS\.filter\(\(kind\) => kind !== "geomap"\)\.map/,
  );
  assert.match(designer, /function NotePropertiesDialog/);
  assert.match(designer, /function LinkPropertiesDialog/);
  assert.match(designer, /setNodeDialog\(\{ node: newNodeDraft\(kind\), root: false, placement: true \}\)/);
  assert.match(designer, /setPlacementDraft\(\{ kind: "node", node, root \}\)/);
  assert.match(designer, /className: "nm-placement-ghost-node"/);
  assert.match(
    designer,
    /position: placementPoint,\s*width: node\.width,\s*height: node\.height,\s*zIndex: 4/,
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
  assert.match(
    designer,
    /const edgeAnchorNodes = dragAnchorNodes \?\? graph\.nodes;[\s\S]*new Map\(edgeAnchorNodes\.map/,
  );
  assert.match(
    designer,
    /onNodeDragStart=\{\(\) => setDragAnchorNodes\(graph\.nodes\)\}[\s\S]*onNodeDragStop=\{\(\) => setDragAnchorNodes\(null\)\}/,
  );
  assert.match(
    designer,
    /reconcileNetworkMapFlowNodes\(\s*renderedNodesRef\.current,[\s\S]*renderedNodesRef\.current = reconciled/,
  );
  assert.match(designer, /onPaneContextMenu=\{showCanvasContextMenu\}/);
  assert.match(
    designer,
    /function showCanvasContextMenu[\s\S]*label: t\("itops\.networkMap\.addNode"\)[\s\S]*setObjectBrowserOpen\(true\)[\s\S]*label: t\("common\.properties"\)[\s\S]*onOpenProperties\(\{ \.\.\.map, graph \}\)/,
  );
  assert.match(
    designer,
    /node\.type === "networkNote"\) showNoteContextMenu\(event, node\.id\)/,
  );
  assert.match(
    designer,
    /onNodeClick=\{\(_event, node\) =>[\s\S]*setSelection\(\{ kind: "note", id: node\.id \}\)[\s\S]*setSelection\(\{ kind: "node", id: node\.id \}\)/,
  );
  assert.match(
    designer,
    /onNodeDoubleClick=\{\(_event, node\) =>[\s\S]*node\.type === "networkNote"[\s\S]*openNoteProperties\(node\.id\)[\s\S]*openNodeProperties\(node\.id\)/,
  );
  assert.match(designer, /onEdgeClick=\{\(_event, edge\) =>[\s\S]*openLinkProperties\(edge\.id\)/);
  assert.match(
    designer,
    /onEdgeDoubleClick=\{\(_event, edge\) => \{[\s\S]*placementDraft[\s\S]*openLinkProperties\(edge\.id\)/,
  );
  assert.match(designer, /setTimeout\(\(\) => \{[\s\S]*saveNetworkMap\(/);
  assert.doesNotMatch(designer, /\) : selected(?:Node|Note|Link) \? \(/);
  assert.match(designer, /\{objectBrowserOpen \? \([\s\S]*itops\.networkMap\.paletteLabel/);
  assert.match(
    designer,
    /label: t\("itops\.actions\.duplicate"\)[\s\S]*label: t\("itops\.actions\.delete"\)[\s\S]*kind: "separator"[\s\S]*label: t\("common\.properties"\)/,
  );
  assert.match(
    designer,
    /function showNoteContextMenu[\s\S]*label: t\("itops\.actions\.duplicate"\)[\s\S]*label: t\("itops\.actions\.delete"\)[\s\S]*label: t\("common\.properties"\)/,
  );
  assert.doesNotMatch(designer, /application\/x-kkterm-network-map/);
  assert.doesNotMatch(designer, /onDrop=\{dropPaletteItem\}/);
  assert.doesNotMatch(designer, /\sdraggable(?:\s|=)/);
  assert.match(designer, /className="nm-node-identity"/);
  assert.match(designer, /function NodeInterfaceEditor/);
  assert.match(designer, /itops\.networkMap\.endpointInterfaceLabel/);
  assert.doesNotMatch(designer, /itops\.networkMap\.rootLabel/);
  assert.match(designer, /className="nm-choice-grid"/);
  assert.match(designer, /type: "networkNote"/);
  assert.match(designer, /zIndex: node\.kind === "geomap" \? 0 : 3/);
  assert.match(designer, /zIndex: 1/);
  assert.match(designer, /zIndex: 2/);
  assert.match(designer, /elevateNodesOnSelect=\{false\}/);
  assert.match(designer, /DOMPurify\.sanitize/);
  assert.match(designer, /marked\.parse\(markdown, \{ async: false, breaks: true \}\)/);
  assert.match(designer, /role="toolbar"[\s\S]*itops\.networkMap\.noteFormattingLabel/);
  assert.match(designer, /formatNetworkMapNoteMarkdown/);
  assert.match(styles, /\.nm-note\s*\{/);
  assert.match(styles, /--nm-note-accent/);
  assert.match(
    styles,
    /\.nm-note\s*\{[\s\S]*border:\s*1px solid color-mix\(in srgb, var\(--border-strong\)/,
  );
  assert.match(styles, /\.nm-note-markdown\s*\{/);
  assert.match(styles, /\.nm-note-format-toolbar\s*\{/);
  assert.match(styles, /\.nm-note-preview\s*\{/);
  assert.match(styles, /\.nm-placement-ghost-node\s*\{/);
  assert.match(styles, /\.nm-node\.ghost,/);
  assert.match(styles, /\.nm-side\s*\{[\s\S]*align-items: stretch;/);
  assert.match(
    styles,
    /\.nm-node\s*\{[\s\S]*padding: 5px 6px;[\s\S]*container-name: network-map-node;/,
  );
  assert.match(styles, /\.nm-node-note\s*\{/);
  assert.match(styles, /@container network-map-node \(min-width: 240px\)/);
  assert.match(designer, /note: node\.note/);
  assert.match(designer, /className="nm-node-note"/);
  assert.match(
    styles,
    /\.nm-node-ic\s*\{[\s\S]*width: 32px;[\s\S]*height: 32px;[\s\S]*border-radius: 8px;/,
  );
  assert.match(styles, /\.nm-resize-handle\s*\{[\s\S]*width: 9px !important;[\s\S]*height: 9px !important;/);

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

test("Network Maps use one interaction mode, a browser pen, reliable link handles, and menu-owned destructive map actions", async () => {
  const [designer, sites, styles] = await Promise.all([
    read("src/modules/itops/NetworkMapDesigner.tsx"),
    read("src/modules/itops/SitesTab.tsx"),
    read("src/modules/itops/itops.css"),
  ]);

  assert.doesNotMatch(designer, /type EditorMode|useState<EditorMode>/);
  assert.match(
    designer,
    /className=\{`it-drill-action\$\{objectBrowserOpen \? " active" : ""\}`\}[\s\S]*setObjectBrowserOpen\(\(open\) => !open\)[\s\S]*<ItIcon name="edit"/,
  );
  assert.doesNotMatch(designer, /setMode\(|mode !== "design"/);
  assert.match(designer, /connectionMode=\{ConnectionMode\.Loose\}/);
  assert.match(
    designer,
    /<Handle[\s\S]*?type="source"[\s\S]*?id=\{position\}[\s\S]*?position=\{position\}[\s\S]*?className="nm-handle"/,
  );
  assert.doesNotMatch(designer, /<Handle type="target" id=\{position\}/);
  assert.match(designer, /nodesDraggable=\{!placementDraft\}/);
  assert.match(designer, /nodesConnectable=\{!placementDraft\}/);
  assert.match(designer, /itops\.networkMap\.importTitle[\s\S]*setImporting\(true\)/);
  assert.match(
    designer,
    /\{objectBrowserOpen \? \(\s*<aside className="au-side nm-side kk-surface">/,
  );
  assert.match(
    designer,
    /\{!objectBrowserOpen \? \(\s*<dl className="nm-map-info">[\s\S]*itops\.networkMap\.statNodes[\s\S]*itops\.networkMap\.statLinks[\s\S]*itops\.networkMap\.statRoots/,
  );
  assert.doesNotMatch(designer, /className="nm-stats"/);
  assert.match(
    styles,
    /\.nm-map-info\s*\{[\s\S]*position: absolute;[\s\S]*top: 12px;[\s\S]*left: 12px;[\s\S]*pointer-events: none;/,
  );
  assert.match(designer, /setSelection\(\{ kind: "node", id: node\.id \}\)/);
  assert.doesNotMatch(designer, /itops\.networkMap\.modeImpact/);
  assert.match(
    designer,
    /className="it-icon-btn nm-gallery-menu"[\s\S]*aria-label=\{t\("itops\.actions\.more"\)\}[\s\S]*showNetworkMapCardMenu\(event, map\)/,
  );
  assert.match(styles, /\.nm-gallery-menu\s*\{[\s\S]*bottom: 10px;[\s\S]*right: 10px;/);
  const toolbar = designer.slice(
    designer.indexOf('<div className="nm-toolbar it-drill-toolbar">'),
    designer.indexOf('<div className="nm-body">'),
  );
  assert.doesNotMatch(toolbar, /name="trash"|name="download"|name="check"/);
  assert.match(
    designer,
    /function showNetworkMapCardMenu[\s\S]*label: t\("common\.properties"\)[\s\S]*label: t\("itops\.actions\.delete"\)/,
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
