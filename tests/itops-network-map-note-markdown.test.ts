import assert from "node:assert/strict";
import test from "node:test";

import { formatNetworkMapNoteMarkdown } from "../src/modules/itops/networkMapNoteMarkdown.ts";

test("Network Map note formatting wraps and unwraps inline selections", () => {
  const bold = formatNetworkMapNoteMarkdown("core switch", 0, 4, "bold");
  assert.deepEqual(bold, {
    text: "**core** switch",
    selectionStart: 2,
    selectionEnd: 6,
  });

  assert.deepEqual(
    formatNetworkMapNoteMarkdown(
      bold.text,
      bold.selectionStart,
      bold.selectionEnd,
      "bold",
    ),
    {
      text: "core switch",
      selectionStart: 0,
      selectionEnd: 4,
    },
  );
});

test("Network Map note formatting applies line-aware Markdown prefixes", () => {
  assert.deepEqual(
    formatNetworkMapNoteMarkdown("core\nedge", 0, 9, "numberedList"),
    {
      text: "1. core\n2. edge",
      selectionStart: 0,
      selectionEnd: 15,
    },
  );

  assert.equal(
    formatNetworkMapNoteMarkdown("Maintenance", 3, 3, "heading2").text,
    "## Maintenance",
  );
});

test("Network Map note link formatting leaves the caret ready for the URL", () => {
  assert.deepEqual(
    formatNetworkMapNoteMarkdown("Runbook", 0, 7, "link"),
    {
      text: "[Runbook]()",
      selectionStart: 10,
      selectionEnd: 10,
    },
  );
});
