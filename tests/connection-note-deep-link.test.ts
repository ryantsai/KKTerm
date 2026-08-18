import assert from "node:assert/strict";
import test from "node:test";

import {
  parseNoteDeepLink,
  serializeNoteDeepLink,
} from "../src/modules/notes/noteDeepLink";
import type { NoteDeepLink } from "../src/modules/notes/noteDeepLink";

test("note Deep Links round-trip through their serialized form", () => {
  const links: NoteDeepLink[] = [
    { kind: "connection", connectionId: "conn-1" },
    { kind: "workspace", workspaceId: "default" },
    { kind: "rackItem", siteId: "site-1", rackId: "rack-2", rackItemId: "item-3" },
  ];

  for (const link of links) {
    assert.deepEqual(parseNoteDeepLink(serializeNoteDeepLink(link)), link);
  }
});

test("note Deep Link parsing rejects malformed targets instead of throwing", () => {
  // Hand-edited or future-version note HTML must never break rendering, so
  // anything unrecognized resolves to null rather than a partial link.
  const malformed = [
    "",
    "connection",
    "connection:",
    "workspace:",
    "rackItem:site-1:rack-2",
    "rackItem:site-1:rack-2:item-3:extra",
    "unknownKind:value",
  ];

  for (const value of malformed) {
    assert.equal(parseNoteDeepLink(value), null, `expected null for ${JSON.stringify(value)}`);
  }
  assert.equal(parseNoteDeepLink(null), null);
  assert.equal(parseNoteDeepLink(undefined), null);
});
