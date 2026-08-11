import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("keyword-highlighting dialogs use the shared dialog form language", async () => {
  const [source, settingsCss] = await Promise.all([
    read("src/modules/settings/SyntaxHighlightProfiles.tsx"),
    read("src/modules/settings/settings.css"),
  ]);

  assert.match(source, /<Field\b/);
  assert.match(source, /<TextInput\b/);
  assert.match(source, /<TextArea\b/);
  assert.match(source, /<Switch\b/);
  assert.doesNotMatch(source, /<(?:input|textarea)\b/);
  assert.match(source, /<Btn kind="primary" icon="wand"/);
  assert.match(settingsCss, /\.syntax-profile-editor-dialog \.kk-dlg\s*\{/);
  assert.doesNotMatch(settingsCss, /\.syntax-profile-editor-dialog \.kk-sheet\b/);
});

test("keyword-highlighting colors use one compact clickable swatch", async () => {
  const [source, picker, pickerCss] = await Promise.all([
    read("src/modules/settings/SyntaxHighlightProfiles.tsx"),
    read("src/app/ui/ColorPalettePicker.tsx"),
    read("src/app/ui/colorPalettePicker.css"),
  ]);

  assert.match(source, /<ColorPalettePicker ariaLabel=\{label\} onClear=\{\(\) => onChange\(null\)\} trigger="swatch"/);
  assert.doesNotMatch(source, /syntax-profile-color-field[\s\S]*?<i\s+style=/);
  assert.doesNotMatch(source, /syntax-profile-color-field[\s\S]*?<X\b/);
  assert.match(picker, /trigger\?: "rainbow" \| "swatch"/);
  assert.match(picker, /createPortal\(popover, document\.body\)/);
  assert.match(pickerCss, /\.color-palette-swatch\s*\{[\s\S]*?width:\s*20px;[\s\S]*?height:\s*20px;/);
});
