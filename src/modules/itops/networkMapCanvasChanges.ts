import type { NodeChange } from "@xyflow/react";

import type { NetworkGraph } from "../../types";

export const NETWORK_NODE_WIDTH = 156;
export const NETWORK_NODE_HEIGHT = 52;
export const NETWORK_NODE_MIN_WIDTH = 120;
export const NETWORK_NODE_MIN_HEIGHT = 44;
export const NETWORK_NODE_MAX_WIDTH = 360;
export const NETWORK_NODE_MAX_HEIGHT = 220;
export const NETWORK_NOTE_WIDTH = 240;
export const NETWORK_NOTE_HEIGHT = 130;
export const NETWORK_NOTE_MIN_WIDTH = 180;
export const NETWORK_NOTE_MIN_HEIGHT = 90;
export const NETWORK_NOTE_MAX_WIDTH = 600;
export const NETWORK_NOTE_MAX_HEIGHT = 400;

function boundedDimension(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}

export function applyNetworkMapCanvasNodeChanges(
  graph: NetworkGraph,
  changes: NodeChange[],
): NetworkGraph {
  let nodes = graph.nodes;
  let notes = graph.notes;

  for (const change of changes) {
    if (change.type === "position" && change.position) {
      const x = Math.round(change.position.x);
      const y = Math.round(change.position.y);
      const nodeIndex = nodes.findIndex((node) => node.id === change.id);
      if (
        nodeIndex >= 0 &&
        (nodes[nodeIndex].x !== x || nodes[nodeIndex].y !== y)
      ) {
        nodes = nodes.slice();
        nodes[nodeIndex] = { ...nodes[nodeIndex], x, y };
      }

      const noteIndex = notes.findIndex((note) => note.id === change.id);
      if (
        noteIndex >= 0 &&
        (notes[noteIndex].x !== x || notes[noteIndex].y !== y)
      ) {
        notes = notes.slice();
        notes[noteIndex] = { ...notes[noteIndex], x, y };
      }
    }

    // React Flow also emits passive measurements whenever controlled nodes
    // render. Feeding those measurements back into the graph creates a
    // render/measure loop that interrupts both live resize and handle lookup.
    // Only NodeResizer changes carry `resizing`.
    if (
      change.type === "dimensions" &&
      change.dimensions &&
      change.resizing !== undefined
    ) {
      const nodeIndex = nodes.findIndex((node) => node.id === change.id);
      if (nodeIndex >= 0) {
        const width = boundedDimension(
          change.dimensions.width,
          NETWORK_NODE_MIN_WIDTH,
          NETWORK_NODE_MAX_WIDTH,
        );
        const height = boundedDimension(
          change.dimensions.height,
          NETWORK_NODE_MIN_HEIGHT,
          NETWORK_NODE_MAX_HEIGHT,
        );
        if (nodes[nodeIndex].width !== width || nodes[nodeIndex].height !== height) {
          nodes = nodes.slice();
          nodes[nodeIndex] = { ...nodes[nodeIndex], width, height };
        }
      }

      const noteIndex = notes.findIndex((note) => note.id === change.id);
      if (noteIndex >= 0) {
        const width = boundedDimension(
          change.dimensions.width,
          NETWORK_NOTE_MIN_WIDTH,
          NETWORK_NOTE_MAX_WIDTH,
        );
        const height = boundedDimension(
          change.dimensions.height,
          NETWORK_NOTE_MIN_HEIGHT,
          NETWORK_NOTE_MAX_HEIGHT,
        );
        if (notes[noteIndex].width !== width || notes[noteIndex].height !== height) {
          notes = notes.slice();
          notes[noteIndex] = { ...notes[noteIndex], width, height };
        }
      }
    }
  }

  return nodes === graph.nodes && notes === graph.notes
    ? graph
    : { ...graph, nodes, notes };
}
