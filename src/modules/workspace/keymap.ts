// Workspace Module keyboard shortcut catalog and matching.
//
// Every rebindable action lives in WORKSPACE_SHORTCUT_ACTIONS with its default
// binding (or null for actions that ship unbound until the user assigns one in
// Settings → Shortcuts). User overrides are stored in
// `GeneralSettings.workspaceShortcuts` as an actionId → binding map where a
// null value means "explicitly unbound"; actions absent from the map keep
// their default. Workspace and terminal defaults use Ctrl+Shift combinations
// (or Ctrl with keys no shell interprets) so terminal Sessions never lose plain
// Ctrl+letter input; the Screenshots editor is a modal dialog, so its defaults
// use the conventional Ctrl+C / Ctrl+S / Ctrl+Shift+S.
//
// Scopes: "workspace" actions are handled by a window-level capture listener
// while the Workspace Module is active; "terminal" actions are handled inside
// the focused terminal Pane's xterm.js custom key handler; "screenshotEditor"
// actions are handled by the Screenshots editor dialog's key handler while it
// is open.

import type { Connection, WorkspaceTab } from "../../types";
import { currentPlatform, type RuntimePlatform } from "../../lib/platform";

export type WorkspaceShortcutScope =
  | "workspace"
  | "terminal"
  | "remoteDesktop"
  | "screenshotEditor";

export type WorkspaceShortcutActionId =
  | "newTab"
  | "closeTab"
  | "nextTab"
  | "previousTab"
  | "copy"
  | "paste"
  | "quickSelect"
  | "find"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "reconnectActiveSession"
  | "splitRight"
  | "splitLeft"
  | "splitDown"
  | "splitUp"
  | "remoteFullscreen"
  | "screenshotEditorCopy"
  | "screenshotEditorSave"
  | "screenshotEditorSaveAs";

export type WorkspaceShortcutOverrides = Record<string, string | null>;

export type WorkspaceShortcutAction = {
  id: WorkspaceShortcutActionId;
  scope: WorkspaceShortcutScope;
  labelKey: string;
  defaultBinding: string | null;
};

export function activeConnectionForNewTab(
  tabs: readonly WorkspaceTab[],
  activeTabId: string | null,
): Connection | null {
  const activeTab = tabs.find((tab) => tab.id === activeTabId);
  if (!activeTab) {
    return null;
  }
  const focusedPane = activeTab.panes.find((pane) => pane.id === activeTab.focusedPaneId);
  return focusedPane?.connection ?? activeTab.connection ?? activeTab.panes[0]?.connection ?? null;
}

export const WORKSPACE_SHORTCUT_ACTIONS: readonly WorkspaceShortcutAction[] = [
  { id: "newTab", scope: "workspace", labelKey: "workspace.newTab", defaultBinding: "Ctrl+Shift+T" },
  { id: "closeTab", scope: "workspace", labelKey: "settings.shortcutCloseTab", defaultBinding: "Ctrl+Shift+W" },
  { id: "nextTab", scope: "workspace", labelKey: "settings.shortcutNextTab", defaultBinding: "Ctrl+Tab" },
  { id: "previousTab", scope: "workspace", labelKey: "settings.shortcutPreviousTab", defaultBinding: "Ctrl+Shift+Tab" },
  { id: "copy", scope: "terminal", labelKey: "terminal.copy", defaultBinding: "Ctrl+Shift+C" },
  { id: "paste", scope: "terminal", labelKey: "terminal.paste", defaultBinding: "Ctrl+V" },
  { id: "quickSelect", scope: "terminal", labelKey: "terminal.quickSelect", defaultBinding: "Ctrl+Shift+Space" },
  { id: "find", scope: "terminal", labelKey: "terminal.findInScrollback", defaultBinding: "Ctrl+Shift+F" },
  { id: "zoomIn", scope: "terminal", labelKey: "settings.shortcutZoomIn", defaultBinding: "Ctrl+=" },
  { id: "zoomOut", scope: "terminal", labelKey: "settings.shortcutZoomOut", defaultBinding: "Ctrl+-" },
  { id: "zoomReset", scope: "terminal", labelKey: "settings.shortcutZoomReset", defaultBinding: "Ctrl+0" },
  { id: "reconnectActiveSession", scope: "terminal", labelKey: "settings.shortcutReconnectActiveSession", defaultBinding: null },
  { id: "splitRight", scope: "terminal", labelKey: "terminal.splitRight", defaultBinding: null },
  { id: "splitLeft", scope: "terminal", labelKey: "terminal.splitLeft", defaultBinding: null },
  { id: "splitDown", scope: "terminal", labelKey: "terminal.splitDown", defaultBinding: null },
  { id: "splitUp", scope: "terminal", labelKey: "terminal.splitUp", defaultBinding: null },
  {
    id: "remoteFullscreen",
    scope: "remoteDesktop",
    labelKey: "remoteDesktop.fullscreen.toggle",
    defaultBinding: "Ctrl+Alt+Pause",
  },
  { id: "screenshotEditorCopy", scope: "screenshotEditor", labelKey: "screenshots.menu.copy", defaultBinding: "Ctrl+C" },
  { id: "screenshotEditorSave", scope: "screenshotEditor", labelKey: "common.save", defaultBinding: "Ctrl+S" },
  { id: "screenshotEditorSaveAs", scope: "screenshotEditor", labelKey: "screenshots.editor.saveAs", defaultBinding: "Ctrl+Shift+S" },
];

const FIXED_TERMINAL_SHORTCUT_ALIASES: ReadonlyArray<{
  actionId: WorkspaceShortcutActionId;
  binding: string;
}> = [
  { actionId: "copy", binding: "Ctrl+Insert" },
  { actionId: "paste", binding: "Ctrl+Shift+V" },
];

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);
const MAC_MODIFIER_LABELS: Readonly<Record<string, string>> = {
  Ctrl: "Control",
  Control: "Control",
  Alt: "Option",
  Option: "Option",
  Cmd: "Command",
  Command: "Command",
  Meta: "Command",
  Super: "Command",
  CmdOrCtrl: "Command",
  CmdOrControl: "Command",
  CommandOrCtrl: "Command",
  CommandOrControl: "Command",
};

/**
 * Format a canonical binding for display without changing the stored value
 * used by keyboard matching and native shortcut registration.
 */
export function displayShortcutBinding(
  binding: string,
  platform: RuntimePlatform = currentPlatform(),
): string {
  if (platform === "windows") {
    return binding
      .split("+")
      .map((part) => part === "Pause" || part === "PauseBreak" ? "Break" : part)
      .join("+");
  }
  if (platform !== "macos") {
    return binding;
  }
  return binding
    .split("+")
    .map((part) => MAC_MODIFIER_LABELS[part] ?? part)
    .join("+");
}

export function defaultWorkspaceShortcutBinding(
  action: WorkspaceShortcutAction,
  platform: RuntimePlatform = currentPlatform(),
): string | null {
  if (action.id !== "remoteFullscreen") {
    return action.defaultBinding;
  }
  if (platform === "macos") {
    return "Ctrl+Cmd+F";
  }
  if (platform === "linux") {
    return "F11";
  }
  return action.defaultBinding;
}

export function workspaceShortcutIsFixed(
  action: WorkspaceShortcutAction,
  platform: RuntimePlatform = currentPlatform(),
): boolean {
  return platform === "windows" && action.id === "remoteFullscreen";
}

/**
 * Normalize a keydown event into the canonical binding string, e.g.
 * "Ctrl+Shift+T". Returns null for presses that cannot be a shortcut: bare
 * modifiers, and keys without a Ctrl/Alt/Cmd modifier (except F1–F24), so
 * plain typing can never match or record a binding.
 */
export function bindingFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) {
    return null;
  }
  const isFunctionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(event.key);
  if (!event.ctrlKey && !event.altKey && !event.metaKey && !isFunctionKey) {
    return null;
  }
  const parts: string[] = [];
  if (event.ctrlKey) {
    parts.push("Ctrl");
  }
  if (event.altKey) {
    parts.push("Alt");
  }
  if (event.shiftKey) {
    parts.push("Shift");
  }
  if (event.metaKey) {
    parts.push("Cmd");
  }
  parts.push(normalizeBindingKey(event.key));
  return parts.join("+");
}

function normalizeBindingKey(key: string): string {
  if (key === " " || key === "Spacebar") {
    return "Space";
  }
  if (key.length === 1) {
    return key.toUpperCase();
  }
  return key;
}

/**
 * Effective binding per action after applying stored overrides. A null value
 * means the action is unbound.
 */
export function effectiveWorkspaceShortcutBindings(
  overrides: WorkspaceShortcutOverrides | undefined,
): Map<WorkspaceShortcutActionId, string | null> {
  const bindings = new Map<WorkspaceShortcutActionId, string | null>();
  for (const action of WORKSPACE_SHORTCUT_ACTIONS) {
    const override = overrides?.[action.id];
    bindings.set(
      action.id,
      override !== undefined && !workspaceShortcutIsFixed(action)
        ? override
        : defaultWorkspaceShortcutBinding(action),
    );
  }
  return bindings;
}

/**
 * Resolve a keydown event to the Workspace shortcut action bound to it, if
 * any, restricted to one scope. When stored overrides collide, the first
 * action in catalog order wins so a bad settings payload cannot make one key
 * fire twice.
 */
export function workspaceShortcutFromKeyboardEvent(
  event: KeyboardEvent,
  overrides: WorkspaceShortcutOverrides | undefined,
  scope: WorkspaceShortcutScope,
): WorkspaceShortcutActionId | null {
  const binding = bindingFromKeyboardEvent(event);
  if (!binding) {
    return null;
  }
  const bindings = effectiveWorkspaceShortcutBindings(overrides);
  for (const action of WORKSPACE_SHORTCUT_ACTIONS) {
    if (action.scope === scope && bindings.get(action.id) === binding) {
      return action.id;
    }
  }
  return null;
}

/**
 * Resolve conventional terminal aliases that remain active independently of
 * the user's configurable primary bindings.
 */
export function fixedTerminalShortcutFromKeyboardEvent(
  event: KeyboardEvent,
): WorkspaceShortcutActionId | null {
  const binding = bindingFromKeyboardEvent(event);
  if (!binding) {
    return null;
  }
  return FIXED_TERMINAL_SHORTCUT_ALIASES.find((alias) => alias.binding === binding)?.actionId ?? null;
}

/**
 * Bindings only conflict inside the same namespace. "workspace" and "terminal"
 * share one namespace because terminal-focused keys reach the window listener
 * too, so the same key cannot mean two things there. The Screenshots editor is
 * a self-contained modal whose keys never reach those listeners, so it gets its
 * own namespace — the same combination (e.g. Ctrl+C / Ctrl+S) can be reused for
 * a workspace or terminal action without colliding.
 */
function shortcutNamespace(scope: WorkspaceShortcutScope): "app" | "screenshotEditor" {
  return scope === "screenshotEditor" ? "screenshotEditor" : "app";
}

/**
 * Find the other action already using `binding`, for conflict rejection in the
 * Settings recorder. Only actions in the same namespace as `exceptActionId`
 * (see `shortcutNamespace`) are considered, so reusing a combination across
 * namespaces is allowed.
 */
export function conflictingWorkspaceShortcutAction(
  binding: string,
  overrides: WorkspaceShortcutOverrides | undefined,
  exceptActionId: WorkspaceShortcutActionId,
): WorkspaceShortcutAction | null {
  const exceptAction = WORKSPACE_SHORTCUT_ACTIONS.find((action) => action.id === exceptActionId);
  const namespace = shortcutNamespace(exceptAction?.scope ?? "workspace");
  // Fixed terminal aliases live in the shared app namespace only.
  if (namespace === "app") {
    const fixedAlias = FIXED_TERMINAL_SHORTCUT_ALIASES.find(
      (alias) => alias.actionId !== exceptActionId && alias.binding === binding,
    );
    if (fixedAlias) {
      return WORKSPACE_SHORTCUT_ACTIONS.find((action) => action.id === fixedAlias.actionId) ?? null;
    }
  }
  const bindings = effectiveWorkspaceShortcutBindings(overrides);
  for (const action of WORKSPACE_SHORTCUT_ACTIONS) {
    if (
      action.id !== exceptActionId
      && shortcutNamespace(action.scope) === namespace
      && bindings.get(action.id) === binding
    ) {
      return action;
    }
  }
  return null;
}
