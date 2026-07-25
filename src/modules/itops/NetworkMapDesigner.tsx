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
import { ItIcon, IT_ACCENTS, type ItIconName } from "./icons";
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
const NODE_STYLE: Record<NetworkNodeKind, { icon: ItIconName; accent: string }> = {
  router: { icon: "network", accent: IT_ACCENTS.indigo },
  switch: { icon: "grid", accent: IT_ACCENTS.blue },
  firewall: { icon: "filter", accent: IT_ACCENTS.orange },
  server: { icon: "server", accent: IT_ACCENTS.steel },
  loadBalancer: { icon: "share", accent: IT_ACCENTS.teal },
  cloud: { icon: "globe", accent: IT_ACCENTS.purple },
};

// Card geometry is fixed so link anchors can be picked from coordinates alone.
const NODE_WIDTH = 158;
const NODE_HEIGHT = 56;

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
        <ItIcon name={style.icon} size={15} />
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

function MapDialog({ map, onClose }: { map: NetworkMap | null; onClose: () => void }) {
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
      if (map) await saveNetworkMap(map.id, name.trim(), description, siteId || null, map.graph);
      else await createNetworkMap(name.trim(), description, siteId || null);
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

function MapEditor({ map }: { map: NetworkMap }) {
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
      return [
        {
          id: link.id,
          source: link.from,
          target: link.to,
          sourceHandle: source,
          targetHandle: target,
          label: link.label || undefined,
          className: `nm-edge ${link.kind} ${state}${
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
        <div className="it-drill-spacer" />
        <div className="it-room-view-controls">
          <div
            className="rm-segmented"
            role="group"
            aria-label={t("itops.networkMap.heading")}
          >
            <button
              type="button"
              data-active={mode === "design"}
              onClick={() => {
                setMode("design");
                setSelection(null);
              }}
            >
              <ItIcon name="edit" size={13} />
              {t("itops.networkMap.modeDesign")}
            </button>
            <button
              type="button"
              data-active={mode === "impact"}
              onClick={() => {
                setMode("impact");
                setSelection(null);
              }}
            >
              <ItIcon name="pulse" size={13} />
              {t("itops.networkMap.modeImpact")}
            </button>
          </div>
        </div>
        <div className="it-drill-actions" aria-label={t("itops.actions.viewActions")}>
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
                        <ItIcon name={NODE_STYLE[kind].icon} size={18} />
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

export function NetworkMapDesigner() {
  const { t } = useTranslation();
  const maps = useItOpsStore((state) => state.networkMaps);
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

  const selected = maps.find((map) => map.id === selectedId) ?? maps[0];

  async function confirmDelete() {
    if (!pendingDelete) return;
    const map = pendingDelete;
    setPendingDelete(null);
    try {
      await removeNetworkMap(map.id);
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

      {maps.length > 0 ? (
        <>
          <div className="nm-tabs" role="tablist" aria-label={t("itops.networkMap.heading")}>
            {maps.map((map) => (
              <div key={map.id} className={`nm-tab${map.id === selected?.id ? " active" : ""}`}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={map.id === selected?.id}
                  onClick={() => setSelectedId(map.id)}
                >
                  <ItIcon name="network" size={13} />
                  {map.name}
                </button>
                {map.id === selected?.id ? (
                  <>
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
                  </>
                ) : null}
              </div>
            ))}
          </div>
          {/* Keyed by id so switching maps starts a fresh draft rather than
              carrying the previous map's unsaved edits across. */}
          {selected ? <MapEditor key={selected.id} map={selected} /> : null}
        </>
      ) : loaded ? (
        <ItOpsEmptyHint>{t("itops.networkMap.emptyBody")}</ItOpsEmptyHint>
      ) : null}

      {dialog !== undefined ? (
        <MapDialog map={dialog} onClose={() => setDialog(undefined)} />
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
