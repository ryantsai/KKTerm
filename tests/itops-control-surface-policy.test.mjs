import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("custom IT Ops editors bridge shared dialog control tokens", async () => {
  const [tasks, networkMap, dialogStyles] = await Promise.all([
    read("src/modules/itops/TaskLibrary.tsx"),
    read("src/modules/itops/NetworkMapDesigner.tsx"),
    read("src/app/ui/dialog/dialogs.css"),
  ]);

  assert.match(tasks, /className="au-editor pb-editor kk-surface"/);
  assert.match(networkMap, /className="au-side nm-side kk-surface"/);
  assert.match(dialogStyles, /\.kk-dlg,\s*\n\.kk-surface\s*\{/);
});

test("every IT Ops shared form-control host supplies a token bridge", async () => {
  const moduleUrl = new URL("../src/modules/itops/", import.meta.url);
  const files = (await readdir(moduleUrl)).filter((name) => name.endsWith(".tsx"));
  const primitive = /<(?:Field|TextInput|TextArea|Select|Switch|Segmented|Stepper|Group|GRow)\b/;

  for (const file of files) {
    const source = await read(`src/modules/itops/${file}`);
    if (!primitive.test(source)) continue;
    assert.match(
      source,
      /<Sheet\b|kk-surface/,
      `${file} renders shared form controls without Sheet or kk-surface`,
    );
  }
});

test("bespoke IT Ops text inputs stay limited to themed search and editor-title controls", async () => {
  const moduleUrl = new URL("../src/modules/itops/", import.meta.url);
  const files = (await readdir(moduleUrl)).filter((name) => name.endsWith(".tsx"));
  const allowedHost =
    /className="(?:rm-picker-search|it-task-search|ft-search)"|className="au-editor-name"/;

  for (const file of files) {
    const source = await read(`src/modules/itops/${file}`);
    for (const match of source.matchAll(/<input\b[\s\S]*?\/>/g)) {
      const tag = match[0];
      if (/type="(?:checkbox|range)"/.test(tag)) continue;
      const context = source.slice(Math.max(0, match.index - 180), match.index + tag.length);
      assert.match(context, allowedHost, `${file} contains an unthemed raw text input`);
    }
  }
});

test("IT Ops and design docs require the non-Sheet surface convention", async () => {
  const [itops, design] = await Promise.all([
    read("docs/ITOPS.md"),
    read("docs/DESIGN_LANGUAGE.md"),
  ]);

  assert.match(itops, /outside `Sheet` must mark its[\s\S]*surface root with `kk-surface`/);
  assert.match(design, /custom non-`Sheet`[\s\S]*surface root must[\s\S]*carry `kk-surface`/);
});
