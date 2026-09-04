import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("custom titlebar inherits the same color scheme as the activity rail", async () => {
  const [appSource, appCssSource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/app.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    appSource,
    /data-color-scheme=\{appliedColorScheme\}/,
    "the app root should carry the active color scheme so titlebar and shell share tokens",
  );
  assert.match(
    appCssSource,
    /\.app-titlebar\s*\{[^}]*background:\s*var\(--titlebar-bg\)/s,
    "custom titlebar should use the titlebar background token",
  );
  assert.match(
    appCssSource,
    /\.app-titlebar\s*\{[^}]*color:\s*var\(--titlebar-text\)/s,
    "custom titlebar should use the titlebar text token",
  );
  assert.match(
    appCssSource,
    /\.activity-rail\s*\{[^}]*background:\s*var\(--nav-toolbar-bg\)/s,
    "activity rail should keep using the navigation toolbar background token",
  );
});

test("World Cup schemes can separate titlebar and Activity Rail colors", async () => {
  const [colorSchemesSource, appCssSource] = await Promise.all([
    readFile(new URL("../src/styles/colorSchemes.css", import.meta.url), "utf8"),
    readFile(new URL("../src/app/app.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    colorSchemesSource,
    /:root\s*\{[\s\S]*--titlebar-bg:\s*var\(--nav-toolbar-bg\);[\s\S]*--titlebar-text:\s*var\(--nav-toolbar-text\);/,
    "existing schemes should inherit titlebar colors from the established navigation toolbar tokens",
  );
  assert.match(
    colorSchemesSource,
    /\[data-color-scheme="canarinho"\]\s*\{[\s\S]*--chrome:\s*#ffdc02;[\s\S]*--nav-toolbar-bg:\s*#19ae47;[\s\S]*--titlebar-bg:\s*var\(--chrome\);/,
    "World Cup schemes should be able to use the picker titlebar color separately from the rail color",
  );
  assert.match(
    appCssSource,
    /\.app-titlebar-button:hover\s*\{[^}]*background:\s*var\(--titlebar-hover-bg\);/s,
    "titlebar controls should hover with titlebar-specific colors",
  );
});

test("custom titlebar is always rendered by the frontend shell", async () => {
  const [appSource, appCssSource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/app.css", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /<TitleBar\b/);
  assert.doesNotMatch(appSource, /useCustomTitleBar/);
  assert.doesNotMatch(appCssSource, /app-root--no-titlebar/);
});

test("custom titlebar hover preserves UI font inheritance and kerning", async () => {
  const appCssSource = await readFile(
    new URL("../src/app/app.css", import.meta.url),
    "utf8",
  );
  const characterRule = appCssSource.match(
    /\.app-titlebar-title-char\s*\{(?<body>[^}]*)\}/s,
  );

  assert.ok(characterRule?.groups?.body, "animated title character CSS should exist");
  assert.match(
    characterRule.groups.body,
    /\bdisplay:\s*inline;/,
    "animated letters must remain inline so hover preserves the UI font's kerning",
  );
  for (const rule of appCssSource.matchAll(/\.app-titlebar-title[^{}]*\{([^}]*)\}/g)) {
    assert.doesNotMatch(
      rule[1],
      /\bfont(?:-family)?\s*:/,
      "normal and animated title text should inherit the selected App UI font",
    );
  }
  assert.match(
    appCssSource,
    /\.app-titlebar-brand:hover\s+\.app-titlebar-title-char\s*\{[^}]*animation:\s*titlebar-color-shift\s+1s\s+both;/s,
    "preserving typography should keep the existing color animation",
  );
});

test("custom titlebar panel buttons match module scope", async () => {
  const [appSource, titleBarSource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/TitleBar.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(
    appSource,
    /<TitleBar[\s\S]*?activePage=\{activePage\}/,
    "TitleBar should know the active Module before rendering module-scoped controls",
  );
  assert.match(
    titleBarSource,
    /activePage === "workspace"/,
    "the Connections panel titlebar toggle should only render inside Workspace",
  );
  assert.match(
    titleBarSource,
    /activePage === "itops"/,
    "the Sites navigator titlebar toggle should only render inside IT Ops",
  );
  assert.match(
    titleBarSource,
    /onToggleItOpsSiteTree/,
    "the IT Ops titlebar toggle should control the Sites navigator",
  );
  assert.match(
    titleBarSource,
    /<Bot size=\{15\} strokeWidth=\{1\.8\} \/>/,
    "the AI Assistant titlebar toggle should use the robot icon",
  );
});

test("collapsed AI Assistant strip is hidden when the titlebar toggle is available", async () => {
  const [appSource, layoutSource, effectsSource, appCssSource, assistantCssSource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/workspaceChromeLayout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/appShellEffects.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/app.css", import.meta.url), "utf8"),
    readFile(new URL("../src/ai/assistant.css", import.meta.url), "utf8"),
  ]);

  assert.match(
    appSource,
    /showCollapsedTab=\{false\}/,
    "App should hide the right collapsed strip because the custom titlebar can reopen the panel",
  );
  assert.match(
    appSource,
    /<div className="connection-panel-slot">[\s\S]*?<ConnectionSidebar/,
    "the Connections panel should slide inside a clipping slot instead of translating the grid item itself",
  );
  assert.match(
    appSource,
    /<div className="assistant-panel-slot">[\s\S]*?<AssistantPanel/,
    "the AI Assistant panel should slide inside a clipping slot instead of translating the grid item itself",
  );
  assert.match(
    layoutSource,
    /collapsed && !showCollapsedTab[\s\S]*?<div[\s\S]*?aria-hidden="true"/,
    "the hidden collapsed strip should not leave a focusable button behind",
  );
  assert.match(
    effectsSource,
    /--ai-resize-width", aiPanelLayout\.collapsed \? "0px" : "3px"/,
    "the AI resize grid column should collapse to zero width with the strip hidden",
  );
  assert.match(
    layoutSource,
    /aiPanelAnimating/,
    "AI panel animation state should be tracked separately from the left Connections panel",
  );
  assert.match(
    layoutSource,
    /connectionPanelAnimating/,
    "Connections panel animation state should be tracked separately so the tree can slide without animating the whole shell grid",
  );
  assert.match(
    appSource,
    /useAppShellAppearance\(\{[\s\S]*?aiPanelAnimating/,
    "the app shell appearance hook should receive AI-only animation state",
  );
  assert.match(
    appSource,
    /useAppShellAppearance\(\{[\s\S]*?connectionPanelAnimating/,
    "the app shell appearance hook should receive Connections-panel-only animation state",
  );
  assert.match(
    effectsSource,
    /aiPanelVisibleForLayout\s*=\s*!aiPanelLayout\.collapsed\s*\|\|\s*aiPanelAnimating/,
    "the AI panel should keep its layout width only while its own slide-out animation is running",
  );
  assert.match(
    effectsSource,
    /connectionPanelVisibleForLayout\s*=\s*!connectionPanelLayout\.collapsed\s*\|\|\s*connectionPanelAnimating/,
    "the Connections panel should keep its layout width only while its own slide-out animation is running",
  );
  assert.match(
    assistantCssSource,
    /\.assistant-panel\s*\{[^}]*transition:[^}]*transform 180ms cubic-bezier\(0\.2,\s*0,\s*0,\s*1\)/s,
    "the AI panel surface should animate with transform instead of animating the whole shell grid",
  );
  assert.match(
    appCssSource,
    /\.ai-assist-collapsed\s+\.assistant-panel\s*\{[^}]*transform:\s*translateX\(100%\)/s,
    "collapsed AI Assistant panel should slide out to the right",
  );
  assert.match(
    appCssSource,
    /\.connection-sidebar\s*\{[^}]*transition:[^}]*transform 180ms cubic-bezier\(0\.2,\s*0,\s*0,\s*1\)/s,
    "the Connections panel surface should animate with transform instead of animating the whole shell grid",
  );
  assert.match(
    appCssSource,
    /\.app-shell\.panel-animating\s+\.connection-panel-slot,\s*\.app-shell\.panel-animating\s+\.assistant-panel-slot\s*\{[^}]*overflow:\s*clip;/s,
    "panel slots should clip translated panel content while animating so the animation cannot create horizontal window overflow",
  );
  assert.match(
    appCssSource,
    /\.connections-collapsed\s+\.connection-sidebar\s*\{[^}]*transform:\s*translateX\(-100%\)/s,
    "collapsed Connections panel should slide out to the left",
  );
});

test("status bar hairline stacks above animated workspace chrome", async () => {
  const workspaceCssSource = await readFile(
    new URL("../src/modules/workspace/workspace.css", import.meta.url),
    "utf8",
  );

  assert.match(
    workspaceCssSource,
    /\.status-bar\s*\{[^}]*position:\s*relative;[^}]*z-index:\s*80;[^}]*border-top:\s*1px solid var\(--border\);/s,
    "the shared Status Bar border should paint above the transformed Connections and AI Assistant panels",
  );
});

test("main Tauri window starts without native decorations by default", async () => {
  // The main window is created in Rust (so RDP/WebView2 stability browser args
  // can be applied per launch), not declared in tauri.conf.json. Verify the
  // config no longer declares a window and the Rust builder removes decorations.
  const [tauriConfigSource, libSource] = await Promise.all([
    readFile(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
  ]);
  const tauriConfig = JSON.parse(tauriConfigSource);

  assert.deepEqual(
    tauriConfig.app.windows,
    [],
    "the main window is built in Rust, so config should not declare one",
  );
  assert.match(
    libSource,
    /WebviewWindowBuilder::new\([\s\S]*?\.decorations\(false\)/,
    "the Rust-built main window should start without native decorations",
  );
});

test("custom titlebar matches the native Windows title height", async () => {
  const appCssSource = await readFile(
    new URL("../src/app/app.css", import.meta.url),
    "utf8",
  );

  assert.match(appCssSource, /--app-titlebar-height:\s*23px;/);
  assert.match(
    appCssSource,
    /\.app-titlebar\s*\{[^}]*box-sizing:\s*border-box;[^}]*height:\s*var\(--app-titlebar-height\)/s,
    "the titlebar border should be included in the fixed Windows-height row",
  );
});

test("custom titlebar buttons never render a focus selection highlight", async () => {
  const appCssSource = await readFile(
    new URL("../src/app/app.css", import.meta.url),
    "utf8",
  );

  assert.match(
    appCssSource,
    /\.app-titlebar button:focus\s*,\s*\.app-titlebar button:focus-visible\s*\{[^}]*outline:\s*none;/s,
    "all custom titlebar buttons should suppress WebView focus outlines",
  );
  assert.doesNotMatch(
    appCssSource,
    /\.app-titlebar-open-path-button:focus-visible\s*\{[^}]*outline:/s,
    "the titlebar file button must not restore its own focus ring",
  );
});

test("custom titlebar controls stay anchored to the visible viewport", async () => {
  const appCssSource = await readFile(
    new URL("../src/app/app.css", import.meta.url),
    "utf8",
  );

  const appRootRule = appCssSource.match(/\.app-root\s*\{(?<body>[^}]*)\}/s);
  const appShellRule = appCssSource.match(/\.app-shell\s*\{(?<body>[^}]*)\}/s);
  const appShellAnimatingRule = appCssSource.match(
    /\.app-shell\.panel-animating\s*\{(?<body>[^}]*)\}/s,
  );
  const controlsRule = appCssSource.match(
    /\.app-titlebar-controls\s*\{(?<body>[^}]*)\}/s,
  );
  const buttonRule = appCssSource.match(
    /\.app-titlebar-button\s*\{(?<body>[^}]*)\}/s,
  );

  assert.ok(appRootRule?.groups?.body, "app-root CSS rule should exist");
  assert.ok(appShellRule?.groups?.body, "app-shell CSS rule should exist");
  assert.ok(
    appShellAnimatingRule?.groups?.body,
    "app-shell panel animation CSS rule should exist",
  );
  assert.ok(
    controlsRule?.groups?.body,
    "titlebar controls CSS rule should exist",
  );
  assert.ok(buttonRule?.groups?.body, "titlebar button CSS rule should exist");
  assert.doesNotMatch(
    appRootRule.groups.body,
    /\bmin-width\s*:/,
    "the root titlebar row should not be widened past the visible viewport",
  );
  assert.doesNotMatch(
    appShellRule.groups.body,
    /\bmin-width\s*:/,
    "the workspace shell should shrink with the viewport so focusing the AI Assistant composer cannot scroll the Activity Rail off-screen",
  );
  assert.doesNotMatch(
    appShellAnimatingRule.groups.body,
    /\bgrid-template-columns\b/,
    "panel toggles should not animate the whole shell grid because that can jiggle the Activity Rail and Connections Panel",
  );
  assert.match(
    controlsRule.groups.body,
    /\bposition:\s*absolute;/,
    "the window controls cluster should be positioned independently of title text layout",
  );
  assert.match(
    controlsRule.groups.body,
    /\bright:\s*0;/,
    "the window controls cluster should stay anchored to the visible right edge",
  );
  assert.match(
    controlsRule.groups.body,
    /\bflex:\s*0\s+0\s+auto;/,
    "the window controls cluster should not shrink away from the right edge",
  );
  assert.match(
    buttonRule.groups.body,
    /\bflex:\s*0\s+0\s+46px;/,
    "each window control should preserve its fixed hit target width",
  );
});
