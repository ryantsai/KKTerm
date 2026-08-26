import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("terminal app-owned paste uses xterm paste transformations before writing to the session", async () => {
  const rendererSource = await readFile(
    new URL("../src/modules/workspace/connections/terminal/renderer.ts", import.meta.url),
    "utf8",
  );
  const workspaceSource = await readFile(
    new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
    "utf8",
  );

  assert.match(rendererSource, /paste: \(data: string\) => void/);
  assert.match(rendererSource, /paste\(data: string\) \{\s*this\.terminal\.paste\(data\);\s*\}/s);

  const pasteHandler =
    workspaceSource.match(/async function handlePasteIntoTerminal\(\) \{([\s\S]*?)\n  \}/)?.[1] ?? "";
  assert.match(pasteHandler, /terminalRendererRef\.current\?\.paste\(text\)/);
  assert.doesNotMatch(pasteHandler, /write_terminal_input/);
});

test("terminal copy-on-select uses the shared clipboard fallback", async () => {
  const workspaceSource = await readFile(
    new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
    "utf8",
  );

  const selectionHandler =
    workspaceSource.match(/terminal\.onSelectionChange\(\(\) => \{([\s\S]*?)\n    \}\)/)?.[1] ?? "";
  assert.match(selectionHandler, /void writeToClipboard\(selection\)/);
  assert.doesNotMatch(selectionHandler, /navigator\.clipboard/);
});

test("terminal copy-on-select reads the live setting so toggling applies to open terminals", async () => {
  const workspaceSource = await readFile(
    new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
    "utf8",
  );

  const selectionHandler =
    workspaceSource.match(/terminal\.onSelectionChange\(\(\) => \{([\s\S]*?)\n    \}\)/)?.[1] ?? "";
  assert.match(selectionHandler, /useWorkspaceStore\.getState\(\)\.terminalSettings\.copyOnSelect/);
});

test("copy-on-select setting explains regular SSH and tmux selection behavior", async () => {
  const settingsSource = await readFile(
    new URL("../src/modules/settings/TerminalSettings.tsx", import.meta.url),
    "utf8",
  );
  const english = JSON.parse(
    await readFile(new URL("../src/i18n/locales/en.json", import.meta.url), "utf8"),
  );

  assert.match(settingsSource, /t\("settings\.copyOnSelectHint"\)/);
  assert.match(english.settings.copyOnSelectHint, /regular SSH Sessions/i);
  assert.match(english.settings.copyOnSelectHint, /hold Shift/i);
  assert.match(english.settings.copyOnSelectHint, /tmux copy mode/i);
});

test("multiline paste confirmation returns focus to the terminal after the dialog closes", async () => {
  const workspaceSource = await readFile(
    new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
    "utf8",
  );

  const resolver =
    workspaceSource.match(
      /function resolveMultilinePasteConfirmation\(confirmed: boolean\) \{([\s\S]*?)\n  \}/,
    )?.[1] ?? "";
  assert.match(resolver, /setMultilinePasteConfirmationOpen\(false\)/);
  assert.match(resolver, /terminalRendererRef\.current\?\.focus\(\)/);
  assert.match(resolver, /queueMicrotask\(focus\)/);
  assert.match(resolver, /window\.requestAnimationFrame\(focus\)/);
});

test("multiline paste confirmation takes focus and supports Enter and Escape", async () => {
  const workspaceSource = await readFile(
    new URL("../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url),
    "utf8",
  );
  const confirmSheetSource = await readFile(
    new URL("../src/app/ui/dialog/ConfirmSheet.tsx", import.meta.url),
    "utf8",
  );

  const confirmation =
    workspaceSource.match(/multilinePasteConfirmationOpen \? \(([\s\S]*?)\n      \) : null/)?.[1] ?? "";
  assert.match(confirmation, /<ConfirmDialog[\s\S]*?autoFocusConfirm/);
  assert.match(confirmSheetSource, /<Btn autoFocus=\{autoFocusConfirm\}/);
  assert.match(confirmSheetSource, /event\.key === "Escape"/);
  assert.match(confirmSheetSource, /event\.preventDefault\(\)/);
  assert.match(confirmSheetSource, /event\.stopPropagation\(\)/);
  assert.match(confirmSheetSource, /onCancel\(\)/);
});

test("clipboard execCommand fallback restores focus after copying", async () => {
  const clipboardSource = await readFile(new URL("../src/lib/clipboard.ts", import.meta.url), "utf8");

  const fallback = clipboardSource.match(/const previouslyFocused([\s\S]*?)\n\}/)?.[0] ?? "";
  assert.match(fallback, /document\.activeElement/);
  assert.match(fallback, /previouslyFocused instanceof HTMLElement/);
  assert.match(fallback, /previouslyFocused\.focus\(\)/);
});
