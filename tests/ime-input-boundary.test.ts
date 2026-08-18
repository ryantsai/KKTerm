import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { isImeComposingEvent, shouldSuppressImeAction } from "../src/lib/ime.ts";

const keyEvent = (overrides: Partial<KeyboardEvent> = {}) =>
  ({
    isComposing: false,
    key: "Enter",
    keyCode: 13,
    ...overrides,
  }) as KeyboardEvent;

test("IME composition detection includes Chromium's Process key", () => {
  assert.equal(isImeComposingEvent(keyEvent({ key: "Process" })), true);
  assert.equal(isImeComposingEvent(keyEvent({ keyCode: 229 })), true);
  assert.equal(isImeComposingEvent(keyEvent({ isComposing: true })), true);
  assert.equal(isImeComposingEvent(keyEvent()), false);
  assert.equal(shouldSuppressImeAction(keyEvent({ key: "Process" }), false, 0, 0, false), false);
});

test("the app-level IME boundary protects every editable text surface", async () => {
  const appSource = await readFile(
    new URL("../src/App.tsx", import.meta.url),
    "utf8",
  );
  const imeSource = await readFile(
    new URL("../src/lib/ime.ts", import.meta.url),
    "utf8",
  );

  assert.match(imeSource, /export function isImeEditableTarget/);
  assert.match(appSource, /useImeCompositionGuard/);
  assert.match(appSource, /onCompositionStartCapture=\{imeGuard\.onCompositionStart\}/);
  assert.match(appSource, /onCompositionEndCapture=\{imeGuard\.onCompositionEnd\}/);
  assert.match(appSource, /isImeEditableTarget\(event\.target\)/);
  assert.match(appSource, /imeGuard\.shouldSuppressAction\(event\.nativeEvent\)/);
  assert.match(appSource, /event\.stopPropagation\(\)/);
  assert.match(appSource, /imeGuard\.consumeSuppressedSubmit\(\)/);

  for (const source of [
    await readFile(new URL("../src/app/TutorialOverlay.tsx", import.meta.url), "utf8"),
    await readFile(new URL("../src/modules/workspace/WorkspaceCanvas.tsx", import.meta.url), "utf8"),
    await readFile(new URL("../src/modules/itops/RackElevation.tsx", import.meta.url), "utf8"),
    await readFile(new URL("../src/modules/itops/SitesTab.tsx", import.meta.url), "utf8"),
    await readFile(new URL("../src/modules/itops/roomViewParts.tsx", import.meta.url), "utf8"),
  ]) {
    assert.match(source, /isImeComposingEvent/);
    assert.match(source, /isImeEditableTarget/);
  }

  const rdpSource = await readFile(
    new URL("../src/modules/workspace/connections/remote-desktop/RdpCanvasView.tsx", import.meta.url),
    "utf8",
  );
  assert.match(rdpSource, /isImeComposingEvent\(e\.nativeEvent\)/);
});
