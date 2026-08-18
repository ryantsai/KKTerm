import assert from "node:assert/strict";
import test from "node:test";

import {
  NOTE_DEEP_LINK_RESULT_LIMIT,
  filterNoteDeepLinkChoices,
} from "../src/modules/notes/noteDeepLinkChoices";
import type { NoteDeepLinkChoice } from "../src/modules/notes/noteDeepLinkChoices";

const choices: NoteDeepLinkChoice[] = [
  {
    key: "connection:c1",
    label: "web-01",
    detail: "10.0.0.5",
    link: { kind: "connection", connectionId: "c1" },
  },
  {
    key: "connection:c2",
    label: "db-primary",
    detail: "10.0.0.6",
    link: { kind: "connection", connectionId: "c2" },
  },
  {
    key: "workspace:ws1",
    label: "Production",
    detail: "Workspace",
    link: { kind: "workspace", workspaceId: "ws1" },
  },
  {
    key: "rackItem:s1:r1:i1",
    label: "Switch A",
    detail: "HQ · Rack A12",
    link: { kind: "rackItem", siteId: "s1", rackId: "r1", rackItemId: "i1" },
  },
];

test("an empty @ query keeps source order so the menu opens on Connections", () => {
  // The `@` menu shows before the user types anything, so the unfiltered order
  // has to be the useful one rather than a fuzzy-search artifact.
  const results = filterNoteDeepLinkChoices(choices, "");
  assert.deepEqual(
    results.map((choice) => choice.key),
    choices.map((choice) => choice.key),
  );

  // Whitespace-only queries behave the same; typing "@ " must not blank the menu.
  assert.equal(filterNoteDeepLinkChoices(choices, "   ").length, choices.length);
});

test("@ queries match Connections, Workspaces, and rack devices alike", () => {
  const byName = filterNoteDeepLinkChoices(choices, "web");
  assert.equal(byName[0]?.key, "connection:c1");

  const byWorkspace = filterNoteDeepLinkChoices(choices, "Production");
  assert.equal(byWorkspace[0]?.key, "workspace:ws1");

  const byRack = filterNoteDeepLinkChoices(choices, "Switch");
  assert.equal(byRack[0]?.key, "rackItem:s1:r1:i1");

  // The detail column is searchable too, so an address finds its Connection.
  const byHost = filterNoteDeepLinkChoices(choices, "10.0.0.6");
  assert.equal(byHost[0]?.key, "connection:c2");
});

test("@ results are capped so a large estate cannot render an unbounded menu", () => {
  const many: NoteDeepLinkChoice[] = Array.from({ length: 200 }, (_, index) => ({
    key: `connection:c${index}`,
    label: `host-${index}`,
    detail: "10.0.0.1",
    link: { kind: "connection", connectionId: `c${index}` },
  }));

  assert.equal(filterNoteDeepLinkChoices(many, "").length, NOTE_DEEP_LINK_RESULT_LIMIT);
  assert.equal(filterNoteDeepLinkChoices(many, "host").length, NOTE_DEEP_LINK_RESULT_LIMIT);
});

test("a non-matching @ query yields no results rather than every choice", () => {
  assert.deepEqual(filterNoteDeepLinkChoices(choices, "zzzzzzzz"), []);
});
