import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  defaultLayoutFor,
  ensureLayout,
  leafOrder,
  splitLayout,
} from "../src/modules/workspace/layout";
import type { LayoutNode, WorkspacePane } from "../src/types";

function pane(id: string): WorkspacePane {
  return { id } as WorkspacePane;
}

test("splitLayout docks beside the hovered (non-focused) pane, not the focused one", () => {
  const base = defaultLayoutFor([pane("a"), pane("b")]);
  assert.ok(base, "two panes should produce a layout");

  // Drag-to-dock onto pane "b" with a downward split while "a" is focused.
  const next = splitLayout(base, "b", "down", "c", ["a", "b"]);

  assert.deepEqual(leafOrder(next), ["a", "b", "c"]);
  assert.equal(next.type, "split");
  if (next.type !== "split") {
    return;
  }
  assert.equal(next.orientation, "horizontal");
  const [first, second] = next.children;
  assert.equal(first.type, "leaf");
  if (first.type === "leaf") {
    assert.equal(first.paneId, "a", "untouched pane stays in place");
  }
  // The new pane is grouped with the hovered pane "b" in a vertical split.
  assert.equal(second.type, "split");
  if (second.type === "split") {
    assert.equal(second.orientation, "vertical");
    assert.deepEqual(leafOrder(second), ["b", "c"]);
  }
});

test("splitLayout honors 'left' by inserting the new pane before the target", () => {
  const base = defaultLayoutFor([pane("a"), pane("b")]) as LayoutNode;
  const next = splitLayout(base, "a", "left", "c", ["a", "b"]);
  assert.deepEqual(leafOrder(next), ["c", "a", "b"]);
});

test("removing the second-last Pane preserves the surviving Pane's layout ancestry", () => {
  const base = defaultLayoutFor([pane("a"), pane("b")]) as LayoutNode;

  assert.deepEqual(ensureLayout(base, [pane("b")]), {
    type: "split",
    orientation: "horizontal",
    children: [{ type: "leaf", paneId: "b" }],
  });
});

test("addConnectionToTerminalPane accepts an explicit targetPaneId and falls back to the focused pane", async () => {
  const storeSource = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");

  assert.match(
    storeSource,
    /addConnectionToTerminalPane: \([\s\S]*?targetPaneId\??: string,[\s\S]*?options\?: ConnectionPaneOptions,[\s\S]*?\) => void/,
    "the action signature should expose an optional targetPaneId",
  );
  assert.match(
    storeSource,
    /addConnectionToTerminalPane: \(tabId, connection, direction, targetPaneId, options\) =>/,
  );
  assert.match(
    storeSource,
    /targetPaneId && currentPanes\.find\(\(pane\) => pane\.id === targetPaneId\)/,
    "an explicit target should win, falling back to the focused pane",
  );
});

test("the Connection Tree drag wires Connections onto Workspace Canvas dock targets", async () => {
  const sidebarSource = await readFile(
    new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
    "utf8",
  );
  const terminalSource = await readFile(
    new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const canvasSource = await readFile(
    new URL("../src/modules/workspace/WorkspaceCanvas.tsx", import.meta.url),
    "utf8",
  );

  // DOM markers the hit-test relies on.
  assert.match(terminalSource, /data-dock-pane-id=\{pane\.id\}/);
  assert.match(terminalSource, /data-dock-tab-id=\{tabId\}/);
  assert.match(canvasSource, /data-dock-empty-canvas/);

  // Drag resolution: a split targets the hovered pane; empty canvas opens a Tab.
  assert.match(sidebarSource, /canvasDropZoneFromElement\(/);
  assert.match(sidebarSource, /addConnectionToPaneWithChildMode\(zone\.tabId, connection, zone\.direction, zone\.paneId\)/);
  assert.match(sidebarSource, /completeCanvasDrop\(dragged\.connectionId, canvasZone\)/);
  assert.match(sidebarSource, /<DockOverlay zone=\{canvasDropZone\} \/>/);

  // The overlay must portal to <body> so its fixed coordinates align with the
  // panes; the host `.connection-sidebar` is a `contain: layout` block that
  // would otherwise offset `position: fixed` children.
  assert.match(
    sidebarSource,
    /function DockOverlay[\s\S]*?<DialogPortal>\s*<div className="dock-overlay"/,
    "DockOverlay should render through DialogPortal (document.body)",
  );
});

test("child-enabled Add-to and canvas dock create Child Connection Tab panes", async () => {
  const sidebarSource = await readFile(
    new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
    "utf8",
  );
  const storeSource = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");

  assert.match(
    storeSource,
    /type ConnectionPaneOptions = \{[\s\S]*?childConnectionId\?: string[\s\S]*?addConnectionToTerminalPane: \([\s\S]*?options\?: ConnectionPaneOptions/,
    "the split action should accept child pane metadata",
  );
  assert.match(
    storeSource,
    /buildPaneForConnection\(paneConnection,\s*targetPane,\s*options\)/,
    "the split action should build panes with child-specific metadata",
  );
  assert.match(
    sidebarSource,
    /async function addConnectionToPaneWithChildMode\([\s\S]*?const child = await createChildConnection\(connection\);[\s\S]*?addConnectionToTerminalPane\([\s\S]*?childConnectionId: child\.id,[\s\S]*?toolbarTitle: child\.name,[\s\S]*?tmuxSessionId: child\.tmuxSessionId,/,
    "child-enabled Add-to should create and dock a Child Connection Tab pane",
  );
  assert.match(
    sidebarSource,
    /await addConnectionToPaneWithChildMode\(zone\.tabId,\s*connection,\s*zone\.direction,\s*zone\.paneId\)/,
    "drag-to-dock should use the same child-aware split path as the context menu",
  );
});

test("standalone connection tabs expose dock targets and split through the same pane action", async () => {
  const sidebarSource = await readFile(
    new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
    "utf8",
  );
  const canvasSource = await readFile(
    new URL("../src/modules/workspace/WorkspaceCanvas.tsx", import.meta.url),
    "utf8",
  );
  const nativeOverlaySource = await readFile(
    new URL("../src/modules/workspace/nativeOverlay.ts", import.meta.url),
    "utf8",
  );
  const storeSource = await readFile(new URL("../src/store.ts", import.meta.url), "utf8");

  assert.match(
    canvasSource,
    /function DockableWorkspaceTab[\s\S]*data-dock-pane-id=\{tab\.panes\[0\]\?\.id \?\? tab\.id\}[\s\S]*data-dock-tab-id=\{tab\.id\}/,
    "non-terminal top-level tabs should expose a synthetic dock pane target",
  );
  for (const kind of ["sftp", "ftp", "localFiles", "fileViewer", "webview", "remoteDesktop"]) {
    assert.match(
      canvasSource,
      new RegExp(`tab\\.kind === "${kind}"[\\s\\S]*<DockableWorkspaceTab[\\s\\S]*tab=\\{tab\\}`),
      `${kind} tabs should render inside DockableWorkspaceTab`,
    );
  }
  assert.doesNotMatch(
    sidebarSource,
    /tab && tab\.kind === "terminal"/,
    "canvas drops should not restrict split docking to terminal-kind tabs",
  );
  assert.match(
    storeSource,
    /const basePane = tab\.kind === "terminal" \? null : buildPaneForStandaloneTab\(tab\)/,
    "the store should convert a standalone tab into its first layout pane before splitting",
  );
  assert.match(
    nativeOverlaySource,
    /INTERSECTING_NATIVE_SURFACE_OVERLAY_SELECTOR[\s\S]*"\.tree-drag-preview"[\s\S]*"\.dock-overlay"/,
    "RDP/VNC and URL native surfaces should be suppressed while drag previews and dock overlays cross them",
  );
});
