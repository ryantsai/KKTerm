import assert from "node:assert/strict";
import test from "node:test";

import {
  parseNoteDeepLink,
  serializeNoteDeepLink,
} from "../src/modules/notes/noteDeepLink";
import type { NoteDeepLink } from "../src/modules/notes/noteDeepLink";
import { isValidNoteDeepLinkTarget } from "../src/modules/notes/noteHtml";

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

test("note Deep Link sanitizer validation accepts only app-owned target formats", () => {
  for (const value of [
    "connection:conn-1",
    "workspace:workspace-1",
    "rackItem:site-1:rack-2:item-3",
  ]) {
    assert.equal(isValidNoteDeepLinkTarget(value), true, value);
  }

  for (const value of [
    "connection:javascript:alert(1)",
    "workspace:",
    "rackItem:site-1:rack-2",
    "unknown:value",
  ]) {
    assert.equal(isValidNoteDeepLinkTarget(value), false, value);
  }
});
