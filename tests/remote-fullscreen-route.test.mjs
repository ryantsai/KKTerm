import assert from "node:assert/strict";
import test from "node:test";

import { parseRemoteFullscreenRoute } from "../src/modules/workspace/connections/remote-desktop/remoteFullscreenRoute.ts";

test("parses a vnc full-screen route", () => {
  assert.deepEqual(
    parseRemoteFullscreenRoute("#/remote-fullscreen/vnc/vnc-abc123/conn-1"),
    { kind: "vnc", sessionId: "vnc-abc123", connectionId: "conn-1" },
  );
});

test("parses an rdp route without a leading slash after the hash", () => {
  assert.deepEqual(
    parseRemoteFullscreenRoute("#remote-fullscreen/rdp/rdp-x/conn-2"),
    { kind: "rdp", sessionId: "rdp-x", connectionId: "conn-2" },
  );
});

test("decodes percent-encoded session and connection ids", () => {
  assert.deepEqual(
    parseRemoteFullscreenRoute("#/remote-fullscreen/vnc/sess%20id/conn%2Fx"),
    { kind: "vnc", sessionId: "sess id", connectionId: "conn/x" },
  );
});

test("rejects unknown kinds", () => {
  assert.equal(parseRemoteFullscreenRoute("#/remote-fullscreen/ssh/s/c"), null);
});

test("rejects routes missing the session or connection id", () => {
  assert.equal(parseRemoteFullscreenRoute("#/remote-fullscreen/vnc/only-session"), null);
  assert.equal(parseRemoteFullscreenRoute("#/remote-fullscreen/vnc"), null);
});

test("returns null for unrelated hashes", () => {
  assert.equal(parseRemoteFullscreenRoute(""), null);
  assert.equal(parseRemoteFullscreenRoute("#/settings"), null);
});
