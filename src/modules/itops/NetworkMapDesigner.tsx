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

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Connection as FlowConnection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
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
  TextArea,
  TextInput,
} from "../../app/ui/dialog";
import { useWorkspaceStore } from "../../store";
import type {
  NetworkGraph,
  NetworkLink,
  NetworkLinkKind,
  NetworkMap,
  NetworkNode,
  NetworkNodeKind,
  SiteHost,
} from "../../types";
import { ItIcon, IT_ACCENTS } from "./icons";
import { ItOpsEmptyHint } from "./ItOpsEmptyHint";
import {
  analyzeWhatIf,
  effectiveRoots,
  findStrandedNodes,
  findWeakPoints,
} from "./reachability";
import { useItOpsStore } from "./state";

const NODE_KINDS: NetworkNodeKind[] = [
  "router",
  "switch",
  "firewall",
  "server",
  "loadBalancer",
  "cloud",
];
const LINK_KINDS: NetworkLinkKind[] = ["ethernet", "fiber", "wan", "wireless"];

/** Glyph and accent per device kind, so a map reads at a glance while zoomed out. */
const NODE_STYLE: Record<NetworkNodeKind, { accent: string }> = {
  router: { accent: IT_ACCENTS.indigo },
  switch: { accent: IT_ACCENTS.blue },
  firewall: { accent: IT_ACCENTS.orange },
  server: { accent: IT_ACCENTS.steel },
  loadBalancer: { accent: IT_ACCENTS.teal },
  cloud: { accent: IT_ACCENTS.purple },
};

// Card geometry is fixed so link anchors can be picked from coordinates alone.
const NODE_WIDTH = 196;
const NODE_HEIGHT = 72;

function newId(prefix: string): string {
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${id}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Node state drives the card's themed treatment; never a hard-coded colour. */
type NodeState = "up" | "down" | "isolated";

interface MapNodeData extends Record<string, unknown> {
  label: string;
  sub: string;
  kind: NetworkNodeKind;
  state: NodeState;
  root: boolean;
  selected: boolean;
  rootLabel: string;
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
    switch: (
      <>
        <rect x="5.5" y="8" width="21" height="16" rx="4" />
        <path d="M10 13h3M16 13h3M22 13h1M10 19h3M16 19h3M22 19h1" />
      </>
    ),
    firewall: (
      <>
        <path d="M6.5 24V9.5L16 5l9.5 4.5V24L16 28Z" />
        <path d="M7 14h18M7 20h18M12 8v6M19.5 7.5V14M12 14v6M20 14v6M12 20v5.5M20 20v5.5" />
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
    cloud: (
      <>
        <path d="M9 24.5h14.5a5 5 0 0 0 .6-10A8.2 8.2 0 0 0 8.5 13 5.8 5.8 0 0 0 9 24.5Z" />
        <path d="M12 19h8" />
      </>
    ),
  }[kind];

  return (
    <svg
      className="nm-device-art"
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
  const style = NODE_STYLE[data.kind];
  return (
    <div
      className={`nm-node${data.selected ? " sel" : ""}`}
      data-state={data.state}
      data-root={data.root ? "true" : undefined}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
    >
      {/* One stacked source/target pair per side: links are undirected, and the
          edge builder picks the side facing the far end. */}
      {[Position.Left, Position.Right, Position.Top, Position.Bottom].map((position) => (
        <span key={position}>
          <Handle type="target" id={position} position={position} className="nm-handle" />
          <Handle type="source" id={position} position={position} className="nm-handle" />
        </span>
      ))}
      <span className="nm-node-ic" style={{ background: style.accent }}>
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
    </div>
  );
}

const nodeTypes = { networkNode: MapNode };

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
  const dx = to.x - from.x;
  const dy = to.y - from.y;
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
  return node.label.trim() || node.address.trim() || fallback;
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
    address: host.hostname,
    hostId: host.id,
    connectionId: host.connectionIds[0] ?? null,
    rackItemId: null,
    note: "",
  }));
}

function MapDialog({
  map,
  onSaved,
  onClose,
}: {
  map: NetworkMap | null;
  onSaved: (saved: NetworkMap) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createNetworkMap = useItOpsStore((state) => state.createNetworkMap);
  const saveNetworkMap = useItOpsStore((state) => state.saveNetworkMap);
  const sites = useItOpsStore((state) => state.sites);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [name, setName] = useState(map?.name ?? "");
  const [description, setDescription] = useState(map?.description ?? "");
  const [siteId, setSiteId] = useState(map?.siteId ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const saved = map
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
        title={map ? t("itops.networkMap.editMapTitle") : t("itops.networkMap.newMapTitle")}
        sub={t("itops.networkMap.mapDialogSub")}
        footer={
          <Actions
            cancel={<Btn onClick={onClose}>{t("itops.actions.cancel")}</Btn>}
            primary={
              <Btn kind="primary" icon="check" onClick={() => void save()} disabled={!name.trim() || busy}>
                {t("itops.actions.save")}
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

type EditorMode = "design" | "impact";
type Selection = { kind: "node" | "link"; id: string } | null;

function MapEditor({
  map,
  onEditMap,
  onDeleteMap,
}: {
  map: NetworkMap;
  onEditMap: () => void;
  onDeleteMap: () => void;
}) {
  const { t } = useTranslation();
  const saveNetworkMap = useItOpsStore((state) => state.saveNetworkMap);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);

  const [graph, setGraph] = useState<NetworkGraph>(map.graph);
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(map.graph));
  const [mode, setMode] = useState<EditorMode>("design");
  const [selection, setSelection] = useState<Selection>(null);
  const [downNodes, setDownNodes] = useState<string[]>([]);
  const [downLinks, setDownLinks] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);

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
  const nodes = useMemo<Node<MapNodeData>[]>(() => {
    const downSet = new Set(analysis.down);
    const isolatedSet = new Set(analysis.isolated);
    return graph.nodes.map((node) => ({
      id: node.id,
      type: "networkNode",
      position: { x: node.x, y: node.y },
      data: {
        label: nodeLabel(node, unnamed),
        sub: node.address || t(`itops.networkMap.nodeKind.${node.kind}`),
        kind: node.kind,
        state: downSet.has(node.id) ? "down" : isolatedSet.has(node.id) ? "isolated" : "up",
        root: rootIds.has(node.id),
        selected: selection?.kind === "node" && selection.id === node.id,
        rootLabel: t("itops.networkMap.rootBadge"),
      },
    }));
  }, [analysis.down, analysis.isolated, graph.nodes, rootIds, selection, t, unnamed]);

  const edges = useMemo<Edge[]>(() => {
    const severed = new Set(analysis.severedLinks);
    const cut = new Set(downLinks);
    return graph.links.flatMap((link) => {
      const from = nodesById.get(link.from);
      const to = nodesById.get(link.to);
      if (!from || !to) return [];
      const { source, target } = anchors(from, to);
      const state = cut.has(link.id) ? "cut" : severed.has(link.id) ? "severed" : "up";
      const label = [
        link.label.trim(),
        link.speed.trim(),
        link.connectionCount > 1 ? `×${link.connectionCount}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      return [
        {
          id: link.id,
          source: link.from,
          target: link.to,
          sourceHandle: source,
          targetHandle: target,
          label: label || undefined,
          animated: state === "up",
          className: `nm-edge ${link.kind} ${state}${link.connectionCount > 1 ? " multi" : ""}${
            selection?.kind === "link" && selection.id === link.id ? " sel" : ""
          }`,
        },
      ];
    });
  }, [analysis.severedLinks, downLinks, graph.links, nodesById, selection]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    // Only drags matter: everything else about a node lives in the side panel.
    setGraph((current) => {
      let next = current.nodes;
      for (const change of changes) {
        if (change.type !== "position" || !change.position) continue;
        const position = change.position;
        next = next.map((node) =>
          node.id === change.id
            ? { ...node, x: Math.round(position.x), y: Math.round(position.y) }
            : node,
        );
      }
      return next === current.nodes ? current : { ...current, nodes: next };
    });
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
      const link: NetworkLink = {
        id: newId("nml"),
        from: connection.source!,
        to: connection.target!,
        label: "",
        kind: "ethernet",
        connectionCount: 1,
        speed: "",
      };
      return { ...current, links: [...current.links, link] };
    });
  }, []);

  function addNode(kind: NetworkNodeKind) {
    const node: NetworkNode = {
      id: newId("nmn"),
      label: "",
      kind,
      x: 60 + (graph.nodes.length % 4) * (NODE_WIDTH + 46),
      y: 60 + Math.floor(graph.nodes.length / 4) * (NODE_HEIGHT + 54),
      address: "",
      hostId: null,
      connectionId: null,
      rackItemId: null,
      note: "",
    };
    setGraph((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelection({ kind: "node", id: node.id });
  }

  function patchNode(id: string, patch: Partial<NetworkNode>) {
    setGraph((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
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

  function toggleRoot(id: string) {
    setGraph((current) => ({
      ...current,
      roots: current.roots.includes(id)
        ? current.roots.filter((root) => root !== id)
        : [...current.roots, id],
    }));
  }

  function toggleDown(kind: "node" | "link", id: string) {
    const setter = kind === "node" ? setDownNodes : setDownLinks;
    setter((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
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

  const selectedNode =
    selection?.kind === "node" ? graph.nodes.find((node) => node.id === selection.id) : undefined;
  const selectedLink =
    selection?.kind === "link" ? graph.links.find((link) => link.id === selection.id) : undefined;

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
        <div className="it-drill-actions" aria-label={t("itops.actions.viewActions")}>
          <button
            type="button"
            className="it-drill-action"
            title={t("itops.actions.edit")}
            aria-label={t("itops.actions.edit")}
            onClick={onEditMap}
          >
            <ItIcon name="edit" size={15} />
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
            disabled={mode === "impact"}
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
        <div className="au-canvas nm-canvas" data-mode={mode}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onConnect={onConnect}
            onNodeClick={(_event, node) =>
              mode === "impact" ? toggleDown("node", node.id) : setSelection({ kind: "node", id: node.id })
            }
            onEdgeClick={(_event, edge) =>
              mode === "impact" ? toggleDown("link", edge.id) : setSelection({ kind: "link", id: edge.id })
            }
            onPaneClick={() => setSelection(null)}
            nodesDraggable={mode === "design"}
            nodesConnectable={mode === "design"}
            deleteKeyCode={null}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={18} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>

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
            ) : selectedNode ? (
              <>
                <div className="au-side-title">{t("itops.networkMap.nodeHeading")}</div>
                <Field label={t("itops.networkMap.labelLabel")}>
                  <TextInput
                    value={selectedNode.label}
                    placeholder={t("itops.networkMap.labelPlaceholder")}
                    onChange={(event) => patchNode(selectedNode.id, { label: event.currentTarget.value })}
                  />
                </Field>
                <Field label={t("itops.networkMap.kindLabel")}>
                  <Select
                    value={selectedNode.kind}
                    onChange={(event) =>
                      patchNode(selectedNode.id, {
                        kind: event.currentTarget.value as NetworkNodeKind,
                      })
                    }
                    options={NODE_KINDS.map((kind) => ({
                      value: kind,
                      label: t(`itops.networkMap.nodeKind.${kind}`),
                    }))}
                  />
                </Field>
                <Field label={t("itops.networkMap.addressLabel")} hint={t("itops.networkMap.addressHint")}>
                  <TextInput
                    mono
                    value={selectedNode.address}
                    placeholder={t("itops.networkMap.addressPlaceholder")}
                    onChange={(event) => patchNode(selectedNode.id, { address: event.currentTarget.value })}
                  />
                </Field>
                <label className="nm-root-toggle">
                  <input
                    type="checkbox"
                    checked={graph.roots.includes(selectedNode.id)}
                    onChange={() => toggleRoot(selectedNode.id)}
                  />
                  <span>
                    <strong>{t("itops.networkMap.rootLabel")}</strong>
                    <small>{t("itops.networkMap.rootHint")}</small>
                  </span>
                </label>
                <Field label={t("itops.networkMap.noteLabel")}>
                  <TextArea
                    rows={3}
                    value={selectedNode.note}
                    onChange={(event) => patchNode(selectedNode.id, { note: event.currentTarget.value })}
                  />
                </Field>
                <Btn kind="danger" icon="trash" onClick={() => removeNode(selectedNode.id)}>
                  {t("itops.networkMap.removeNode")}
                </Btn>
              </>
            ) : selectedLink ? (
              <>
                <div className="au-side-title">{t("itops.networkMap.linkHeading")}</div>
                <p className="au-side-hint">
                  {t("itops.networkMap.linkBetween", {
                    from: endpointName(nodesById, selectedLink.from, unnamed),
                    to: endpointName(nodesById, selectedLink.to, unnamed),
                  })}
                </p>
                <Field label={t("itops.networkMap.linkLabelLabel")} hint={t("itops.networkMap.linkLabelHint")}>
                  <TextInput
                    value={selectedLink.label}
                    placeholder={t("itops.networkMap.linkLabelPlaceholder")}
                    onChange={(event) => patchLink(selectedLink.id, { label: event.currentTarget.value })}
                  />
                </Field>
                <Field label={t("itops.networkMap.linkKindLabel")}>
                  <Select
                    value={selectedLink.kind}
                    onChange={(event) =>
                      patchLink(selectedLink.id, {
                        kind: event.currentTarget.value as NetworkLinkKind,
                      })
                    }
                    options={LINK_KINDS.map((kind) => ({
                      value: kind,
                      label: t(`itops.networkMap.linkKind.${kind}`),
                    }))}
                  />
                </Field>
                <div className="nm-link-meta-grid">
                  <Field label={t("itops.networkMap.linkCountLabel")}>
                    <TextInput
                      mono
                      type="number"
                      min={1}
                      max={64}
                      step={1}
                      value={selectedLink.connectionCount}
                      onChange={(event) => {
                        const value = Number.parseInt(event.currentTarget.value, 10);
                        patchLink(selectedLink.id, {
                          connectionCount: Number.isFinite(value)
                            ? Math.min(64, Math.max(1, value))
                            : 1,
                        });
                      }}
                    />
                  </Field>
                  <Field label={t("itops.networkMap.linkSpeedLabel")}>
                    <TextInput
                      mono
                      value={selectedLink.speed}
                      placeholder={t("itops.networkMap.linkSpeedPlaceholder")}
                      onChange={(event) =>
                        patchLink(selectedLink.id, { speed: event.currentTarget.value })
                      }
                    />
                  </Field>
                </div>
                <Btn kind="danger" icon="trash" onClick={() => removeLink(selectedLink.id)}>
                  {t("itops.networkMap.removeLink")}
                </Btn>
              </>
            ) : (
              <>
                <div className="au-side-title">{t("itops.networkMap.paletteLabel")}</div>
                <div
                  className="nm-picker-grid"
                  role="group"
                  aria-label={t("itops.networkMap.paletteLabel")}
                >
                  {NODE_KINDS.map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      className="nm-picker-card"
                      onClick={() => addNode(kind)}
                    >
                      <span
                        className="nm-picker-ic"
                        style={{ background: NODE_STYLE[kind].accent }}
                      >
                        <NetworkNodeArtwork kind={kind} size={30} />
                      </span>
                      <span>{t(`itops.networkMap.nodeKind.${kind}`)}</span>
                    </button>
                  ))}
                </div>
                <p className="au-side-hint">{t("itops.networkMap.designHint")}</p>
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
    </div>
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

export function NetworkMapDesigner({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const maps = useItOpsStore((state) => state.networkMaps);
  const sites = useItOpsStore((state) => state.sites);
  const loaded = useItOpsStore((state) => state.networkMapsLoaded);
  const loadNetworkMaps = useItOpsStore((state) => state.loadNetworkMaps);
  const removeNetworkMap = useItOpsStore((state) => state.removeNetworkMap);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);

  const [selectedId, setSelectedId] = useState("");
  const [dialog, setDialog] = useState<NetworkMap | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<NetworkMap | null>(null);

  useEffect(() => {
    if (!loaded) void loadNetworkMaps().catch(() => undefined);
  }, [loaded, loadNetworkMaps]);

  useEffect(() => {
    if (!active) {
      setSelectedId("");
      setDialog(undefined);
      setPendingDelete(null);
    }
  }, [active]);

  const selected = maps.find((map) => map.id === selectedId);
  const siteNames = useMemo(
    () => new Map(sites.map((site) => [site.id, site.name])),
    [sites],
  );

  async function confirmDelete() {
    if (!pendingDelete) return;
    const map = pendingDelete;
    setPendingDelete(null);
    try {
      await removeNetworkMap(map.id);
      if (selectedId === map.id) setSelectedId("");
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

      {maps.length > 0 && selected ? (
        <div className="nm-detail">
          <div className="nm-detail-nav">
            <button
              type="button"
              className="nm-back"
              onClick={() => setSelectedId("")}
              aria-label={t("itops.actions.back")}
            >
              <ItIcon name="chevL" size={13} />
              {t("itops.actions.back")}
            </button>
            <div className="nm-tabs" role="tablist" aria-label={t("itops.networkMap.heading")}>
              {maps.map((map) => (
                <button
                  key={map.id}
                  type="button"
                  className="nm-tab"
                  role="tab"
                  aria-selected={map.id === selected.id}
                  data-active={map.id === selected.id}
                  onClick={() => setSelectedId(map.id)}
                >
                  <ItIcon name="network" size={13} />
                  <span>{map.name}</span>
                </button>
              ))}
            </div>
          </div>
          {/* Keyed by id so switching maps starts a fresh draft rather than
              carrying the previous map's unsaved edits across. */}
          <MapEditor
            key={selected.id}
            map={selected}
            onEditMap={() => setDialog(selected)}
            onDeleteMap={() => setPendingDelete(selected)}
          />
        </div>
      ) : maps.length > 0 ? (
        <div className="nm-gallery" role="list">
          {maps.map((map) => (
            <article key={map.id} className="nm-gallery-card" role="listitem">
              <button
                type="button"
                className="nm-gallery-open"
                onClick={() => setSelectedId(map.id)}
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
                  aria-label={t("itops.actions.edit")}
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
        <ItOpsEmptyHint>{t("itops.networkMap.emptyBody")}</ItOpsEmptyHint>
      ) : null}

      {dialog !== undefined ? (
        <MapDialog
          map={dialog}
          onSaved={(saved) => setSelectedId(saved.id)}
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
