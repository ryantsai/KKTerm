import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeBackground, normalizeHighlightProfile, normalizeAppearancePatch, resolveDynamicBackground, resolveNamed, applyAppearanceToTabs, projectAppearance } from "../src/ai/appearanceModel.ts";
import { APPEARANCE_TOOL_NAMES, runAppearanceTool, type AppearanceToolDeps } from "../src/ai/appearanceTools.ts";
import { BUILTIN_SYNTAX_HIGHLIGHT_PROFILES } from "../src/modules/workspace/connections/terminal/syntaxHighlighting.ts";
import type { Connection, TerminalSettings, WorkspaceTab } from "../src/types.ts";
const rule = {name:"Error",pattern:"ERROR",style:{foreground:"#ff0000",background:null}};
const makeProfile = () => normalizeHighlightProfile({name:"Mine",rules:[rule]},"custom:mine");
const file = (name:string) => readFileSync(new URL(`../${name}`,import.meta.url),"utf8");

test("dynamic IDs and translated display names resolve identically and reject unknown values", () => {
  assert.equal(resolveDynamicBackground("Misty Sea"),"mistySea");
  assert.equal(resolveDynamicBackground(" MISTY_sea "),"mistySea");
  const entries = JSON.parse(file("src/shared/dynamicBackgroundCatalog.json"));
  for (const entry of entries) {
    assert.equal(resolveDynamicBackground(entry.id),entry.id);
    // A genuinely ambiguous translated label must fail rather than pick one.
    for (const name of Object.values(entry.names) as string[]) {
      try { assert.equal(resolveDynamicBackground(name),entry.id); }
      catch(error) { assert.match(String(error),/Ambiguous/); }
    }
  }
  for (const invalid of ["", "---", "unknown", "toString", "constructor", null, 4]) assert.throws(() => resolveDynamicBackground(invalid));
  assert.equal(normalizeBackground({kind:"dynamic",dynamic:"Misty Sea"})?.kind,"dynamic");
});

test("background metadata stays in sync with every translated picker label and Rust IDs", () => {
  const entries = JSON.parse(file("src/shared/dynamicBackgroundCatalog.json"));
  for (const entry of entries) for (const [locale,name] of Object.entries(entry.names)) {
    const labels = JSON.parse(file(`src/i18n/locales/${locale}.json`)).dashboard.dynamicBackgrounds;
    assert.equal(name,labels[entry.labelKey.split(".").at(-1)]);
  }
  const rust = file("src-tauri/src/dashboard_validation.rs").match(/pub const DYNAMIC_BACKGROUND_IDS:[\s\S]*?= &\[([\s\S]*?)\];/)![1];
  assert.deepEqual(new Set([...rust.matchAll(/"(.*?)"/g)].map((m) => m[1])),new Set(entries.map((e:{id:string})=>e.id)));
});

test("profiles reject invalid regexes, unsupported repetition, duplicate IDs, bad colors and silent truncation", () => {
  const good = makeProfile(); assert.equal(good.rules[0].style.foreground,"#FF0000");
  assert.equal(good.caseSensitive,false); assert.ok(good.rules[0].id);
  for (const rules of [[{...rule,pattern:"["}],[{...rule,pattern:"(a+)+"}],[{...rule,style:{foreground:"red"}}],Array.from({length:201},()=>rule),[{...rule,id:"same"},{...rule,id:"same"}]]) {
    assert.throws(()=>normalizeHighlightProfile({name:"Invalid",rules}));
  }
  for(const profile of BUILTIN_SYNTAX_HIGHLIGHT_PROFILES) assert.doesNotThrow(()=>normalizeHighlightProfile(profile));
  assert.throws(()=>normalizeHighlightProfile({name:"x",caseSensitive:true,rules:[]}));
  assert.throws(()=>normalizeHighlightProfile({name:"x",rules:[],unexpected:true}));
});

test("appearance patches distinguish omission, null, and invalid values", () => {
  assert.deepEqual(normalizeAppearancePatch({background:null},[]),{background:null});
  assert.deepEqual(normalizeAppearancePatch({highlightProfile:null},[]),{highlightProfileId:null});
  assert.deepEqual(normalizeAppearancePatch({highlightProfile:"Cisco IOS"},BUILTIN_SYNTAX_HIGHLIGHT_PROFILES),{highlightProfileId:"builtin:cisco-ios"});
  assert.deepEqual(normalizeAppearancePatch({fileBrowser:{remote:{background:{kind:"dynamic",dynamic:"Misty Sea"}}}},[]),{fileBrowser:{remote:{background:{kind:"dynamic",dynamic:"mistySea"}}}});
  for(const patch of [{},{opacity:1.5},{opacity:101},{opacity:null},{host:"oops"},{highlightProfile:"missing"},{background:{kind:"video",file:"../private.mp4",fit:"fill",dim:0}}]) assert.throws(()=>normalizeAppearancePatch(patch,[]));
  assert.throws(()=>resolveNamed([{id:"a",name:"Same"},{id:"b",name:"same"}],"SAME","profile"),/Ambiguous/);
});

function fixture() {
  const profile = makeProfile(); let tabs: WorkspaceTab[] = [];
  const writes: Record<string,unknown>[] = [];
  const settings = {syntaxHighlightProfiles:[profile],fontSize:16} as TerminalSettings;
  const deps:AppearanceToolDeps = {
    data: async(request) => { if(request.action==="get_profiles") return {settings,references:[]}; writes.push(request); return {settings}; },
    getTabs:()=>tabs, updateTabs:(apply)=>{tabs=apply(tabs);}, setTerminalSettings:()=>{}, separatePaneBackgrounds:()=>true,language:"en",
  };
  return {profile,deps,writes,setTabs:(next:WorkspaceTab[])=>{tabs=next;}};
}
test("invalid calls and built-in edits never reach persistent writes", async () => {
  const f=fixture();
  await assert.rejects(runAppearanceTool("terminal_highlight_update",{profile:"Cisco IOS",patch:{name:"Overwrite"}},f.deps),/immutable/);
  await assert.rejects(runAppearanceTool("terminal_highlight_create",{profile:{name:"Invalid",rules:[{...rule,pattern:"["}]}},f.deps),/regex/);
  await assert.rejects(runAppearanceTool("connection_update_appearance",{connectionId:"c",patch:{background:{kind:"dynamic",dynamic:"missing"}}},f.deps),/Unknown/);
  assert.equal(f.writes.length,0);
});

test("updating preserves omitted rules and passes an expected version; copying generates new IDs", async () => {
  const f=fixture();
  await runAppearanceTool("terminal_highlight_update",{profile:"Mine",patch:{name:"Mine edited"}},f.deps);
  assert.deepEqual(f.writes[0].expectedProfile,f.profile);
  assert.deepEqual((f.writes[0].profile as typeof f.profile).rules,f.profile.rules);
  await runAppearanceTool("terminal_highlight_copy",{profile:"Cisco IOS",name:"My Cisco"},f.deps);
  assert.equal(f.writes[1].action,"create_profile");
  assert.ok(!(f.writes[1].id as string).startsWith("builtin:"));
  assert.notEqual((f.writes[1].profile as typeof f.profile).rules[0].id,BUILTIN_SYNTAX_HIGHLIGHT_PROFILES[0].rules[0].id);
});

test("a live-only selection prevents profile deletion", async () => {
  const f=fixture();
  f.setTabs([{panes:[{id:"p",connection:{id:"transient",terminalSyntaxHighlightProfileId:f.profile.id}}]} as WorkspaceTab]);
  await assert.rejects(runAppearanceTool("terminal_highlight_delete",{profile:"Mine"},f.deps),/live pane/);
  assert.equal(f.writes.length,0);
});

test("projection changes only appearance, updates all matching panes and clears stale background overrides", () => {
  const connection = {id:"c",host:"unchanged",terminalOpacity:75,terminalSyntaxHighlightProfileId:"keep"} as Connection;
  const tabs=[{id:"tab",connection,panes:[{id:"one",connection,terminalBackground:{kind:"dynamic",dynamic:"ocean"}},{id:"two",connection:{...connection,id:"other"}}]}] as WorkspaceTab[];
  const next=applyAppearanceToTabs(tabs,"c",projectAppearance({...connection,terminalBackground:null},{background:null}));
  assert.equal(next[0].panes[0].connection?.host,"unchanged");
  assert.equal(next[0].panes[0].connection?.terminalSyntaxHighlightProfileId,"keep");
  assert.equal(next[0].panes[0].terminalBackground,null);
  assert.equal(next[0].panes[1],tabs[0].panes[1]);
  const live=applyAppearanceToTabs(tabs,"c",{terminalOpacity:20},"one");
  assert.equal(live[0].connection,connection); assert.equal(live[0].panes[0].connection?.terminalOpacity,20);
});

test("every shared tool has frontend dispatch, native/MCP registration and narrow IPC permissions", () => {
  const catalog=file("src-tauri/src/appearance_tool_catalog.rs");
  const names=[...catalog.matchAll(/tool!\("([^"]+)"/g)].map((m)=>m[1]);
  assert.deepEqual(new Set(names),new Set(APPEARANCE_TOOL_NAMES));
  assert.match(file("src-tauri/src/ai.rs"),/appearance_group_enabled\(tool_settings, tool.group\)/);
  assert.match(file("src-tauri/src/mcp_bridge.rs"),/live_session_tool\(app, tool.native, args\)/);
  assert.match(file("src-tauri/src/mcp_tool_catalog.rs"),/appearance::tools\(\)/);
  assert.match(file("src-tauri/permissions/main.toml"),/"appearance_data"/);
  assert.match(file("src-tauri/src/lib.rs"),/            appearance_data,/);
});
