import dynamicCatalog from "../shared/dynamicBackgroundCatalog.json";
import type { Connection, TerminalSyntaxHighlightProfile, WorkspaceTab } from "../types";
import type { DashboardBackground } from "../modules/dashboard/types";
import { BACKGROUND_PRESETS } from "../modules/dashboard/registry/backgroundPresets";
import { TERMINAL_COLOR_SCHEMES } from "../modules/workspace/connections/terminal/colorSchemes";
import { syntaxHighlightProfileId, syntaxHighlightRuleId } from "../modules/workspace/connections/terminal/syntaxHighlighting";

export const normalizeAppearanceName = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
export function resolveNamed<T extends { id: string; name: string }>(entries: readonly T[], value: unknown, kind: string): T {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${kind} name or ID is required`);
  const exact = entries.find((entry) => entry.id === value);
  if (exact) return exact;
  const key = normalizeAppearanceName(value);
  if (!key) throw new Error(`${kind} name must not be empty`);
  const matches = entries.filter((entry) => normalizeAppearanceName(entry.id) === key || normalizeAppearanceName(entry.name) === key);
  if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous ${kind} name; use an exact ID: ${matches.map((m) => m.id).join(", ")}` : `Unknown ${kind}: ${value}`);
  return matches[0];
}
export function resolveDynamicBackground(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Dynamic background name or ID is required");
  const exact = dynamicCatalog.find((entry) => entry.id === value);
  if (exact) return exact.id;
  const key = normalizeAppearanceName(value);
  if (!key) throw new Error("Dynamic background name must not be empty");
  const matches = dynamicCatalog.filter((entry) => normalizeAppearanceName(entry.id) === key || Object.values(entry.names).some((name) => normalizeAppearanceName(name) === key));
  if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous background name; use an ID: ${matches.map((m) => m.id).join(", ")}` : `Unknown dynamic background ${value}. List available backgrounds first.`);
  return matches[0].id;
}
export function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}
export function knownKeys(value: Record<string, unknown>, keys: readonly string[]) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw new Error(`Unsupported field: ${key}`);
}
function text(value: unknown, label: string, max = 80): string {
  if (typeof value !== "string" || !value.trim() || [...value.trim()].length > max) throw new Error(`${label} must contain 1–${max} characters`);
  return value.trim();
}
function number(value: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${label} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}`);
  return value;
}
export function normalizeBackground(value: unknown): DashboardBackground | null {
  if (value === null) return null;
  const bg = record(value, "background");
  switch (bg.kind) {
    case "dynamic":
      knownKeys(bg, ["kind", "dynamic"]);
      return { kind: "dynamic", dynamic: resolveDynamicBackground(bg.dynamic) };
    case "preset":
      knownKeys(bg, ["kind", "preset"]);
      if (!BACKGROUND_PRESETS.some((p) => p.id === bg.preset)) throw new Error("Unknown background preset");
      return { kind: "preset", preset: bg.preset as string };
    case "image": case "video": {
      knownKeys(bg, ["kind", "file", "fit", "dim"]);
      const file = text(bg.file, "Imported media filename", 255);
      const extensions = bg.kind === "image" ? /\.(png|jpe?g|webp|gif|bmp|svg)$/i : /\.(mp4|webm|mov|m4v|ogv)$/i;
      if (/[\\/]/.test(file) || file.includes("..") || !extensions.test(file)) throw new Error("Use a previously imported background media filename, not a path or URL");
      if (!["fill", "fit", "stretch", "tile", "center"].includes(String(bg.fit))) throw new Error("Invalid background fit");
      return { kind: bg.kind, file, fit: bg.fit as "fill", dim: number(bg.dim, "dim", -100, 100, true) };
    }
    case "customGradient": {
      knownKeys(bg, ["kind", "stops", "angle"]);
      if (!Array.isArray(bg.stops) || bg.stops.length < 2 || bg.stops.length > 8) throw new Error("A gradient needs 2–8 stops");
      const stops = bg.stops.map((raw) => {
        const stop = record(raw, "gradient stop"); knownKeys(stop, ["color", "offset"]);
        if (typeof stop.color !== "string" || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(stop.color)) throw new Error("Invalid gradient color");
        return { color: stop.color, offset: number(stop.offset, "offset", 0, 100) };
      });
      return { kind: "customGradient", stops, angle: number(bg.angle, "angle", 0, 360) };
    }
    default: throw new Error("Unknown background kind");
  }
}

export function normalizeHighlightProfile(value: unknown, id = syntaxHighlightProfileId()): TerminalSyntaxHighlightProfile {
  const profile = record(value, "profile");
  knownKeys(profile, ["id", "name", "caseSensitive", "rules"]);
  if (profile.caseSensitive === true) throw new Error("Keyword matching is always case-insensitive");
  if (!Array.isArray(profile.rules) || profile.rules.length > 200) throw new Error("A profile must contain at most 200 rules");
  const ids = new Set<string>();
  const rules = profile.rules.map((raw) => {
    const rule = record(raw, "rule"); knownKeys(rule, ["id", "name", "pattern", "enabled", "style"]);
    const ruleId = rule.id === undefined ? syntaxHighlightRuleId() : text(rule.id, "Rule ID", 200);
    if (ids.has(ruleId)) throw new Error("Duplicate rule ID"); ids.add(ruleId);
    const pattern = text(rule.pattern, "Regex", 2000);
    // Same conservative nested-repetition guard used by the renderer. Reject
    // instead of saving a rule the renderer would silently skip.
    if (/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(pattern)) throw new Error("Regex contains nested repetition unsupported by the renderer");
    try { new RegExp(pattern, "gi"); } catch { throw new Error(`Invalid JavaScript regex: ${pattern}`); }
    if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") throw new Error("enabled must be a boolean");
    const style = record(rule.style, "style"); knownKeys(style, ["foreground", "background", "fontFamily", "bold", "italic"]);
    if (style.fontFamily || style.bold || style.italic) throw new Error("Keyword highlighting supports foreground/background colors, not font overrides");
    const color = (value: unknown) => {
      if (value === undefined || value === null) return null;
      if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error("Highlight colors must use #RRGGBB");
      return value.toUpperCase();
    };
    return { id: ruleId, name: text(rule.name, "Rule name"), pattern, enabled: rule.enabled !== false,
      style: { foreground: color(style.foreground), background: color(style.background), fontFamily: null, bold: false, italic: false } };
  });
  return { id, name: text(profile.name, "Profile name"), caseSensitive: false, rules };
}

export function normalizeAppearancePatch(value: unknown, profiles: readonly TerminalSyntaxHighlightProfile[], browserAllowed = true): Record<string, unknown> {
  const patch = record(value, "patch");
  knownKeys(patch, ["background", "opacity", "colorScheme", "highlightProfile", ...(browserAllowed ? ["fileBrowser"] : [])]);
  if (!Object.keys(patch).length) throw new Error("Appearance patch must not be empty");
  const result: Record<string, unknown> = {};
  if ("background" in patch) result.background = normalizeBackground(patch.background);
  if ("opacity" in patch) result.opacity = number(patch.opacity, "opacity", 0, 100, true);
  if ("colorScheme" in patch) result.colorScheme = patch.colorScheme === null ? null : resolveNamed(TERMINAL_COLOR_SCHEMES, patch.colorScheme, "color scheme").id;
  if ("highlightProfile" in patch) result.highlightProfileId = patch.highlightProfile === null ? null : resolveNamed(profiles, patch.highlightProfile, "highlighting profile").id;
  if ("fileBrowser" in patch) {
    const browser = record(patch.fileBrowser, "fileBrowser"); knownKeys(browser, ["local", "remote"]);
    if (!Object.keys(browser).length) throw new Error("fileBrowser must contain at least one pane patch");
    result.fileBrowser = Object.fromEntries(Object.entries(browser).map(([side, raw]) => {
      const pane = record(raw, side); knownKeys(pane, ["background", "zoom"]);
      if (!Object.keys(pane).length) throw new Error("Browser pane patch must not be empty");
      return [side, { ...("background" in pane ? { background: normalizeBackground(pane.background) } : {}),
        ...("zoom" in pane ? { zoom: number(pane.zoom, "zoom", 0.5, 2) } : {}) }];
    }));
  }
  return result;
}

export function projectAppearance(saved: Connection, patch: Record<string, unknown>): Partial<Connection> {
  const result: Partial<Connection> = {};
  if ("background" in patch) result.terminalBackground = saved.terminalBackground ?? null;
  if ("opacity" in patch) result.terminalOpacity = saved.terminalOpacity;
  if ("colorScheme" in patch) result.terminalColorScheme = saved.terminalColorScheme ?? null;
  if ("highlightProfileId" in patch) result.terminalSyntaxHighlightProfileId = saved.terminalSyntaxHighlightProfileId ?? null;
  if ("fileBrowser" in patch) result.fileBrowserViewOptions = saved.fileBrowserViewOptions;
  return result;
}
export function applyAppearanceToTabs(tabs: WorkspaceTab[], connectionId: string, appearance: Partial<Connection>, paneId?: string): WorkspaceTab[] {
  return tabs.map((tab) => ({ ...tab,
    connection: !paneId && tab.connection?.id === connectionId ? { ...tab.connection, ...appearance } : tab.connection,
    panes: tab.panes.map((pane) => pane.connection?.id === connectionId && (!paneId || pane.id === paneId) ? {
      ...pane, connection: { ...pane.connection, ...appearance },
      ...((pane.kind === undefined || pane.kind === "terminal") && "terminalBackground" in appearance ? { terminalBackground: appearance.terminalBackground } : {}),
    } : pane),
  }));
}
