import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire, stripTypeScriptTypes } from "node:module";
import test from "node:test";
import vm from "node:vm";

const { Terminal } = createRequire(import.meta.url)("@xterm/xterm");
const workspace = readFileSync(new URL(
  "../src/modules/workspace/connections/terminal/TerminalWorkspace.tsx", import.meta.url,
), "utf8");
const clipboard = readFileSync(new URL("../src/lib/clipboard.ts", import.meta.url), "utf8");

// Execute the production handlers with the real xterm paste/onData pipeline.
// Only clipboard, native menu, focus and confirmation UI are test doubles:
// this is not a Windows WebView2/native clipboard integration test.
function extractFunction(source, name, indent = "  ") {
  const match = source.match(new RegExp(
    `${indent}(?:async )?function ${name}\\([^]*?\\n${indent}\\}`,
  ));
  assert.ok(match, `Missing production function ${name}`);
  return stripTypeScriptTypes(match[0]);
}

function harness(t, initiallyConfirm = false) {
  let settings = { confirmMultilinePaste: initiallyConfirm, rightClickPaste: true };
  let text = "first\r\nsecond";
  let rejectClipboard = false;
  let clipboardReads = 0;
  let focusCount = 0;
  let menu;
  let answer;
  const writes = [];
  const pending = [];
  const terminal = new Terminal();
  // No DOM is opened in Node. xterm paste only clears this textarea after
  // emitting transformed input; keep the parser and paste implementation real.
  terminal._core.textarea = { value: "" };
  t.after(() => terminal.dispose());
  const renderer = {
    paste: (data) => terminal.paste(data),
    focus: () => { focusCount += 1; },
    getSelection: () => "",
  };
  const context = {
    terminalSettings: settings, // Capture the settings from Session creation.
    useWorkspaceStore: { getState: () => ({ terminalSettings: settings }) },
    terminalRendererRef: { current: renderer },
    navigator: { clipboard: { readText: async () => {
      clipboardReads += 1;
      if (rejectClipboard) throw new Error("NotAllowedError");
      return text;
    } } },
    requestMultilinePasteConfirmation: () => new Promise((resolve) => { answer = resolve; }),
    onFocus() {},
    updateTerminalSelection() {},
    handleCopyTerminalSelection() {},
    t: (key) => key,
    nativeMenuIcons: {},
    showNativeContextMenu: async (items) => { menu = items; },
  };
  const handlers = vm.runInNewContext([
    extractFunction(clipboard, "readFromClipboard", ""),
    extractFunction(workspace, "isMultilinePaste", ""),
    extractFunction(workspace, "writeWithPasteConfirmation"),
    extractFunction(workspace, "handlePasteIntoTerminal"),
    extractFunction(workspace, "handleTerminalContextMenu"),
    "({ writeWithPasteConfirmation, handleTerminalContextMenu })",
  ].join("\n"), context);
  terminal.onData((data) => pending.push(
    handlers.writeWithPasteConfirmation(data, (input) => writes.push(input)),
  ));
  return {
    writes, terminal,
    setConfirm(value) { settings = { ...settings, confirmMultilinePaste: value }; },
    setText(value) { text = value; },
    denyClipboard() { rejectClipboard = true; },
    get asked() { return Boolean(answer); },
    get focusCount() { return focusCount; },
    get clipboardReads() { return clipboardReads; },
    get menu() { return menu; },
    async rightClick(shiftKey = false) {
      let prevented = false;
      handlers.handleTerminalContextMenu({
        shiftKey, preventDefault() { prevented = true; }, stopPropagation() {},
      });
      assert.equal(prevented, true);
      await new Promise(setImmediate);
    },
    async answer(value) { answer(value); await Promise.all(pending); },
  };
}

test("enabling confirmation on an existing Session gates right-click paste; Cancel writes nothing", async (t) => {
  const h = harness(t, false);
  h.setConfirm(true);
  await h.rightClick();
  assert.equal(h.asked, true);
  assert.deepEqual(h.writes, []);
  await h.answer(false);
  assert.deepEqual(h.writes, []);
});

test("disabling confirmation on an existing Session takes effect without reconnecting", async (t) => {
  const h = harness(t, true);
  h.setConfirm(false);
  await h.rightClick();
  assert.equal(h.asked, false);
  assert.deepEqual(h.writes, ["first\rsecond"]);
});

for (const bracketed of [false, true]) {
  test(`confirmed right-click paste writes once with xterm normalization (bracketed=${bracketed})`, async (t) => {
    const h = harness(t, true);
    if (bracketed) await new Promise((resolve) => h.terminal.write("\x1b[?2004h", resolve));
    await h.rightClick();
    assert.equal(h.asked, true);
    assert.deepEqual(h.writes, []);
    await h.answer(true);
    assert.deepEqual(h.writes, [bracketed ? "\x1b[200~first\rsecond\x1b[201~" : "first\rsecond"]);
    assert.equal(h.menu, undefined);
    assert.equal(h.clipboardReads, 1);
  });
}

test("single-line right-click paste sends Unicode once and restores terminal focus", async (t) => {
  const h = harness(t, true);
  h.setText("echo 貼上");
  await h.rightClick();
  assert.equal(h.asked, false);
  assert.deepEqual(h.writes, ["echo 貼上"]);
  assert.equal(h.focusCount, 1);
});

test("Shift+right-click opens the native menu without reading or pasting", async (t) => {
  const h = harness(t);
  await h.rightClick(true);
  assert.deepEqual(Array.from(h.menu, (item) => item.label), ["terminal.copy", "terminal.paste"]);
  assert.equal(h.clipboardReads, 0);
  assert.deepEqual(h.writes, []);
});

for (const denied of [false, true]) {
  test(`empty or denied clipboard does not send input and restores focus (denied=${denied})`, async (t) => {
    const h = harness(t);
    h.setText("");
    if (denied) h.denyClipboard();
    await h.rightClick();
    assert.deepEqual(h.writes, []);
    assert.equal(h.asked, false);
    assert.equal(h.focusCount, 1);
  });
}
