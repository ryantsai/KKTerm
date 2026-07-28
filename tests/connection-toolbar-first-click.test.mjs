import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const terminalWorkspaceSource = await readFile(
  new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
  "utf8",
);

test("Panorama Connection toolbar controls defer Pane selection until click", () => {
  assert.match(
    terminalWorkspaceSource,
    /function shouldDeferPaneFocusUntilClick\(/,
    "terminal and embedded Connection Panes need one shared interactive-target guard",
  );
  assert.match(
    terminalWorkspaceSource,
    /function handleEmbeddedPaneMouseDown\([\s\S]*shouldDeferPaneFocusUntilClick\(event\.target\)[\s\S]*onFocus\(\)/,
    "embedded Connection controls must not change focused Pane during mousedown",
  );
  assert.match(
    terminalWorkspaceSource,
    /function handleEmbeddedPaneClick\([\s\S]*shouldDeferPaneFocusUntilClick\(event\.target\)[\s\S]*onFocus\(\)/,
    "embedded Connection controls should select their Pane after their click handler runs",
  );
  assert.match(
    terminalWorkspaceSource,
    /function handlePaneMouseDown\([\s\S]*shouldDeferPaneFocusUntilClick\(event\.target\)[\s\S]*onFocus\(\)[\s\S]*focusTerminalRenderer\(\)/,
    "terminal controls must not focus or select the Pane before Chromium synthesizes click",
  );
  assert.match(
    terminalWorkspaceSource,
    /function handlePaneClick\([\s\S]*shouldDeferPaneFocusUntilClick\(event\.target\)[\s\S]*onFocus\(\)/,
    "terminal controls should select their Pane only after activation",
  );
});

test("the deferred Pane-focus guard covers every Connection toolbar control shape", () => {
  const focusGuard = terminalWorkspaceSource.match(
    /function shouldDeferPaneFocusUntilClick\([\s\S]*?\n\}/,
  )?.[0];
  assert.ok(focusGuard, "the shared Pane-focus guard should remain discoverable");
  assert.match(
    focusGuard,
    /button,\s*input,\s*textarea,\s*select,\s*a\[href\],\s*summary,\s*\[role="button"\],\s*\[role\^="menuitem"\]/,
    "buttons, address/search fields, selectors, links, and custom toolbar controls all need first-click protection",
  );
  assert.doesNotMatch(
    focusGuard,
    /tabindex|canvas/,
    "VNC and canvas-RDP surfaces must retain their immediate pointer-down Pane focus",
  );
});
