// What-If analysis for the IT Ops Network Map (docs/ITOPS.md Network Map).
//
// Everything here is pure graph maths over the drawn map: no polling, no live
// device state. The "down" set is whatever the operator has switched off on the
// canvas — the question this answers is "if I take these out, what stops being
// reachable?", which is exactly the change-review question you want to ask
// before touching production, not a health readout.

import type { NetworkGraph, NetworkLink, NetworkNode } from "../../types";

export interface WhatIfSelection {
  /** Node ids the operator has switched off. */
  nodes: readonly string[];
  /** Link ids the operator has cut. */
  links: readonly string[];
}

export interface WhatIfResult {
  /** Entry points the walk actually started from. */
  roots: string[];
  /** Nodes still reachable from an up root over up links. */
  reachable: Set<string>;
  /** Nodes that are up themselves but have lost their path to every root. */
  isolated: string[];
  /** The down nodes, echoed back for rendering. */
  down: string[];
  /** Links dropped because they were cut or an endpoint went down. */
  severedLinks: string[];
}

/** A node or link whose single failure would isolate part of the map. */
export interface WeakPoint {
  kind: "node" | "link";
  id: string;
  /** How many otherwise-up nodes lose all paths to a root. */
  isolates: number;
}

interface Adjacency {
  nodeIds: string[];
  /** node id → links touching it. */
  edges: Map<string, NetworkLink[]>;
}

function buildAdjacency(graph: NetworkGraph): Adjacency {
  const nodeIds = graph.nodes.map((node) => node.id);
  const known = new Set(nodeIds);
  const edges = new Map<string, NetworkLink[]>();
  for (const id of nodeIds) edges.set(id, []);
  for (const link of graph.links) {
    // The backend sanitizes dangling endpoints on save; a map edited in this
    // session may still hold one, so tolerate it rather than throwing.
    if (!known.has(link.from) || !known.has(link.to) || link.from === link.to) continue;
    edges.get(link.from)?.push(link);
    edges.get(link.to)?.push(link);
  }
  return { nodeIds, edges };
}

/**
 * The entry points reachability is measured from. An explicit root list wins;
 * with none set, the first node stands in so a freshly drawn map still analyses
 * instead of reporting everything as isolated.
 */
export function effectiveRoots(graph: NetworkGraph): string[] {
  const known = new Set(graph.nodes.map((node) => node.id));
  const roots = graph.roots.filter((id) => known.has(id));
  if (roots.length > 0) return roots;
  const first = graph.nodes[0];
  return first ? [first.id] : [];
}

function walk(
  adjacency: Adjacency,
  roots: readonly string[],
  downNodes: ReadonlySet<string>,
  downLinks: ReadonlySet<string>,
): Set<string> {
  const reachable = new Set<string>();
  const queue: string[] = [];
  for (const root of roots) {
    if (downNodes.has(root) || reachable.has(root)) continue;
    reachable.add(root);
    queue.push(root);
  }
  // Breadth-first so the frontier stays shallow on the wide, flat maps people
  // actually draw; depth-first recursion would risk a stack blow-up on a chain.
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head]!;
    for (const link of adjacency.edges.get(current) ?? []) {
      if (downLinks.has(link.id)) continue;
      const next = link.from === current ? link.to : link.from;
      if (downNodes.has(next) || reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }
  return reachable;
}

/** Reachability under a hypothetical outage. Pure: same input, same answer. */
export function analyzeWhatIf(graph: NetworkGraph, selection: WhatIfSelection): WhatIfResult {
  const adjacency = buildAdjacency(graph);
  const downNodes = new Set(selection.nodes.filter((id) => adjacency.edges.has(id)));
  const downLinks = new Set(selection.links);
  const roots = effectiveRoots(graph);
  const reachable = walk(adjacency, roots, downNodes, downLinks);

  const isolated = adjacency.nodeIds.filter((id) => !downNodes.has(id) && !reachable.has(id));
  const severedLinks = graph.links
    .filter(
      (link) => downLinks.has(link.id) || downNodes.has(link.from) || downNodes.has(link.to),
    )
    .map((link) => link.id);

  return { roots, reachable, isolated, down: [...downNodes], severedLinks };
}

/**
 * Every single failure that would cut something off, worst first. Maps drawn by
 * hand stay small, so re-walking once per candidate is cheap and keeps the rule
 * obvious — an articulation-point algorithm would be faster and far harder to
 * trust against the same definition of "isolated" used above.
 */
export function findWeakPoints(graph: NetworkGraph): WeakPoint[] {
  const adjacency = buildAdjacency(graph);
  const roots = effectiveRoots(graph);
  if (roots.length === 0) return [];
  const total = adjacency.nodeIds.length;

  const points: WeakPoint[] = [];
  for (const id of adjacency.nodeIds) {
    const reachable = walk(adjacency, roots, new Set([id]), new Set());
    // The failed node does not count as collateral damage from its own outage.
    const isolates = total - 1 - reachable.size;
    if (isolates > 0) points.push({ kind: "node", id, isolates });
  }
  for (const link of graph.links) {
    const reachable = walk(adjacency, roots, new Set(), new Set([link.id]));
    const isolates = total - reachable.size;
    if (isolates > 0) points.push({ kind: "link", id: link.id, isolates });
  }

  points.sort((left, right) => right.isolates - left.isolates || left.id.localeCompare(right.id));
  return points;
}

/** Nodes with no link at all — usually a half-finished drawing, worth flagging. */
export function findStrandedNodes(graph: NetworkGraph): NetworkNode[] {
  const adjacency = buildAdjacency(graph);
  return graph.nodes.filter((node) => (adjacency.edges.get(node.id) ?? []).length === 0);
}
