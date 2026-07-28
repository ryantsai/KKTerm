import type {
  LayoutNode,
  SplitDirection,
  SplitOrientation,
  StoredConnectionLayout,
  StoredLayoutPane,
  StoredLayoutNode,
  WorkspacePane,
} from "../../types";

export function defaultLayoutFor(panes: WorkspacePane[]): LayoutNode | undefined {
  if (panes.length === 0) {
    return undefined;
  }
  if (panes.length === 1) {
    return { type: "leaf", paneId: panes[0].id };
  }
  return {
    type: "split",
    orientation: "horizontal",
    children: panes.map((pane) => ({ type: "leaf", paneId: pane.id })),
  };
}

export function panoramaLayoutFor(panes: WorkspacePane[]): LayoutNode | undefined {
  if (panes.length <= 2) {
    return defaultLayoutFor(panes);
  }

  const leaf = (pane: WorkspacePane): LayoutNode => ({ type: "leaf", paneId: pane.id });
  const rowCount = Math.max(2, Math.floor(Math.sqrt(panes.length)));
  const baseRowSize = Math.floor(panes.length / rowCount);
  const largerRowCount = panes.length % rowCount;
  const rows: LayoutNode[] = [];
  let offset = 0;

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowSize = baseRowSize + (rowIndex < largerRowCount ? 1 : 0);
    const rowPanes = panes.slice(offset, offset + rowSize);
    offset += rowSize;
    rows.push(
      rowPanes.length === 1
        ? leaf(rowPanes[0]!)
        : {
            type: "split",
            orientation: "horizontal",
            children: rowPanes.map(leaf),
          },
    );
  }

  return {
    type: "split",
    orientation: "vertical",
    children: rows,
  };
}

export function reconcilePanoramaLayout(
  layout: LayoutNode | undefined,
  panes: WorkspacePane[],
): LayoutNode | undefined {
  const next = ensureLayout(layout, panes);
  if (
    panes.length > 3 &&
    next?.type === "split" &&
    next.orientation === "horizontal" &&
    next.children.every((child) => child.type === "leaf")
  ) {
    return panoramaLayoutFor(panes);
  }
  return next;
}

export function ensureLayout(layout: LayoutNode | undefined, panes: WorkspacePane[]): LayoutNode | undefined {
  if (!layout) {
    return defaultLayoutFor(panes);
  }
  const known = collectLeafIds(layout);
  const paneIds = new Set(panes.map((pane) => pane.id));
  const missing = panes.filter((pane) => !known.has(pane.id));
  let next = pruneMissingLeaves(layout, paneIds) ?? defaultLayoutFor(panes);
  for (const pane of missing) {
    next = appendLeaf(next, pane.id);
  }
  return next;
}

export function collectLeafIds(node: LayoutNode): Set<string> {
  const set = new Set<string>();
  walkLeaves(node, (id) => set.add(id));
  return set;
}

export function leafOrder(node: LayoutNode | undefined): string[] {
  const ids: string[] = [];
  if (!node) {
    return ids;
  }
  walkLeaves(node, (id) => ids.push(id));
  return ids;
}

function walkLeaves(node: LayoutNode, visit: (paneId: string) => void) {
  if (node.type === "leaf") {
    visit(node.paneId);
    return;
  }
  for (const child of node.children) {
    walkLeaves(child, visit);
  }
}

function pruneMissingLeaves(node: LayoutNode, paneIds: Set<string>): LayoutNode | undefined {
  if (node.type === "leaf") {
    return paneIds.has(node.paneId) ? node : undefined;
  }
  const children = node.children
    .map((child) => pruneMissingLeaves(child, paneIds))
    .filter((child): child is LayoutNode => Boolean(child));
  if (children.length === 0) {
    return undefined;
  }
  if (children.length === 1) {
    // Keep the surviving leaf under the same split ancestry. Terminal Panes
    // own live xterm renderers, and collapsing this wrapper reparents the
    // surviving React component, destroying screen modes and tmux state even
    // when the underlying SSH Session is preserved.
    return { ...node, children };
  }
  return { ...node, children };
}

function appendLeaf(node: LayoutNode | undefined, paneId: string): LayoutNode {
  const leaf: LayoutNode = { type: "leaf", paneId };
  if (!node) {
    return leaf;
  }
  if (node.type === "split" && node.orientation === "horizontal") {
    return { ...node, children: [...node.children, leaf] };
  }
  return { type: "split", orientation: "horizontal", children: [node, leaf] };
}

export function orientationFor(direction: SplitDirection): SplitOrientation {
  return direction === "right" || direction === "left" ? "horizontal" : "vertical";
}

function placeBefore(direction: SplitDirection): boolean {
  return direction === "left" || direction === "up";
}

export function splitLayout(
  layout: LayoutNode | undefined,
  focusedPaneId: string | undefined,
  direction: SplitDirection,
  newPaneId: string,
  paneIds: string[],
): LayoutNode {
  const orientation = orientationFor(direction);
  const before = placeBefore(direction);
  const fallbackTarget = focusedPaneId && paneIds.includes(focusedPaneId)
    ? focusedPaneId
    : paneIds[paneIds.length - 1];

  if (!layout) {
    return { type: "leaf", paneId: newPaneId };
  }

  const updated = trySplit(layout, fallbackTarget, orientation, before, newPaneId);
  if (updated) {
    return updated;
  }

  // Focused pane not found; wrap entire layout.
  return {
    type: "split",
    orientation,
    children: before
      ? [{ type: "leaf", paneId: newPaneId }, layout]
      : [layout, { type: "leaf", paneId: newPaneId }],
  };
}

function trySplit(
  node: LayoutNode,
  focusedPaneId: string | undefined,
  orientation: SplitOrientation,
  before: boolean,
  newPaneId: string,
): LayoutNode | null {
  if (node.type === "leaf") {
    if (node.paneId !== focusedPaneId) {
      return null;
    }
    return {
      type: "split",
      orientation,
      children: before
        ? [{ type: "leaf", paneId: newPaneId }, node]
        : [node, { type: "leaf", paneId: newPaneId }],
    };
  }

  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i];
    if (child.type === "leaf" && child.paneId === focusedPaneId) {
      if (node.orientation === orientation) {
        const children = [...node.children];
        children.splice(before ? i : i + 1, 0, { type: "leaf", paneId: newPaneId });
        return { ...node, children };
      }
      const wrapped: LayoutNode = {
        type: "split",
        orientation,
        children: before
          ? [{ type: "leaf", paneId: newPaneId }, child]
          : [child, { type: "leaf", paneId: newPaneId }],
      };
      const children = [...node.children];
      children[i] = wrapped;
      return { ...node, children };
    }
  }

  for (let i = 0; i < node.children.length; i += 1) {
    const child = node.children[i];
    if (child.type === "split") {
      const updated = trySplit(child, focusedPaneId, orientation, before, newPaneId);
      if (updated) {
        const children = [...node.children];
        children[i] = updated;
        return { ...node, children };
      }
    }
  }

  return null;
}

export function serializeLayout(
  layout: LayoutNode,
  panes: WorkspacePane[],
): StoredConnectionLayout | undefined {
  const indexById = new Map(panes.map((pane, index) => [pane.id, index] as const));
  const stored = serializeNode(layout, indexById);
  if (!stored) {
    return undefined;
  }
  const storedPanes: StoredLayoutPane[] = [];
  for (const pane of panes) {
    const connection = pane.connection ?? panes[0]?.connection;
    if (!connection) {
      continue;
    }
    storedPanes.push({
      kind: pane.kind,
      connection,
      title: pane.title,
      cwd: "cwd" in pane ? pane.cwd : undefined,
      fontSize: "fontSize" in pane ? pane.fontSize : undefined,
      textEncoding: "textEncoding" in pane ? pane.textEncoding : undefined,
      terminalBackground: "terminalBackground" in pane ? pane.terminalBackground : undefined,
      tmuxSessionId: "tmuxSessionId" in pane ? pane.tmuxSessionId : undefined,
      url: pane.kind === "webview" ? pane.url : undefined,
      dataPartition: pane.kind === "webview" ? pane.dataPartition : undefined,
    });
  }
  return { paneCount: panes.length, layout: stored, panes: storedPanes };
}

function serializeNode(
  node: LayoutNode,
  indexById: Map<string, number>,
): StoredLayoutNode | undefined {
  if (node.type === "leaf") {
    const index = indexById.get(node.paneId);
    if (index === undefined) {
      return undefined;
    }
    return { type: "leaf", paneIndex: index };
  }
  const children = node.children
    .map((child) => serializeNode(child, indexById))
    .filter((child): child is StoredLayoutNode => Boolean(child));
  if (children.length === 0) {
    return undefined;
  }
  if (children.length === 1) {
    return children[0];
  }
  return { type: "split", orientation: node.orientation, children };
}

export function hydrateLayout(
  stored: StoredLayoutNode,
  paneIds: string[],
): LayoutNode | undefined {
  if (stored.type === "leaf") {
    const id = paneIds[stored.paneIndex];
    return id ? { type: "leaf", paneId: id } : undefined;
  }
  const children = stored.children
    .map((child) => hydrateLayout(child, paneIds))
    .filter((child): child is LayoutNode => Boolean(child));
  if (children.length === 0) {
    return undefined;
  }
  if (children.length === 1) {
    return children[0];
  }
  return { type: "split", orientation: stored.orientation, children };
}
