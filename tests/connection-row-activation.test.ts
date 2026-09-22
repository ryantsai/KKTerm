import assert from "node:assert/strict";
import test from "node:test";
import {
  connectionRowClickActivation,
  connectionRowDoubleClickActivation,
} from "../src/modules/workspace/connections/connectionRowActivation.ts";

function doubleClickSequence(doubleClickOpensConnection: boolean) {
  return [
    connectionRowClickActivation(doubleClickOpensConnection, 1),
    connectionRowClickActivation(doubleClickOpensConnection, 2),
    connectionRowDoubleClickActivation(doubleClickOpensConnection),
  ];
}

// Tauri uses different system WebViews, but each sends the standard click-count
// sequence through this shared React handler. These are product-policy checks,
// not substitutes for release smoke tests in each real Tauri runtime.
const desktopWebViews = [
  ["Windows", "WebView2"],
  ["macOS", "WKWebView"],
  ["Linux", "WebKitGTK"],
] as const;

for (const [platform, webView] of desktopWebViews) {
  test(`${platform} ${webView}: a double-click dispatches one open in single-click mode`, () => {
    assert.deepEqual(doubleClickSequence(false), ["open", "ignore", "ignore"]);
  });
}

test("double-click mode selects on clicks and opens from the double-click event", () => {
  assert.deepEqual(doubleClickSequence(true), ["select", "select", "open"]);
});

test("keyboard-generated clicks still open in single-click mode", () => {
  assert.equal(connectionRowClickActivation(false, 0), "open");
});
