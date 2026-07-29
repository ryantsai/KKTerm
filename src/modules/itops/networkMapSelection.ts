export type NetworkMapCanvasSelectionItem = {
  kind: "node" | "note";
  id: string;
};

export function sameNetworkMapCanvasItem(
  left: NetworkMapCanvasSelectionItem,
  right: NetworkMapCanvasSelectionItem,
): boolean {
  return left.kind === right.kind && left.id === right.id;
}

export function toggleNetworkMapCanvasSelection(
  current: readonly NetworkMapCanvasSelectionItem[],
  item: NetworkMapCanvasSelectionItem,
  additive: boolean,
): NetworkMapCanvasSelectionItem[] {
  if (!additive) return [item];
  return current.some((entry) => sameNetworkMapCanvasItem(entry, item))
    ? current.filter((entry) => !sameNetworkMapCanvasItem(entry, item))
    : [...current, item];
}

export function selectionForNetworkMapContextMenu(
  current: readonly NetworkMapCanvasSelectionItem[],
  item: NetworkMapCanvasSelectionItem,
): NetworkMapCanvasSelectionItem[] {
  return current.some((entry) => sameNetworkMapCanvasItem(entry, item))
    ? [...current]
    : [item];
}
