import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const terminalWorkspace = await readFile(
  new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
  "utf8",
);
const terminalBackgroundPopover = await readFile(
  new URL("../src/modules/workspace/connections/terminal/TerminalBackgroundPopover.tsx", import.meta.url),
  "utf8",
);
const dashboardBackgroundPopover = await readFile(
  new URL("../src/modules/dashboard/edit/BackgroundPopover.tsx", import.meta.url),
  "utf8",
);
const sharedBackgroundPopover = await readFile(
  new URL("../src/modules/dashboard/edit/SharedBackgroundPopover.tsx", import.meta.url),
  "utf8",
);
const dynamicBackgrounds = await readFile(
  new URL("../src/modules/dashboard/registry/dynamicBackgrounds.tsx", import.meta.url),
  "utf8",
);
const iframeBackgroundSources = await Promise.all([
  "../src/modules/dashboard/registry/threeui/at-the-horizon/AtTheHorizon.tsx",
  "../src/modules/dashboard/registry/threeui/elements/GenerativeTree.tsx",
  "../src/modules/dashboard/registry/threeui/neuform-isolated/NeuformBatchEffects.tsx",
  "../src/modules/dashboard/registry/threeui/neuform-isolated/NeuformCraftEffects.tsx",
  "../src/modules/dashboard/registry/threeui/neuform-isolated/NeuformIsolatedEffects.tsx",
  "../src/modules/dashboard/registry/threeui/quantera-trading-background/QuanteraTradingBackground.tsx",
  "../src/modules/dashboard/registry/threeui/sylva-living-world/SylvaLivingWorldScene.tsx",
].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
const workspaceSettings = await readFile(
  new URL("../src/modules/settings/WorkspaceSettings.tsx", import.meta.url),
  "utf8",
);
const appDefaults = await readFile(
  new URL("../src/app-defaults.ts", import.meta.url),
  "utf8",
);
const typesSource = await readFile(
  new URL("../src/types.ts", import.meta.url),
  "utf8",
);
const layoutSource = await readFile(
  new URL("../src/modules/workspace/layout.ts", import.meta.url),
  "utf8",
);
const storeSource = await readFile(
  new URL("../src/store.ts", import.meta.url),
  "utf8",
);
const architecture = await readFile(
  new URL("../docs/ARCHITECTURE.md", import.meta.url),
  "utf8",
);
const terminalManual = await readFile(
  new URL("../docs/manual/05-terminal.md", import.meta.url),
  "utf8",
);
const terminalCss = await readFile(
  new URL("../src/modules/workspace/connections/terminal/terminal.css", import.meta.url),
  "utf8",
);
const dashboardCss = await readFile(
  new URL("../src/modules/dashboard/dashboard.css", import.meta.url),
  "utf8",
);

test("Workspace settings exposes split terminal background scope defaulted off", () => {
  assert.match(typesSource, /separateSplitTerminalBackgrounds:\s*boolean/);
  assert.match(appDefaults, /separateSplitTerminalBackgrounds:\s*false/);
  assert.match(workspaceSettings, /settings\.separateSplitTerminalBackgrounds/);
  assert.match(workspaceSettings, /settings\.terminalBackgrounds/);
});

test("terminal background paints once at workspace scope unless split pane backgrounds are enabled", () => {
  assert.match(
    terminalWorkspace,
    /generalSettings\.separateSplitTerminalBackgrounds/,
  );
  assert.match(
    terminalWorkspace,
    /<TerminalBackgroundLayer\s+active=\{isActive\}\s+background=\{workspaceTerminalBackground\}/,
  );
  assert.match(terminalWorkspace, /terminal-workspace-has-background/);
  assert.match(
    terminalWorkspace,
    /background=\{usePaneTerminalBackgrounds \? terminalBackground : null\}/,
  );
  assert.match(
    terminalCss,
    /\.terminal-connection-background\s*\{[\s\S]*inset:\s*0;/,
    "shared terminal backgrounds must fill the full workspace surface",
  );
  assert.match(
    terminalCss,
    /\.quick-command-bar\s*\{[\s\S]*z-index:\s*1;/,
    "the quick command bar must remain above shared terminal backgrounds",
  );
});

test("split terminal pane backgrounds serialize with stored layouts", () => {
  assert.match(typesSource, /terminalBackground\?:\s*DashboardBackground\s*\|\s*null/);
  assert.match(layoutSource, /terminalBackground:\s*"terminalBackground" in pane/);
  assert.match(storeSource, /terminalBackground:\s*storedPane\.terminalBackground/);
});

test("terminal and Dashboard background pickers share the same component and datasource", () => {
  assert.match(terminalBackgroundPopover, /SharedBackgroundPopover/);
  assert.match(dashboardBackgroundPopover, /SharedBackgroundPopover/);
  assert.match(sharedBackgroundPopover, /extensions:\s*\[[^\]]*"svg"/);
  assert.doesNotMatch(terminalBackgroundPopover, /BACKGROUND_PRESETS\.map/);
  assert.doesNotMatch(terminalBackgroundPopover, /DYNAMIC_BACKGROUNDS\.map/);
});

test("dynamic background tab uses static thumbnails and supports transient header dragging", () => {
  assert.match(sharedBackgroundPopover, /DYNAMIC_BACKGROUNDS\.map/);
  assert.match(sharedBackgroundPopover, /dw-bg-thumb-grid/);
  assert.match(
    sharedBackgroundPopover,
    /src=\{`\/dynamic-bg-thumbs\/\$\{backgroundOption\.id\}\.webp`\}/,
    "every thumbnail card should default to a static captured image",
  );
  assert.match(sharedBackgroundPopover, /onClick=\{\(\) => applyDynamic\(backgroundOption\.id\)\}/);
  assert.doesNotMatch(
    sharedBackgroundPopover,
    /DashboardDynamicBackground|hoveredDynamicId|isHovered|onMouseEnter|onMouseLeave|dw-bg-thumb-live/,
    "thumbnail hover should not mount or track a live renderer",
  );
  assert.match(sharedBackgroundPopover, /popoverOffset/);
  assert.match(
    sharedBackgroundPopover,
    /<DialogPortal>\{popover\}<\/DialogPortal>/,
    "the fixed background picker should portal to the app window instead of being clipped by its owning Pane",
  );
  assert.match(sharedBackgroundPopover, /onPointerDown=\{onHeaderPointerDown\}/);
  assert.match(sharedBackgroundPopover, /onPointerMove=\{onHeaderPointerMove\}/);
  assert.match(sharedBackgroundPopover, /onPointerUp=\{onHeaderPointerEnd\}/);
  assert.match(sharedBackgroundPopover, /onPointerCancel=\{onHeaderPointerEnd\}/);
  assert.doesNotMatch(
    sharedBackgroundPopover,
    /DynamicBackgroundPreviewDialog|backgroundLivePreview|DynamicBackgroundPreviewArt/,
    "the old live-preview modal and procedural art should be fully removed",
  );
  assert.match(dashboardCss, /\.dw-bg-popover\s*\{[\s\S]*z-index:\s*200;/);
  assert.match(dashboardCss, /\.dw-bg-popover\s*\{[\s\S]*width:\s*840px;/);
  assert.match(
    dashboardCss,
    /\.dw-bg-popover\s*\{[\s\S]*transform:\s*translate\([\s\S]*var\(--dw-bg-popover-offset-x[\s\S]*var\(--dw-bg-popover-offset-y/,
  );
  assert.match(dashboardCss, /\.dw-bg-popover-head\s*\{[\s\S]*cursor:\s*grab;/);
  assert.match(dashboardCss, /\.dw-bg-popover-head\.is-dragging\s*\{[\s\S]*cursor:\s*grabbing;/);
  assert.match(dashboardCss, /\.dw-bg-seg\s*\{[\s\S]*width:\s*70%;/);
  assert.match(dashboardCss, /\.dw-bg-popover-body\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.doesNotMatch(dashboardCss, /\.dw-bg-thumb-live/);
  assert.doesNotMatch(dashboardCss, /\.dw-bg-preview-|dw-bg-live-preview|dw-bg-dynamic-grid/);
});

test("iframe-backed dynamic backgrounds relay context menus to their owning surface", () => {
  assert.match(dynamicBackgrounds, /THREE_UI_FRAME_CONTEXT_MENU_MESSAGE/);
  assert.match(dynamicBackgrounds, /contentWindow === event\.source/);
  assert.match(dynamicBackgrounds, /new MouseEvent\("contextmenu"/);
  for (const source of iframeBackgroundSources) {
    assert.match(source, /withThreeUiFrameContextMenuBridge/);
  }
});

test("background picker coalesces drag repaints outside React state updates", () => {
  assert.match(sharedBackgroundPopover, /popoverOffsetRef/);
  assert.match(sharedBackgroundPopover, /requestAnimationFrame/);
  assert.match(sharedBackgroundPopover, /onLostPointerCapture=\{onHeaderPointerEnd\}/);
});

test("docs make shared terminal background scope and datasource explicit", () => {
  assert.match(architecture, /shared background picker datasource/i);
  assert.match(architecture, /separateSplitTerminalBackgrounds/);
  assert.match(terminalManual, /terminal workspace content area/i);
  assert.match(terminalManual, /per-Pane terminal backgrounds/i);
});
