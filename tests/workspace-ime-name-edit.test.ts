import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  IME_COMPOSITION_END_GRACE_MS,
  shouldSuppressImeAction,
} from "../src/lib/ime.ts";

const keyEvent = (overrides: Partial<KeyboardEvent> = {}) =>
  ({
    isComposing: false,
    key: "Enter",
    keyCode: 13,
    ...overrides,
  }) as KeyboardEvent;

test("IME action guard suppresses Windows composition confirmation keys", () => {
  assert.equal(shouldSuppressImeAction(keyEvent({ isComposing: true }), false, 0, 0, false), true);
  assert.equal(shouldSuppressImeAction(keyEvent({ keyCode: 229 }), false, 0, 0, false), true);
  assert.equal(shouldSuppressImeAction(keyEvent(), true, 0, 0, false), true);
  assert.equal(shouldSuppressImeAction(keyEvent({ key: "Escape" }), true, 0, 0, false), true);
  assert.equal(shouldSuppressImeAction(keyEvent(), false, 0, 0, false), false);
});

test("IME action guard covers compositionend-before-keydown ordering on macOS", () => {
  const compositionEndedAt = 1_000;
  assert.equal(
    shouldSuppressImeAction(
      keyEvent(),
      false,
      compositionEndedAt,
      compositionEndedAt + IME_COMPOSITION_END_GRACE_MS - 1,
      true,
    ),
    true,
  );
  assert.equal(
    shouldSuppressImeAction(
      keyEvent(),
      false,
      compositionEndedAt,
      compositionEndedAt + IME_COMPOSITION_END_GRACE_MS,
      true,
    ),
    false,
  );
});

test("Workspace and folder name editors wire the IME guard before actions", async () => {
  const workspaceSource = await readFile(
    new URL("../src/modules/workspace/NewWorkspaceDialog.tsx", import.meta.url),
    "utf8",
  );
  const sidebarSource = await readFile(
    new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
    "utf8",
  );

  assert.match(workspaceSource, /useImeCompositionGuard/);
  assert.match(workspaceSource, /onCompositionStart=\{imeGuard\.onCompositionStart\}/);
  assert.match(workspaceSource, /onCompositionEnd=\{imeGuard\.onCompositionEnd\}/);
  assert.match(
    workspaceSource,
    /if \(imeGuard\.shouldSuppressAction\(event\.nativeEvent\)\) \{\s*return;\s*\}\s*if \(event\.key === "Enter"\)/,
  );

  const newFolderSource =
    sidebarSource.match(/function NewFolderDraftRow[\s\S]*?function isTerminalConnectionType/)?.[0] ?? "";
  const inlineRenameSource =
    sidebarSource.match(/function InlineTreeRenameInput[\s\S]*?function TreeContextMenu/)?.[0] ?? "";
  assert.ok(newFolderSource, "new folder editor should be discoverable");
  assert.ok(inlineRenameSource, "inline rename editor should be discoverable");

  for (const editorSource of [newFolderSource, inlineRenameSource]) {
    assert.match(editorSource, /useImeCompositionGuard/);
    assert.match(editorSource, /onCompositionStart=\{imeGuard\.onCompositionStart\}/);
    assert.match(editorSource, /onCompositionEnd=\{imeGuard\.onCompositionEnd\}/);
    assert.match(
      editorSource,
      /if \(imeGuard\.shouldSuppressAction\(event\.nativeEvent\)\) \{\s*return;\s*\}/,
    );
    assert.match(editorSource, /if \(event\.key === "Enter"\)/);
    assert.match(editorSource, /if \(event\.key === "Escape"\)/);
  }
});
