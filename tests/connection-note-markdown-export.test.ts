import assert from "node:assert/strict";
import test from "node:test";

import { noteHtmlToMarkdown, noteMarkdownFilename } from "../src/modules/notes/noteMarkdown.ts";

test("note export keeps an image reference instead of the image", () => {
  // Note images are files in the app data directory, not part of the exported
  // document. The reference is the asset's path under that directory, so the
  // original file is still identifiable from the exported Markdown alone.
  const markdown = noteHtmlToMarkdown(
    '<p><img data-note-asset="conn-1/abc.png" alt="rack label" width="320"></p>',
  );
  assert.equal(markdown.trim(), "![rack label](note-images/conn-1/abc.png)");

  // An image inserted without alt text still names the file it refers to.
  assert.equal(
    noteHtmlToMarkdown('<p><img data-note-asset="conn-1/abc.png"></p>').trim(),
    "![abc.png](note-images/conn-1/abc.png)",
  );

  // Sanitization strips images that carry no asset id; an exported note must
  // not smuggle a stray remote source back in either.
  assert.equal(noteHtmlToMarkdown('<p><img src="https://example.com/x.png"></p>').trim(), "");
});

test("note export preserves the structures the note toolbar can produce", () => {
  const markdown = noteHtmlToMarkdown(
    "<h2>Restart</h2>" +
      "<ul data-type=\"taskList\">" +
      '<li data-type="taskItem" data-checked="true"><div><p>backup verified</p></div></li>' +
      '<li data-type="taskItem" data-checked="false"><div><p>rotate keys</p></div></li>' +
      "</ul>" +
      "<pre><code>uptime</code></pre>" +
      "<p><s>retired</s></p>" +
      "<table><tbody><tr><th><p>Host</p></th><th><p>Role</p></th></tr>" +
      "<tr><td><p>db-1</p></td><td><p>primary</p></td></tr></tbody></table>",
  );

  assert.match(markdown, /^## Restart$/m);
  // Checklist state is carried by `data-checked`; a plain bullet would lose it.
  assert.match(markdown, /^- \[x\] backup verified$/m);
  assert.match(markdown, /^- \[ \] rotate keys$/m);
  assert.match(markdown, /```\nuptime\n```/);
  assert.match(markdown, /~~retired~~/);
  // Turndown has no table rule of its own, so without ours a table would
  // collapse into one run-on line.
  assert.match(markdown, /^\| Host \| Role \|$/m);
  assert.match(markdown, /^\| --- \| --- \|$/m);
  assert.match(markdown, /^\| db-1 \| primary \|$/m);
});

test("note export flattens a Deep Link chip to its captured label", () => {
  // A Deep Link only resolves inside KKTerm, so an exported note keeps the
  // label the chip displays rather than an unusable target.
  const markdown = noteHtmlToMarkdown(
    '<p>See <span data-note-deep-link="connection:abc" data-note-label="edge-01">edge-01</span>.</p>',
  );
  assert.equal(markdown.trim(), "See edge-01.");
});

test("the export file name survives a Connection name that is not a file name", () => {
  assert.equal(noteMarkdownFilename("prod/db: main*"), "prod db main.md");
  // Non-ASCII names stay readable rather than collapsing to placeholders.
  assert.equal(noteMarkdownFilename("正式資料庫"), "正式資料庫.md");
  assert.equal(noteMarkdownFilename("///"), "note.md");
});
