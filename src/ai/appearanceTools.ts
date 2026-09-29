import dynamicCatalog from "../shared/dynamicBackgroundCatalog.json";
import { BACKGROUND_PRESETS } from "../modules/dashboard/registry/backgroundPresets";
import { TERMINAL_COLOR_SCHEMES } from "../modules/workspace/connections/terminal/colorSchemes";
import { allSyntaxHighlightProfiles, copySyntaxHighlightProfile, isBuiltinSyntaxHighlightProfile, parseSecureCrtKeywordIni } from "../modules/workspace/connections/terminal/syntaxHighlighting";
import type { Connection, TerminalSettings, TerminalSyntaxHighlightProfile, WorkspaceTab } from "../types";
import { applyAppearanceToTabs, knownKeys, normalizeAppearanceName, normalizeAppearancePatch, normalizeHighlightProfile, projectAppearance, record, resolveNamed } from "./appearanceModel";

export interface AppearanceToolDeps {
  data: (request: Record<string, unknown>) => Promise<unknown>;
  getTabs: () => WorkspaceTab[];
  updateTabs: (apply: (tabs: WorkspaceTab[]) => WorkspaceTab[]) => void;
  setTerminalSettings: (settings: TerminalSettings) => void;
  separatePaneBackgrounds: () => boolean;
  language: string;
}
interface ProfileSnapshot {
  settings: TerminalSettings;
  references: { connectionId: string; name: string; profileId: string }[];
}
export const APPEARANCE_TOOL_NAMES = [
  "appearance_list_backgrounds", "terminal_list_color_schemes", "connection_get_appearance", "connection_update_appearance",
  "session_update_terminal_appearance", "terminal_highlight_list", "terminal_highlight_read", "terminal_highlight_create",
  "terminal_highlight_update", "terminal_highlight_copy", "terminal_highlight_delete", "terminal_highlight_import",
] as const;
export function isAppearanceTool(name: string) { return (APPEARANCE_TOOL_NAMES as readonly string[]).includes(name); }

// Native AI and simultaneous MCP clients share one main-window queue. The backend
// also checks expected profile versions and merges under the Storage lock.
let queue: Promise<unknown> = Promise.resolve();
export function runAppearanceTool(name: string, args: Record<string, unknown>, deps: AppearanceToolDeps): Promise<unknown> {
  const result = queue.then(() => execute(name, args, deps));
  queue = result.catch(() => undefined);
  return result;
}
function appearance(connection: Connection) {
  return { connectionId: connection.id, name: connection.name, type: connection.type,
    background: connection.terminalBackground ?? null, opacity: connection.terminalOpacity ?? null,
    colorScheme: connection.terminalColorScheme ?? null, highlightProfile: connection.terminalSyntaxHighlightProfileId ?? null,
    fileBrowser: connection.fileBrowserViewOptions ?? null };
}
function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value;
}
async function execute(name: string, args: Record<string, unknown>, deps: AppearanceToolDeps) {
  if (!isAppearanceTool(name)) throw new Error(`Unknown appearance tool: ${name}`);
  if (name === "appearance_list_backgrounds" || name === "terminal_list_color_schemes") {
    knownKeys(args, name === "appearance_list_backgrounds" ? ["query"] : ["query", "offset"]);
    if (args.query !== undefined && typeof args.query !== "string") throw new Error("query must be a string");
    const query = normalizeAppearanceName(args.query ?? "");
    const match = (values: string[]) => values.some((value) => normalizeAppearanceName(value).includes(query));
    if (name === "terminal_list_color_schemes") {
      const offset = args.offset ?? 0;
      if (typeof offset !== "number" || !Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
      const schemes = TERMINAL_COLOR_SCHEMES.filter((s) => match([s.id,s.name])).map(({id,name}) => ({id,name}));
      return { ok: true, schemes: schemes.slice(offset,offset+100), total: schemes.length, nextOffset: offset+100 < schemes.length ? offset+100 : null };
    }
    return { ok: true,
      dynamic: dynamicCatalog.filter((entry) => match([entry.id, ...Object.values(entry.names)])).map((entry) => ({
        id: entry.id, name: entry.names.en, localizedName: (entry.names as Record<string,string>)[deps.language] ?? entry.names.en, mood: entry.mood,
      })),
      presets: BACKGROUND_PRESETS.filter((p) => match([p.id])).map(({id,labelKey}) => ({id,labelKey})),
      usage: { background: {kind:"dynamic",dynamic:"Misty Sea"}, clear: {background:null}, media: "Use an already imported background media filename. No paths or URLs." },
    };
  }
  if (name === "connection_get_appearance") {
    knownKeys(args,["connectionId"]);
    return { ok:true, ...appearance(await deps.data({action:"get_connection",connectionId:requiredString(args.connectionId,"connectionId")}) as Connection) };
  }
  const snapshot = await deps.data({action:"get_profiles"}) as ProfileSnapshot;
  const profiles = allSyntaxHighlightProfiles(snapshot.settings.syntaxHighlightProfiles);
  if (name === "terminal_highlight_list") {
    knownKeys(args,[]);
    return {ok:true,profiles:profiles.map((profile) => ({id:profile.id,name:profile.name,builtIn:isBuiltinSyntaxHighlightProfile(profile.id),
      ruleCount:profile.rules.length,connectionCount:snapshot.references.filter((r) => r.profileId === profile.id).length}))};
  }
  if (name === "connection_update_appearance" || name === "session_update_terminal_appearance") {
    const live = name === "session_update_terminal_appearance";
    knownKeys(args,live ? ["paneId","patch"] : ["connectionId","patch"]);
    const patch = normalizeAppearancePatch(args.patch,profiles,!live);
    if (live) {
      const paneId = requiredString(args.paneId,"paneId");
      const tab = deps.getTabs().find((tab) => tab.panes.some((pane) => pane.id === paneId && (pane.kind === undefined || pane.kind === "terminal")));
      const pane = tab?.panes.find((pane) => pane.id === paneId);
      if (!tab || !pane?.connection) throw new Error("Live terminal pane was not found; list sessions first");
      if ("background" in patch && !deps.separatePaneBackgrounds() && tab.panes.filter((p) => p.kind === undefined || p.kind === "terminal").length > 1) {
        throw new Error("This tab shares one background across terminal panes. Enable separate split terminal backgrounds or update the background owner's saved Connection instead.");
      }
      const next = { ...pane.connection,
        ...("background" in patch ? {terminalBackground:patch.background} : {}), ...("opacity" in patch ? {terminalOpacity:patch.opacity} : {}),
        ...("colorScheme" in patch ? {terminalColorScheme:patch.colorScheme} : {}), ...("highlightProfileId" in patch ? {terminalSyntaxHighlightProfileId:patch.highlightProfileId} : {}),
      } as Connection;
      deps.updateTabs((tabs) => applyAppearanceToTabs(tabs,next.id,projectAppearance(next,patch),paneId));
      return {ok:true,scope:"livePane",paneId,...appearance(next)};
    }
    const saved = await deps.data({action:"patch_connection",connectionId:requiredString(args.connectionId,"connectionId"),patch}) as Connection;
    deps.updateTabs((tabs) => applyAppearanceToTabs(tabs,saved.id,projectAppearance(saved,patch)));
    return {ok:true,scope:"savedConnection",...appearance(saved)};
  }
  const selected = name === "terminal_highlight_create" || name === "terminal_highlight_import" ? null : resolveNamed(profiles,args.profile,"highlighting profile");
  if (name === "terminal_highlight_read") {
    knownKeys(args,["profile"]); return {ok:true,profile:selected,builtIn:isBuiltinSyntaxHighlightProfile(selected!.id)};
  }
  if ((name === "terminal_highlight_update" || name === "terminal_highlight_delete") && isBuiltinSyntaxHighlightProfile(selected!.id)) {
    throw new Error("Built-in profiles are immutable; copy one before editing");
  }
  let profile: TerminalSyntaxHighlightProfile | null = null;
  let action = "create_profile";
  switch (name) {
    case "terminal_highlight_create":
      knownKeys(args,["profile"]); profile = normalizeHighlightProfile(args.profile); break;
    case "terminal_highlight_copy":
      knownKeys(args,["profile","name"]); profile = normalizeHighlightProfile(copySyntaxHighlightProfile(selected!,requiredString(args.name,"name"))); break;
    case "terminal_highlight_import": {
      knownKeys(args,["text","name"]);
      const source = requiredString(args.text,"INI text");
      if (source.length > 500000) throw new Error("INI text exceeds 500000 characters");
      const parsed = parseSecureCrtKeywordIni(source,args.name === undefined ? "Imported Profile" : requiredString(args.name,"name"));
      if (args.name !== undefined) parsed.name = requiredString(args.name,"name");
      profile = normalizeHighlightProfile(parsed); break;
    }
    case "terminal_highlight_update": {
      knownKeys(args,["profile","patch"]);
      const patch = record(args.patch,"patch"); knownKeys(patch,["name","rules"]);
      if (!Object.keys(patch).length) throw new Error("Profile patch must not be empty");
      profile = normalizeHighlightProfile({...selected,...patch},selected!.id); action = "update_profile"; break;
    }
    case "terminal_highlight_delete":
      knownKeys(args,["profile"]);
      if (deps.getTabs().some((tab) => tab.connection?.terminalSyntaxHighlightProfileId === selected!.id || tab.panes.some((pane) => pane.connection?.terminalSyntaxHighlightProfileId === selected!.id))) {
        throw new Error("Profile is still selected by a live pane; disable or replace that selection before deleting");
      }
      action = "delete_profile"; break;
    default: throw new Error(`Unknown appearance operation: ${name}`);
  }
  if (profile && profiles.some((p) => p.id !== profile!.id && normalizeAppearanceName(p.name) === normalizeAppearanceName(profile!.name))) {
    throw new Error("A profile with this name already exists; choose a distinct name");
  }
  const result = await deps.data({action,id:profile?.id ?? selected!.id,profile,expectedProfile:selected}) as {settings:TerminalSettings};
  deps.setTerminalSettings(result.settings);
  return {ok:true,profile:profile ? result.settings.syntaxHighlightProfiles.find((p) => p.id === profile!.id) : null,deletedId:action === "delete_profile" ? selected!.id : undefined};
}
