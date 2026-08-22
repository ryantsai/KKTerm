import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("double-click open mode still selects Connection Tree rows on single click", async () => {
  const sidebarSource = await readFile(
    new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
    "utf8",
  );
  const cssSource = await readFile(
    new URL("../src/modules/workspace/connections/connections.css", import.meta.url),
    "utf8",
  );

  assert.match(
    sidebarSource,
    /const \[selectedConnectionId,\s*setSelectedConnectionId\] = useState<string \| null>\(null\);/,
    "Connection Tree should track selection separately from open Tabs",
  );
  assert.match(
    sidebarSource,
    /if \(doubleClickOpensConnection\) \{[\s\S]*?onSelect\(\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?onOpen\(event\);/,
    "single-click in double-click mode should select without opening",
  );
  assert.match(
    sidebarSource,
    /onDoubleClick=\{\(event\) => \{[\s\S]*?if \(doubleClickOpensConnection\) \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?onOpen\(event\);/,
    "double-click mode should still open from the double-click handler",
  );
  assert.match(
    sidebarSource,
    /isSelected=\{selectedConnectionId === connection\.id\}/,
    "root and flattened Connection rows should receive selected state",
  );
  assert.match(
    sidebarSource,
    /selectedConnectionId=\{selectedConnectionId\}/,
    "folder Connection rows should receive selected state",
  );
  assert.match(
    cssSource,
    /\.connection-row\.active,\s*\.connection-row\.selected \{[\s\S]*?background: var\(--accent-soft\);/,
    "selected rows should be visibly highlighted like active rows",
  );
});

test("Connection Tree focus does not draw browser selection borders", async () => {
  const cssSource = await readFile(
    new URL("../src/modules/workspace/connections/connections.css", import.meta.url),
    "utf8",
  );

  assert.match(
    cssSource,
    /\.tree-list:focus,[\s\S]*?\.tree-list button:focus-visible \{[\s\S]*?outline: 0;/,
    "the focusable Tree surface and its item buttons should suppress browser outlines",
  );
});
