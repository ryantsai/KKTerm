import type { Node } from "@xyflow/react";

function shallowEqual(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => Object.is(left[key], right[key]));
}

function sameRenderedNode<Data extends Record<string, unknown>>(
  left: Node<Data>,
  right: Node<Data>,
): boolean {
  const leftRecord = left as unknown as Record<string, unknown>;
  const rightRecord = right as unknown as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  if (keys.length !== Object.keys(rightRecord).length) return false;
  return keys.every((key) => {
    if (key === "position" || key === "data" || key === "style") {
      const leftValue = leftRecord[key];
      const rightValue = rightRecord[key];
      if (leftValue === rightValue) return true;
      if (!leftValue || !rightValue || typeof leftValue !== "object" || typeof rightValue !== "object") {
        return false;
      }
      return shallowEqual(
        leftValue as Readonly<Record<string, unknown>>,
        rightValue as Readonly<Record<string, unknown>>,
      );
    }
    return Object.is(leftRecord[key], rightRecord[key]);
  });
}

/**
 * React Flow treats a new controlled Node object as an update. Preserve the
 * objects whose rendered values did not change so dragging one node does not
 * make unrelated handles remeasure and briefly drop their Links.
 */
export function reconcileNetworkMapFlowNodes<Data extends Record<string, unknown>>(
  previous: readonly Node<Data>[],
  next: Node<Data>[],
): Node<Data>[] {
  if (previous.length === 0) return next;
  const previousById = new Map(previous.map((node) => [node.id, node]));
  return next.map((node) => {
    const prior = previousById.get(node.id);
    return prior && sameRenderedNode(prior, node) ? prior : node;
  });
}
