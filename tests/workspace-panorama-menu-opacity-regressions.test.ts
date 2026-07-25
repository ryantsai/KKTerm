import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  leafOrder,
  panoramaLayoutFor,
  reconcilePanoramaLayout,
} from "../src/modules/workspace/layout";
import {
  terminalToolbarOpacity,
} from "../src/modules/workspace/connections/terminal/colorSchemes";
import {
  resolveVisibleTerminalBackground,
  supportsTerminalAppearanceDefaults,
} from "../src/modules/workspace/connections/terminalAppearanceDefaults";
import type { ConnectionType, LayoutNode, WorkspacePane } from "../src/types";
import type { DashboardBackground } from "../src/modules/dashboard/types";

function pane(id: string): WorkspacePane {
  return { id } as WorkspacePane;
}

function rowSizes(layout: LayoutNode | undefined): number[] {
  if (!layout) {
    return [];
  }
  if (layout.type === "leaf") {
    return [1];
  }
  if (layout.orientation === "horizontal") {
    return [leafOrder(layout).length];
  }
  return layout.children.map((row) => leafOrder(row).length);
}

test("dense Panoramas use balanced multirow layouts", () => {
  const panes = Array.from({ length: 7 }, (_, index) => pane(String(index + 1)));
  const layout = panoramaLayoutFor(panes);

  assert.deepEqual(rowSizes(layout), [4, 3]);
  assert.deepEqual(leafOrder(layout), panes.map((entry) => entry.id));
});

test("legacy flat Panorama rows rebalance while deliberate mixed splits survive", () => {
  const panes = Array.from({ length: 7 }, (_, index) => pane(String(index + 1)));
  const flatLayout: LayoutNode = {
    type: "split",
    orientation: "horizontal",
    children: panes.map((entry) => ({ type: "leaf", paneId: entry.id })),
  };
  assert.deepEqual(rowSizes(reconcilePanoramaLayout(flatLayout, panes)), [4, 3]);

  const mixedLayout: LayoutNode = {
    type: "split",
    orientation: "vertical",
    children: [
      {
        type: "split",
        orientation: "horizontal",
        children: [
          { type: "leaf", paneId: "1" },
          { type: "leaf", paneId: "2" },
        ],
      },
      {
        type: "split",
        orientation: "horizontal",
        children: panes.slice(2).map((entry) => ({ type: "leaf", paneId: entry.id })),
      },
    ],
  };
  assert.deepEqual(reconcilePanoramaLayout(mixedLayout, panes), mixedLayout);
});

test("terminal toolbar transparency stays 25 points below terminal transparency", () => {
  assert.equal(terminalToolbarOpacity(0), 25, "100% terminal transparency becomes 75% toolbar transparency");
  assert.equal(terminalToolbarOpacity(75), 100, "25% terminal transparency becomes an opaque toolbar");
  assert.equal(terminalToolbarOpacity(100), 100, "values below 25% transparency clamp at zero");
});

test("every xterm-backed Connection uses every custom background type for toolbar opacity", async () => {
  const customBackgrounds: DashboardBackground[] = [
    { kind: "preset", preset: "softGradient" },
    { kind: "image", file: "custom.png", fit: "fill", dim: 0 },
    { kind: "video", file: "custom.mp4", fit: "fill", dim: 0 },
    { kind: "dynamic", dynamic: "rainyWindow" },
  ];
  const xtermConnectionTypes: ConnectionType[] = ["local", "ssh", "telnet", "serial"];

  for (const connectionType of xtermConnectionTypes) {
    assert.equal(
      supportsTerminalAppearanceDefaults(connectionType),
      true,
      `${connectionType} should use the shared xterm appearance path`,
    );
    for (const background of customBackgrounds) {
      assert.equal(
        resolveVisibleTerminalBackground({
          connectionBackground: null,
          paneBackground: undefined,
          sharedBackground: background,
          usePaneBackground: false,
        }),
        background,
        `${connectionType} should derive toolbar opacity from its ${background.kind} background`,
      );
    }
  }

  const terminalWorkspace = await readFile(
    new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    terminalWorkspace,
    /terminalToolbarBackground\s*=\s*terminalBackground\s*\?/,
    "every non-null background kind should enable the relative toolbar opacity",
  );
  assert.doesNotMatch(
    terminalWorkspace,
    /terminalBackground\?\.kind\s*===\s*"dynamic"/,
    "toolbar opacity must not be restricted to dynamic backgrounds",
  );
});

test("an explicit default terminal background does not fall back to the last background", () => {
  const previousBackground: DashboardBackground = { kind: "preset", preset: "softGradient" };

  assert.equal(
    resolveVisibleTerminalBackground({
      connectionBackground: previousBackground,
      paneBackground: null,
      sharedBackground: undefined,
      usePaneBackground: true,
    }),
    null,
    "explicit per-Pane null should remove the background",
  );
  assert.equal(
    resolveVisibleTerminalBackground({
      connectionBackground: previousBackground,
      paneBackground: undefined,
      sharedBackground: null,
      usePaneBackground: false,
    }),
    null,
    "explicit shared null should remove the background",
  );
  assert.equal(
    resolveVisibleTerminalBackground({
      connectionBackground: previousBackground,
      paneBackground: undefined,
      sharedBackground: undefined,
      usePaneBackground: false,
    }),
    previousBackground,
    "only an absent background value should inherit the Connection background",
  );
});

test("terminal action menu portals above the Activity Rail and flips edge submenus", async () => {
  const [terminalWorkspace, baseCss, terminalCss] = await Promise.all([
    readFile(
      new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/styles/base.css", import.meta.url), "utf8"),
    readFile(
      new URL("../src/modules/workspace/connections/terminal/terminal.css", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    terminalWorkspace,
    /actionsMenuOpen\s*\?\s*createPortal\([\s\S]*terminal-actions-menu-portal[\s\S]*document\.body/,
  );
  assert.match(
    terminalWorkspace,
    /resolveVisibleTerminalBackground\(\{[\s\S]*sharedBackground:\s*sharedTerminalBackground,[\s\S]*usePaneBackground:\s*usePaneTerminalBackgrounds/,
  );
  assert.match(terminalWorkspace, /terminal-actions-menu-submenus-right/);
  assert.match(
    baseCss,
    /\.terminal-actions-menu-submenus-right[\s\S]*\.terminal-menu-submenu-panel[\s\S]*left:\s*calc\(100% \+ 4px\)/,
  );
  assert.match(
    terminalCss,
    /\.terminal-actions-menu-portal\s*\{[\s\S]*position:\s*fixed;[\s\S]*z-index:\s*260;/,
  );
});
