import assert from "node:assert/strict";
import test from "node:test";
import {
  WORKSPACE_SHORTCUT_ACTIONS,
  activeConnectionForNewTab,
  bindingFromKeyboardEvent,
  conflictingWorkspaceShortcutAction,
  effectiveWorkspaceShortcutBindings,
  fixedTerminalShortcutFromKeyboardEvent,
  workspaceShortcutFromKeyboardEvent,
} from "../src/modules/workspace/keymap";
import type { Connection, WorkspaceTab } from "../src/types";

// Minimal KeyboardEvent stand-in; the keymap only reads these fields.
function keyEvent(
  key: string,
  modifiers: Partial<Pick<KeyboardEvent, "ctrlKey" | "shiftKey" | "altKey" | "metaKey">> = {},
): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ...modifiers,
  } as KeyboardEvent;
}

test("activeConnectionForNewTab targets the focused Pane before the Tab fallback", () => {
  const parent = { id: "parent", name: "Parent" } as Connection;
  const focused = { id: "focused", name: "Focused" } as Connection;
  const tabs = [
    {
      id: "tab-1",
      connection: parent,
      focusedPaneId: "pane-focused",
      panes: [
        { id: "pane-parent", connection: parent },
        { id: "pane-focused", connection: focused },
      ],
    },
  ] as WorkspaceTab[];

  assert.equal(activeConnectionForNewTab(tabs, "tab-1"), focused);
  assert.equal(
    activeConnectionForNewTab([{ ...tabs[0], focusedPaneId: "missing" }], "tab-1"),
    parent,
  );
  assert.equal(activeConnectionForNewTab(tabs, "missing"), null);
});

test("bindingFromKeyboardEvent canonicalizes modifier order and key casing", () => {
  assert.equal(
    bindingFromKeyboardEvent(keyEvent("t", { ctrlKey: true, shiftKey: true })),
    "Ctrl+Shift+T",
  );
  assert.equal(bindingFromKeyboardEvent(keyEvent(" ", { ctrlKey: true, shiftKey: true })), "Ctrl+Shift+Space");
  assert.equal(bindingFromKeyboardEvent(keyEvent("Tab", { ctrlKey: true })), "Ctrl+Tab");
});

test("bindingFromKeyboardEvent ignores bare keys and lone modifiers", () => {
  // Plain typing must never resolve to a binding, or terminals would break.
  assert.equal(bindingFromKeyboardEvent(keyEvent("a")), null);
  assert.equal(bindingFromKeyboardEvent(keyEvent("Control", { ctrlKey: true })), null);
  assert.equal(bindingFromKeyboardEvent(keyEvent("Shift", { shiftKey: true })), null);
  // Function keys are allowed without a modifier.
  assert.equal(bindingFromKeyboardEvent(keyEvent("F5")), "F5");
});

test("workspaceShortcutFromKeyboardEvent resolves defaults within the requested scope", () => {
  // New tab is a workspace-scope action; it must not resolve in terminal scope.
  assert.equal(
    workspaceShortcutFromKeyboardEvent(keyEvent("t", { ctrlKey: true, shiftKey: true }), {}, "workspace"),
    "newTab",
  );
  assert.equal(
    workspaceShortcutFromKeyboardEvent(keyEvent("t", { ctrlKey: true, shiftKey: true }), {}, "terminal"),
    null,
  );
  // Copy is terminal-scope.
  assert.equal(
    workspaceShortcutFromKeyboardEvent(keyEvent("c", { ctrlKey: true, shiftKey: true }), {}, "terminal"),
    "copy",
  );
});

test("screenshot editor actions resolve only within their own scope", () => {
  // Copy/Save/Save As default to the conventional modal-dialog bindings.
  assert.equal(
    workspaceShortcutFromKeyboardEvent(keyEvent("c", { ctrlKey: true }), {}, "screenshotEditor"),
    "screenshotEditorCopy",
  );
  assert.equal(
    workspaceShortcutFromKeyboardEvent(keyEvent("s", { ctrlKey: true }), {}, "screenshotEditor"),
    "screenshotEditorSave",
  );
  assert.equal(
    workspaceShortcutFromKeyboardEvent(keyEvent("s", { ctrlKey: true, shiftKey: true }), {}, "screenshotEditor"),
    "screenshotEditorSaveAs",
  );
  // A plain Ctrl+C must not leak into the terminal scope where it would steal SIGINT.
  assert.equal(
    workspaceShortcutFromKeyboardEvent(keyEvent("c", { ctrlKey: true }), {}, "terminal"),
    null,
  );
  // A rebind flows through the shared overrides map like any other action.
  assert.equal(
    workspaceShortcutFromKeyboardEvent(
      keyEvent("e", { ctrlKey: true }),
      { screenshotEditorCopy: "Ctrl+E" },
      "screenshotEditor",
    ),
    "screenshotEditorCopy",
  );
});

test("overrides rebind and unbind actions", () => {
  const overrides = { newTab: "Ctrl+Shift+N", closeTab: null } as Record<string, string | null>;
  assert.equal(
    workspaceShortcutFromKeyboardEvent(keyEvent("n", { ctrlKey: true, shiftKey: true }), overrides, "workspace"),
    "newTab",
  );
  // The old default no longer fires once rebound.
  assert.equal(
    workspaceShortcutFromKeyboardEvent(keyEvent("t", { ctrlKey: true, shiftKey: true }), overrides, "workspace"),
    null,
  );
  // Explicitly unbound action produces no match on its former default.
  assert.equal(
    workspaceShortcutFromKeyboardEvent(keyEvent("w", { ctrlKey: true, shiftKey: true }), overrides, "workspace"),
    null,
  );
});

test("split actions ship unbound by default", () => {
  const bindings = effectiveWorkspaceShortcutBindings({});
  assert.equal(bindings.get("splitRight"), null);
  assert.equal(bindings.get("splitLeft"), null);
});

test("conflict detection finds the action already using a binding", () => {
  // Ctrl+Shift+C is copy's default; assigning it to find must report the conflict.
  const conflict = conflictingWorkspaceShortcutAction("Ctrl+Shift+C", {}, "find");
  assert.equal(conflict?.id, "copy");
  // No conflict against an unused combination.
  assert.equal(conflictingWorkspaceShortcutAction("Ctrl+Shift+J", {}, "find"), null);
});

test("fixed terminal aliases cannot be stolen by other configurable actions", () => {
  assert.equal(
    fixedTerminalShortcutFromKeyboardEvent(keyEvent("Insert", { ctrlKey: true })),
    "copy",
  );
  assert.equal(
    fixedTerminalShortcutFromKeyboardEvent(keyEvent("v", { ctrlKey: true, shiftKey: true })),
    "paste",
  );
  assert.equal(conflictingWorkspaceShortcutAction("Ctrl+Insert", {}, "find")?.id, "copy");
  assert.equal(conflictingWorkspaceShortcutAction("Ctrl+Shift+V", {}, "find")?.id, "paste");
  assert.equal(conflictingWorkspaceShortcutAction("Ctrl+Insert", {}, "copy"), null);
  assert.equal(conflictingWorkspaceShortcutAction("Ctrl+Shift+V", {}, "paste"), null);
});

test("default bindings are unique within a namespace but may repeat across namespaces", () => {
  // Mirror the source grouping: workspace/terminal share one namespace; the
  // Screenshots editor modal is isolated, so it may reuse the same key.
  const namespaceOf = (scope: string) => (scope === "screenshotEditor" ? "screenshotEditor" : "app");
  const seen = new Map<string, Set<string>>();
  for (const action of WORKSPACE_SHORTCUT_ACTIONS) {
    if (action.defaultBinding === null) {
      continue;
    }
    const namespace = namespaceOf(action.scope);
    const used = seen.get(namespace) ?? new Set<string>();
    assert.ok(
      !used.has(action.defaultBinding),
      `duplicate default binding ${action.defaultBinding} in ${namespace} namespace`,
    );
    used.add(action.defaultBinding);
    seen.set(namespace, used);
  }
});

test("conflict detection is isolated to the recording action's namespace", () => {
  // The editor's Ctrl+C default must not block reusing Ctrl+C for a workspace or
  // terminal action, and vice versa — they live in separate namespaces.
  assert.equal(conflictingWorkspaceShortcutAction("Ctrl+C", {}, "newTab"), null);
  assert.equal(conflictingWorkspaceShortcutAction("Ctrl+Shift+C", {}, "screenshotEditorCopy"), null);
  // Within the editor namespace, a real collision is still reported.
  assert.equal(
    conflictingWorkspaceShortcutAction("Ctrl+S", {}, "screenshotEditorCopy")?.id,
    "screenshotEditorSave",
  );
  // Fixed terminal aliases only guard the shared app namespace.
  assert.equal(conflictingWorkspaceShortcutAction("Ctrl+Insert", {}, "screenshotEditorCopy"), null);
});
