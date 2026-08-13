import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("right-click menus that can intersect native surfaces use Tauri native menus", async () => {
  const [terminal, sftpWorkspace, sftpOverlays, appLauncher] = await Promise.all([
    readFile(
      new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/modules/workspace/connections/sftp/SftpWorkspace.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/modules/workspace/connections/sftp/SftpOverlays.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/modules/dashboard/widgets/builtin/app-launcher/AppLauncherWidget.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  for (const [name, source] of [
    ["Terminal", terminal],
    ["SFTP/File Explorer", sftpWorkspace],
    ["App Launcher", appLauncher],
  ]) {
    assert.match(source, /showNativeContextMenu/, `${name} should open its right-click menu natively`);
  }

  assert.doesNotMatch(terminal, /function TerminalContextMenu\s*\(/);
  assert.doesNotMatch(sftpOverlays, /function SftpContextMenu\s*\(/);
  assert.doesNotMatch(appLauncher, /function AppLauncherMenu\s*\(/);
});

test("advanced DOM overlays share URL and RDP intersection detection", async () => {
  const source = await readFile(
    new URL("../src/modules/workspace/nativeOverlay.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /documentHasRdpBlockingOverlay[\s\S]*INTERSECTING_NATIVE_SURFACE_OVERLAY_SELECTOR/,
  );
  assert.match(
    source,
    /documentHasWebviewBlockingOverlay[\s\S]*INTERSECTING_NATIVE_SURFACE_OVERLAY_SELECTOR/,
  );
  assert.match(
    source,
    /documentHasCustomModuleBlockingOverlay[\s\S]*INTERSECTING_NATIVE_SURFACE_OVERLAY_SELECTOR/,
  );

  for (const selector of [
    ".assistant-image-preview-backdrop",
    ".app-launcher-dialog-backdrop",
    ".app-launcher-menu",
    ".ai-coding-add-menu",
    ".dashboard-tab-gradient-popover",
    ".dw-bg-popover",
    ".dw-customize-dismiss-layer",
    ".fv-bg-popover",
    ".fv-menu",
    ".git-adv-backdrop",
    ".sftp-bg-popover",
    ".sftp-protocol-menu",
    ".sftp-recent-menu",
    ".sftp-viewopts-menu",
    ".terminal-actions-menu",
    ".terminal-bg-popover",
    ".tmux-session-menu-portal",
    ".tutorial-overlay",
  ]) {
    assert.match(source, new RegExp(`"${selector.replaceAll(".", "\\.")}"`), `${selector} should suppress intersecting native surfaces`);
  }
});

test("Dashboard overlays use the central snapshot suppression path", async () => {
  const files = await Promise.all(
    [
      "../src/modules/dashboard/DashboardPage.tsx",
      "../src/modules/dashboard/view/DashboardCanvas.tsx",
      "../src/modules/dashboard/view/WidgetFrame.tsx",
      "../src/modules/dashboard/view/WidgetBody.tsx",
      "../src/modules/dashboard/registry/builtInRegistry.ts",
      "../src/modules/dashboard/widgets/builtin/connections/ConnectionWidget.tsx",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );

  for (const source of files) {
    assert.doesNotMatch(
      source,
      /suppressNativeWebviews/,
      "Dashboard overlays should not bypass the URL snapshot with direct visibility props",
    );
  }
});

test("AI coding guidance preserves native-surface layering constraints", async () => {
  const [agents, aiInstructions, architecture] = await Promise.all([
    readFile(new URL("../AGENTS.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/AIINSTRUCTIONS.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/ARCHITECTURE.md", import.meta.url), "utf8"),
  ]);

  for (const [name, source] of [
    ["AGENTS.md", agents],
    ["AIINSTRUCTIONS.md", aiInstructions],
  ]) {
    assert.match(
      source,
      /CSS `z-index` cannot/,
      `${name} should warn that CSS cannot out-z-order native Session surfaces`,
    );
    assert.match(
      source,
      /nativeContextMenu\.ts/,
      `${name} should require native right-click command menus`,
    );
    assert.match(
      source,
      /nativeOverlay\.ts/,
      `${name} should route advanced DOM overlays through the intersection registry`,
    );
  }
  assert.match(architecture, /URL[^\r\n]*snapshot\/hide/);
  assert.match(architecture, /RDP[^\r\n]*snapshot\/park/);
});
