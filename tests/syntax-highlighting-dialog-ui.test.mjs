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
  assert.doesNotMatch(source, /syntaxHighlightCaseSensitive/);
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

test("keyword-highlighting profile rows use the compact list scale", async () => {
  const settingsCss = await read("src/modules/settings/settings.css");

  assert.match(settingsCss, /\.syntax-profile-row\s*\{[\s\S]*?min-height:\s*40px;[\s\S]*?padding:\s*6px 9px;/);
  assert.match(settingsCss, /\.syntax-profile-row strong\s*\{[\s\S]*?font-size:\s*13px;/);
  assert.match(settingsCss, /\.syntax-profile-row > svg\s*\{[\s\S]*?width:\s*13px;[\s\S]*?height:\s*13px;/);
});

test("keyword-highlighting rules keep terminal typography unchanged", async () => {
  const source = await read("src/modules/settings/SyntaxHighlightProfiles.tsx");

  assert.doesNotMatch(source, /settings\.syntaxHighlightFont/);
  assert.doesNotMatch(source, /settings\.syntaxHighlightBold/);
  assert.doesNotMatch(source, /settings\.syntaxHighlightItalic/);
});
