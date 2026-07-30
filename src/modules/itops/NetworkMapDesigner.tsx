// Network Map designer (docs/ITOPS.md Network Map) — a global, cross-Site canvas
// for drawing how the network actually hangs together, plus the What-If pass that
// answers "if I take this out, what stops being reachable?".
//
// The map is documentation the operator draws, not a discovered graph: KKTerm has
// no live device binding today, so nothing here polls, and "down" only ever means
// "the operator switched it off on this canvas". The analysis in reachability.ts
// takes that switched-off set as its only input, which is what makes it useful
// before a change window rather than after an outage.
//
// Built on @xyflow/react. Node positions live in the
// graph itself (they are part of the saved document), so a drag is an edit.

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  EdgeLabelRenderer,
  Controls,
  Handle,
  NodeResizer,
  Position,
  ReactFlow,
  type Connection as FlowConnection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import worldMapUrl from "../../assets/network-map/world-map.svg";
import { DialogPortal } from "../../app/DialogPortal";
import {
  Actions,
  Btn,
  ConfirmSheet,
  DialogShell,
  Field,
  Select,
  Sheet,
  TextArea,
  TextInput,
} from "../../app/ui/dialog";
import {
  ColorPalettePicker,
  isHexColor,
} from "../../app/ui/ColorPalettePicker";
import { showNativeContextMenu } from "../../lib/nativeContextMenu";
import { nativeMenuIcons } from "../../lib/nativeMenuIcons";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type {
  Connection,
  NetworkGraph,
  NetworkGeomapViewport,
  NetworkLink,
  NetworkLinkKind,
  NetworkLinkStatus,
  NetworkLinkStrand,
  NetworkLinkStrandDisplay,
  NetworkMap,
  NetworkMapNote,
  NetworkMapStatus,
  NetworkNode,
  NetworkNodeDeepLink,
  NetworkNodeDeepLinkKind,
  NetworkNodeIconKind,
  NetworkNodeInterface,
  NetworkNodeKind,
  Rack,
  ServerRoom,
  Site,
  SiteHost,
  Vlan,
} from "../../types";
import { ItIcon, type ItIconName } from "./icons";
import { ItOpsEmptyHint } from "./ItOpsEmptyHint";
import {
  applyNetworkMapCanvasNodeChanges,
  NETWORK_NODE_HEIGHT as NODE_HEIGHT,
  NETWORK_NODE_MAX_HEIGHT as NODE_MAX_HEIGHT,
  NETWORK_NODE_MAX_WIDTH as NODE_MAX_WIDTH,
  NETWORK_NODE_MIN_HEIGHT as NODE_MIN_HEIGHT,
  NETWORK_NODE_MIN_WIDTH as NODE_MIN_WIDTH,
  NETWORK_NODE_WIDTH as NODE_WIDTH,
  NETWORK_NOTE_HEIGHT as NOTE_HEIGHT,
  NETWORK_NOTE_MAX_HEIGHT as NOTE_MAX_HEIGHT,
  NETWORK_NOTE_MAX_WIDTH as NOTE_MAX_WIDTH,
  NETWORK_NOTE_MIN_HEIGHT as NOTE_MIN_HEIGHT,
  NETWORK_NOTE_MIN_WIDTH as NOTE_MIN_WIDTH,
  NETWORK_NOTE_WIDTH as NOTE_WIDTH,
  parseNetworkMapDimensionDraft,
} from "./networkMapCanvasChanges";
import { reconcileNetworkMapFlowNodes } from "./networkMapFlowNodes";
import {
  selectionForNetworkMapContextMenu,
  sameNetworkMapCanvasItem,
  toggleNetworkMapCanvasSelection,
  type NetworkMapCanvasSelectionItem,
} from "./networkMapSelection";
import { networkNodeArtworkMarkup } from "./networkNodeArtwork";
import { matchesNetworkMapSearch } from "./networkMapSearch";
import {
  formatNetworkMapNoteMarkdown,
  type NetworkMapNoteFormatAction,
} from "./networkMapNoteMarkdown";
import { nextTopologyDuplicateName } from "./topologyDuplicate";
import {
  analyzeWhatIf,
  effectiveRoots,
} from "./reachability";
import { useItOpsStore } from "./state";
import { vlanAccent, vlanLabel, vlansById } from "./vlanModel";
import { flattenConnections } from "../workspace/connections/treeUtils";

const LINK_KINDS: NetworkLinkKind[] = ["ethernet", "fiber", "wan", "wireless"];

/** The palette groups, and the single source of the kind list. The inspector's
 * dropdown is derived from these below rather than hand-maintained beside them:
 * two parallel lists would let a new kind appear in one surface and silently
 * vanish from the other. */
const NODE_CATEGORIES = [
  { id: "core", kinds: ["router", "gateway", "switch", "switchL3", "hub"] },
  { id: "security", kinds: ["firewall", "vpnGateway", "idsIps"] },
  { id: "traffic", kinds: ["loadBalancer", "proxy", "dns"] },
  { id: "compute", kinds: ["server", "database", "storage"] },
  { id: "cloud", kinds: ["cloud", "isp"] },
  { id: "wireless", kinds: ["accessPoint", "wirelessController"] },
  {
    id: "endpoints",
    kinds: ["desktop", "laptop", "smartphone", "iot", "voip", "printer", "camera"],
  },
  { id: "others", kinds: ["generic", "geomap"] },
] as const satisfies ReadonlyArray<{
  id: string;
  kinds: readonly NetworkNodeKind[];
}>;

const NODE_KINDS: readonly NetworkNodeKind[] = NODE_CATEGORIES.flatMap(
  (category) => category.kinds,
);
const BUILT_IN_ICON_KINDS = NODE_KINDS.filter(
  (kind): kind is NetworkNodeIconKind => kind !== "generic",
);

/** Compile-time coverage guard. `Record<never, never>` is `{}` while every kind
 * is grouped; add a kind to `NetworkNodeKind` without a palette group and this
 * demands a property that cannot be written, so the omission fails `tsc`
 * instead of silently hiding the kind from both surfaces. */
export const NODE_KINDS_COVER_EVERY_KIND: Record<
  Exclude<NetworkNodeKind, (typeof NODE_CATEGORIES)[number]["kinds"][number]>,
  never
> = {};

/** Speeds offered in the strand editor's combobox. It stays free text — an
 * operator documenting a 2.5G uplink or "OC-3" must not be blocked by a list —
 * so these are suggestions, not the accepted set. */
const COMMON_LINK_SPEEDS = [
  "10 Mbps",
  "100 Mbps",
  "1 Gbps",
  "2.5 Gbps",
  "5 Gbps",
  "10 Gbps",
  "25 Gbps",
  "40 Gbps",
  "100 Gbps",
  "200 Gbps",
  "400 Gbps",
];

/** Matches the backend's strand ceiling in `network_map_storage`. */
const MAX_STRANDS = 64;
const EDGE_READOUT_ROWS_PER_COLUMN = 12;
/** Matches the backend ceiling for node interfaces and Deep Links. */
const MAX_NODE_COLLECTION_ITEMS = 32;
/** A Network Map-only palette. These intentionally pale hardware-card colours
 * stay separate from the stronger status/content accents used elsewhere in IT
 * Ops, and keep dark skeuomorphic chassis readable. */
const MAP_ACCENTS = [
  "#dbe8f4",
  "#dfe4f2",
  "#e8e1ef",
  "#f1dfe4",
  "#f2e4d3",
  "#dceade",
  "#d9e9e9",
  "#e3e6e9",
  "#f4f4f1",
] as const;

/** Glyph and accent per device kind, so a map reads at a glance while zoomed out. */
const NODE_STYLE: Record<NetworkNodeKind, { accent: string }> = {
  generic: { accent: MAP_ACCENTS[7] },
  router: { accent: MAP_ACCENTS[1] },
  gateway: { accent: MAP_ACCENTS[1] },
  switch: { accent: MAP_ACCENTS[0] },
  switchL3: { accent: MAP_ACCENTS[0] },
  hub: { accent: MAP_ACCENTS[0] },
  firewall: { accent: MAP_ACCENTS[4] },
  vpnGateway: { accent: MAP_ACCENTS[4] },
  idsIps: { accent: MAP_ACCENTS[3] },
  loadBalancer: { accent: MAP_ACCENTS[6] },
  proxy: { accent: MAP_ACCENTS[6] },
  dns: { accent: MAP_ACCENTS[6] },
  server: { accent: MAP_ACCENTS[7] },
  database: { accent: MAP_ACCENTS[7] },
  storage: { accent: MAP_ACCENTS[7] },
  cloud: { accent: MAP_ACCENTS[2] },
  isp: { accent: MAP_ACCENTS[2] },
  accessPoint: { accent: MAP_ACCENTS[5] },
  wirelessController: { accent: MAP_ACCENTS[5] },
  desktop: { accent: MAP_ACCENTS[3] },
  laptop: { accent: MAP_ACCENTS[3] },
  smartphone: { accent: MAP_ACCENTS[3] },
  iot: { accent: MAP_ACCENTS[3] },
  voip: { accent: MAP_ACCENTS[3] },
  printer: { accent: MAP_ACCENTS[3] },
  camera: { accent: MAP_ACCENTS[3] },
  geomap: { accent: MAP_ACCENTS[5] },
};

function newId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface NetworkMapDeepLinkCatalog {
  connections: readonly Connection[];
  sites: readonly Site[];
  racksBySite: Readonly<Record<string, Rack[] | undefined>>;
  serverRoomsBySite: Readonly<Record<string, ServerRoom[] | undefined>>;
}

interface NetworkMapDeepLinkTarget {
  key: string;
  link: NetworkNodeDeepLink;
  label: string;
  detail: string;
  icon: ItIconName;
  available: boolean;
}

function deepLinkKey(link: NetworkNodeDeepLink): string {
  switch (link.kind) {
    case "connection":
      return JSON.stringify(["connection", link.connectionId]);
    case "site":
      return JSON.stringify(["site", link.siteId]);
    case "serverRoom":
      return JSON.stringify(["serverRoom", link.siteId, link.serverRoom]);
    case "rackItem":
      return JSON.stringify(["rackItem", link.siteId, link.rackId, link.rackItemId]);
  }
}

function deepLinkTargets(
  kind: NetworkNodeDeepLinkKind,
  catalog: NetworkMapDeepLinkCatalog,
  t: TFunction,
): NetworkMapDeepLinkTarget[] {
  if (kind === "connection") {
    return catalog.connections.map((connection) => {
      const link: NetworkNodeDeepLink = {
        id: "",
        kind,
        connectionId: connection.id,
      };
      return {
        key: deepLinkKey(link),
        link,
        label: connection.name,
        detail: connection.host || t("itops.networkMap.deepLinkType.connection"),
        icon: "network",
        available: true,
      };
    });
  }
  if (kind === "site") {
    return catalog.sites.map((site) => {
      const link: NetworkNodeDeepLink = { id: "", kind, siteId: site.id };
      return {
        key: deepLinkKey(link),
        link,
        label: site.name,
        detail: t("itops.networkMap.deepLinkType.site"),
        icon: "site",
        available: true,
      };
    });
  }
  if (kind === "serverRoom") {
    return catalog.sites.flatMap((site) => {
      const names = new Set(
        (catalog.serverRoomsBySite[site.id] ?? []).map((room) => room.name.trim()),
      );
      for (const rack of catalog.racksBySite[site.id] ?? []) {
        if (rack.serverRoom.trim()) names.add(rack.serverRoom.trim());
      }
      return [...names].map((serverRoom) => {
        const link: NetworkNodeDeepLink = {
          id: "",
          kind,
          siteId: site.id,
          serverRoom,
        };
        return {
          key: deepLinkKey(link),
          link,
          label: serverRoom,
          detail: site.name,
          icon: "room" as ItIconName,
          available: true,
        };
      });
    });
  }
  return catalog.sites.flatMap((site) =>
    (catalog.racksBySite[site.id] ?? []).flatMap((rack) =>
      rack.items.map((item) => {
        const link: NetworkNodeDeepLink = {
          id: "",
          kind,
          siteId: site.id,
          rackId: rack.id,
          rackItemId: item.id,
        };
        return {
          key: deepLinkKey(link),
          link,
          label: item.label || t(`itops.racks.kind.${item.kind}`),
          detail: [site.name, rack.serverRoom, rack.name].filter(Boolean).join(" · "),
          icon: "rack" as ItIconName,
          available: true,
        };
      }),
    ),
  );
}

function resolveDeepLink(
  link: NetworkNodeDeepLink,
  catalog: NetworkMapDeepLinkCatalog,
  t: TFunction,
): NetworkMapDeepLinkTarget {
  const resolved = deepLinkTargets(link.kind, catalog, t).find(
    (target) => target.key === deepLinkKey(link),
  );
  return resolved ?? {
    key: deepLinkKey(link),
    link,
    label: t("itops.networkMap.deepLinkUnavailable"),
    detail: t(`itops.networkMap.deepLinkType.${link.kind}`),
    icon:
      link.kind === "site"
        ? "site"
        : link.kind === "serverRoom"
          ? "room"
          : link.kind === "rackItem"
            ? "rack"
            : "network",
    available: false,
  };
}

/** Node state drives the card's themed treatment; never a hard-coded colour. */
type NodeState = "up" | "warning" | "down" | "isolated";

interface MapNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  sub: string;
  note: string;
  kind: NetworkNodeKind;
  iconKind: NetworkNodeIconKind;
  state: NodeState;
  root: boolean;
  selected: boolean;
  rootLabel: string;
  warningLabel: string;
  accent: string;
  resizable: boolean;
  locked: boolean;
  geomapViewport: NetworkGeomapViewport;
  deepLinks: NetworkNodeDeepLink[];
  deepLinksPopupLabel: string;
  onOpenDeepLinks?: (nodeId: string, anchor: DOMRect) => void;
  ghost?: boolean;
}

const DEFAULT_GEOMAP_VIEWPORT: NetworkGeomapViewport = {
  zoom: 1,
  x: 50,
  y: 50,
};

function geomapViewport(node: NetworkNode): NetworkGeomapViewport {
  return node.geomapViewport ?? DEFAULT_GEOMAP_VIEWPORT;
}

function nodeArtworkKind(node: Pick<NetworkNode, "kind" | "iconKind">): NetworkNodeIconKind {
  return node.kind === "generic" ? node.iconKind ?? "switch" : node.kind;
}

function hasBlackDeviceShell(kind: NetworkNodeIconKind): boolean {
  return ["switch", "switchL3", "server", "storage"].includes(kind);
}

function GeomapArtwork({
  viewport = DEFAULT_GEOMAP_VIEWPORT,
  className = "",
}: {
  viewport?: NetworkGeomapViewport;
  className?: string;
}) {
  return (
    <span
      className={`nm-geomap-artwork${className ? ` ${className}` : ""}`}
      style={{
        maskImage: `url("${worldMapUrl}")`,
        WebkitMaskImage: `url("${worldMapUrl}")`,
        maskSize: `${viewport.zoom * 100}% auto`,
        WebkitMaskSize: `${viewport.zoom * 100}% auto`,
        maskPosition: `${viewport.x}% ${viewport.y}%`,
        WebkitMaskPosition: `${viewport.x}% ${viewport.y}%`,
      }}
      aria-hidden="true"
    />
  );
}

function clampGeomapViewport(viewport: NetworkGeomapViewport): NetworkGeomapViewport {
  return {
    zoom: Math.min(100, Math.max(1, viewport.zoom)),
    x: Math.min(100, Math.max(0, viewport.x)),
    y: Math.min(100, Math.max(0, viewport.y)),
  };
}

function GeomapViewportEditor({
  value,
  onChange,
}: {
  value: NetworkGeomapViewport;
  onChange: (value: NetworkGeomapViewport) => void;
}) {
  const { t } = useTranslation();
  const dragStart = useRef<{
    pointerX: number;
    pointerY: number;
    viewportX: number;
    viewportY: number;
  } | null>(null);

  const setZoom = (zoom: number) =>
    onChange(clampGeomapViewport({ ...value, zoom }));

  return (
    <div className="nm-geomap-editor">
      <div
        className="nm-geomap-editor-preview"
        role="img"
        aria-label={t("itops.networkMap.geomapPreviewLabel")}
        tabIndex={0}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragStart.current = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            viewportX: value.x,
            viewportY: value.y,
          };
        }}
        onPointerMove={(event) => {
          const start = dragStart.current;
          if (!start || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const rect = event.currentTarget.getBoundingClientRect();
          onChange(clampGeomapViewport({
            ...value,
            x: start.viewportX + ((event.clientX - start.pointerX) / rect.width) * 100,
            y: start.viewportY + ((event.clientY - start.pointerY) / rect.height) * 100,
          }));
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId);
          dragStart.current = null;
        }}
        onPointerCancel={() => {
          dragStart.current = null;
        }}
        onWheel={(event) => {
          event.preventDefault();
          setZoom(value.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
        }}
      >
        <GeomapArtwork viewport={value} className="nm-geomap-editor-image" />
        <span className="nm-geomap-editor-frame" aria-hidden="true" />
      </div>
      <div className="nm-geomap-editor-controls">
        <ItIcon name="minus" size={14} />
        <input
          type="range"
          min="1"
          max="100"
          step="0.05"
          value={value.zoom}
          aria-label={t("itops.networkMap.geomapZoomLabel")}
          onChange={(event) => setZoom(Number(event.currentTarget.value))}
        />
        <ItIcon name="plus" size={14} />
        <output>{Math.round(value.zoom * 100)}%</output>
        <button
          type="button"
          className="nm-geomap-reset"
          onClick={() => onChange(DEFAULT_GEOMAP_VIEWPORT)}
        >
          <ItIcon name="center" size={13} />
          {t("itops.networkMap.geomapReset")}
        </button>
      </div>
      <span className="kk-hint">{t("itops.networkMap.geomapViewportHint")}</span>
    </div>
  );
}

function GeomapSizeFields({
  node,
  onChange,
}: {
  node: NetworkNode;
  onChange: (patch: Partial<NetworkNode>) => void;
}) {
  const { t } = useTranslation();
  const [widthDraft, setWidthDraft] = useState(() => String(Math.round(node.width)));
  const [heightDraft, setHeightDraft] = useState(() => String(Math.round(node.height)));

  const updateWidth = (value: string) => {
    setWidthDraft(value);
    const width = parseNetworkMapDimensionDraft(value, NODE_MIN_WIDTH);
    if (width !== null) onChange({ width });
  };
  const updateHeight = (value: string) => {
    setHeightDraft(value);
    const height = parseNetworkMapDimensionDraft(value, NODE_MIN_HEIGHT);
    if (height !== null) onChange({ height });
  };

  return (
    <div className="nm-geomap-size-fields">
      <Field label={t("itops.networkMap.geomapWidthLabel")}>
        <TextInput
          type="number"
          min={NODE_MIN_WIDTH}
          step={1}
          value={widthDraft}
          onChange={(event) => updateWidth(event.currentTarget.value)}
          onBlur={() => {
            if (parseNetworkMapDimensionDraft(widthDraft, NODE_MIN_WIDTH) === null) {
              setWidthDraft(String(Math.round(node.width)));
            }
          }}
        />
      </Field>
      <Field label={t("itops.networkMap.geomapHeightLabel")}>
        <TextInput
          type="number"
          min={NODE_MIN_HEIGHT}
          step={1}
          value={heightDraft}
          onChange={(event) => updateHeight(event.currentTarget.value)}
          onBlur={() => {
            if (parseNetworkMapDimensionDraft(heightDraft, NODE_MIN_HEIGHT) === null) {
              setHeightDraft(String(Math.round(node.height)));
            }
          }}
        />
      </Field>
    </div>
  );
}

function NetworkNodeArtwork({
  kind,
  size = 30,
}: {
  kind: NetworkNodeIconKind;
  size?: number;
}) {
  return (
    <svg
      className="nm-device-art"
      data-kind={kind}
      data-shell={
        hasBlackDeviceShell(kind) ? "black" : "light"
      }
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
    >
      <g
        className="nm-device-art-hardware"
        dangerouslySetInnerHTML={{ __html: networkNodeArtworkMarkup(kind) }}
      />
    </svg>
  );
}

function MapNode({ data }: NodeProps<Node<MapNodeData>>) {
  const accentStyle = { "--nm-node-accent": data.accent } as CSSProperties;
  const note = data.note.trim();
  return (
    <div
      className={`nm-node${data.selected ? " sel" : ""}${data.ghost ? " ghost" : ""}`}
      data-state={data.kind === "geomap" ? undefined : data.state}
      data-kind={data.kind}
      data-root={data.kind !== "geomap" && data.root ? "true" : undefined}
      data-has-note={data.kind !== "geomap" && note ? "true" : undefined}
      data-has-deep-links={data.deepLinks.length > 0 ? "true" : undefined}
      data-locked={data.locked ? "true" : undefined}
      data-placement-ghost={data.ghost ? "true" : undefined}
      style={{ width: "100%", height: "100%", ...accentStyle }}
    >
      {data.ghost || data.kind === "geomap" ? null : (
        <NodeResizer
          isVisible={data.selected && data.resizable && !data.locked}
          minWidth={NODE_MIN_WIDTH}
          minHeight={NODE_MIN_HEIGHT}
          maxWidth={NODE_MAX_WIDTH}
          maxHeight={NODE_MAX_HEIGHT}
          lineClassName="nm-resize-line"
          handleClassName="nm-resize-handle"
        />
      )}
      {/* Loose connection mode makes one handle usable from either end. Keeping
          a single hit target per side avoids overlapping source/target handles,
          where the top handle made the one below impossible to drop onto. */}
      {data.ghost || data.kind === "geomap"
        ? null
        : [Position.Left, Position.Right, Position.Top, Position.Bottom].map((position) => (
            <Handle
              key={position}
              type="source"
              id={position}
              position={position}
              className="nm-handle"
            />
          ))}
      {data.kind === "geomap" ? (
        <span className="nm-geomap-node">
          <GeomapArtwork
            viewport={data.geomapViewport}
            className="nm-geomap-node-image"
          />
        </span>
      ) : (
        <span className="nm-node-content">
          <span
            className="nm-node-ic"
            data-shell={hasBlackDeviceShell(data.iconKind) ? "black" : "light"}
            style={accentStyle}
          >
            <NetworkNodeArtwork kind={data.iconKind} size={28} />
          </span>
          <span className="nm-node-tx">
            <span className="nm-node-lab">{data.label}</span>
            <span className="nm-node-sub">{data.sub}</span>
          </span>
        </span>
      )}
      {data.kind !== "geomap" && note ? <span className="nm-node-note">{note}</span> : null}
      {data.kind !== "geomap" && data.deepLinks.length > 0 && data.onOpenDeepLinks ? (
        <button
          type="button"
          className="nm-node-deep-links nodrag nopan"
          aria-label={data.deepLinksPopupLabel}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            data.onOpenDeepLinks?.(data.id, event.currentTarget.getBoundingClientRect());
          }}
        >
          <ItIcon name="link" size={11} />
          <span>{data.deepLinks.length}</span>
        </button>
      ) : null}
      {data.kind !== "geomap" && data.root ? (
        <span className="nm-node-root" title={data.rootLabel}>
          <ItIcon name="pulse" size={11} />
        </span>
      ) : null}
      {data.kind !== "geomap" && data.state === "warning" ? (
        <span className="nm-node-warning" title={data.warningLabel}>
          !
        </span>
      ) : null}
      {data.locked ? (
        <span className="nm-object-lock" aria-hidden="true">
          <ItIcon name="lock" size={10} />
        </span>
      ) : null}
    </div>
  );
}

interface MapNoteData extends Record<string, unknown> {
  text: string;
  accent: string;
  selected: boolean;
  resizable: boolean;
  locked: boolean;
  ghost?: boolean;
}

function renderNetworkMapNoteMarkdown(markdown: string): string {
  const html = marked.parse(markdown, { async: false, breaks: true }) as string;
  return DOMPurify.sanitize(html);
}

function MapNote({ data }: NodeProps<Node<MapNoteData>>) {
  const renderedMarkdown = useMemo(
    () => renderNetworkMapNoteMarkdown(data.text),
    [data.text],
  );
  return (
    <div
      className={`nm-note${data.selected ? " sel" : ""}${data.ghost ? " ghost" : ""}`}
      data-locked={data.locked ? "true" : undefined}
      style={{
        width: "100%",
        height: "100%",
        "--nm-note-accent": data.accent,
      } as CSSProperties}
    >
      <NodeResizer
        isVisible={data.selected && data.resizable && !data.locked}
        minWidth={NOTE_MIN_WIDTH}
        minHeight={NOTE_MIN_HEIGHT}
        maxWidth={NOTE_MAX_WIDTH}
        maxHeight={NOTE_MAX_HEIGHT}
        lineClassName="nm-resize-line"
        handleClassName="nm-resize-handle"
      />
      <div
        className="nm-note-markdown"
        dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
      />
      {data.locked ? (
        <span className="nm-object-lock" aria-hidden="true">
          <ItIcon name="lock" size={10} />
        </span>
      ) : null}
    </div>
  );
}

const nodeTypes = { networkNode: MapNode, networkNote: MapNote };

interface NetworkLinkEdgeData extends Record<string, unknown> {
  kind: NetworkLinkKind;
  state: "up" | "warning" | "down" | "cut" | "severed";
  strandCount: number;
  strands: NetworkLinkStrand[];
  strandDisplay: NetworkLinkStrandDisplay;
  label: string;
  /** Set for a trunk, so the midpoint gets the 802.1Q double-tick and
   * trunk-vs-access reads without hovering. */
  trunk: boolean;
  /** Accent of the spotlit VLAN when this link carries it; drives the chip. */
  spotlightAccent: string | null;
}

function orthogonalLinkPath({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  offset = 0,
}: Pick<
  EdgeProps,
  "sourceX" | "sourceY" | "targetX" | "targetY" | "sourcePosition"
> & { offset?: number }): { path: string; labelX: number; labelY: number } {
  const horizontal =
    sourcePosition === Position.Left || sourcePosition === Position.Right;
  // The mid jog shifts with the strand: offsetting only the runs parallel to the
  // route would stack every strand of a bundle back onto one line at the step.
  if (horizontal) {
    const midX = Math.round((sourceX + targetX) / 2) + offset;
    const fromY = sourceY + offset;
    const toY = targetY + offset;
    return {
      path: `M ${sourceX} ${fromY} L ${midX} ${fromY} L ${midX} ${toY} L ${targetX} ${toY}`,
      labelX: midX + 9,
      labelY: Math.round((fromY + toY) / 2),
    };
  }

  const midY = Math.round((sourceY + targetY) / 2) + offset;
  const fromX = sourceX + offset;
  const toX = targetX + offset;
  return {
    path: `M ${fromX} ${sourceY} L ${fromX} ${midY} L ${toX} ${midY} L ${toX} ${targetY}`,
    labelX: Math.round((fromX + toX) / 2),
    labelY: midY - 11,
  };
}

function NetworkLinkEdge(props: EdgeProps<Edge<NetworkLinkEdgeData>>) {
  const { id, data, sourcePosition } = props;
  const count = Math.max(data?.strandCount ?? 1, 1);
  const strandDisplay = data?.strandDisplay ?? "separate";
  const offsets = Array.from(
    { length: strandDisplay === "separate" ? count : 1 },
    (_entry, index) => (index - (count - 1) / 2) * 5,
  );
  if (strandDisplay === "bundle") offsets[0] = 0;
  const centre = orthogonalLinkPath(props);
  const bundleWidth = Math.min(4 + count * 0.75, 12);
  const readouts =
    strandDisplay === "bundle"
      ? Array.from(
          (data?.strands ?? []).reduce((groups, strand) => {
            const speed = strand.speed.trim() || "—";
            groups.set(speed, (groups.get(speed) ?? 0) + 1);
            return groups;
          }, new Map<string, number>()),
          ([speed, quantity]) => ({ badge: `${quantity}×`, value: speed }),
        )
      : (data?.strands ?? [])
          .flatMap((strand, index) =>
            strand.name.trim() || strand.speed.trim()
              ? [
                  {
                    badge: `${index + 1}`,
                    value: [
                      strand.name.trim(),
                      strand.speed.trim() || "—",
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  },
                ]
              : [],
          );
  const readoutColumns = Array.from(
    {
      length: Math.ceil(readouts.length / EDGE_READOUT_ROWS_PER_COLUMN),
    },
    (_entry, columnIndex) =>
      readouts.slice(
        columnIndex * EDGE_READOUT_ROWS_PER_COLUMN,
        (columnIndex + 1) * EDGE_READOUT_ROWS_PER_COLUMN,
      ),
  );
  // The mid jog runs across the route, so the ticks are drawn along the other
  // axis to stay perpendicular to the line they mark.
  const horizontal =
    sourcePosition === Position.Left || sourcePosition === Position.Right;
  const tickX = centre.labelX - 9;
  const tickY = centre.labelY;

  return (
    <>
      <path
        d={centre.path}
        className="react-flow__edge-interaction nm-edge-hit"
        fill="none"
        stroke="transparent"
        strokeWidth={
          strandDisplay === "separate"
            ? Math.max(18, (count - 1) * 5 + 12)
            : bundleWidth + 12
        }
      />
      {offsets.map((offset, index) => {
        const { path } = orthogonalLinkPath({ ...props, offset });
        return (
          <g key={`${id}:${index}`}>
            <path
              d={path}
              className={`react-flow__edge-path nm-edge-strand${
                strandDisplay === "bundle" ? " nm-edge-bundle" : ""
              }`}
              fill="none"
              style={
                strandDisplay === "bundle"
                  ? ({ strokeWidth: bundleWidth } as CSSProperties)
                  : undefined
              }
            />
            <path
              d={path}
              className="nm-edge-flow"
              fill="none"
              style={
                strandDisplay === "bundle"
                  ? ({ strokeWidth: Math.min(bundleWidth, 3.5) } as CSSProperties)
                  : undefined
              }
            />
          </g>
        );
      })}
      {data?.trunk ? (
        <path
          className="nm-edge-trunk-tick"
          fill="none"
          d={
            horizontal
              ? `M ${tickX - 3} ${tickY - 5} L ${tickX - 3} ${tickY + 5} M ${tickX + 3} ${tickY - 5} L ${tickX + 3} ${tickY + 5}`
              : `M ${tickX - 5} ${tickY - 3} L ${tickX + 5} ${tickY - 3} M ${tickX - 5} ${tickY + 3} L ${tickX + 5} ${tickY + 3}`
          }
        />
      ) : null}
      {data?.label || readouts.length > 0 ? (
        <EdgeLabelRenderer>
          <div
            className="nm-edge-label"
            data-state={data?.state}
            data-spotlit={data?.spotlightAccent ? "true" : undefined}
            style={{
              transform: `translate(-50%, -50%) translate(${centre.labelX}px, ${centre.labelY}px)`,
              ...(data?.spotlightAccent
                ? ({ "--nm-vlan-accent": data.spotlightAccent } as CSSProperties)
                : {}),
            }}
          >
            {data?.label ? <span className="nm-edge-label-main">{data.label}</span> : null}
            {readouts.length > 0 ? (
              <span className="nm-edge-speed-list">
                {readoutColumns.map((column, columnIndex) => (
                  <span key={`${id}:column:${columnIndex}`} className="nm-edge-speed-column">
                    {column.map((readout, rowIndex) => (
                      <span
                        key={`${id}:speed:${
                          columnIndex * EDGE_READOUT_ROWS_PER_COLUMN + rowIndex
                        }`}
                        className="nm-edge-speed"
                      >
                        <span className="nm-edge-speed-number">{readout.badge}</span>
                        <span className="nm-edge-speed-value">{readout.value}</span>
                      </span>
                    ))}
                  </span>
                ))}
              </span>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

const edgeTypes = { networkLink: NetworkLinkEdge };

function NetworkMapPreview({ map }: { map: NetworkMap }) {
  const nodesById = new Map(map.graph.nodes.map((node) => [node.id, node]));
  const xs = map.graph.nodes.map((node) => node.x);
  const ys = map.graph.nodes.map((node) => node.y);
  const minX = xs.length > 0 ? Math.min(...xs) : 0;
  const maxX = xs.length > 0 ? Math.max(...xs) : 1;
  const minY = ys.length > 0 ? Math.min(...ys) : 0;
  const maxY = ys.length > 0 ? Math.max(...ys) : 1;
  const point = (node: NetworkNode) => ({
    x: 22 + ((node.x - minX) / Math.max(maxX - minX, 1)) * 196,
    y: 18 + ((node.y - minY) / Math.max(maxY - minY, 1)) * 78,
  });

  return (
    <svg className="nm-map-preview" viewBox="0 0 240 114" aria-hidden="true">
      <defs>
        <pattern id={`nm-grid-${map.id}`} width="12" height="12" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".65" className="nm-map-preview-grid" />
        </pattern>
      </defs>
      <rect width="240" height="114" rx="10" fill={`url(#nm-grid-${map.id})`} />
      {map.graph.links.map((link, index) => {
        const from = nodesById.get(link.from);
        const to = nodesById.get(link.to);
        if (!from || !to) return null;
        const a = point(from);
        const b = point(to);
        return (
          <line
            key={link.id}
            className={`nm-map-preview-link ${link.kind} ${link.status ?? "up"}`}
            style={{ animationDelay: `${index * -180}ms` }}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
          />
        );
      })}
      {map.graph.nodes.length === 0 ? (
        <g className="nm-map-preview-empty">
          <circle cx="120" cy="57" r="18" />
          <path d="M120 39v36M102 57h36" />
        </g>
      ) : null}
      {map.graph.nodes.map((node, index) => {
        const p = point(node);
        return (
          <g
            key={node.id}
            className="nm-map-preview-node"
            data-kind={node.kind}
            style={{ animationDelay: `${index * 90}ms` }}
            transform={`translate(${p.x} ${p.y})`}
          >
            <circle className="nm-map-preview-halo" r="9" />
            <rect x="-5" y="-5" width="10" height="10" rx="3" />
            <circle className="nm-map-preview-led" cx="3" cy="-3" r="1.2" />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Which side of each card a link should leave from. Comparing the centres keeps
 * the drawn line short and stops every edge from stacking on one handle.
 */
function anchors(from: NetworkNode, to: NetworkNode): { source: Position; target: Position } {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { source: Position.Right, target: Position.Left }
      : { source: Position.Left, target: Position.Right };
  }
  return dy >= 0
    ? { source: Position.Bottom, target: Position.Top }
    : { source: Position.Top, target: Position.Bottom };
}

function nodeLabel(node: NetworkNode, fallback: string): string {
  return node.label.trim() || node.interfaces[0]?.address.trim() || fallback;
}

function interfaceLabel(
  entry: NetworkNodeInterface,
  fallback: string,
): string {
  return entry.name.trim() || entry.address.trim() || fallback;
}

function nodeAccent(node: NetworkNode): string {
  return isHexColor(node.iconBackgroundColor)
    ? node.iconBackgroundColor
    : node.iconAccent == null
    ? NODE_STYLE[node.kind].accent
    : MAP_ACCENTS[node.iconAccent % MAP_ACCENTS.length];
}

function noteAccent(note: NetworkMapNote): string {
  return isHexColor(note.backgroundColor)
    ? note.backgroundColor
    : MAP_ACCENTS[note.backgroundAccent % MAP_ACCENTS.length];
}

/** Whether a link carries a VLAN at all, tagged or untagged. Membership is the
 * only thing the spotlight asks; access-vs-trunk is drawn separately. */
function linkCarriesVlan(link: NetworkLink, vlanId: string): boolean {
  return link.nativeVlanId === vlanId || link.taggedVlanIds.includes(vlanId);
}

/** The VLAN fragment of an edge label: "VLAN 30" for an access link, "30 · +4T"
 * for a trunk. A trunk's full tagged list would not survive at edge-label size,
 * so the chip carries the native id and how many tags ride alongside it; the
 * inspector holds the list. A reference to a deleted VLAN reads as "?" rather
 * than vanishing, because a link that documents *some* VLAN is not the same as
 * one that documents none. */
function vlanChip(
  link: NetworkLink,
  vlans: ReadonlyMap<string, Vlan>,
  t: TFunction,
): string {
  const native = link.nativeVlanId ? vlans.get(link.nativeVlanId) : undefined;
  const nativeText = link.nativeVlanId
    ? (native ? String(native.vid) : t("itops.networkMap.vlanUnknownShort"))
    : "";
  const tagged = link.taggedVlanIds.length;
  if (!nativeText && tagged === 0) return "";
  if (tagged === 0) return t("itops.networkMap.vlanAccessChip", { vid: nativeText });
  return t("itops.networkMap.vlanTrunkChip", {
    vid: nativeText || t("itops.networkMap.vlanNoneShort"),
    count: tagged,
  });
}

/** Endpoint name for prose, tolerating a link whose node was removed mid-edit. */
function endpointName(
  nodesById: ReadonlyMap<string, NetworkNode>,
  id: string,
  fallback: string,
): string {
  const node = nodesById.get(id);
  return node ? nodeLabel(node, fallback) : fallback;
}

/** Nodes seeded from a Site's Host inventory, laid out in a readable grid. */
function hostsAsNodes(hosts: readonly SiteHost[], offset: number): NetworkNode[] {
  return hosts.map((host, index) => ({
    id: newId("nmn"),
    label: host.label.trim() || host.hostname,
    kind: "server" as NetworkNodeKind,
    x: 60 + ((index + offset) % 4) * (NODE_WIDTH + 46),
    y: 60 + Math.floor((index + offset) / 4) * (NODE_HEIGHT + 54),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    iconAccent: null,
    iconBackgroundColor: null,
    iconKind: null,
    interfaces: [
      {
        id: newId("nmi"),
        name: "",
        address: host.hostname,
      },
    ],
    status: "up",
    hostId: host.id,
    connectionId: host.connectionIds[0] ?? null,
    rackItemId: null,
    deepLinks: [],
    note: "",
    locked: false,
  }));
}

function newNodeDraft(kind: NetworkNodeKind): NetworkNode {
  const isGeomap = kind === "geomap";
  return {
    id: newId("nmn"),
    label: "",
    kind,
    x: 0,
    y: 0,
    width: isGeomap ? 320 : NODE_WIDTH,
    height: isGeomap ? 190 : NODE_HEIGHT,
    iconAccent: null,
    iconBackgroundColor: null,
    iconKind: kind === "generic" ? "switch" : null,
    interfaces: [],
    status: "up",
    hostId: null,
    connectionId: null,
    rackItemId: null,
    deepLinks: [],
    note: "",
    geomapViewport: isGeomap ? DEFAULT_GEOMAP_VIEWPORT : null,
    locked: false,
  };
}

function newNoteDraft(): NetworkMapNote {
  return {
    id: newId("nmt"),
    text: "",
    x: 0,
    y: 0,
    width: NOTE_WIDTH,
    height: NOTE_HEIGHT,
    backgroundAccent: 1,
    backgroundColor: null,
    locked: false,
  };
}

function appendGeneratedInterface(node: NetworkNode): {
  node: NetworkNode;
  interfaceId: string;
} {
  const names = new Set(
    node.interfaces.map((entry) => entry.name.trim().toLocaleLowerCase()),
  );
  let ordinal = 1;
  while (names.has(`port${ordinal}`)) ordinal += 1;
  const entry: NetworkNodeInterface = {
    id: newId("nmi"),
    name: `port${ordinal}`,
    address: "",
  };
  return {
    node: { ...node, interfaces: [...node.interfaces, entry] },
    interfaceId: entry.id,
  };
}

function appendBoundStrand(
  link: NetworkLink,
  fromNode: NetworkNode,
  toNode: NetworkNode,
  speed = "",
): {
  link: NetworkLink;
  fromNode: NetworkNode;
  toNode: NetworkNode;
  generatedInterfaceIds: string[];
} {
  const nextFrom = appendGeneratedInterface(fromNode);
  const nextTo = appendGeneratedInterface(toNode);
  return {
    link: {
      ...link,
      strands: [
        ...link.strands,
        {
          id: newId("nms"),
          name: "",
          fromInterfaceId: nextFrom.interfaceId,
          toInterfaceId: nextTo.interfaceId,
          speed,
        },
      ],
    },
    fromNode: nextFrom.node,
    toNode: nextTo.node,
    generatedInterfaceIds: [nextFrom.interfaceId, nextTo.interfaceId],
  };
}

function ChoiceGrid({
  value,
  options,
  onChange,
}: {
  value: string;
  options: Array<{ value: string; label: string; icon: ItIconName }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="nm-choice-grid" role="radiogroup">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            className={selected ? "nm-choice selected" : "nm-choice"}
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
          >
            <span className="nm-choice-icon">
              <ItIcon name={option.icon} size={15} />
            </span>
            <span>{option.label}</span>
            <span className="nm-choice-radio" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}

function NetworkMapColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const customValue = isHexColor(value) && !MAP_ACCENTS.some(
    (accent) => accent.toLowerCase() === value.toLowerCase(),
  )
    ? value
    : null;
  return (
    <div className="nm-color-swatches" role="group">
      {MAP_ACCENTS.map((color) => {
        const selected = color.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={color}
            type="button"
            className={`nm-color-swatch${selected ? " selected" : ""}`}
            style={{ "--nm-swatch": color } as CSSProperties}
            aria-label={color}
            aria-pressed={selected}
            onClick={() => onChange(color)}
          />
        );
      })}
      <ColorPalettePicker
        className="nm-custom-color"
        value={customValue}
        onChange={onChange}
      />
    </div>
  );
}

function NodeDeepLinkEditor({
  existing,
  catalog,
  onSave,
  onClose,
}: {
  existing: readonly NetworkNodeDeepLink[];
  catalog: NetworkMapDeepLinkCatalog;
  onSave: (link: NetworkNodeDeepLink) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<NetworkNodeDeepLinkKind>("connection");
  const existingKeys = useMemo(() => new Set(existing.map(deepLinkKey)), [existing]);
  const targets = useMemo(
    () => deepLinkTargets(kind, catalog, t).filter((target) => !existingKeys.has(target.key)),
    [catalog, existingKeys, kind, t],
  );
  const [targetKey, setTargetKey] = useState("");
  const selected = targets.find((target) => target.key === targetKey) ?? targets[0];

  useEffect(() => {
    setTargetKey("");
  }, [kind]);

  return (
    <DialogShell onBackdrop={onClose} zClassName="itops-page">
      <Sheet
        width={440}
        title={t("itops.networkMap.deepLinkAdd")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("common.cancel")}</Btn>}
            primary={
              <Btn
                kind="primary"
                icon="check"
                disabled={!selected}
                onClick={() => {
                  if (!selected) return;
                  onSave({ ...selected.link, id: newId("nmdl") });
                  onClose();
                }}
              >
                {t("common.add")}
              </Btn>
            }
          />
        }
      >
        <Field label={t("itops.networkMap.deepLinkTypeLabel")}>
          <Select
            value={kind}
            onChange={(event) =>
              setKind(event.currentTarget.value as NetworkNodeDeepLinkKind)
            }
            options={(
              ["connection", "site", "serverRoom", "rackItem"] as const
            ).map((value) => ({
              value,
              label: t(`itops.networkMap.deepLinkType.${value}`),
            }))}
          />
        </Field>
        <Field label={t("itops.networkMap.deepLinkTargetLabel")}>
          <Select
            value={selected?.key ?? ""}
            disabled={targets.length === 0}
            onChange={(event) => setTargetKey(event.currentTarget.value)}
            options={
              targets.length > 0
                ? targets.map((target) => ({
                    value: target.key,
                    label: target.detail
                      ? `${target.label} — ${target.detail}`
                      : target.label,
                  }))
                : [{ value: "", label: t("itops.networkMap.deepLinkNoTargets") }]
            }
          />
        </Field>
      </Sheet>
    </DialogShell>
  );
}

function NodeInterfaceEditor({
  value,
  onSave,
  onDelete,
  onClose,
}: {
  value: NetworkNodeInterface | null;
  onSave: (entry: NetworkNodeInterface) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<NetworkNodeInterface>(
    value ?? { id: newId("nmi"), name: "", address: "" },
  );
  const canSave = Boolean(draft.name.trim());

  return (
    <DialogShell onBackdrop={onClose} zClassName="itops-page">
      <Sheet
        width={420}
        title={t(
          value
            ? "itops.networkMap.interfaceEditTitle"
            : "itops.networkMap.interfaceAddTitle",
        )}
        footer={
          <Actions
            extraLeft={
              onDelete ? (
                <Btn kind="danger" icon="trash" onClick={onDelete}>
                  {t("common.delete")}
                </Btn>
              ) : undefined
            }
            cancel={<Btn onClick={onClose}>{t("common.cancel")}</Btn>}
            primary={
              <Btn
                kind="primary"
                icon="check"
                disabled={!canSave}
                onClick={() => onSave({ ...draft, name: draft.name.trim(), address: draft.address.trim() })}
              >
                {t("common.save")}
              </Btn>
            }
          />
        }
      >
        <Field label={t("common.name")} req>
          <TextInput
            value={draft.name}
            placeholder={t("itops.networkMap.strandNamePlaceholder")}
            onChange={(event) => {
              const name = event.currentTarget.value;
              setDraft((current) => ({ ...current, name }));
            }}
            autoFocus
          />
        </Field>
        <Field label={t("itops.networkMap.addressLabel")}>
          <TextInput
            mono
            value={draft.address}
            placeholder={t("itops.networkMap.addressPlaceholder")}
            onChange={(event) => {
              const address = event.currentTarget.value;
              setDraft((current) => ({ ...current, address }));
            }}
          />
        </Field>
      </Sheet>
    </DialogShell>
  );
}

function NodeInterfacesEditor({
  value,
  onSave,
  onClose,
}: {
  value: readonly NetworkNodeInterface[];
  onSave: (interfaces: NetworkNodeInterface[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<NetworkNodeInterface[]>(() =>
    value.map((entry) => ({ ...entry })),
  );
  const [interfaceEditor, setInterfaceEditor] = useState<
    NetworkNodeInterface | null | undefined
  >(undefined);
  const unnamedInterface = t("itops.networkMap.interfaceUnbound");

  return (
    <>
      <DialogShell onBackdrop={onClose} zClassName="itops-page">
        <Sheet
          width={560}
          title={t("itops.networkMap.interfacesLabel")}
          footer={
            <Actions
              cancel={<Btn onClick={onClose}>{t("common.cancel")}</Btn>}
              primary={
                <Btn
                  kind="primary"
                  icon="check"
                  onClick={() => {
                    onSave(draft);
                    onClose();
                  }}
                >
                  {t("common.save")}
                </Btn>
              }
            />
          }
        >
          <div className="nm-member-editor-heading">
            <span>
              {t("itops.networkMap.interfaceCount", { count: draft.length })}
            </span>
            <button
              type="button"
              className="nm-strand-add"
              disabled={draft.length >= MAX_NODE_COLLECTION_ITEMS}
              onClick={() => setInterfaceEditor(null)}
            >
              <ItIcon name="plus" size={12} />
              {t("common.add")}
            </button>
          </div>
          {draft.length > 0 ? (
            <div className="nm-interface-list nm-collection-editor-list">
              {draft.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className="nm-interface-row"
                  onClick={() => setInterfaceEditor(entry)}
                >
                  <span className="nm-interface-port">
                    <ItIcon name="network" size={15} />
                  </span>
                  <span className="nm-interface-copy">
                    <strong>{interfaceLabel(entry, unnamedInterface)}</strong>
                    {entry.address ? <small>{entry.address}</small> : null}
                  </span>
                  <ItIcon name="chevR" size={13} />
                </button>
              ))}
            </div>
          ) : (
            <p className="nm-interface-empty">
              {t("itops.networkMap.interfaceEmpty")}
            </p>
          )}
        </Sheet>
      </DialogShell>
      {interfaceEditor !== undefined ? (
        <NodeInterfaceEditor
          value={interfaceEditor}
          onClose={() => setInterfaceEditor(undefined)}
          onDelete={
            interfaceEditor
              ? () => {
                  setDraft((current) =>
                    current.filter((entry) => entry.id !== interfaceEditor.id),
                  );
                  setInterfaceEditor(undefined);
                }
              : undefined
          }
          onSave={(entry) => {
            setDraft((current) =>
              interfaceEditor
                ? current.map((candidate) =>
                    candidate.id === entry.id ? entry : candidate,
                  )
                : [...current, entry],
            );
            setInterfaceEditor(undefined);
          }}
        />
      ) : null}
    </>
  );
}

function NodeDeepLinksEditor({
  value,
  catalog,
  onSave,
  onNavigate,
  onClose,
}: {
  value: readonly NetworkNodeDeepLink[];
  catalog: NetworkMapDeepLinkCatalog;
  onSave: (deepLinks: NetworkNodeDeepLink[]) => void;
  onNavigate: (link: NetworkNodeDeepLink) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<NetworkNodeDeepLink[]>(() =>
    value.map((link) => ({ ...link })),
  );
  const [addEditorOpen, setAddEditorOpen] = useState(false);

  return (
    <>
      <DialogShell onBackdrop={onClose} zClassName="itops-page">
        <Sheet
          width={600}
          title={t("itops.networkMap.deepLinksLabel")}
          footer={
            <Actions
              cancel={<Btn onClick={onClose}>{t("common.cancel")}</Btn>}
              primary={
                <Btn
                  kind="primary"
                  icon="check"
                  onClick={() => {
                    onSave(draft);
                    onClose();
                  }}
                >
                  {t("common.save")}
                </Btn>
              }
            />
          }
        >
          <div className="nm-member-editor-heading">
            <span>
              {t("itops.networkMap.deepLinkCount", { count: draft.length })}
            </span>
            <button
              type="button"
              className="nm-strand-add"
              disabled={draft.length >= MAX_NODE_COLLECTION_ITEMS}
              onClick={() => setAddEditorOpen(true)}
            >
              <ItIcon name="plus" size={12} />
              {t("common.add")}
            </button>
          </div>
          {draft.length > 0 ? (
            <div className="nm-deep-link-list nm-collection-editor-list">
              {draft.map((link) => {
                const target = resolveDeepLink(link, catalog, t);
                return (
                  <div
                    className={`nm-deep-link-row${target.available ? "" : " missing"}`}
                    key={link.id}
                  >
                    <span className="nm-deep-link-row-icon">
                      <ItIcon name={target.icon} size={14} />
                    </span>
                    <span className="nm-deep-link-row-copy">
                      <strong>{target.label}</strong>
                      <small>{target.detail}</small>
                    </span>
                    <button
                      type="button"
                      className="nm-deep-link-action"
                      disabled={!target.available}
                      title={t("itops.networkMap.deepLinkOpenAction", {
                        name: target.label,
                      })}
                      aria-label={t("itops.networkMap.deepLinkOpenAction", {
                        name: target.label,
                      })}
                      onClick={() => {
                        onClose();
                        onNavigate(link);
                      }}
                    >
                      <ItIcon name="arrow" size={12} />
                    </button>
                    <button
                      type="button"
                      className="nm-deep-link-action remove"
                      title={t("common.remove")}
                      aria-label={t("common.remove")}
                      onClick={() =>
                        setDraft((current) =>
                          current.filter((entry) => entry.id !== link.id),
                        )
                      }
                    >
                      <ItIcon name="xmark" size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="nm-interface-empty">
              {t("itops.networkMap.deepLinkEmpty")}
            </p>
          )}
        </Sheet>
      </DialogShell>
      {addEditorOpen ? (
        <NodeDeepLinkEditor
          existing={draft}
          catalog={catalog}
          onClose={() => setAddEditorOpen(false)}
          onSave={(link) => setDraft((current) => [...current, link])}
        />
      ) : null}
    </>
  );
}

function NodePropertiesFields({
  node,
  showKindPicker,
  deepLinkCatalog,
  onNavigateDeepLink,
  onChange,
}: {
  node: NetworkNode;
  showKindPicker: boolean;
  deepLinkCatalog: NetworkMapDeepLinkCatalog;
  onNavigateDeepLink: (link: NetworkNodeDeepLink) => void;
  onChange: (patch: Partial<NetworkNode>) => void;
}) {
  const { t } = useTranslation();
  const [interfacesEditorOpen, setInterfacesEditorOpen] = useState(false);
  const [deepLinkEditorOpen, setDeepLinkEditorOpen] = useState(false);

  if (node.kind === "geomap") {
    return (
      <>
        <div className="nm-node-identity">
          <span
            className="nm-node-ic nm-node-identity-icon"
            data-shell="light"
            style={{ "--nm-node-accent": nodeAccent(node) } as CSSProperties}
          >
            <NetworkNodeArtwork kind="geomap" size={32} />
          </span>
          <span className="nm-node-identity-copy">
            <strong>{t("itops.networkMap.nodeKind.geomap")}</strong>
          </span>
          <NetworkMapColorPicker
            value={nodeAccent(node)}
            onChange={(color) => {
              const paletteIndex = MAP_ACCENTS.findIndex((accent) => accent === color);
              onChange({
                iconAccent: paletteIndex >= 0 ? paletteIndex : null,
                iconBackgroundColor: paletteIndex >= 0 ? null : color,
              });
            }}
          />
        </div>
        <GeomapSizeFields node={node} onChange={onChange} />
        <Field label={t("itops.networkMap.geomapViewportLabel")}>
          <GeomapViewportEditor
            value={geomapViewport(node)}
            onChange={(geomapViewport) => onChange({ geomapViewport })}
          />
        </Field>
      </>
    );
  }

  return (
    <>
      <div className="nm-node-identity">
        <span
          className="nm-node-ic nm-node-identity-icon"
          data-shell={
            hasBlackDeviceShell(nodeArtworkKind(node)) ? "black" : "light"
          }
          style={{ "--nm-node-accent": nodeAccent(node) } as CSSProperties}
        >
          <NetworkNodeArtwork kind={nodeArtworkKind(node)} size={32} />
        </span>
        <span className="nm-node-identity-copy">
          <strong>{node.label.trim() || t("itops.networkMap.unnamedNode")}</strong>
          <small>{t(`itops.networkMap.nodeKind.${node.kind}`)}</small>
        </span>
        <NetworkMapColorPicker
          value={nodeAccent(node)}
          onChange={(color) => {
            const paletteIndex = MAP_ACCENTS.findIndex((accent) => accent === color);
            onChange({
              iconAccent: paletteIndex >= 0 ? paletteIndex : null,
              iconBackgroundColor: paletteIndex >= 0 ? null : color,
            });
          }}
        />
      </div>
      <Field label={t("itops.networkMap.labelLabel")}>
        <TextInput
          value={node.label}
          placeholder={t("itops.networkMap.labelPlaceholder")}
          onChange={(event) => onChange({ label: event.currentTarget.value })}
          autoFocus
        />
      </Field>
      {showKindPicker ? (
        <Field label={t("itops.networkMap.kindLabel")}>
          <Select
            value={node.kind}
            onChange={(event) => {
              const kind = event.currentTarget.value as NetworkNodeKind;
              onChange({
                kind,
                iconKind:
                  kind === "generic"
                    ? node.iconKind ?? nodeArtworkKind(node)
                    : null,
                geomapViewport:
                  kind === "geomap"
                    ? node.geomapViewport ?? DEFAULT_GEOMAP_VIEWPORT
                    : null,
                ...(kind === "geomap" && node.kind !== "geomap"
                  ? { width: 320, height: 190 }
                  : {}),
              });
            }}
            options={NODE_KINDS.filter((kind) => kind !== "geomap").map((kind) => ({
              value: kind,
              label: t(`itops.networkMap.nodeKind.${kind}`),
            }))}
          />
        </Field>
      ) : null}
      {node.kind === "generic" ? (
        <Field label={t("itops.networkMap.genericIconLabel")}>
          <div className="nm-icon-picker" role="radiogroup">
            {BUILT_IN_ICON_KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                className={nodeArtworkKind(node) === kind ? "selected" : ""}
                role="radio"
                aria-checked={nodeArtworkKind(node) === kind}
                title={t(`itops.networkMap.nodeKind.${kind}`)}
                onClick={() => onChange({ iconKind: kind })}
              >
                <NetworkNodeArtwork kind={kind} size={28} />
              </button>
            ))}
          </div>
        </Field>
      ) : null}
      <Field label={t("itops.networkMap.statusLabel")}>
        <ChoiceGrid
          value={node.status ?? "up"}
          onChange={(value) => onChange({ status: value as NetworkMapStatus })}
          options={[
            {
              value: "up",
              label: t("itops.networkMap.status.up"),
              icon: "check",
            },
            {
              value: "warning",
              label: t("itops.networkMap.status.warning"),
              icon: "alert",
            },
          ]}
        />
      </Field>
      <Field label={t("itops.networkMap.interfacesLabel")}>
        <button
          type="button"
          className="nm-member-count"
          onClick={() => setInterfacesEditorOpen(true)}
        >
          <span className="nm-member-count-icon">
            <ItIcon name="network" size={16} />
          </span>
          <span className="nm-member-count-copy">
            <strong>
              {t("itops.networkMap.interfaceCount", {
                count: node.interfaces.length,
              })}
            </strong>
            <small>{t("itops.networkMap.collectionEditHint")}</small>
          </span>
          <ItIcon name="chevR" size={14} />
        </button>
      </Field>
      <Field label={t("itops.networkMap.deepLinksLabel")}>
        <button
          type="button"
          className="nm-member-count"
          onClick={() => setDeepLinkEditorOpen(true)}
        >
          <span className="nm-member-count-icon">
            <ItIcon name="link" size={16} />
          </span>
          <span className="nm-member-count-copy">
            <strong>
              {t("itops.networkMap.deepLinkCount", {
                count: node.deepLinks.length,
              })}
            </strong>
            <small>{t("itops.networkMap.collectionEditHint")}</small>
          </span>
          <ItIcon name="chevR" size={14} />
        </button>
      </Field>
      <Field label={t("itops.networkMap.noteLabel")}>
        <TextArea
          rows={3}
          value={node.note}
          onChange={(event) => onChange({ note: event.currentTarget.value })}
          spellCheck
        />
      </Field>
      {interfacesEditorOpen ? (
        <NodeInterfacesEditor
          value={node.interfaces}
          onClose={() => setInterfacesEditorOpen(false)}
          onSave={(interfaces) => onChange({ interfaces })}
        />
      ) : null}
      {deepLinkEditorOpen ? (
        <NodeDeepLinksEditor
          value={node.deepLinks}
          catalog={deepLinkCatalog}
          onNavigate={onNavigateDeepLink}
          onClose={() => setDeepLinkEditorOpen(false)}
          onSave={(deepLinks) => onChange({ deepLinks })}
        />
      ) : null}
    </>
  );
}

function NodePropertiesDialog({
  node,
  root,
  placement,
  deepLinkCatalog,
  onNavigateDeepLink,
  onSubmit,
  onDelete,
  onClose,
}: {
  node: NetworkNode;
  root: boolean;
  placement: boolean;
  deepLinkCatalog: NetworkMapDeepLinkCatalog;
  onNavigateDeepLink: (link: NetworkNodeDeepLink) => void;
  onSubmit: (node: NetworkNode, root: boolean) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(node);
  return (
    <DialogShell onBackdrop={onClose} zClassName="itops-page">
      <Sheet
        width={620}
        title={t(
          node.kind === "geomap"
            ? "itops.networkMap.nodeKind.geomap"
            : "itops.networkMap.nodeHeading",
        )}
        footer={
          <Actions
            extraLeft={
              onDelete ? (
                <Btn
                  kind="danger"
                  icon="trash"
                  onClick={() => {
                    onDelete();
                    onClose();
                  }}
                >
                  {t("itops.networkMap.removeNode")}
                </Btn>
              ) : undefined
            }
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              <Btn
                kind="primary"
                onClick={() => {
                  onSubmit(draft, root);
                  onClose();
                }}
              >
                {placement ? t("itops.racks.placeAction") : t("itops.actions.save")}
              </Btn>
            }
          />
        }
      >
        <NodePropertiesFields
          node={draft}
          showKindPicker={!placement}
          deepLinkCatalog={deepLinkCatalog}
          onNavigateDeepLink={onNavigateDeepLink}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        />
      </Sheet>
    </DialogShell>
  );
}

function NotePropertiesDialog({
  note,
  placement,
  onSubmit,
  onDelete,
  onClose,
}: {
  note: NetworkMapNote;
  placement: boolean;
  onSubmit: (note: NetworkMapNote) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(note);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const renderedMarkdown = useMemo(
    () => renderNetworkMapNoteMarkdown(draft.text),
    [draft.text],
  );

  function applyFormatting(action: NetworkMapNoteFormatAction) {
    const textArea = textAreaRef.current;
    if (!textArea) return;
    const formatted = formatNetworkMapNoteMarkdown(
      draft.text,
      textArea.selectionStart,
      textArea.selectionEnd,
      action,
    );
    setDraft((current) => ({ ...current, text: formatted.text }));
    requestAnimationFrame(() => {
      textAreaRef.current?.focus();
      textAreaRef.current?.setSelectionRange(
        formatted.selectionStart,
        formatted.selectionEnd,
      );
    });
  }

  const formatButtons: Array<{
    action: NetworkMapNoteFormatAction;
    label: string;
    glyph: string;
  }> = [
    {
      action: "heading1",
      label: t("itops.networkMap.noteFormatHeading1"),
      glyph: "H1",
    },
    {
      action: "heading2",
      label: t("itops.networkMap.noteFormatHeading2"),
      glyph: "H2",
    },
    {
      action: "bold",
      label: t("screenshots.editor.bold"),
      glyph: "B",
    },
    {
      action: "italic",
      label: t("screenshots.editor.italic"),
      glyph: "I",
    },
    {
      action: "bulletedList",
      label: t("itops.networkMap.noteFormatBulletedList"),
      glyph: "•",
    },
    {
      action: "numberedList",
      label: t("itops.networkMap.noteFormatNumberedList"),
      glyph: "1.",
    },
    {
      action: "quote",
      label: t("itops.networkMap.noteFormatQuote"),
      glyph: ">",
    },
    {
      action: "inlineCode",
      label: t("itops.networkMap.noteFormatInlineCode"),
      glyph: "</>",
    },
    {
      action: "link",
      label: t("itops.networkMap.linkHeading"),
      glyph: "[]",
    },
  ];

  return (
    <DialogShell onBackdrop={onClose} zClassName="itops-page">
      <Sheet
        width={680}
        title={t("itops.networkMap.noteElement")}
        footer={
          <Actions
            extraLeft={
              onDelete ? (
                <Btn
                  kind="danger"
                  icon="trash"
                  onClick={() => {
                    onDelete();
                    onClose();
                  }}
                >
                  {t("itops.networkMap.removeNote")}
                </Btn>
              ) : undefined
            }
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              <Btn
                kind="primary"
                onClick={() => {
                  onSubmit(draft);
                  onClose();
                }}
              >
                {placement ? t("itops.racks.placeAction") : t("itops.actions.save")}
              </Btn>
            }
          />
        }
      >
        <Field label={t("itops.networkMap.noteLabel")}>
          <div className="nm-note-editor">
            <div
              className="nm-note-format-toolbar"
              role="toolbar"
              aria-label={t("itops.networkMap.noteFormattingLabel")}
            >
              {formatButtons.map((button) => (
                <button
                  key={button.action}
                  type="button"
                  className={`nm-note-format-button ${button.action}`}
                  aria-label={button.label}
                  title={button.label}
                  onClick={() => applyFormatting(button.action)}
                >
                  {button.glyph}
                </button>
              ))}
            </div>
            <TextArea
              ref={textAreaRef}
              rows={8}
              value={draft.text}
              placeholder={t("itops.networkMap.notePlaceholder")}
              onChange={(event) => {
                const text = event.currentTarget.value;
                setDraft((current) => ({ ...current, text }));
              }}
              autoFocus
              spellCheck
            />
            <div
              className="nm-note-markdown nm-note-preview"
              aria-label={t("workspace.fileViewer.view.preview")}
              dangerouslySetInnerHTML={{ __html: renderedMarkdown }}
            />
          </div>
        </Field>
        <Field label={t("itops.networkMap.noteBackgroundLabel")}>
          <NetworkMapColorPicker
            value={noteAccent(draft)}
            onChange={(color) => {
              const paletteIndex = MAP_ACCENTS.findIndex((accent) => accent === color);
              setDraft((current) => ({
                ...current,
                backgroundAccent:
                  paletteIndex >= 0 ? paletteIndex : current.backgroundAccent,
                backgroundColor: paletteIndex >= 0 ? null : color,
              }));
            }}
          />
        </Field>
      </Sheet>
    </DialogShell>
  );
}

type LinkMembersDraft = {
  link: NetworkLink;
  fromNode: NetworkNode;
  toNode: NetworkNode;
  generatedInterfaceIds: Set<string>;
};

function createLinkMembersDraft(
  link: NetworkLink,
  fromNode: NetworkNode,
  toNode: NetworkNode,
): LinkMembersDraft {
  const draft: LinkMembersDraft = {
    link: { ...link, strands: [] },
    fromNode: { ...fromNode, interfaces: [...fromNode.interfaces] },
    toNode: { ...toNode, interfaces: [...toNode.interfaces] },
    generatedInterfaceIds: new Set(),
  };
  const strands = link.strands.length > 0 ? link.strands : [{
    id: newId("nms"),
    name: "",
    fromInterfaceId: null,
    toInterfaceId: null,
    speed: "",
  }];
  for (const strand of strands) {
    const nextStrand = { ...strand };
    const fromExists = draft.fromNode.interfaces.some(
      (entry) => entry.id === nextStrand.fromInterfaceId,
    );
    if (!fromExists) {
      const next = appendGeneratedInterface(draft.fromNode);
      draft.fromNode = next.node;
      nextStrand.fromInterfaceId = next.interfaceId;
      draft.generatedInterfaceIds.add(next.interfaceId);
    }
    const toExists = draft.toNode.interfaces.some(
      (entry) => entry.id === nextStrand.toInterfaceId,
    );
    if (!toExists) {
      const next = appendGeneratedInterface(draft.toNode);
      draft.toNode = next.node;
      nextStrand.toInterfaceId = next.interfaceId;
      draft.generatedInterfaceIds.add(next.interfaceId);
    }
    draft.link.strands.push(nextStrand);
  }
  return draft;
}

function LinkMembersEditor({
  link,
  fromNode,
  toNode,
  onSave,
  onClose,
}: {
  link: NetworkLink;
  fromNode: NetworkNode;
  toNode: NetworkNode;
  onSave: (link: NetworkLink, endpointNodes: NetworkNode[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() =>
    createLinkMembersDraft(link, fromNode, toNode),
  );
  const speedListId = `nm-link-members-speeds-${link.id}`;
  const fromInterfaceLabel = t("itops.networkMap.endpointInterfaceLabel", {
    node: nodeLabel(draft.fromNode, t("itops.networkMap.unnamedNode")),
  });
  const toInterfaceLabel = t("itops.networkMap.endpointInterfaceLabel", {
    node: nodeLabel(draft.toNode, t("itops.networkMap.unnamedNode")),
  });
  const canSave = draft.link.strands.every((strand) => {
    const fromInterface = draft.fromNode.interfaces.find(
      (entry) => entry.id === strand.fromInterfaceId,
    );
    const toInterface = draft.toNode.interfaces.find(
      (entry) => entry.id === strand.toInterfaceId,
    );
    return Boolean(fromInterface?.name.trim() && toInterface?.name.trim());
  });

  function patchInterface(
    endpoint: "from" | "to",
    interfaceId: string,
    name: string,
  ) {
    setDraft((current) => {
      const key = endpoint === "from" ? "fromNode" : "toNode";
      return {
        ...current,
        [key]: {
          ...current[key],
          interfaces: current[key].interfaces.map((entry) =>
            entry.id === interfaceId ? { ...entry, name } : entry,
          ),
        },
      };
    });
  }

  function removeStrand(strand: NetworkLinkStrand) {
    setDraft((current) => {
      if (current.link.strands.length <= 1) return current;
      const removedIds = [strand.fromInterfaceId, strand.toInterfaceId].filter(
        (id): id is string => Boolean(id && current.generatedInterfaceIds.has(id)),
      );
      const generatedInterfaceIds = new Set(current.generatedInterfaceIds);
      for (const id of removedIds) generatedInterfaceIds.delete(id);
      return {
        link: {
          ...current.link,
          strands: current.link.strands.filter((entry) => entry.id !== strand.id),
        },
        fromNode: {
          ...current.fromNode,
          interfaces: current.fromNode.interfaces.filter(
            (entry) => !removedIds.includes(entry.id),
          ),
        },
        toNode: {
          ...current.toNode,
          interfaces: current.toNode.interfaces.filter(
            (entry) => !removedIds.includes(entry.id),
          ),
        },
        generatedInterfaceIds,
      };
    });
  }

  return (
    <DialogShell onBackdrop={onClose} zClassName="itops-page">
      <Sheet
        width={860}
        title={t("itops.networkMap.strandEditorTitle")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("common.cancel")}</Btn>}
            primary={
              <Btn
                kind="primary"
                icon="check"
                disabled={!canSave}
                onClick={() =>
                  onSave(draft.link, [draft.fromNode, draft.toNode])
                }
              >
                {t("common.save")}
              </Btn>
            }
          />
        }
      >
        <div className="nm-member-editor-heading">
          <span>{t("itops.networkMap.linkBetween", {
            from: nodeLabel(draft.fromNode, t("itops.networkMap.unnamedNode")),
            to: nodeLabel(draft.toNode, t("itops.networkMap.unnamedNode")),
          })}</span>
          <button
            type="button"
            className="nm-strand-add"
            disabled={draft.link.strands.length >= MAX_STRANDS}
            onClick={() =>
              setDraft((current) => {
                const next = appendBoundStrand(
                  current.link,
                  current.fromNode,
                  current.toNode,
                  current.link.strands[current.link.strands.length - 1]?.speed ?? "",
                );
                return {
                  link: next.link,
                  fromNode: next.fromNode,
                  toNode: next.toNode,
                  generatedInterfaceIds: new Set([
                    ...current.generatedInterfaceIds,
                    ...next.generatedInterfaceIds,
                  ]),
                };
              })
            }
          >
            <ItIcon name="plus" size={12} />
            {t("itops.networkMap.strandAdd")}
          </button>
        </div>
        <div className="nm-member-grid" role="table">
          <div className="nm-member-grid-head" role="row">
            <span role="columnheader">#</span>
            <span role="columnheader">{fromInterfaceLabel}</span>
            <span role="columnheader">{toInterfaceLabel}</span>
            <span role="columnheader">{t("itops.networkMap.strandSpeedLabel")}</span>
            <span role="columnheader" aria-label={t("itops.networkMap.strandRemove")} />
          </div>
          <div className="nm-member-grid-body" role="rowgroup">
            {draft.link.strands.map((strand, index) => {
              const fromInterface = draft.fromNode.interfaces.find(
                (entry) => entry.id === strand.fromInterfaceId,
              );
              const toInterface = draft.toNode.interfaces.find(
                (entry) => entry.id === strand.toInterfaceId,
              );
              return (
                <div key={strand.id} className="nm-member-grid-row" role="row">
                  <span className="nm-member-grid-index" role="cell">
                    {index + 1}
                  </span>
                  <div className="nm-member-interface-cell" role="cell">
                    <TextInput
                      mono
                      value={fromInterface?.name ?? ""}
                      aria-label={fromInterfaceLabel}
                      placeholder={t("itops.networkMap.strandNamePlaceholder")}
                      onChange={(event) => {
                        const name = event.currentTarget.value;
                        if (strand.fromInterfaceId) {
                          patchInterface("from", strand.fromInterfaceId, name);
                        }
                      }}
                    />
                    {fromInterface?.address ? <small>{fromInterface.address}</small> : null}
                  </div>
                  <div className="nm-member-interface-cell" role="cell">
                    <TextInput
                      mono
                      value={toInterface?.name ?? ""}
                      aria-label={toInterfaceLabel}
                      placeholder={t("itops.networkMap.strandNamePlaceholder")}
                      onChange={(event) => {
                        const name = event.currentTarget.value;
                        if (strand.toInterfaceId) {
                          patchInterface("to", strand.toInterfaceId, name);
                        }
                      }}
                    />
                    {toInterface?.address ? <small>{toInterface.address}</small> : null}
                  </div>
                  <div role="cell">
                    <TextInput
                      mono
                      list={speedListId}
                      value={strand.speed}
                      aria-label={t("itops.networkMap.strandSpeedLabel")}
                      placeholder={t("itops.networkMap.strandSpeedPlaceholder")}
                      onChange={(event) => {
                        const speed = event.currentTarget.value;
                        setDraft((current) => ({
                          ...current,
                          link: {
                            ...current.link,
                            strands: current.link.strands.map((entry) =>
                              entry.id === strand.id ? { ...entry, speed } : entry,
                            ),
                          },
                        }));
                      }}
                    />
                  </div>
                  <button
                    type="button"
                    className="nm-strand-remove"
                    disabled={draft.link.strands.length <= 1}
                    aria-label={t("itops.networkMap.strandRemove")}
                    title={t("itops.networkMap.strandRemove")}
                    onClick={() => removeStrand(strand)}
                  >
                    <ItIcon name="trash" size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <datalist id={speedListId}>
          {COMMON_LINK_SPEEDS.map((speed) => (
            <option key={speed} value={speed} />
          ))}
        </datalist>
        <span className="kk-hint">{t("itops.networkMap.strandsHint")}</span>
      </Sheet>
    </DialogShell>
  );
}

function LinkPropertiesFields({
  link,
  nodesById,
  vlans,
  onChange,
  onEditMembers,
}: {
  link: NetworkLink;
  nodesById: Map<string, NetworkNode>;
  vlans: Vlan[];
  onChange: (link: NetworkLink) => void;
  onEditMembers: () => void;
}) {
  const { t } = useTranslation();
  const unnamed = t("itops.networkMap.unnamedNode");
  const vlanIndex = useMemo(() => vlansById(vlans), [vlans]);
  const patch = (change: Partial<NetworkLink>) => onChange({ ...link, ...change });

  return (
    <>
      <p className="au-side-hint">
        {t("itops.networkMap.linkBetween", {
          from: endpointName(nodesById, link.from, unnamed),
          to: endpointName(nodesById, link.to, unnamed),
        })}
      </p>
      <Field
        label={t("itops.networkMap.linkLabelLabel")}
        hint={t("itops.networkMap.linkLabelHint")}
      >
        <TextInput
          value={link.label}
          placeholder={t("itops.networkMap.linkLabelPlaceholder")}
          onChange={(event) => patch({ label: event.currentTarget.value })}
          autoFocus
        />
      </Field>
      <Field label={t("itops.networkMap.linkKindLabel")}>
        <ChoiceGrid
          value={link.kind}
          onChange={(value) => patch({ kind: value as NetworkLinkKind })}
          options={LINK_KINDS.map((kind, index) => ({
            value: kind,
            label: t(`itops.networkMap.linkKind.${kind}`),
            icon: (["link", "pulse", "globe", "network"] as ItIconName[])[index],
          }))}
        />
      </Field>
      <Field label={t("itops.networkMap.statusLabel")}>
        <ChoiceGrid
          value={link.status ?? "up"}
          onChange={(value) => patch({ status: value as NetworkLinkStatus })}
          options={[
            {
              value: "up",
              label: t("itops.networkMap.status.up"),
              icon: "check",
            },
            {
              value: "warning",
              label: t("itops.networkMap.status.warning"),
              icon: "alert",
            },
            {
              value: "down",
              label: t("itops.networkMap.status.down"),
              icon: "stop",
            },
          ]}
        />
      </Field>
      <Field label={t("itops.networkMap.strandDisplayLabel")}>
        <ChoiceGrid
          value={link.strandDisplay ?? "separate"}
          onChange={(value) =>
            patch({ strandDisplay: value as NetworkLinkStrandDisplay })
          }
          options={[
            {
              value: "separate",
              label: t("itops.networkMap.strandDisplaySeparate"),
              icon: "rows",
            },
            {
              value: "bundle",
              label: t("itops.networkMap.strandDisplayBundle"),
              icon: "link",
            },
          ]}
        />
      </Field>
      <Field
        label={t("itops.networkMap.strandsLabel")}
        hint={t("itops.networkMap.strandsHint")}
      >
        <button
          type="button"
          className="nm-member-count"
          onClick={onEditMembers}
          aria-label={t("itops.networkMap.strandEditAction", {
            count: Math.max(link.strands.length, 1),
          })}
        >
          <span className="nm-member-count-icon">
            <ItIcon name="rows" size={16} />
          </span>
          <span className="nm-member-count-copy">
            <strong>
              {t("itops.networkMap.strandCount", {
                count: Math.max(link.strands.length, 1),
              })}
            </strong>
            <small>{t("itops.networkMap.strandEditHint")}</small>
          </span>
          <ItIcon name="chevR" size={14} />
        </button>
      </Field>
      <Field
        label={t("itops.networkMap.nativeVlanLabel")}
        hint={t("itops.networkMap.nativeVlanHint")}
      >
        <Select
          value={link.nativeVlanId ?? ""}
          onChange={(event) => {
            const nativeVlanId = event.currentTarget.value || null;
            patch({
              nativeVlanId,
              taggedVlanIds: link.taggedVlanIds.filter((id) => id !== nativeVlanId),
            });
          }}
          options={[
            { value: "", label: t("itops.networkMap.vlanNone") },
            ...(link.nativeVlanId && !vlanIndex.has(link.nativeVlanId)
              ? [
                  {
                    value: link.nativeVlanId,
                    label: t("itops.vlan.optionLabel", {
                      label: t("itops.networkMap.vlanUnknownShort"),
                    }),
                  },
                ]
              : []),
            ...vlans.map((vlan) => ({
              value: vlan.id,
              label: t("itops.vlan.optionLabel", { label: vlanLabel(vlan) }),
            })),
          ]}
        />
      </Field>
      <div className="nm-vlan-picker">
        <span className="kk-lbl">{t("itops.networkMap.taggedVlanLabel")}</span>
        {vlans.length > 0 ||
        link.taggedVlanIds.some((id) => !vlanIndex.has(id)) ? (
          <div
            className="nm-vlan-options"
            role="group"
            aria-label={t("itops.networkMap.taggedVlanLabel")}
          >
            {vlans.map((vlan) => {
              const isNative = link.nativeVlanId === vlan.id;
              const on = link.taggedVlanIds.includes(vlan.id);
              return (
                <button
                  key={vlan.id}
                  type="button"
                  className="nm-vlan-option"
                  aria-pressed={on}
                  disabled={isNative}
                  title={isNative ? t("itops.networkMap.vlanIsNative") : undefined}
                  style={{ "--nm-vlan-accent": vlanAccent(vlan) } as CSSProperties}
                  onClick={() =>
                    patch({
                      taggedVlanIds: on
                        ? link.taggedVlanIds.filter((id) => id !== vlan.id)
                        : [...link.taggedVlanIds, vlan.id],
                    })
                  }
                >
                  {vlanLabel(vlan)}
                </button>
              );
            })}
            {link.taggedVlanIds
              .filter((id) => !vlanIndex.has(id))
              .map((id) => (
                <button
                  key={id}
                  type="button"
                  className="nm-vlan-option"
                  aria-pressed="true"
                  title={id}
                  onClick={() =>
                    patch({
                      taggedVlanIds: link.taggedVlanIds.filter((entry) => entry !== id),
                    })
                  }
                >
                  {t("itops.networkMap.vlanUnknownShort")}
                </button>
              ))}
          </div>
        ) : (
          <span className="kk-hint">{t("itops.networkMap.vlanEmptyHint")}</span>
        )}
        <span className="kk-hint">{t("itops.networkMap.taggedVlanHint")}</span>
      </div>
    </>
  );
}

function LinkPropertiesDialog({
  link,
  nodesById,
  vlans,
  onSubmit,
  onDelete,
  onClose,
}: {
  link: NetworkLink;
  nodesById: Map<string, NetworkNode>;
  vlans: Vlan[];
  onSubmit: (link: NetworkLink, endpointNodes: NetworkNode[]) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(link);
  const [endpointNodes, setEndpointNodes] = useState(() =>
    [link.from, link.to]
      .map((id) => nodesById.get(id))
      .filter((node): node is NetworkNode => Boolean(node))
      .map((node) => ({ ...node, interfaces: [...node.interfaces] })),
  );
  const [membersOpen, setMembersOpen] = useState(false);
  const draftNodesById = useMemo(() => {
    const next = new Map(nodesById);
    for (const node of endpointNodes) next.set(node.id, node);
    return next;
  }, [endpointNodes, nodesById]);
  const fromNode = draftNodesById.get(link.from);
  const toNode = draftNodesById.get(link.to);
  return (
    <>
      <DialogShell onBackdrop={onClose} zClassName="itops-page">
        <Sheet
          width={680}
          title={t("itops.networkMap.linkHeading")}
          footer={
            <Actions
              extraLeft={
                onDelete ? (
                  <Btn
                    kind="danger"
                    icon="trash"
                    onClick={() => {
                      onDelete();
                      onClose();
                    }}
                  >
                    {t("itops.networkMap.removeLink")}
                  </Btn>
                ) : undefined
              }
              cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
              primary={
                <Btn
                  kind="primary"
                  onClick={() => {
                    onSubmit(draft, endpointNodes);
                    onClose();
                  }}
                >
                  {t("itops.actions.save")}
                </Btn>
              }
            />
          }
        >
          <LinkPropertiesFields
            link={draft}
            nodesById={draftNodesById}
            vlans={vlans}
            onChange={setDraft}
            onEditMembers={() => setMembersOpen(true)}
          />
        </Sheet>
      </DialogShell>
      {membersOpen && fromNode && toNode ? (
        <LinkMembersEditor
          link={draft}
          fromNode={fromNode}
          toNode={toNode}
          onClose={() => setMembersOpen(false)}
          onSave={(nextLink, nextEndpointNodes) => {
            setDraft(nextLink);
            setEndpointNodes(nextEndpointNodes);
            setMembersOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export function NetworkMapPropertiesDialog({
  map,
  duplicateOf,
  duplicateName,
  onSaved,
  onClose,
}: {
  map: NetworkMap | null;
  duplicateOf?: NetworkMap | null;
  duplicateName?: string;
  onSaved: (saved: NetworkMap) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createNetworkMap = useItOpsStore((state) => state.createNetworkMap);
  const saveNetworkMap = useItOpsStore((state) => state.saveNetworkMap);
  const sites = useItOpsStore((state) => state.sites);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const sourceMap = map ?? duplicateOf;
  const isProperties = !!sourceMap;
  const [name, setName] = useState(duplicateName ?? sourceMap?.name ?? "");
  const [description, setDescription] = useState(sourceMap?.description ?? "");
  const [siteId, setSiteId] = useState(sourceMap?.siteId ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const saved = duplicateOf
        ? await createNetworkMap(
            name.trim(),
            description,
            siteId || null,
            duplicateOf.graph,
          )
        : map
          ? await saveNetworkMap(map.id, name.trim(), description, siteId || null, map.graph)
          : await createNetworkMap(name.trim(), description, siteId || null);
      onSaved(saved);
      onClose();
    } catch (error) {
      showStatusBarNotice(t("itops.errorNotice", { message: errorMessage(error) }), {
        tone: "error",
      });
      setBusy(false);
    }
  }

  return (
    <DialogShell onBackdrop={onClose}>
      <Sheet
        width={480}
        title={isProperties ? t("common.properties") : t("itops.networkMap.newMapTitle")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              <Btn kind="primary" icon="check" onClick={() => void save()} disabled={!name.trim() || busy}>
                {t(isProperties ? "itops.actions.save" : "itops.actions.create")}
              </Btn>
            }
          />
        }
      >
        <Field label={t("itops.networkMap.nameLabel")} req>
          <TextInput
            value={name}
            placeholder={t("itops.networkMap.namePlaceholder")}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </Field>
        <Field label={t("itops.networkMap.siteLabel")} hint={t("itops.networkMap.siteHint")}>
          <Select
            value={siteId}
            onChange={(event) => setSiteId(event.currentTarget.value)}
            options={[
              { value: "", label: t("itops.networkMap.siteUnscoped") },
              ...sites.map((site) => ({ value: site.id, label: site.name })),
            ]}
          />
        </Field>
        <Field label={t("itops.networkMap.descriptionLabel")}>
          <TextArea
            rows={3}
            value={description}
            onChange={(event) => setDescription(event.currentTarget.value)}
          />
        </Field>
      </Sheet>
    </DialogShell>
  );
}

/** Seed a map from a Site's Hosts, so a first map is not a blank canvas. */
function ImportDialog({
  onImport,
  onClose,
}: {
  onImport: (hosts: SiteHost[]) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sites = useItOpsStore((state) => state.sites);
  const hostsBySite = useItOpsStore((state) => state.hostsBySite);
  const loadHosts = useItOpsStore((state) => state.loadHosts);
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");

  useEffect(() => {
    if (siteId && !hostsBySite[siteId]) void loadHosts(siteId).catch(() => undefined);
  }, [hostsBySite, loadHosts, siteId]);

  const hosts = hostsBySite[siteId] ?? [];
  return (
    <DialogShell onBackdrop={onClose}>
      <Sheet
        width={460}
        title={t("itops.networkMap.importTitle")}
        sub={t("itops.networkMap.importSub")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              <Btn
                kind="primary"
                icon="download"
                disabled={hosts.length === 0}
                onClick={() => {
                  onImport(hosts);
                  onClose();
                }}
              >
                {t("itops.networkMap.importAction", { count: hosts.length })}
              </Btn>
            }
          />
        }
      >
        <Field label={t("itops.networkMap.importSiteLabel")}>
          <Select
            value={siteId}
            onChange={(event) => setSiteId(event.currentTarget.value)}
            options={sites.map((site) => ({ value: site.id, label: site.name }))}
          />
        </Field>
        <p className="au-side-hint">
          {hosts.length > 0
            ? t("itops.networkMap.importCount", { count: hosts.length })
            : t("itops.networkMap.importEmpty")}
        </p>
      </Sheet>
    </DialogShell>
  );
}

function NodeDeepLinksPopover({
  node,
  anchor,
  catalog,
  onNavigate,
  onClose,
}: {
  node: NetworkNode;
  anchor: DOMRect;
  catalog: NetworkMapDeepLinkCatalog;
  onNavigate: (link: NetworkNodeDeepLink) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    const bounds = popover.getBoundingClientRect();
    const viewportPad = 8;
    const gap = 8;
    let left = anchor.right + gap;
    if (left + bounds.width > window.innerWidth - viewportPad) {
      left = anchor.left - bounds.width - gap;
    }
    setPosition({
      left: Math.max(
        viewportPad,
        Math.min(left, window.innerWidth - bounds.width - viewportPad),
      ),
      top: Math.max(
        viewportPad,
        Math.min(anchor.top, window.innerHeight - bounds.height - viewportPad),
      ),
    });
  }, [anchor, node.deepLinks]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <DialogPortal>
      <div className="nm-deep-link-backdrop" onPointerDown={onClose} />
      <div
        ref={popoverRef}
        className="nm-deep-link-popover"
        role="dialog"
        aria-label={t("itops.networkMap.deepLinksPopupLabel", {
          name: nodeLabel(node, t("itops.networkMap.unnamedNode")),
        })}
        style={
          position
            ? { top: position.top, left: position.left }
            : { top: anchor.top, left: anchor.right + 8, visibility: "hidden" }
        }
      >
        <div className="nm-deep-link-popover-head">
          <ItIcon name="link" size={13} />
          <strong>{t("itops.networkMap.deepLinksLabel")}</strong>
          <span>{node.deepLinks.length}</span>
        </div>
        <div className="nm-deep-link-popover-rows">
          {node.deepLinks.map((link) => {
            const target = resolveDeepLink(link, catalog, t);
            return (
              <button
                type="button"
                key={link.id}
                className="nm-deep-link-popover-row"
                disabled={!target.available}
                onClick={() => {
                  onClose();
                  onNavigate(link);
                }}
              >
                <span className="nm-deep-link-row-icon">
                  <ItIcon name={target.icon} size={14} />
                </span>
                <span className="nm-deep-link-row-copy">
                  <strong>{target.label}</strong>
                  <small>{target.detail}</small>
                </span>
                {target.available ? <ItIcon name="chevR" size={12} /> : null}
              </button>
            );
          })}
        </div>
      </div>
    </DialogPortal>
  );
}

type Selection =
  | { kind: "link"; id: string }
  | { kind: "canvas"; items: NetworkMapCanvasSelectionItem[] }
  | null;
type PlacementDraft =
  | { kind: "node"; node: NetworkNode; root: boolean }
  | { kind: "note"; note: NetworkMapNote };
type NodeDialogRequest = {
  node: NetworkNode;
  root: boolean;
  placement: boolean;
};
type NoteDialogRequest = {
  note: NetworkMapNote;
  placement: boolean;
};
type LinkDialogRequest = {
  link: NetworkLink;
};

function MapEditor({
  map,
  onOpenProperties,
  deepLinkCatalog,
  onNavigateDeepLink,
}: {
  map: NetworkMap;
  onOpenProperties: (map: NetworkMap) => void;
  deepLinkCatalog: NetworkMapDeepLinkCatalog;
  onNavigateDeepLink: (link: NetworkNodeDeepLink) => void;
}) {
  const { t } = useTranslation();
  const saveNetworkMap = useItOpsStore((state) => state.saveNetworkMap);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);

  const [graph, setGraph] = useState<NetworkGraph>(map.graph);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(map.graph));
  const graphRef = useRef(graph);
  const savedJsonRef = useRef(savedJson);
  const [objectBrowserOpen, setObjectBrowserOpen] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [importing, setImporting] = useState(false);
  const [nodeDialog, setNodeDialog] = useState<NodeDialogRequest | null>(null);
  const [noteDialog, setNoteDialog] = useState<NoteDialogRequest | null>(null);
  const [linkDialog, setLinkDialog] = useState<LinkDialogRequest | null>(null);
  const [deepLinkPopup, setDeepLinkPopup] = useState<{
    nodeId: string;
    anchor: DOMRect;
  } | null>(null);
  const [placementDraft, setPlacementDraft] = useState<PlacementDraft | null>(null);
  const [placementPoint, setPlacementPoint] = useState<{ x: number; y: number } | null>(null);
  const [dragAnchorNodes, setDragAnchorNodes] = useState<NetworkNode[] | null>(null);
  const renderedNodesRef = useRef<Node<MapNodeData | MapNoteData>[]>([]);
  const suppressPlacementClickRef = useRef(false);
  // Which VLAN the overlay spotlights. Purely a view filter: it never edits the
  // graph and never feeds the reachability analysis, which stays VLAN-blind.
  const [spotlightVlanId, setSpotlightVlanId] = useState<string | null>(null);
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null);

  function cancelPlacement() {
    setPlacementDraft(null);
    setPlacementPoint(null);
  }

  useEffect(() => {
    if (!placementDraft) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelPlacement();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".nm-canvas")) return;
      cancelPlacement();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [placementDraft]);

  const vlans = useItOpsStore((state) => state.vlans);
  const vlansLoaded = useItOpsStore((state) => state.vlansLoaded);
  const loadVlans = useItOpsStore((state) => state.loadVlans);
  useEffect(() => {
    if (!vlansLoaded) void loadVlans().catch(() => undefined);
  }, [loadVlans, vlansLoaded]);
  const vlanIndex = useMemo(() => vlansById(vlans), [vlans]);

  // How many links carry each VLAN. Drives the legend's counts and keeps VLANs
  // this map never mentions out of the spotlight list — the global record set
  // is deliberately larger than any one drawing.
  const vlanUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const link of graph.links) {
      for (const id of new Set(
        [link.nativeVlanId, ...link.taggedVlanIds].filter(
          (value): value is string => Boolean(value),
        ),
      )) {
        counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    }
    return counts;
  }, [graph.links]);

  // A VLAN removed from the map (or from the global list) must not leave the
  // canvas stuck dimmed against a filter the operator can no longer see.
  useEffect(() => {
    if (
      spotlightVlanId &&
      (!vlanUsage.has(spotlightVlanId) || !vlanIndex.has(spotlightVlanId))
    ) {
      setSpotlightVlanId(null);
    }
  }, [spotlightVlanId, vlanIndex, vlanUsage]);

  // With view and edit unified, canvas changes no longer wait for a mode toggle
  // to persist. Debounce live drag/resize events into one durable save while
  // leaving newer local changes intact if they arrive during the request.
  useEffect(() => {
    const submittedJson = JSON.stringify(graph);
    if (submittedJson === savedJson) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void saveNetworkMap(
        map.id,
        map.name,
        map.description,
        map.siteId ?? null,
        graph,
      )
        .then((saved) => {
          if (!active) return;
          const persistedJson = JSON.stringify(saved.graph);
          setSavedJson(persistedJson);
          setGraph((current) =>
            JSON.stringify(current) === submittedJson ? saved.graph : current,
          );
        })
        .catch((error) => {
          if (!active) return;
          showStatusBarNotice(t("itops.errorNotice", { message: errorMessage(error) }), {
            tone: "error",
          });
        });
    }, 350);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [graph, map.description, map.id, map.name, map.siteId, saveNetworkMap, savedJson, showStatusBarNotice, t]);

  useEffect(() => {
    graphRef.current = graph;
    savedJsonRef.current = savedJson;
  }, [graph, savedJson]);

  useEffect(
    () => () => {
      const latestGraph = graphRef.current;
      if (JSON.stringify(latestGraph) === savedJsonRef.current) return;
      void saveNetworkMap(
        map.id,
        map.name,
        map.description,
        map.siteId ?? null,
        latestGraph,
      ).catch((error) => {
        showStatusBarNotice(t("itops.errorNotice", { message: errorMessage(error) }), {
          tone: "error",
        });
      });
    },
    [map.description, map.id, map.name, map.siteId, saveNetworkMap, showStatusBarNotice, t],
  );

  const analysis = useMemo(
    () => analyzeWhatIf(graph, { nodes: [], links: [] }),
    [graph],
  );
  const rootIds = useMemo(() => new Set(effectiveRoots(graph)), [graph]);
  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );
  // Keep each Link attached to the same pair of side handles while a node is
  // moving. React Flow can then update the existing SVG path from its live node
  // coordinates instead of receiving a rebuilt Edge on every drag frame,
  // which preserves the link's CSS animation until the drag settles.
  const edgeAnchorNodes = dragAnchorNodes ?? graph.nodes;
  const edgeNodesById = useMemo(
    () => new Map(edgeAnchorNodes.map((node) => [node.id, node])),
    [edgeAnchorNodes],
  );
  const severedLinkSignature = analysis.severedLinks.join("\u0000");
  const severedLinkIds = useMemo(
    () => new Set(severedLinkSignature ? severedLinkSignature.split("\u0000") : []),
    [severedLinkSignature],
  );
  const openDeepLinks = useCallback((nodeId: string, anchor: DOMRect) => {
    setDeepLinkPopup({ nodeId, anchor });
  }, []);

  const unnamed = t("itops.networkMap.unnamedNode");
  const nodes = useMemo<Node<MapNodeData | MapNoteData>[]>(() => {
    const downSet = new Set(analysis.down);
    const isolatedSet = new Set(analysis.isolated);
    const selectedItems = selection?.kind === "canvas" ? selection.items : [];
    const noteNodes: Node<MapNoteData>[] = graph.notes.map((note) => {
      const selected = selectedItems.some((item) =>
        sameNetworkMapCanvasItem(item, { kind: "note", id: note.id }),
      );
      return {
        id: note.id,
        type: "networkNote",
        position: { x: note.x, y: note.y },
        width: note.width,
        height: note.height,
        draggable: !note.locked,
        selected,
        zIndex: 1,
        data: {
          text: note.text || t("itops.networkMap.notePlaceholder"),
          accent: noteAccent(note),
          selected,
          resizable: !note.locked,
          locked: Boolean(note.locked),
        },
      };
    });
    const deviceNodes: Node<MapNodeData>[] = graph.nodes.map((node) => {
      const selected = selectedItems.some((item) =>
        sameNetworkMapCanvasItem(item, { kind: "node", id: node.id }),
      );
      return {
        id: node.id,
        type: "networkNode",
        position: { x: node.x, y: node.y },
        width: node.width,
        height: node.height,
        draggable: !node.locked,
        connectable: node.kind !== "geomap",
        selected,
        zIndex: node.kind === "geomap" ? 0 : 3,
        data: {
          id: node.id,
          label: nodeLabel(node, unnamed),
          sub:
            node.interfaces.map((entry) => entry.address).filter(Boolean).join(" · ") ||
            t(`itops.networkMap.nodeKind.${node.kind}`),
          note: node.note,
          kind: node.kind,
          iconKind: nodeArtworkKind(node),
          state: downSet.has(node.id)
            ? "down"
            : isolatedSet.has(node.id)
              ? "isolated"
              : node.status === "warning"
                ? "warning"
                : "up",
          root: rootIds.has(node.id),
          selected,
          rootLabel: t("itops.networkMap.rootBadge"),
          warningLabel: t("itops.networkMap.status.warning"),
          accent: nodeAccent(node),
          resizable: !node.locked,
          locked: Boolean(node.locked),
          geomapViewport: geomapViewport(node),
          deepLinks: node.deepLinks,
          deepLinksPopupLabel: t("itops.networkMap.deepLinksPopupLabel", {
            name: nodeLabel(node, unnamed),
          }),
          onOpenDeepLinks: openDeepLinks,
        },
      };
    });
    if (placementDraft && placementPoint) {
      if (placementDraft.kind === "node") {
        const node = placementDraft.node;
        deviceNodes.push({
          id: node.id,
          type: "networkNode",
          position: placementPoint,
          width: node.width,
          height: node.height,
          zIndex: 4,
          className: "nm-placement-ghost-node",
          draggable: false,
          selectable: false,
          connectable: false,
          focusable: false,
          data: {
            id: node.id,
            label: nodeLabel(node, unnamed),
            sub:
              node.interfaces.map((entry) => entry.address).filter(Boolean).join(" · ") ||
              t(`itops.networkMap.nodeKind.${node.kind}`),
            note: node.note,
            kind: node.kind,
            iconKind: nodeArtworkKind(node),
            state: node.status === "warning" ? "warning" : "up",
            root: placementDraft.root,
            selected: false,
            rootLabel: t("itops.networkMap.rootBadge"),
            warningLabel: t("itops.networkMap.status.warning"),
            accent: nodeAccent(node),
            resizable: false,
            locked: false,
            geomapViewport: geomapViewport(node),
            deepLinks: node.deepLinks,
            deepLinksPopupLabel: t("itops.networkMap.deepLinksPopupLabel", {
              name: nodeLabel(node, unnamed),
            }),
            ghost: true,
          },
        });
      } else {
        const note = placementDraft.note;
        noteNodes.push({
          id: note.id,
          type: "networkNote",
          position: placementPoint,
          width: note.width,
          height: note.height,
          zIndex: 4,
          className: "nm-placement-ghost-node",
          draggable: false,
          selectable: false,
          focusable: false,
          data: {
            text: note.text || t("itops.networkMap.notePlaceholder"),
            accent: noteAccent(note),
            selected: false,
            resizable: false,
            locked: false,
            ghost: true,
          },
        });
      }
    }
    const reconciled = reconcileNetworkMapFlowNodes(
      renderedNodesRef.current,
      [...noteNodes, ...deviceNodes],
    );
    renderedNodesRef.current = reconciled;
    return reconciled;
  }, [
    analysis.down,
    analysis.isolated,
    graph.nodes,
    graph.notes,
    openDeepLinks,
    placementDraft,
    placementPoint,
    rootIds,
    selection,
    t,
    unnamed,
  ]);

  const edges = useMemo<Edge<NetworkLinkEdgeData>[]>(() => {
    return graph.links.flatMap((link) => {
      const from = edgeNodesById.get(link.from);
      const to = edgeNodesById.get(link.to);
      if (!from || !to) return [];
      const { source, target } = anchors(from, to);
      const state = severedLinkIds.has(link.id)
        ? "severed"
        : link.status === "down"
          ? "down"
          : link.status === "warning"
            ? "warning"
            : "up";
      const strandCount = Math.max(link.strands.length, 1);
      const label = [
        link.label.trim(),
        link.strandDisplay === "bundle" && strandCount > 1 ? `×${strandCount}` : "",
        vlanChip(link, vlanIndex, t),
      ]
        .filter(Boolean)
        .join(" · ");
      const trunk = link.taggedVlanIds.length > 0;
      const spotlit = spotlightVlanId ? linkCarriesVlan(link, spotlightVlanId) : true;
      const spotlightVlan = spotlightVlanId ? vlanIndex.get(spotlightVlanId) : undefined;
      return [
        {
          id: link.id,
          type: "networkLink",
          source: link.from,
          target: link.to,
          sourceHandle: source,
          targetHandle: target,
          zIndex: 2,
          className: `nm-edge ${link.kind} ${state}${strandCount > 1 ? " multi" : ""}${
            selection?.kind === "link" && selection.id === link.id ? " sel" : ""
          }${spotlightVlanId && !spotlit ? " dimmed" : ""}`,
          data: {
            kind: link.kind,
            state,
            strandCount,
            strands: link.strands,
            strandDisplay: link.strandDisplay ?? "separate",
            label,
            trunk,
            spotlightAccent:
              spotlit && spotlightVlan ? vlanAccent(spotlightVlan) : null,
          },
        },
      ];
    });
  }, [
    edgeNodesById,
    graph.links,
    selection,
    severedLinkIds,
    spotlightVlanId,
    t,
    vlanIndex,
  ]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setGraph((current) => applyNetworkMapCanvasNodeChanges(current, changes));
  }, []);

  const onConnect = useCallback((connection: FlowConnection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    setGraph((current) => {
      const exists = current.links.some(
        (link) =>
          (link.from === connection.source && link.to === connection.target) ||
          (link.from === connection.target && link.to === connection.source),
      );
      if (exists) return current;
      const fromNode = current.nodes.find((node) => node.id === connection.source);
      const toNode = current.nodes.find((node) => node.id === connection.target);
      if (
        !fromNode ||
        !toNode ||
        fromNode.kind === "geomap" ||
        toNode.kind === "geomap"
      ) {
        return current;
      }
      const id = newId("nml");
      const baseLink: NetworkLink = {
        id,
        from: connection.source!,
        to: connection.target!,
        label: "",
        kind: "ethernet",
        strands: [],
        strandDisplay: "separate",
        nativeVlanId: null,
        taggedVlanIds: [],
        status: "up",
      };
      // Drawing a cable implies one physical member and therefore one interface
      // at each endpoint. The member editor can rename those generated ports.
      const created = appendBoundStrand(baseLink, fromNode, toNode);
      return {
        ...current,
        nodes: current.nodes.map((node) =>
          node.id === created.fromNode.id
            ? created.fromNode
            : node.id === created.toNode.id
              ? created.toNode
              : node,
        ),
        links: [...current.links, created.link],
      };
    });
  }, []);

  function configureNewNode(kind: NetworkNodeKind) {
    cancelPlacement();
    setSelection(null);
    setNodeDialog({ node: newNodeDraft(kind), root: false, placement: true });
  }

  function configureNewNote() {
    cancelPlacement();
    setSelection(null);
    setNoteDialog({ note: newNoteDraft(), placement: true });
  }

  function armNodePlacement(node: NetworkNode, root: boolean) {
    setPlacementPoint(null);
    setPlacementDraft({ kind: "node", node, root });
    setSelection(null);
  }

  function armNotePlacement(note: NetworkMapNote) {
    setPlacementPoint(null);
    setPlacementDraft({ kind: "note", note });
    setSelection(null);
  }

  function placeDraftAt(clientX: number, clientY: number) {
    if (!placementDraft || !flowInstance) return;
    const cursor = flowInstance.screenToFlowPosition({ x: clientX, y: clientY });
    if (placementDraft.kind === "node") {
      const node = {
        ...placementDraft.node,
        x: Math.round(cursor.x - placementDraft.node.width / 2),
        y: Math.round(cursor.y - placementDraft.node.height / 2),
      };
      setGraph((current) => ({
        ...current,
        nodes: [...current.nodes, node],
        roots: placementDraft.root ? [...current.roots, node.id] : current.roots,
      }));
      setSelection({ kind: "canvas", items: [{ kind: "node", id: node.id }] });
    } else {
      const note = {
        ...placementDraft.note,
        x: Math.round(cursor.x - placementDraft.note.width / 2),
        y: Math.round(cursor.y - placementDraft.note.height / 2),
      };
      setGraph((current) => ({ ...current, notes: [...current.notes, note] }));
      setSelection({ kind: "canvas", items: [{ kind: "note", id: note.id }] });
    }
    cancelPlacement();
  }

  function updatePlacementPoint(clientX: number, clientY: number) {
    if (!placementDraft || !flowInstance) return;
    const cursor = flowInstance.screenToFlowPosition({ x: clientX, y: clientY });
    const element = placementDraft.kind === "node" ? placementDraft.node : placementDraft.note;
    setPlacementPoint({
      x: cursor.x - element.width / 2,
      y: cursor.y - element.height / 2,
    });
  }

  function updateNodeProperties(node: NetworkNode, root: boolean) {
    const retained = new Set(node.interfaces.map((entry) => entry.id));
    const nextGraph = {
      ...graph,
      nodes: graph.nodes.map((entry) => (entry.id === node.id ? node : entry)),
      links: graph.links.map((link) => ({
        ...link,
        strands: link.strands.map((strand) => ({
          ...strand,
          fromInterfaceId:
            link.from === node.id &&
            strand.fromInterfaceId &&
            !retained.has(strand.fromInterfaceId)
              ? null
              : strand.fromInterfaceId,
          toInterfaceId:
            link.to === node.id &&
            strand.toInterfaceId &&
            !retained.has(strand.toInterfaceId)
              ? null
              : strand.toInterfaceId,
        })),
      })),
      roots: root
        ? graph.roots.includes(node.id)
          ? graph.roots
          : [...graph.roots, node.id]
        : graph.roots.filter((id) => id !== node.id),
    };
    setGraph(nextGraph);
  }

  function patchNote(id: string, patch: Partial<NetworkMapNote>) {
    const nextGraph = {
      ...graph,
      notes: graph.notes.map((note) => (note.id === id ? { ...note, ...patch } : note)),
    };
    setGraph(nextGraph);
  }

  function updateLinkProperties(
    link: NetworkLink,
    endpointNodes: NetworkNode[],
  ) {
    const nodeUpdates = new Map(endpointNodes.map((node) => [node.id, node]));
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => nodeUpdates.get(node.id) ?? node),
      links: current.links.map((entry) => (entry.id === link.id ? link : entry)),
    }));
  }

  function removeNode(id: string) {
    if (graph.nodes.find((node) => node.id === id)?.locked) return;
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => node.id !== id),
      // A node's links go with it, and it stops being an entry point.
      links: current.links.filter((link) => link.from !== id && link.to !== id),
      roots: current.roots.filter((root) => root !== id),
    }));
    setSelection(null);
  }

  function removeLink(id: string) {
    setGraph((current) => ({ ...current, links: current.links.filter((link) => link.id !== id) }));
    setSelection(null);
  }

  function removeNote(id: string) {
    if (graph.notes.find((note) => note.id === id)?.locked) return;
    setGraph((current) => ({ ...current, notes: current.notes.filter((note) => note.id !== id) }));
    setSelection(null);
  }

  function openNodeProperties(id: string) {
    const node = graph.nodes.find((entry) => entry.id === id);
    if (!node) return;
    setSelection({ kind: "canvas", items: [{ kind: "node", id }] });
    setNodeDialog({
      node,
      root: graph.roots.includes(id),
      placement: false,
    });
  }

  function openNoteProperties(id: string) {
    const note = graph.notes.find((entry) => entry.id === id);
    if (!note) return;
    setSelection({ kind: "canvas", items: [{ kind: "note", id }] });
    setNoteDialog({ note, placement: false });
  }

  function openLinkProperties(id: string) {
    const link = graph.links.find((entry) => entry.id === id);
    if (!link) return;
    setSelection({ kind: "link", id });
    setLinkDialog({ link });
  }

  function canvasItemLocked(item: NetworkMapCanvasSelectionItem): boolean {
    return item.kind === "node"
      ? Boolean(graph.nodes.find((node) => node.id === item.id)?.locked)
      : Boolean(graph.notes.find((note) => note.id === item.id)?.locked);
  }

  function setCanvasItemsLocked(
    items: readonly NetworkMapCanvasSelectionItem[],
    locked: boolean,
  ) {
    const nodeIds = new Set(
      items.filter((item) => item.kind === "node").map((item) => item.id),
    );
    const noteIds = new Set(
      items.filter((item) => item.kind === "note").map((item) => item.id),
    );
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) =>
        nodeIds.has(node.id) ? { ...node, locked } : node,
      ),
      notes: current.notes.map((note) =>
        noteIds.has(note.id) ? { ...note, locked } : note,
      ),
    }));
  }

  function removeCanvasItems(items: readonly NetworkMapCanvasSelectionItem[]) {
    if (items.some(canvasItemLocked)) return;
    const nodeIds = new Set(
      items.filter((item) => item.kind === "node").map((item) => item.id),
    );
    const noteIds = new Set(
      items.filter((item) => item.kind === "note").map((item) => item.id),
    );
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => !nodeIds.has(node.id)),
      notes: current.notes.filter((note) => !noteIds.has(note.id)),
      links: current.links.filter(
        (link) => !nodeIds.has(link.from) && !nodeIds.has(link.to),
      ),
      roots: current.roots.filter((root) => !nodeIds.has(root)),
    }));
    setSelection(null);
  }

  function duplicateNode(id: string) {
    const source = graph.nodes.find((entry) => entry.id === id);
    if (!source) return;
    const label = source.label.trim()
      ? nextTopologyDuplicateName(
          source.label,
          graph.nodes.map((node) => node.label),
        )
      : "";
    setSelection(null);
    setNodeDialog({
      node: {
        ...source,
        id: newId("nmn"),
        label,
        x: 0,
        y: 0,
        locked: false,
      },
      root: graph.roots.includes(id),
      placement: true,
    });
  }

  function showCanvasObjectContextMenu(
    event: import("react").MouseEvent<Element, MouseEvent>,
    item: NetworkMapCanvasSelectionItem,
    duplicate: () => void,
    openProperties: () => void,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (placementDraft) {
      cancelPlacement();
      return;
    }
    const currentItems = selection?.kind === "canvas" ? selection.items : [];
    const items = selectionForNetworkMapContextMenu(currentItems, item);
    const anyLocked = items.some(canvasItemLocked);
    const multiple = items.length > 1;
    setSelection({ kind: "canvas", items });
    void showNativeContextMenu(
      multiple
        ? [
            {
              kind: "item",
              label: t(
                anyLocked
                  ? "itops.networkMap.unlockSelection"
                  : "itops.networkMap.lockSelection",
              ),
              iconSvg: anyLocked
                ? nativeMenuIcons.unlock
                : nativeMenuIcons.lock,
              action: () => setCanvasItemsLocked(items, !anyLocked),
            },
            {
              kind: "item",
              label: t("itops.actions.delete"),
              iconSvg: nativeMenuIcons.trash,
              disabled: anyLocked,
              action: () => removeCanvasItems(items),
            },
          ]
        : [
            {
              kind: "item",
              label: t(
                anyLocked
                  ? "itops.networkMap.unlockSelection"
                  : "itops.networkMap.lockSelection",
              ),
              iconSvg: anyLocked ? nativeMenuIcons.unlock : nativeMenuIcons.lock,
              action: () => setCanvasItemsLocked(items, !anyLocked),
            },
            {
              kind: "item",
              label: t("itops.actions.duplicate"),
              iconSvg: nativeMenuIcons.copy,
              action: duplicate,
            },
            {
              kind: "item",
              label: t("itops.actions.delete"),
              iconSvg: nativeMenuIcons.trash,
              disabled: anyLocked,
              action: () => removeCanvasItems(items),
            },
            { kind: "separator" },
            {
              kind: "item",
              label: t("common.properties"),
              iconSvg: nativeMenuIcons.pencil,
              action: openProperties,
            },
          ],
      { x: event.clientX, y: event.clientY },
    );
  }

  function showNodeContextMenu(
    event: import("react").MouseEvent<Element, MouseEvent>,
    id: string,
  ) {
    showCanvasObjectContextMenu(
      event,
      { kind: "node", id },
      () => duplicateNode(id),
      () => openNodeProperties(id),
    );
  }

  function duplicateNote(id: string) {
    const source = graph.notes.find((entry) => entry.id === id);
    if (!source) return;
    setSelection(null);
    setNoteDialog({
      note: {
        ...source,
        id: newId("nma"),
        x: 0,
        y: 0,
        locked: false,
      },
      placement: true,
    });
  }

  function showNoteContextMenu(
    event: import("react").MouseEvent<Element, MouseEvent>,
    id: string,
  ) {
    showCanvasObjectContextMenu(
      event,
      { kind: "note", id },
      () => duplicateNote(id),
      () => openNoteProperties(id),
    );
  }

  function showCanvasContextMenu(
    event: MouseEvent | ReactMouseEvent<Element>,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (placementDraft) {
      cancelPlacement();
      return;
    }
    setSelection(null);
    void showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("itops.networkMap.addNode"),
          iconSvg: nativeMenuIcons.plus,
          action: () => {
            setObjectBrowserOpen(true);
            setSelection(null);
            cancelPlacement();
          },
        },
        {
          kind: "item",
          label: t("common.properties"),
          iconSvg: nativeMenuIcons.pencil,
          action: () => onOpenProperties({ ...map, graph }),
        },
      ],
      { x: event.clientX, y: event.clientY },
    );
  }

  return (
    <div className="nm-editor">
      <div className="nm-toolbar it-drill-toolbar">
        <div className="it-drill-spacer" />
        <h2 className="nm-editor-title" title={map.name}>{map.name}</h2>
        <div className="it-drill-actions" aria-label={t("itops.actions.viewActions")}>
          <button
            type="button"
            className={`it-drill-action${objectBrowserOpen ? " active" : ""}`}
            title={t("itops.networkMap.paletteLabel")}
            aria-label={t("itops.networkMap.paletteLabel")}
            aria-pressed={objectBrowserOpen}
            onClick={() => {
              setObjectBrowserOpen((open) => !open);
              setSelection(null);
              cancelPlacement();
            }}
          >
            <ItIcon name="edit" size={15} />
          </button>
        </div>
      </div>

      <div className="nm-body">
        <div
          className="au-canvas nm-canvas"
          data-mode="design"
          data-placing={placementDraft ? "true" : undefined}
          onPointerMoveCapture={(event) =>
            updatePlacementPoint(event.clientX, event.clientY)
          }
          onPointerDownCapture={(event) => {
            if (!placementDraft || event.button !== 0) return;
            const target = event.target;
            if (
              target instanceof Element &&
              target.closest(".react-flow__controls")
            ) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            suppressPlacementClickRef.current = true;
            placeDraftAt(event.clientX, event.clientY);
          }}
          onClickCapture={(event) => {
            if (!suppressPlacementClickRef.current) return;
            suppressPlacementClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
          onContextMenu={(event) => {
            if (!placementDraft) return;
            event.preventDefault();
            event.stopPropagation();
            cancelPlacement();
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeDragStart={() => setDragAnchorNodes(graph.nodes)}
            onNodeDragStop={() => setDragAnchorNodes(null)}
            onConnect={onConnect}
            onInit={setFlowInstance}
            onNodeClick={(event, node) => {
              if (placementDraft) return;
              const item: NetworkMapCanvasSelectionItem = {
                kind: node.type === "networkNote" ? "note" : "node",
                id: node.id,
              };
              const additive = event.ctrlKey || event.metaKey || event.shiftKey;
              setSelection((current) => {
                const currentItems =
                  current?.kind === "canvas" ? current.items : [];
                const items = toggleNetworkMapCanvasSelection(
                  currentItems,
                  item,
                  additive,
                );
                return items.length > 0 ? { kind: "canvas", items } : null;
              });
            }}
            onNodeDoubleClick={(_event, node) => {
              if (placementDraft) return;
              if (node.type === "networkNote") openNoteProperties(node.id);
              else if (node.type === "networkNode") openNodeProperties(node.id);
            }}
            onNodeContextMenu={(event, node) => {
              if (node.type === "networkNote") showNoteContextMenu(event, node.id);
              else if (node.type === "networkNode") showNodeContextMenu(event, node.id);
            }}
            onEdgeClick={(_event, edge) => {
              if (!placementDraft) openLinkProperties(edge.id);
            }}
            onEdgeDoubleClick={(_event, edge) => {
              if (placementDraft) return;
              openLinkProperties(edge.id);
            }}
            onPaneClick={() => {
              if (!placementDraft) setSelection(null);
            }}
            onPaneContextMenu={showCanvasContextMenu}
            connectionMode={ConnectionMode.Loose}
            nodesDraggable={!placementDraft}
            nodesConnectable={!placementDraft}
            elevateNodesOnSelect={false}
            deleteKeyCode={null}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
          {!objectBrowserOpen ? (
            <dl className="nm-map-info">
              <div>
                <dt>{t("itops.networkMap.statNodes")}</dt>
                <dd>{graph.nodes.length}</dd>
              </div>
              <div>
                <dt>{t("itops.networkMap.statLinks")}</dt>
                <dd>{graph.links.length}</dd>
              </div>
              <div>
                <dt>{t("itops.networkMap.statRoots")}</dt>
                <dd>{rootIds.size}</dd>
              </div>
            </dl>
          ) : null}
        </div>

        {objectBrowserOpen ? (
          <aside className="au-side nm-side kk-surface">
            <div className="au-side-in">
                <>
                <div className="nm-side-heading">
                  <div className="au-side-title">{t("itops.networkMap.paletteLabel")}</div>
                  <button
                    type="button"
                    className="it-icon-btn"
                    title={t("itops.networkMap.importTitle")}
                    aria-label={t("itops.networkMap.importTitle")}
                    onClick={() => setImporting(true)}
                  >
                    <ItIcon name="download" size={14} />
                  </button>
                </div>
                <div className="nm-picker-groups">
                  {NODE_CATEGORIES.map((category) => (
                    <section key={category.id} className="nm-picker-group">
                      <h3>{t(`itops.networkMap.nodeCategory.${category.id}`)}</h3>
                      <div
                        className="nm-picker-grid"
                        role="group"
                        aria-label={t(`itops.networkMap.nodeCategory.${category.id}`)}
                      >
                        {category.kinds.map((kind) => (
                          <button
                            key={kind}
                            type="button"
                            className="nm-picker-card"
                            onClick={() => configureNewNode(kind)}
                          >
                            <span
                              className="nm-picker-ic"
                              data-shell={
                                hasBlackDeviceShell(
                                  kind === "generic" ? "switch" : kind,
                                )
                                  ? "black"
                                  : "light"
                              }
                              style={{ "--nm-node-accent": NODE_STYLE[kind].accent } as CSSProperties}
                            >
                              <NetworkNodeArtwork
                                kind={kind === "generic" ? "switch" : kind}
                                size={30}
                              />
                            </span>
                            <span>{t(`itops.networkMap.nodeKind.${kind}`)}</span>
                          </button>
                        ))}
                        {category.id === "others" ? (
                          <button
                            type="button"
                            className="nm-picker-card nm-picker-note"
                            onClick={configureNewNote}
                          >
                            <span className="nm-picker-note-preview">Aa</span>
                            <span>{t("itops.networkMap.noteElement")}</span>
                          </button>
                        ) : null}
                      </div>
                    </section>
                  ))}
                </div>
                <VlanLegend
                  vlans={vlans}
                  usage={vlanUsage}
                  spotlightVlanId={spotlightVlanId}
                  onSpotlight={setSpotlightVlanId}
                />
                {graph.roots.length === 0 && graph.nodes.length > 0 ? (
                  <p className="nm-notice">{t("itops.networkMap.noRootsHint")}</p>
                ) : null}
                </>
            </div>
          </aside>
        ) : null}
      </div>

      {importing ? (
        <ImportDialog
          onClose={() => setImporting(false)}
          onImport={(hosts) =>
            setGraph((current) => ({
              ...current,
              nodes: [...current.nodes, ...hostsAsNodes(hosts, current.nodes.length)],
            }))
          }
        />
      ) : null}
      {nodeDialog ? (
        <NodePropertiesDialog
          key={nodeDialog.node.id}
          node={nodeDialog.node}
          root={nodeDialog.root}
          placement={nodeDialog.placement}
          deepLinkCatalog={deepLinkCatalog}
          onNavigateDeepLink={onNavigateDeepLink}
          onClose={() => setNodeDialog(null)}
          onDelete={
            nodeDialog.placement || nodeDialog.node.locked
              ? undefined
              : () => removeNode(nodeDialog.node.id)
          }
          onSubmit={(node, root) => {
            if (nodeDialog.placement) armNodePlacement(node, root);
            else updateNodeProperties(node, root);
          }}
        />
      ) : null}
      {noteDialog ? (
        <NotePropertiesDialog
          key={noteDialog.note.id}
          note={noteDialog.note}
          placement={noteDialog.placement}
          onClose={() => setNoteDialog(null)}
          onDelete={
            noteDialog.placement || noteDialog.note.locked
              ? undefined
              : () => removeNote(noteDialog.note.id)
          }
          onSubmit={(note) => {
            if (noteDialog.placement) armNotePlacement(note);
            else patchNote(note.id, note);
          }}
        />
      ) : null}
      {linkDialog ? (
        <LinkPropertiesDialog
          key={linkDialog.link.id}
          link={linkDialog.link}
          nodesById={nodesById}
          vlans={vlans}
          onClose={() => setLinkDialog(null)}
          onDelete={() => removeLink(linkDialog.link.id)}
          onSubmit={updateLinkProperties}
        />
      ) : null}
      {deepLinkPopup ? (
        (() => {
          const node = graph.nodes.find((entry) => entry.id === deepLinkPopup.nodeId);
          return node ? (
            <NodeDeepLinksPopover
              node={node}
              anchor={deepLinkPopup.anchor}
              catalog={deepLinkCatalog}
              onClose={() => setDeepLinkPopup(null)}
              onNavigate={onNavigateDeepLink}
            />
          ) : null;
        })()
      ) : null}
    </div>
  );
}

/**
 * VLAN spotlight legend. Selecting a VLAN dims every link that does not carry
 * it, which is the one-click answer to "where does VLAN 30 actually go?".
 *
 * This is a view filter and nothing more: it never edits the graph, and the
 * What-If analysis stays VLAN-blind — per-VLAN reachability would multiply
 * `effectiveRoots` / `findWeakPoints` / `findStrandedNodes` by the VLAN count
 * and is a separate piece of work.
 */
function VlanLegend({
  vlans,
  usage,
  spotlightVlanId,
  onSpotlight,
}: {
  vlans: readonly Vlan[];
  usage: ReadonlyMap<string, number>;
  spotlightVlanId: string | null;
  onSpotlight: (vlanId: string | null) => void;
}) {
  const { t } = useTranslation();
  // Only VLANs this map actually carries: the global list is documentation for
  // the whole install, and listing all of it here would bury the drawn ones.
  const drawn = vlans.filter((vlan) => usage.has(vlan.id));
  if (drawn.length === 0) return null;

  return (
    <section className="nm-vlan-legend">
      <div className="nm-vlan-legend-head">
        <span className="nm-impact-caption">{t("itops.networkMap.vlanLegendHeading")}</span>
        {spotlightVlanId ? (
          <button type="button" className="nm-vlan-clear" onClick={() => onSpotlight(null)}>
            {t("itops.networkMap.vlanSpotlightClear")}
          </button>
        ) : null}
      </div>
      <div className="nm-vlan-legend-rows">
        {drawn.map((vlan) => (
          <button
            key={vlan.id}
            type="button"
            className="nm-vlan-legend-row"
            aria-pressed={spotlightVlanId === vlan.id}
            style={{ "--nm-vlan-accent": vlanAccent(vlan) } as CSSProperties}
            onClick={() => onSpotlight(spotlightVlanId === vlan.id ? null : vlan.id)}
          >
            <em className="nm-vlan-dot" />
            <span>{vlanLabel(vlan)}</span>
            <small>{t("itops.networkMap.vlanLinkCount", { count: usage.get(vlan.id) ?? 0 })}</small>
          </button>
        ))}
      </div>
      <p className="au-side-hint">{t("itops.networkMap.vlanSpotlightHint")}</p>
    </section>
  );
}

export function NetworkMapDesigner({
  active,
  selectedMapId,
  onSelectedMapIdChange,
  onShowWorkspace,
  onNavigateItOpsDeepLink,
}: {
  active: boolean;
  selectedMapId?: string;
  onSelectedMapIdChange?: (id: string) => void;
  onShowWorkspace: () => void;
  onNavigateItOpsDeepLink: (link: NetworkNodeDeepLink) => void;
}) {
  const { t } = useTranslation();
  const maps = useItOpsStore((state) => state.networkMaps);
  const sites = useItOpsStore((state) => state.sites);
  const racksBySite = useItOpsStore((state) => state.racksBySite);
  const serverRoomsBySite = useItOpsStore((state) => state.serverRoomsBySite);
  const loaded = useItOpsStore((state) => state.networkMapsLoaded);
  const loadNetworkMaps = useItOpsStore((state) => state.loadNetworkMaps);
  const removeNetworkMap = useItOpsStore((state) => state.removeNetworkMap);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const tabs = useWorkspaceStore((state) => state.tabs);
  const openConnection = useWorkspaceStore((state) => state.openConnection);
  const activateTab = useWorkspaceStore((state) => state.activateTab);

  const [localSelectedId, setLocalSelectedId] = useState("");
  const selectedId = selectedMapId ?? localSelectedId;
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<NetworkMap | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<NetworkMap | null>(null);
  const [connections, setConnections] = useState<Connection[]>([]);

  useEffect(() => {
    if (!loaded) void loadNetworkMaps().catch(() => undefined);
  }, [loaded, loadNetworkMaps]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invokeCommand("list_connection_tree")
      .then((tree) => setConnections(flattenConnections(tree)))
      .catch(() => setConnections([]));
  }, []);

  useEffect(() => {
    if (!active) {
      setLocalSelectedId("");
      onSelectedMapIdChange?.("");
      setQuery("");
      setDialog(undefined);
      setPendingDelete(null);
    }
  }, [active, onSelectedMapIdChange]);

  function selectMap(id: string) {
    setLocalSelectedId(id);
    onSelectedMapIdChange?.(id);
  }

  const selected = maps.find((map) => map.id === selectedId);
  const siteNames = useMemo(
    () => new Map(sites.map((site) => [site.id, site.name])),
    [sites],
  );
  const deepLinkCatalog = useMemo<NetworkMapDeepLinkCatalog>(
    () => ({ connections, sites, racksBySite, serverRoomsBySite }),
    [connections, racksBySite, serverRoomsBySite, sites],
  );

  function navigateDeepLink(link: NetworkNodeDeepLink) {
    if (link.kind !== "connection") {
      onNavigateItOpsDeepLink(link);
      return;
    }
    const connection = connections.find((entry) => entry.id === link.connectionId);
    if (!connection) return;
    const openTab = tabs.find((tab) => tab.connection?.id === connection.id);
    if (openTab) activateTab(openTab.id);
    else openConnection(connection);
    onShowWorkspace();
  }
  const visibleMaps = maps.filter((map) =>
    matchesNetworkMapSearch(map, query, [
      map.siteId
        ? siteNames.get(map.siteId) ?? t("itops.networkMap.siteUnscoped")
        : t("itops.networkMap.siteUnscoped"),
      t("itops.networkMap.statNodes"),
      t("itops.networkMap.statLinks"),
      t("itops.networkMap.statRoots"),
      ...(map.graph.roots.length > 0 ? [t("itops.networkMap.rootBadge")] : []),
      ...map.graph.nodes.flatMap((node) => [
        t(`itops.networkMap.nodeKind.${node.kind}`),
        t(`itops.networkMap.status.${node.status}`),
      ]),
      ...map.graph.links.flatMap((link) => [
        t(`itops.networkMap.linkKind.${link.kind}`),
        t(`itops.networkMap.status.${link.status}`),
      ]),
    ]),
  );

  async function confirmDelete() {
    if (!pendingDelete) return;
    const map = pendingDelete;
    setPendingDelete(null);
    try {
      await removeNetworkMap(map.id);
      if (selectedId === map.id) selectMap("");
      showStatusBarNotice(t("itops.networkMap.deletedNotice", { name: map.name }), {
        tone: "success",
      });
    } catch (error) {
      showStatusBarNotice(t("itops.errorNotice", { message: errorMessage(error) }), {
        tone: "error",
      });
    }
  }

  function showNetworkMapCardMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
    map: NetworkMap,
  ) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    void showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("common.properties"),
          iconSvg: nativeMenuIcons.pencil,
          action: () => setDialog(map),
        },
        { kind: "separator" },
        {
          kind: "item",
          label: t("itops.actions.delete"),
          iconSvg: nativeMenuIcons.trash,
          action: () => setPendingDelete(map),
        },
      ],
      { x: Math.round(rect.right), y: Math.round(rect.bottom) },
    );
  }

  return (
    <div className="nm-page it-destination-surface" data-tutorial-id="itops.networkMaps">
      {!selected ? (
        <div className="it-destination-page-head">
          <div>
            <h2>{t("itops.networkMap.heading")}</h2>
            <p>{t("itops.networkMap.pageDescription")}</p>
          </div>
          <button
            type="button"
            className="it-btn primary"
            data-tutorial-id="itops.networkMapNew"
            onClick={() => setDialog(null)}
          >
            <ItIcon name="plus" size={14} />
            {t("itops.networkMap.newMapTitle")}
          </button>
        </div>
      ) : null}

      {maps.length > 0 && !selected ? (
        <div className="nm-gallery-toolbar" role="search">
          <label className="it-task-search">
            <ItIcon name="search" size={13} />
            <input
              type="search"
              value={query}
              placeholder={t("itops.networkMap.searchPlaceholder")}
              aria-label={t("itops.networkMap.searchPlaceholder")}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
        </div>
      ) : null}

      {maps.length > 0 && selected ? (
        <div className="nm-detail">
          {/* Keyed by id so switching maps starts a fresh draft rather than
              carrying the previous map's unsaved edits across. */}
          <MapEditor
            key={selected.id}
            map={selected}
            deepLinkCatalog={deepLinkCatalog}
            onNavigateDeepLink={navigateDeepLink}
            onOpenProperties={(currentMap) => setDialog(currentMap)}
          />
        </div>
      ) : visibleMaps.length > 0 ? (
        <div className="nm-gallery" role="list">
          {visibleMaps.map((map) => (
            <article key={map.id} className="nm-gallery-card" role="listitem">
              <button
                type="button"
                className="nm-gallery-open"
                onClick={() => selectMap(map.id)}
                aria-label={`${t("common.open")} ${map.name}`}
              >
                <NetworkMapPreview map={map} />
                <span className="nm-gallery-copy">
                  <span className="nm-gallery-kicker">
                    <ItIcon name="network" size={12} />
                    {map.siteId
                      ? siteNames.get(map.siteId) ?? t("itops.networkMap.siteUnscoped")
                      : t("itops.networkMap.siteUnscoped")}
                  </span>
                  <strong>{map.name}</strong>
                  {map.description ? <span className="nm-gallery-description">{map.description}</span> : null}
                  <span className="nm-gallery-stats">
                    <span>
                      <b>{map.graph.nodes.length}</b>
                      {t("itops.networkMap.statNodes")}
                    </span>
                    <span>
                      <b>{map.graph.links.length}</b>
                      {t("itops.networkMap.statLinks")}
                    </span>
                    <span>
                      <b>{effectiveRoots(map.graph).length}</b>
                      {t("itops.networkMap.statRoots")}
                    </span>
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="it-icon-btn nm-gallery-menu"
                aria-label={t("itops.actions.more")}
                aria-haspopup="menu"
                onClick={(event) => showNetworkMapCardMenu(event, map)}
              >
                <span className="nm-gallery-menu-glyph" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </span>
              </button>
            </article>
          ))}
        </div>
      ) : loaded ? (
        <ItOpsEmptyHint>
          {maps.length > 0
            ? t("itops.networkMap.noMatches")
            : t("itops.networkMap.emptyBody")}
        </ItOpsEmptyHint>
      ) : null}

      {dialog !== undefined ? (
        <NetworkMapPropertiesDialog
          map={dialog}
          onSaved={(saved) => selectMap(saved.id)}
          onClose={() => setDialog(undefined)}
        />
      ) : null}
      {pendingDelete ? (
        <ConfirmSheet
          tone="danger"
          title={t("itops.networkMap.deleteTitle")}
          message={t("itops.networkMap.deleteBody", { name: pendingDelete.name })}
          confirmLabel={t("itops.actions.delete")}
          confirmIcon="trash"
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
