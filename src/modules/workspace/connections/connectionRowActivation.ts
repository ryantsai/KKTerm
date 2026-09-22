export type ConnectionRowActivation = "ignore" | "open" | "select";

export function connectionRowClickActivation(
  doubleClickOpensConnection: boolean,
  clickCount: number,
): ConnectionRowActivation {
  if (doubleClickOpensConnection) {
    return "select";
  }
  // A browser double-click emits click(detail=1), click(detail=2), then
  // dblclick. The first click already opened the Connection, so dispatching the
  // second one would duplicate activation and can overlap asynchronous Child
  // Connection creation or Session startup. Keyboard-generated clicks use
  // detail=0 and must still open.
  return clickCount > 1 ? "ignore" : "open";
}

export function connectionRowDoubleClickActivation(
  doubleClickOpensConnection: boolean,
): ConnectionRowActivation {
  return doubleClickOpensConnection ? "open" : "ignore";
}
