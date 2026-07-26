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
// Built on @xyflow/react like the Automation editor. Node positions live in the
// graph itself (they are part of the saved document), so a drag is an edit.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import {
  Background,
  BackgroundVariant,
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

import {
  Actions,
  Btn,
  ConfirmSheet,
  DialogShell,
  Field,
  Select,
  Sheet,
  Swatches,
  TextArea,
  TextInput,
} from "../../app/ui/dialog";
import { showNativeContextMenu } from "../../lib/nativeContextMenu";
import { nativeMenuIcons } from "../../lib/nativeMenuIcons";
import { useWorkspaceStore } from "../../store";
import type {
  NetworkGraph,
  NetworkLink,
  NetworkLinkKind,
  NetworkMap,
  NetworkMapNote,
  NetworkMapStatus,
  NetworkNode,
  NetworkNodeKind,
  SiteHost,
  Vlan,
} from "../../types";
import { ItIcon, IT_ACCENTS } from "./icons";
import { ItOpsEmptyHint } from "./ItOpsEmptyHint";
import { matchesNetworkMapSearch } from "./networkMapSearch";
import { nextTopologyDuplicateName } from "./topologyDuplicate";
import {
  analyzeWhatIf,
  effectiveRoots,
  findStrandedNodes,
  findWeakPoints,
} from "./reachability";
import { useItOpsStore } from "./state";
import { vlanAccent, vlanLabel, vlansById } from "./vlanModel";

const LINK_KINDS: NetworkLinkKind[] = ["ethernet", "fiber", "wan", "wireless"];
const MAP_STATUSES: NetworkMapStatus[] = ["up", "warning"];

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
] as const satisfies ReadonlyArray<{
  id: string;
  kinds: readonly NetworkNodeKind[];
}>;

const NODE_KINDS: readonly NetworkNodeKind[] = NODE_CATEGORIES.flatMap(
  (category) => category.kinds,
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
const MAP_ACCENTS = Object.values(IT_ACCENTS);

/** Glyph and accent per device kind, so a map reads at a glance while zoomed out. */
const NODE_STYLE: Record<NetworkNodeKind, { accent: string }> = {
  router: { accent: IT_ACCENTS.indigo },
  gateway: { accent: IT_ACCENTS.indigo },
  switch: { accent: IT_ACCENTS.blue },
  switchL3: { accent: IT_ACCENTS.blue },
  hub: { accent: IT_ACCENTS.blue },
  firewall: { accent: IT_ACCENTS.orange },
  vpnGateway: { accent: IT_ACCENTS.orange },
  idsIps: { accent: IT_ACCENTS.red },
  loadBalancer: { accent: IT_ACCENTS.teal },
  proxy: { accent: IT_ACCENTS.teal },
  dns: { accent: IT_ACCENTS.teal },
  server: { accent: IT_ACCENTS.steel },
  database: { accent: IT_ACCENTS.graphite },
  storage: { accent: IT_ACCENTS.steel },
  cloud: { accent: IT_ACCENTS.purple },
  isp: { accent: IT_ACCENTS.purple },
  accessPoint: { accent: IT_ACCENTS.green },
  wirelessController: { accent: IT_ACCENTS.green },
  desktop: { accent: IT_ACCENTS.pink },
  laptop: { accent: IT_ACCENTS.pink },
  smartphone: { accent: IT_ACCENTS.pink },
  iot: { accent: IT_ACCENTS.pink },
  voip: { accent: IT_ACCENTS.pink },
  printer: { accent: IT_ACCENTS.pink },
  camera: { accent: IT_ACCENTS.red },
};

const NODE_WIDTH = 190;
const NODE_HEIGHT = 80;
const NODE_MIN_WIDTH = 140;
const NODE_MIN_HEIGHT = 64;
const NODE_MAX_WIDTH = 360;
const NODE_MAX_HEIGHT = 220;
const NOTE_WIDTH = 240;
const NOTE_HEIGHT = 130;
const NOTE_MIN_WIDTH = 180;
const NOTE_MIN_HEIGHT = 90;
const NOTE_MAX_WIDTH = 600;
const NOTE_MAX_HEIGHT = 400;

function newId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Node state drives the card's themed treatment; never a hard-coded colour. */
type NodeState = "up" | "warning" | "down" | "isolated";

interface MapNodeData extends Record<string, unknown> {
  label: string;
  sub: string;
  kind: NetworkNodeKind;
  state: NodeState;
  root: boolean;
  selected: boolean;
  rootLabel: string;
  warningLabel: string;
  accent: string;
  resizable: boolean;
  ghost?: boolean;
}

function NetworkNodeArtwork({
  kind,
  size = 30,
}: {
  kind: NetworkNodeKind;
  size?: number;
}) {
  const artwork = {
    router: (
      <>
        <circle cx="16" cy="16" r="9.5" />
        <path d="M8.5 16h15M16 8.5v15M11.5 11.5 8.8 8.8M20.5 20.5l2.7 2.7M20.5 11.5l2.7-2.7M11.5 20.5l-2.7 2.7" />
      </>
    ),
    gateway: (
      <>
        <rect x="7" y="13" width="18" height="9" rx="2.5" />
        <path d="M12 13V9M20 13V9M10 17.5h12" />
      </>
    ),
    switch: (
      <>
        <rect x="5.5" y="8" width="21" height="16" rx="4" />
        <path d="M10 13h3M16 13h3M22 13h1M10 19h3M16 19h3M22 19h1" />
      </>
    ),
    switchL3: (
      <>
        <rect x="5.5" y="11" width="21" height="13" rx="4" />
        <path d="M10 16h3M16 16h3M22 16h1M10 20h3M16 20h3M22 20h1M7 7h7.5M14.5 7l-2.6-2.6M14.5 7l-2.6 2.6M25 8.6h-7.5M17.5 8.6l2.6-2.6M17.5 8.6l2.6 2.6" />
      </>
    ),
    hub: (
      <>
        <circle cx="16" cy="16" r="3" />
        <path d="M16 13V7M16 19v6M13 16H7M19 16h6" />
        <circle cx="16" cy="5" r="1.6" />
        <circle cx="16" cy="27" r="1.6" />
        <circle cx="5" cy="16" r="1.6" />
        <circle cx="27" cy="16" r="1.6" />
      </>
    ),
    firewall: (
      <>
        <path d="M6.5 24V9.5L16 5l9.5 4.5V24L16 28Z" />
        <path d="M7 14h18M7 20h18M12 8v6M19.5 7.5V14M12 14v6M20 14v6M12 20v5.5M20 20v5.5" />
      </>
    ),
    vpnGateway: (
      <>
        <path d="M16 5l9 4v7c0 6-4 9.5-9 11-5-1.5-9-5-9-11V9Z" />
        <circle cx="16" cy="16" r="2.2" />
        <path d="M16 18.2V22" />
      </>
    ),
    idsIps: (
      <>
        <path d="M16 5l9 4v7c0 6-4 9.5-9 11-5-1.5-9-5-9-11V9Z" />
        <path d="M11.3 15.6c1.3-1.7 2.9-2.5 4.7-2.5s3.4.8 4.7 2.5c-1.3 1.7-2.9 2.5-4.7 2.5s-3.4-.8-4.7-2.5Z" />
        <circle cx="16" cy="15.6" r="1.3" />
      </>
    ),
    server: (
      <>
        <rect x="6" y="5.5" width="20" height="8" rx="2.5" />
        <rect x="6" y="18.5" width="20" height="8" rx="2.5" />
        <path d="M10 9.5h.1M10 22.5h.1M14 9.5h8M14 22.5h8" />
      </>
    ),
    loadBalancer: (
      <>
        <circle cx="16" cy="7" r="3" />
        <circle cx="8" cy="24" r="3" />
        <circle cx="24" cy="24" r="3" />
        <path d="M16 10v5M16 15H8v6M16 15h8v6" />
      </>
    ),
    proxy: (
      <path d="M6 12h14M20 12l-3.5-3.5M20 12l-3.5 3.5M26 20H12M12 20l3.5-3.5M12 20l3.5 3.5" />
    ),
    dns: (
      <>
        <circle cx="14" cy="14" r="8" />
        <path d="M6 14h16M14 6c2.5 2.2 2.5 13.8 0 16M14 6c-2.5 2.2-2.5 13.8 0 16" />
        <rect x="19" y="19" width="8" height="6" rx="1.5" />
        <path d="M22 22h.1" />
      </>
    ),
    cloud: (
      <>
        <path d="M9 24.5h14.5a5 5 0 0 0 .6-10A8.2 8.2 0 0 0 8.5 13 5.8 5.8 0 0 0 9 24.5Z" />
        <path d="M12 19h8" />
      </>
    ),
    database: (
      <>
        <path d="M8 9c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Z" />
        <path d="M8 9v14c0 1.7 3.6 3 8 3s8-1.3 8-3V9M8 16c0 1.7 3.6 3 8 3s8-1.3 8-3" />
      </>
    ),
    storage: (
      <>
        <rect x="6" y="7" width="20" height="7" rx="2" />
        <rect x="6" y="18" width="20" height="7" rx="2" />
        <path d="M10 10.5h.1M10 21.5h.1" />
        <circle cx="22" cy="10.5" r="1" />
        <circle cx="22" cy="21.5" r="1" />
      </>
    ),
    isp: (
      <>
        <circle cx="16" cy="17" r="8" />
        <path d="M8 17h16M16 9c2.2 2 2.2 12 0 16M16 9c-2.2 2-2.2 12 0 16M11 6.5a13 13 0 0 1 10 0" />
      </>
    ),
    accessPoint: (
      <path d="M16 24h.1M11 19.5a7 7 0 0 1 10 0M7.5 15.5a12 12 0 0 1 17 0" />
    ),
    wirelessController: (
      <>
        <rect x="12" y="24" width="8" height="3" rx="1" />
        <path d="M16 24V10M11.5 14a5 5 0 0 1 9 0M8.5 10.5a9.5 9.5 0 0 1 15 0" />
      </>
    ),
    desktop: (
      <>
        <rect x="4" y="7" width="15" height="11" rx="2" />
        <path d="M9 23h5M11.5 18v5" />
        <rect x="21" y="7" width="6" height="16" rx="1.5" />
        <path d="M24 10.5h.1M24 14h.1" />
      </>
    ),
    laptop: (
      <>
        <rect x="7" y="6" width="18" height="12" rx="2" />
        <path d="M4.5 24h23l-2.6-5H7.1ZM13.5 21.5h5" />
      </>
    ),
    smartphone: (
      <>
        <rect x="11" y="3.5" width="10" height="25" rx="3" />
        <path d="M14 7h4" />
        <circle cx="16" cy="24.5" r="1.2" />
      </>
    ),
    iot: (
      <>
        <rect x="10" y="10" width="12" height="12" rx="2" />
        <path d="M13 10V6M19 10V6M13 26v-4M19 26v-4M10 13H6M10 19H6M26 13h-4M26 19h-4" />
      </>
    ),
    voip: (
      <path d="M9.3 8.3c.3-1.1 1.1-1.7 2.2-1.6l2.2.3c.9.1 1.4.9 1.3 1.8l-.4 2.3c-.1.7-.6 1.3-1.3 1.4-.6.1-1 .5-1 1.1-.2 1.4 2 3.7 3.4 3.5.6-.1 1-.5 1.1-1.1.1-.7.6-1.2 1.3-1.3l2.3-.4c.9-.1 1.6.4 1.7 1.3l.3 2.2c.1 1.1-.5 1.9-1.6 2.2-5.8 1.5-13.4-6.1-11.9-11.7Z" />
    ),
    printer: (
      <>
        <rect x="8" y="13" width="16" height="8" rx="2" />
        <path d="M10 13V8h12v5" />
        <rect x="11" y="21" width="10" height="5" rx="1" />
        <path d="M11 16h.1" />
      </>
    ),
    camera: (
      <>
        <rect x="5" y="11" width="16" height="11" rx="2.5" />
        <path d="M17 14l6-3v10l-6-3Z" />
        <circle cx="11" cy="16.5" r="3" />
      </>
    ),
  }[kind];

  return (
    <svg
      className="nm-device-art"
      data-kind={kind}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle className="nm-device-art-orbit" cx="16" cy="16" r="14" />
      <g className="nm-device-art-glyph">{artwork}</g>
      <circle className="nm-device-art-ping" cx="26" cy="6" r="2" />
    </svg>
  );
}

function MapNode({ data }: NodeProps<Node<MapNodeData>>) {
  const accentStyle = { "--nm-node-accent": data.accent } as CSSProperties;
  return (
    <div
      className={`nm-node${data.selected ? " sel" : ""}${data.ghost ? " ghost" : ""}`}
      data-state={data.state}
      data-kind={data.kind}
      data-root={data.root ? "true" : undefined}
      data-placement-ghost={data.ghost ? "true" : undefined}
      style={{ width: "100%", height: "100%" }}
    >
      {data.ghost ? null : (
        <NodeResizer
          isVisible={data.selected && data.resizable}
          minWidth={NODE_MIN_WIDTH}
          minHeight={NODE_MIN_HEIGHT}
          maxWidth={NODE_MAX_WIDTH}
          maxHeight={NODE_MAX_HEIGHT}
          lineClassName="nm-resize-line"
          handleClassName="nm-resize-handle"
        />
      )}
      {/* One stacked source/target pair per side: links are undirected, and the
          edge builder picks the side facing the far end. */}
      {data.ghost
        ? null
        : [Position.Left, Position.Right, Position.Top, Position.Bottom].map((position) => (
            <span key={position}>
              <Handle type="target" id={position} position={position} className="nm-handle" />
              <Handle type="source" id={position} position={position} className="nm-handle" />
            </span>
          ))}
      <span className="nm-node-ic" style={accentStyle}>
        <NetworkNodeArtwork kind={data.kind} size={34} />
      </span>
      <span className="nm-node-tx">
        <span className="nm-node-lab">{data.label}</span>
        <span className="nm-node-sub">{data.sub}</span>
      </span>
      {data.root ? (
        <span className="nm-node-root" title={data.rootLabel}>
          <ItIcon name="pulse" size={11} />
        </span>
      ) : null}
      {data.state === "warning" ? (
        <span className="nm-node-warning" title={data.warningLabel}>
          !
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
  ghost?: boolean;
}

function MapNote({ data }: NodeProps<Node<MapNoteData>>) {
  return (
    <div
      className={`nm-note${data.selected ? " sel" : ""}${data.ghost ? " ghost" : ""}`}
      style={{
        width: "100%",
        height: "100%",
        "--nm-note-accent": data.accent,
      } as CSSProperties}
    >
      <NodeResizer
        isVisible={data.selected && data.resizable}
        minWidth={NOTE_MIN_WIDTH}
        minHeight={NOTE_MIN_HEIGHT}
        maxWidth={NOTE_MAX_WIDTH}
        maxHeight={NOTE_MAX_HEIGHT}
        lineClassName="nm-resize-line"
        handleClassName="nm-resize-handle"
      />
      <span>{data.text}</span>
    </div>
  );
}

const nodeTypes = { networkNode: MapNode, networkNote: MapNote };

interface NetworkLinkEdgeData extends Record<string, unknown> {
  kind: NetworkLinkKind;
  state: "up" | "warning" | "cut" | "severed";
  strandCount: number;
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
  const count = Math.min(Math.max(data?.strandCount ?? 1, 1), 4);
  const offsets = Array.from(
    { length: count },
    (_entry, index) => (index - (count - 1) / 2) * 5,
  );
  const centre = orthogonalLinkPath(props);
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
        strokeWidth={18}
      />
      {offsets.map((offset, index) => {
        const { path } = orthogonalLinkPath({ ...props, offset });
        return (
          <path
            key={`${id}:${index}`}
            d={path}
            className="react-flow__edge-path nm-edge-strand"
            fill="none"
          />
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
      {data?.label ? (
        <EdgeLabelRenderer>
          <div
            className="nm-edge-label"
            data-spotlit={data.spotlightAccent ? "true" : undefined}
            style={{
              transform: `translate(-50%, -50%) translate(${centre.labelX}px, ${centre.labelY}px)`,
              ...(data.spotlightAccent
                ? ({ "--nm-vlan-accent": data.spotlightAccent } as CSSProperties)
                : {}),
            }}
          >
            {data.label}
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
            className={`nm-map-preview-link ${link.kind}`}
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
  return node.label.trim() || node.addresses[0]?.trim() || fallback;
}

function nodeAccent(node: NetworkNode): string {
  return node.iconAccent == null
    ? NODE_STYLE[node.kind].accent
    : MAP_ACCENTS[node.iconAccent % MAP_ACCENTS.length];
}

function noteAccent(note: NetworkMapNote): string {
  return MAP_ACCENTS[note.backgroundAccent % MAP_ACCENTS.length];
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
    addresses: [host.hostname],
    status: "up",
    hostId: host.id,
    connectionId: host.connectionIds[0] ?? null,
    rackItemId: null,
    note: "",
  }));
}

function newNodeDraft(kind: NetworkNodeKind): NetworkNode {
  return {
    id: newId("nmn"),
    label: "",
    kind,
    x: 0,
    y: 0,
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    iconAccent: null,
    addresses: [],
    status: "up",
    hostId: null,
    connectionId: null,
    rackItemId: null,
    note: "",
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
  };
}

function NodePropertiesFields({
  node,
  root,
  onChange,
  onAddressesChange,
  onRootChange,
}: {
  node: NetworkNode;
  root: boolean;
  onChange: (patch: Partial<NetworkNode>) => void;
  onAddressesChange: (addresses: string[]) => void;
  onRootChange: (root: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Field label={t("itops.networkMap.labelLabel")}>
        <TextInput
          value={node.label}
          placeholder={t("itops.networkMap.labelPlaceholder")}
          onChange={(event) => onChange({ label: event.currentTarget.value })}
          autoFocus
        />
      </Field>
      <Field label={t("itops.networkMap.kindLabel")}>
        <Select
          value={node.kind}
          onChange={(event) =>
            onChange({
              kind: event.currentTarget.value as NetworkNodeKind,
            })
          }
          options={NODE_KINDS.map((kind) => ({
            value: kind,
            label: t(`itops.networkMap.nodeKind.${kind}`),
          }))}
        />
      </Field>
      <div className="nm-addresses">
        <div className="nm-strands-head">
          <span className="kk-lbl">{t("itops.networkMap.addressesLabel")}</span>
          <button
            type="button"
            className="nm-strand-add"
            onClick={() => onAddressesChange([...node.addresses, ""])}
          >
            <ItIcon name="plus" size={12} />
            {t("itops.networkMap.addressAdd")}
          </button>
        </div>
        {node.addresses.map((address, index) => (
          <div key={`${node.id}:address:${index}`} className="nm-address-row">
            <TextInput
              mono
              value={address}
              aria-label={t("itops.networkMap.addressItemLabel", { index: index + 1 })}
              placeholder={t("itops.networkMap.addressPlaceholder")}
              onChange={(event) =>
                onAddressesChange(
                  node.addresses.map((entry, entryIndex) =>
                    entryIndex === index ? event.currentTarget.value : entry,
                  ),
                )
              }
            />
            <button
              type="button"
              className="nm-strand-remove"
              aria-label={t("itops.networkMap.addressRemove")}
              title={t("itops.networkMap.addressRemove")}
              onClick={() =>
                onAddressesChange(
                  node.addresses.filter((_entry, entryIndex) => entryIndex !== index),
                )
              }
            >
              <ItIcon name="xmark" size={12} />
            </button>
          </div>
        ))}
        <span className="kk-hint">{t("itops.networkMap.addressesHint")}</span>
      </div>
      <Field label={t("itops.networkMap.iconBackgroundLabel")}>
        <Swatches
          accents={MAP_ACCENTS}
          value={nodeAccent(node)}
          onChange={(color) =>
            onChange({
              iconAccent: MAP_ACCENTS.findIndex((accent) => accent === color),
            })
          }
        />
      </Field>
      <Field label={t("itops.networkMap.statusLabel")}>
        <Select
          value={node.status ?? "up"}
          onChange={(event) =>
            onChange({
              status: event.currentTarget.value as NetworkMapStatus,
            })
          }
          options={MAP_STATUSES.map((status) => ({
            value: status,
            label: t(`itops.networkMap.status.${status}`),
          }))}
        />
      </Field>
      <label className="nm-root-toggle">
        <input
          type="checkbox"
          checked={root}
          onChange={(event) => onRootChange(event.currentTarget.checked)}
        />
        <span>
          <strong>{t("itops.networkMap.rootLabel")}</strong>
          <small>{t("itops.networkMap.rootHint")}</small>
        </span>
      </label>
      <Field label={t("itops.networkMap.noteLabel")}>
        <TextArea
          rows={3}
          value={node.note}
          onChange={(event) => onChange({ note: event.currentTarget.value })}
        />
      </Field>
    </>
  );
}

function NodePropertiesDialog({
  node,
  root,
  placement,
  onSubmit,
  onDelete,
  onClose,
}: {
  node: NetworkNode;
  root: boolean;
  placement: boolean;
  onSubmit: (node: NetworkNode, root: boolean) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(node);
  const [draftRoot, setDraftRoot] = useState(root);
  return (
    <DialogShell onBackdrop={onClose} zClassName="itops-page">
      <Sheet
        width={520}
        title={t("itops.networkMap.nodeHeading")}
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
                  onSubmit(draft, draftRoot);
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
          root={draftRoot}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          onAddressesChange={(addresses) =>
            setDraft((current) => ({ ...current, addresses }))
          }
          onRootChange={setDraftRoot}
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
  return (
    <DialogShell onBackdrop={onClose} zClassName="itops-page">
      <Sheet
        width={480}
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
          <TextArea
            rows={6}
            value={draft.text}
            placeholder={t("itops.networkMap.notePlaceholder")}
            onChange={(event) => {
              const text = event.currentTarget.value;
              setDraft((current) => ({ ...current, text }));
            }}
            autoFocus
          />
        </Field>
        <Field label={t("itops.networkMap.noteBackgroundLabel")}>
          <Swatches
            accents={MAP_ACCENTS}
            value={noteAccent(draft)}
            onChange={(color) =>
              setDraft((current) => ({
                ...current,
                backgroundAccent: MAP_ACCENTS.findIndex((accent) => accent === color),
              }))
            }
          />
        </Field>
      </Sheet>
    </DialogShell>
  );
}

function LinkPropertiesFields({
  link,
  nodesById,
  vlans,
  onChange,
}: {
  link: NetworkLink;
  nodesById: Map<string, NetworkNode>;
  vlans: Vlan[];
  onChange: (link: NetworkLink) => void;
}) {
  const { t } = useTranslation();
  const unnamed = t("itops.networkMap.unnamedNode");
  const vlanIndex = useMemo(() => vlansById(vlans), [vlans]);
  const speedListId = `nm-link-dialog-speeds-${link.id}`;
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
        <Select
          value={link.kind}
          onChange={(event) =>
            patch({ kind: event.currentTarget.value as NetworkLinkKind })
          }
          options={LINK_KINDS.map((kind) => ({
            value: kind,
            label: t(`itops.networkMap.linkKind.${kind}`),
          }))}
        />
      </Field>
      <Field label={t("itops.networkMap.statusLabel")}>
        <Select
          value={link.status ?? "up"}
          onChange={(event) =>
            patch({ status: event.currentTarget.value as NetworkMapStatus })
          }
          options={MAP_STATUSES.map((status) => ({
            value: status,
            label: t(`itops.networkMap.status.${status}`),
          }))}
        />
      </Field>
      <Field
        label={t("itops.networkMap.endpointAddressLabel", {
          node: endpointName(nodesById, link.from, unnamed),
        })}
      >
        <Select
          value={link.fromAddress ?? ""}
          onChange={(event) => patch({ fromAddress: event.currentTarget.value || null })}
          options={[
            { value: "", label: t("itops.networkMap.addressUnbound") },
            ...(nodesById.get(link.from)?.addresses ?? [])
              .filter(Boolean)
              .map((address) => ({ value: address, label: address })),
          ]}
        />
      </Field>
      <Field
        label={t("itops.networkMap.endpointAddressLabel", {
          node: endpointName(nodesById, link.to, unnamed),
        })}
      >
        <Select
          value={link.toAddress ?? ""}
          onChange={(event) => patch({ toAddress: event.currentTarget.value || null })}
          options={[
            { value: "", label: t("itops.networkMap.addressUnbound") },
            ...(nodesById.get(link.to)?.addresses ?? [])
              .filter(Boolean)
              .map((address) => ({ value: address, label: address })),
          ]}
        />
      </Field>
      <div className="nm-strands">
        <div className="nm-strands-head">
          <span className="kk-lbl">{t("itops.networkMap.strandsLabel")}</span>
          <button
            type="button"
            className="nm-strand-add"
            disabled={link.strands.length >= MAX_STRANDS}
            onClick={() => {
              const last = link.strands[link.strands.length - 1];
              patch({
                strands: [
                  ...link.strands,
                  { id: newId("nms"), name: "", speed: last?.speed ?? "" },
                ],
              });
            }}
          >
            <ItIcon name="plus" size={12} />
            {t("itops.networkMap.strandAdd")}
          </button>
        </div>
        {link.strands.map((strand, index) => (
          <div key={strand.id} className="nm-strand-row">
            <span className="nm-strand-index">{index + 1}</span>
            <TextInput
              mono
              aria-label={t("itops.networkMap.strandNameLabel")}
              value={strand.name}
              placeholder={t("itops.networkMap.strandNamePlaceholder")}
              onChange={(event) => {
                const name = event.currentTarget.value;
                patch({
                  strands: link.strands.map((entry) =>
                    entry.id === strand.id ? { ...entry, name } : entry,
                  ),
                });
              }}
            />
            <TextInput
              mono
              list={speedListId}
              aria-label={t("itops.networkMap.strandSpeedLabel")}
              value={strand.speed}
              placeholder={t("itops.networkMap.strandSpeedPlaceholder")}
              onChange={(event) => {
                const speed = event.currentTarget.value;
                patch({
                  strands: link.strands.map((entry) =>
                    entry.id === strand.id ? { ...entry, speed } : entry,
                  ),
                });
              }}
            />
            <button
              type="button"
              className="nm-strand-remove"
              disabled={link.strands.length <= 1}
              aria-label={t("itops.networkMap.strandRemove")}
              title={t("itops.networkMap.strandRemove")}
              onClick={() =>
                patch({
                  strands: link.strands.filter((entry) => entry.id !== strand.id),
                })
              }
            >
              <ItIcon name="xmark" size={12} />
            </button>
          </div>
        ))}
        <datalist id={speedListId}>
          {COMMON_LINK_SPEEDS.map((speed) => (
            <option key={speed} value={speed} />
          ))}
        </datalist>
        <span className="kk-hint">{t("itops.networkMap.strandsHint")}</span>
      </div>
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
  onSubmit: (link: NetworkLink) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(link);
  return (
    <DialogShell onBackdrop={onClose} zClassName="itops-page">
      <Sheet
        width={560}
        title={t("itops.networkMap.linkHeading")}
        footer={
          <Actions
            extraLeft={
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
                {t("itops.actions.save")}
              </Btn>
            }
          />
        }
      >
        <LinkPropertiesFields
          link={draft}
          nodesById={nodesById}
          vlans={vlans}
          onChange={setDraft}
        />
      </Sheet>
    </DialogShell>
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

type EditorMode = "view" | "design" | "impact";
type Selection = { kind: "node" | "link" | "note"; id: string } | null;
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
  onDeleteMap,
}: {
  map: NetworkMap;
  onDeleteMap: () => void;
}) {
  const { t } = useTranslation();
  const saveNetworkMap = useItOpsStore((state) => state.saveNetworkMap);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);

  const [graph, setGraph] = useState<NetworkGraph>(map.graph);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(map.graph));
  const [mode, setMode] = useState<EditorMode>("view");
  const [selection, setSelection] = useState<Selection>(null);
  const [downNodes, setDownNodes] = useState<string[]>([]);
  const [downLinks, setDownLinks] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nodeDialog, setNodeDialog] = useState<NodeDialogRequest | null>(null);
  const [noteDialog, setNoteDialog] = useState<NoteDialogRequest | null>(null);
  const [linkDialog, setLinkDialog] = useState<LinkDialogRequest | null>(null);
  const [placementDraft, setPlacementDraft] = useState<PlacementDraft | null>(null);
  const [placementPoint, setPlacementPoint] = useState<{ x: number; y: number } | null>(null);
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

  const dirty = JSON.stringify(graph) !== savedJson;

  const analysis = useMemo(
    () => analyzeWhatIf(graph, { nodes: downNodes, links: downLinks }),
    [downLinks, downNodes, graph],
  );
  const weakPoints = useMemo(() => findWeakPoints(graph), [graph]);
  const stranded = useMemo(() => findStrandedNodes(graph), [graph]);
  const rootIds = useMemo(() => new Set(effectiveRoots(graph)), [graph]);
  const nodesById = useMemo(
    () => new Map(graph.nodes.map((node) => [node.id, node])),
    [graph.nodes],
  );

  const unnamed = t("itops.networkMap.unnamedNode");
  const nodes = useMemo<Node<MapNodeData | MapNoteData>[]>(() => {
    const downSet = new Set(analysis.down);
    const isolatedSet = new Set(analysis.isolated);
    const noteNodes: Node<MapNoteData>[] = graph.notes.map((note) => ({
      id: note.id,
      type: "networkNote",
      position: { x: note.x, y: note.y },
      width: note.width,
      height: note.height,
      zIndex: 0,
      data: {
        text: note.text || t("itops.networkMap.notePlaceholder"),
        accent: noteAccent(note),
        selected: selection?.kind === "note" && selection.id === note.id,
        resizable: mode === "design",
      },
    }));
    const deviceNodes: Node<MapNodeData>[] = graph.nodes.map((node) => ({
      id: node.id,
      type: "networkNode",
      position: { x: node.x, y: node.y },
      width: node.width,
      height: node.height,
      zIndex: 2,
      data: {
        label: nodeLabel(node, unnamed),
        sub: node.addresses.join(" · ") || t(`itops.networkMap.nodeKind.${node.kind}`),
        kind: node.kind,
        state: downSet.has(node.id)
          ? "down"
          : isolatedSet.has(node.id)
            ? "isolated"
            : node.status === "warning"
              ? "warning"
              : "up",
        root: rootIds.has(node.id),
        selected: selection?.kind === "node" && selection.id === node.id,
        rootLabel: t("itops.networkMap.rootBadge"),
        warningLabel: t("itops.networkMap.status.warning"),
        accent: nodeAccent(node),
        resizable: mode === "design",
      },
    }));
    if (placementDraft && placementPoint) {
      if (placementDraft.kind === "node") {
        const node = placementDraft.node;
        deviceNodes.push({
          id: node.id,
          type: "networkNode",
          position: placementPoint,
          width: node.width,
          height: node.height,
          zIndex: 3,
          className: "nm-placement-ghost-node",
          draggable: false,
          selectable: false,
          connectable: false,
          focusable: false,
          data: {
            label: nodeLabel(node, unnamed),
            sub: node.addresses.join(" · ") || t(`itops.networkMap.nodeKind.${node.kind}`),
            kind: node.kind,
            state: node.status === "warning" ? "warning" : "up",
            root: placementDraft.root,
            selected: false,
            rootLabel: t("itops.networkMap.rootBadge"),
            warningLabel: t("itops.networkMap.status.warning"),
            accent: nodeAccent(node),
            resizable: false,
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
          zIndex: 3,
          className: "nm-placement-ghost-node",
          draggable: false,
          selectable: false,
          focusable: false,
          data: {
            text: note.text || t("itops.networkMap.notePlaceholder"),
            accent: noteAccent(note),
            selected: false,
            resizable: false,
            ghost: true,
          },
        });
      }
    }
    return [...noteNodes, ...deviceNodes];
  }, [
    analysis.down,
    analysis.isolated,
    graph.nodes,
    graph.notes,
    mode,
    placementDraft,
    placementPoint,
    rootIds,
    selection,
    t,
    unnamed,
  ]);

  const edges = useMemo<Edge<NetworkLinkEdgeData>[]>(() => {
    const severed = new Set(analysis.severedLinks);
    const cut = new Set(downLinks);
    return graph.links.flatMap((link) => {
      const from = nodesById.get(link.from);
      const to = nodesById.get(link.to);
      if (!from || !to) return [];
      const { source, target } = anchors(from, to);
      const state = cut.has(link.id)
        ? "cut"
        : severed.has(link.id)
          ? "severed"
          : link.status === "warning"
            ? "warning"
            : "up";
      const strandCount = Math.max(link.strands.length, 1);
      // Every strand at the same speed reads as one figure; a mixed bundle
      // would be a lie compressed into one chip, so it falls back to the count.
      const speeds = new Set(link.strands.map((strand) => strand.speed.trim()).filter(Boolean));
      const label = [
        link.label.trim(),
        link.fromAddress || link.toAddress
          ? `${link.fromAddress || "—"} ↔ ${link.toAddress || "—"}`
          : "",
        speeds.size === 1 ? [...speeds][0] : "",
        strandCount > 1 ? `×${strandCount}` : "",
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
          zIndex: 1,
          className: `nm-edge ${link.kind} ${state}${strandCount > 1 ? " multi" : ""}${
            selection?.kind === "link" && selection.id === link.id ? " sel" : ""
          }${spotlightVlanId && !spotlit ? " dimmed" : ""}`,
          data: {
            kind: link.kind,
            state,
            strandCount,
            label,
            trunk,
            spotlightAccent:
              spotlit && spotlightVlan ? vlanAccent(spotlightVlan) : null,
          },
        },
      ];
    });
  }, [
    analysis.severedLinks,
    downLinks,
    graph.links,
    nodesById,
    selection,
    spotlightVlanId,
    t,
    vlanIndex,
  ]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (mode !== "design") return;
    // Positions and dimensions are the two canvas-owned properties.
    setGraph((current) => {
      let nextNodes = current.nodes;
      let nextNotes = current.notes;
      for (const change of changes) {
        if (change.type === "position" && change.position) {
          const position = change.position;
          nextNodes = nextNodes.map((node) =>
            node.id === change.id
              ? { ...node, x: Math.round(position.x), y: Math.round(position.y) }
              : node,
          );
          nextNotes = nextNotes.map((note) =>
            note.id === change.id
              ? { ...note, x: Math.round(position.x), y: Math.round(position.y) }
              : note,
          );
        }
        if (change.type === "dimensions" && change.dimensions) {
          const { width, height } = change.dimensions;
          nextNodes = nextNodes.map((node) =>
            node.id === change.id
              ? { ...node, width: Math.round(width), height: Math.round(height) }
              : node,
          );
          nextNotes = nextNotes.map((note) =>
            note.id === change.id
              ? { ...note, width: Math.round(width), height: Math.round(height) }
              : note,
          );
        }
      }
      return nextNodes === current.nodes && nextNotes === current.notes
        ? current
        : { ...current, nodes: nextNodes, notes: nextNotes };
    });
  }, [mode]);

  const onConnect = useCallback((connection: FlowConnection) => {
    if (mode !== "design") return;
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    setGraph((current) => {
      const exists = current.links.some(
        (link) =>
          (link.from === connection.source && link.to === connection.target) ||
          (link.from === connection.target && link.to === connection.source),
      );
      if (exists) return current;
      const id = newId("nml");
      const link: NetworkLink = {
        id,
        from: connection.source!,
        to: connection.target!,
        label: "",
        kind: "ethernet",
        fromAddress: null,
        toAddress: null,
        // A drawn link always stands for at least one physical link, so it
        // starts with one strand rather than an empty list the operator has to
        // notice is empty.
        strands: [{ id: newId("nms"), name: "", speed: "" }],
        nativeVlanId: null,
        taggedVlanIds: [],
        status: "up",
      };
      return { ...current, links: [...current.links, link] };
    });
  }, [mode]);

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
      setSelection({ kind: "node", id: node.id });
    } else {
      const note = {
        ...placementDraft.note,
        x: Math.round(cursor.x - placementDraft.note.width / 2),
        y: Math.round(cursor.y - placementDraft.note.height / 2),
      };
      setGraph((current) => ({ ...current, notes: [...current.notes, note] }));
      setSelection({ kind: "note", id: note.id });
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
    const retained = new Set(node.addresses);
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((entry) => (entry.id === node.id ? node : entry)),
      links: current.links.map((link) => ({
        ...link,
        fromAddress:
          link.from === node.id && link.fromAddress && !retained.has(link.fromAddress)
            ? null
            : link.fromAddress,
        toAddress:
          link.to === node.id && link.toAddress && !retained.has(link.toAddress)
            ? null
            : link.toAddress,
      })),
      roots: root
        ? current.roots.includes(node.id)
          ? current.roots
          : [...current.roots, node.id]
        : current.roots.filter((id) => id !== node.id),
    }));
  }

  function patchNote(id: string, patch: Partial<NetworkMapNote>) {
    setGraph((current) => ({
      ...current,
      notes: current.notes.map((note) => (note.id === id ? { ...note, ...patch } : note)),
    }));
  }

  function patchLink(id: string, patch: Partial<NetworkLink>) {
    setGraph((current) => ({
      ...current,
      links: current.links.map((link) => (link.id === id ? { ...link, ...patch } : link)),
    }));
  }

  function removeNode(id: string) {
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
    setGraph((current) => ({ ...current, notes: current.notes.filter((note) => note.id !== id) }));
    setSelection(null);
  }

  function toggleDown(kind: "node" | "link", id: string) {
    const setter = kind === "node" ? setDownNodes : setDownLinks;
    setter((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
  }

  function openNodeProperties(id: string) {
    const node = graph.nodes.find((entry) => entry.id === id);
    if (!node) return;
    setSelection({ kind: "node", id });
    setNodeDialog({
      node,
      root: graph.roots.includes(id),
      placement: false,
    });
  }

  function openNoteProperties(id: string) {
    const note = graph.notes.find((entry) => entry.id === id);
    if (!note) return;
    setSelection({ kind: "note", id });
    setNoteDialog({ note, placement: false });
  }

  function openLinkProperties(id: string) {
    const link = graph.links.find((entry) => entry.id === id);
    if (!link) return;
    setSelection({ kind: "link", id });
    setLinkDialog({ link });
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
      },
      root: graph.roots.includes(id),
      placement: true,
    });
  }

  function showNodeContextMenu(
    event: import("react").MouseEvent<Element, MouseEvent>,
    id: string,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (mode !== "design") return;
    if (placementDraft) {
      cancelPlacement();
      return;
    }
    setSelection({ kind: "node", id });
    void showNativeContextMenu(
      [
        {
          kind: "item",
          label: t("itops.actions.duplicate"),
          iconSvg: nativeMenuIcons.copy,
          action: () => duplicateNode(id),
        },
        {
          kind: "item",
          label: t("itops.actions.delete"),
          iconSvg: nativeMenuIcons.trash,
          action: () => removeNode(id),
        },
        { kind: "separator" },
        {
          kind: "item",
          label: t("common.properties"),
          iconSvg: nativeMenuIcons.pencil,
          action: () => openNodeProperties(id),
        },
      ],
      { x: event.clientX, y: event.clientY },
    );
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await saveNetworkMap(map.id, map.name, map.description, map.siteId ?? null, graph);
      setGraph(saved.graph);
      setSavedJson(JSON.stringify(saved.graph));
      showStatusBarNotice(t("itops.networkMap.savedNotice", { name: map.name }), {
        tone: "success",
      });
    } catch (error) {
      showStatusBarNotice(t("itops.errorNotice", { message: errorMessage(error) }), {
        tone: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nm-editor">
      <div className="nm-toolbar it-drill-toolbar">
        <div className="nm-mode-action-wrap">
          <button
            type="button"
            className="nm-mode-action"
            data-active={mode === "impact"}
            onClick={() => {
              setMode(mode === "impact" ? "design" : "impact");
              setSelection(null);
              cancelPlacement();
            }}
          >
            <ItIcon name={mode === "impact" ? "chevL" : "pulse"} size={13} />
            {t(
              mode === "impact"
                ? "itops.networkMap.modeDesign"
                : "itops.networkMap.modeImpact",
            )}
          </button>
        </div>
        <h2 className="nm-editor-title" title={map.name}>{map.name}</h2>
        <div className="it-drill-actions" aria-label={t("itops.actions.viewActions")}>
          <button
            type="button"
            className={`it-drill-action${mode === "design" ? " active" : ""}`}
            title={
              mode === "design"
                ? t("itops.actions.editDone")
                : t("itops.actions.edit")
            }
            aria-label={
              mode === "design"
                ? t("itops.actions.editDone")
                : t("itops.actions.edit")
            }
            aria-pressed={mode === "design"}
            onClick={() => {
              setMode(mode === "design" ? "view" : "design");
              setSelection(null);
              cancelPlacement();
            }}
          >
            <ItIcon name={mode === "design" ? "check" : "edit"} size={15} />
          </button>
          <button
            type="button"
            className="it-drill-action danger"
            title={t("itops.actions.delete")}
            aria-label={t("itops.actions.delete")}
            onClick={onDeleteMap}
          >
            <ItIcon name="trash" size={15} />
          </button>
          <button
            type="button"
            className="it-drill-action"
            title={t("itops.networkMap.importTitle")}
            aria-label={t("itops.networkMap.importTitle")}
            disabled={mode !== "design"}
            onClick={() => setImporting(true)}
          >
            <ItIcon name="download" size={15} />
          </button>
          <button
            type="button"
            className={`it-drill-action${dirty ? " active" : ""}`}
            title={dirty ? t("itops.networkMap.saveChanges") : t("itops.networkMap.saved")}
            aria-label={dirty ? t("itops.networkMap.saveChanges") : t("itops.networkMap.saved")}
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            <ItIcon name="check" size={15} />
          </button>
        </div>
      </div>

      <div className="nm-body">
        <div
          className="au-canvas nm-canvas"
          data-mode={mode}
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
            onConnect={onConnect}
            onInit={setFlowInstance}
            onNodeClick={(_event, node) => {
              if (placementDraft) return;
              if (node.type === "networkNote") {
                if (mode === "design") openNoteProperties(node.id);
                else if (mode === "view") setSelection({ kind: "note", id: node.id });
                return;
              }
              if (mode === "impact") toggleDown("node", node.id);
              else if (mode === "design") openNodeProperties(node.id);
              else setSelection({ kind: "node", id: node.id });
            }}
            onNodeDoubleClick={(_event, node) => {
              if (
                placementDraft ||
                mode !== "design" ||
                node.type !== "networkNode"
              ) {
                return;
              }
              openNodeProperties(node.id);
            }}
            onNodeContextMenu={(event, node) => {
              if (node.type !== "networkNode") return;
              showNodeContextMenu(event, node.id);
            }}
            onEdgeClick={(_event, edge) =>
              placementDraft
                ? undefined
                : mode === "impact"
                  ? toggleDown("link", edge.id)
                  : mode === "design"
                    ? openLinkProperties(edge.id)
                    : setSelection({ kind: "link", id: edge.id })
            }
            onPaneClick={() => {
              if (!placementDraft) setSelection(null);
            }}
            nodesDraggable={mode === "design" && !placementDraft}
            nodesConnectable={mode === "design" && !placementDraft}
            deleteKeyCode={null}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

        {mode !== "view" ? (
          <aside className="au-side nm-side kk-surface">
            <div className="au-side-in">
              {mode === "impact" ? (
              <ImpactPanel
                analysis={analysis}
                weakPoints={weakPoints}
                stranded={stranded}
                graph={graph}
                onRestore={toggleDown}
                onReset={() => {
                  setDownNodes([]);
                  setDownLinks([]);
                }}
              />
              ) : (
                <>
                <div className="au-side-title">{t("itops.networkMap.paletteLabel")}</div>
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
                              style={{ "--nm-node-accent": NODE_STYLE[kind].accent } as CSSProperties}
                            >
                              <NetworkNodeArtwork kind={kind} size={30} />
                            </span>
                            <span>{t(`itops.networkMap.nodeKind.${kind}`)}</span>
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                  <section className="nm-picker-group">
                    <h3>{t("itops.networkMap.annotationCategory")}</h3>
                    <button
                      type="button"
                      className="nm-picker-card nm-picker-note"
                      onClick={configureNewNote}
                    >
                      <span className="nm-picker-note-preview">Aa</span>
                      <span>{t("itops.networkMap.noteElement")}</span>
                    </button>
                  </section>
                </div>
                <VlanLegend
                  vlans={vlans}
                  usage={vlanUsage}
                  spotlightVlanId={spotlightVlanId}
                  onSpotlight={setSpotlightVlanId}
                />
                <dl className="nm-stats">
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
                {graph.roots.length === 0 && graph.nodes.length > 0 ? (
                  <p className="nm-notice">{t("itops.networkMap.noRootsHint")}</p>
                ) : null}
                </>
              )}
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
          onClose={() => setNodeDialog(null)}
          onDelete={
            nodeDialog.placement ? undefined : () => removeNode(nodeDialog.node.id)
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
            noteDialog.placement ? undefined : () => removeNote(noteDialog.note.id)
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
          onSubmit={(link) => patchLink(link.id, link)}
        />
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

function ImpactPanel({
  analysis,
  weakPoints,
  stranded,
  graph,
  onRestore,
  onReset,
}: {
  analysis: ReturnType<typeof analyzeWhatIf>;
  weakPoints: ReturnType<typeof findWeakPoints>;
  stranded: NetworkNode[];
  graph: NetworkGraph;
  onRestore: (kind: "node" | "link", id: string) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const unnamed = t("itops.networkMap.unnamedNode");
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const name = (id: string) => endpointName(byId, id, unnamed);
  const linkName = (id: string) => {
    const link = graph.links.find((entry) => entry.id === id);
    if (!link) return id;
    return link.label.trim() || `${name(link.from)} ↔ ${name(link.to)}`;
  };

  const touched = analysis.down.length + analysis.downLinks.length > 0;
  return (
    <>
      <div className="au-side-title">{t("itops.networkMap.impactHeading")}</div>
      <p className="au-side-hint">{t("itops.networkMap.impactHint")}</p>

      <div className="nm-impact-summary" data-tone={analysis.isolated.length > 0 ? "bad" : "ok"}>
        <strong>{analysis.isolated.length}</strong>
        <span>
          {t("itops.networkMap.impactSummary", { total: graph.nodes.length })}
        </span>
      </div>

      {analysis.isolated.length > 0 ? (
        <div className="nm-impact-list">
          <span className="nm-impact-caption">{t("itops.networkMap.isolatedHeading")}</span>
          {analysis.isolated.map((id) => (
            <span key={id} className="nm-chip" data-tone="bad">
              {name(id)}
            </span>
          ))}
        </div>
      ) : null}

      {touched ? (
        <div className="nm-impact-list">
          <span className="nm-impact-caption">{t("itops.networkMap.downHeading")}</span>
          {analysis.down.map((id) => (
            <button key={id} type="button" className="nm-chip" onClick={() => onRestore("node", id)}>
              {name(id)}
              <ItIcon name="xmark" size={11} />
            </button>
          ))}
          {analysis.downLinks.map((id) => (
            <button key={id} type="button" className="nm-chip" onClick={() => onRestore("link", id)}>
              {linkName(id)}
              <ItIcon name="xmark" size={11} />
            </button>
          ))}
          <Btn sm onClick={onReset}>
            <span className="nm-btn-ic">
              <ItIcon name="rotateL" size={12} />
            </span>
            {t("itops.networkMap.resetImpact")}
          </Btn>
        </div>
      ) : null}

      {weakPoints.length > 0 ? (
        <div className="nm-weak">
          <span className="nm-impact-caption">{t("itops.networkMap.weakHeading")}</span>
          <p className="au-side-hint">{t("itops.networkMap.weakHint")}</p>
          {weakPoints.slice(0, 6).map((point) => (
            <div key={`${point.kind}:${point.id}`} className="nm-weak-row">
              <ItIcon name={point.kind === "node" ? "server" : "link"} size={12} />
              <span>{point.kind === "node" ? name(point.id) : linkName(point.id)}</span>
              <small>{t("itops.networkMap.weakIsolates", { count: point.isolates })}</small>
            </div>
          ))}
        </div>
      ) : null}

      {stranded.length > 0 ? (
        <p className="nm-notice">
          {t("itops.networkMap.strandedHint", {
            count: stranded.length,
            names: stranded.map((node) => nodeLabel(node, unnamed)).join(", "),
          })}
        </p>
      ) : null}
    </>
  );
}

export function NetworkMapDesigner({
  active,
  selectedMapId,
  onSelectedMapIdChange,
}: {
  active: boolean;
  selectedMapId?: string;
  onSelectedMapIdChange?: (id: string) => void;
}) {
  const { t } = useTranslation();
  const maps = useItOpsStore((state) => state.networkMaps);
  const sites = useItOpsStore((state) => state.sites);
  const loaded = useItOpsStore((state) => state.networkMapsLoaded);
  const loadNetworkMaps = useItOpsStore((state) => state.loadNetworkMaps);
  const removeNetworkMap = useItOpsStore((state) => state.removeNetworkMap);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);

  const [localSelectedId, setLocalSelectedId] = useState("");
  const selectedId = selectedMapId ?? localSelectedId;
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<NetworkMap | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<NetworkMap | null>(null);

  useEffect(() => {
    if (!loaded) void loadNetworkMaps().catch(() => undefined);
  }, [loaded, loadNetworkMaps]);

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
            onDeleteMap={() => setPendingDelete(selected)}
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
              <div className="nm-gallery-actions">
                <button
                  type="button"
                  className="it-icon-btn"
                  aria-label={t("common.properties")}
                  onClick={() => setDialog(map)}
                >
                  <ItIcon name="edit" size={13} />
                </button>
                <button
                  type="button"
                  className="it-icon-btn"
                  aria-label={t("itops.actions.delete")}
                  onClick={() => setPendingDelete(map)}
                >
                  <ItIcon name="trash" size={13} />
                </button>
              </div>
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
