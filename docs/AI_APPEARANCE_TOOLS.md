# Appearance tools: native Assistant, MCP and CLI

The native Assistant and `kkterm-cli` / built-in MCP server share the appearance
contracts in `src-tauri/src/appearance_tool_catalog.rs`. The CLI includes this
catalog directly; no separate tool-name or schema mirror needs updating.
The desktop app must be running for tool execution. These are KKTerm backgrounds,
not operating-system wallpaper controls.

## Discovery and dynamic names

Call `appearance_list_backgrounds` / `kkterm.appearance.backgrounds.list` first.
It returns canonical IDs, English and current UI display names, mood metadata,
and solid/gradient preset IDs. `query` filters all translated dynamic names.
`terminal_list_color_schemes` / `kkterm.appearance.color_schemes.list` supports
`query` and `offset` and returns `nextOffset` when another page exists.

Every background setter, including the existing Dashboard and IT Ops setters,
accepts a dynamic ID **or display name** in `background.dynamic`:

```json
{"kind":"dynamic","dynamic":"Misty Sea"}
```

`mistySea`, `MISTY SEA`, `misty-sea`, and the corresponding translated picker
labels resolve to the same canonical ID. Case and punctuation are ignored;
canonical IDs win exact matches. An unknown or ambiguous label returns an error
without changing anything. Ambiguous labels must be replaced with an exact ID.
The stored JSON always uses the canonical ID, not a localized display name.

The picker and Rust resolver consume `src/shared/dynamicBackgroundCatalog.json`.
After editing translations, run `node scripts/sync-dynamic-background-names.mjs`.
Regression tests compare every alias with the locale files and renderer ID list.
Adding a scene requires updating the component map, shared catalog metadata, and
Rust validation ID list together.

## Saved Connection and live-pane appearance

| Native Assistant | MCP / CLI |
| --- | --- |
| `connection_get_appearance` | `kkterm.workspace.connections.get_appearance` |
| `connection_update_appearance` | `kkterm.workspace.connections.dangerous.update_appearance` |
| `session_update_terminal_appearance` | `kkterm.workspace.sessions.dangerous.update_terminal_appearance` |

Read the saved Connection appearance, then submit only the fields to change:

```json
{
  "connectionId": "saved-connection-id",
  "patch": {
    "background": {"kind": "dynamic", "dynamic": "Misty Sea"},
    "opacity": 65,
    "highlightProfile": "Cisco IOS"
  }
}
```

A saved patch supports `background`, `opacity` (0–100), `colorScheme` (ID/name),
`highlightProfile` (existing ID/name), and `fileBrowser`. Unsupported fields or
Connection types fail before any column changes. The operation never changes
hosts, usernames, passwords, keys, transport options, or reconnects Sessions.
It validates all fields, commits one SQLite UPDATE, and projects only the changed
appearance fields into open tabs/panes, clearing stale pane background overrides
only when explicitly setting the saved background.

Omitted fields stay unchanged. `background: null` clears the background;
`colorScheme: null` restores the global default; `highlightProfile: null` turns
keyword highlighting off (it does **not** mean inherit). Opacity is not nullable.
Saved Document Connections (`fileView`) accept the background field.

A File Explorer/SFTP/FTP/cloud-browser patch merges the selected pane only:

```json
{"connectionId":"connection-id","patch":{"fileBrowser":{"remote":{"background":{"kind":"dynamic","dynamic":"Aurora"}}}}}
```

The other pane and its zoom are preserved. Pane fields are `background` and
`zoom` (0.5–2). Media backgrounds use a previously imported media filename, never
an arbitrary local path, network URL, or image data URL.

The live-pane tool requires a `paneId` discovered through Session listing. It
accepts terminal appearance fields, not `fileBrowser`, and never persists them
to the saved Connection. This also works for transient local Sessions. When a
split tab shares one background, an individual-pane background request returns
an actionable error instead of silently changing an invisible override. Enable
`settings.separateSplitTerminalBackgrounds` or change the saved background of
the tab's background-owning Connection instead.

## Keyword-highlighting profiles

| Native Assistant | MCP / CLI |
| --- | --- |
| `terminal_highlight_list` | `kkterm.workspace.highlighting.list` |
| `terminal_highlight_read` | `kkterm.workspace.highlighting.read` |
| `terminal_highlight_create` | `kkterm.workspace.highlighting.dangerous.create` |
| `terminal_highlight_update` | `kkterm.workspace.highlighting.dangerous.update` |
| `terminal_highlight_copy` | `kkterm.workspace.highlighting.dangerous.copy` |
| `terminal_highlight_delete` | `kkterm.workspace.highlighting.dangerous.delete` |
| `terminal_highlight_import` | `kkterm.workspace.highlighting.dangerous.import` |

List returns metadata and saved-Connection usage counts, not every regex. Read
returns one profile selected by exact ID or unique name. Create takes a `profile`
with `name` and `rules`; rule fields are `name`, `pattern`, `enabled` (default true),
optional stable `id`, and `style.foreground` / `style.background` (`#RRGGBB` or null).
Matching is always case-insensitive. IDs are generated for new profiles/rules.

```json
{"profile":{"name":"Service Logs","rules":[{"name":"Errors","pattern":"\\bERROR\\b","enabled":true,"style":{"foreground":"#FF5555","background":null}}]}}
```

Create/copy/import do not apply profiles automatically. Apply the returned ID
with `connection_update_appearance.patch.highlightProfile`, or use the live-pane
tool. Update takes `profile` (ID/name) and a `patch`; omitted name/rules are kept,
while a supplied rules array replaces the complete ordered rule list. Read first
before changing individual rules so unrelated rules survive.

Built-ins are immutable and shared with the UI via
`src/shared/builtinHighlightProfiles.json`; copy before editing. Duplicate names,
invalid JavaScript regexes, nested repetition the renderer would skip, invalid
colors, duplicate rule IDs, and oversized inputs fail before saving. Existing
limits remain 50 custom profiles, 200 rules/profile, 80-character names, and
2,000-character patterns. No silent truncation or conversion to another regex
engine occurs. Import accepts supplied SecureCRT keyword INI text, not a file
path. These checks mirror renderer constraints; they are not a guarantee that
arbitrary regexes are inexpensive, so review generated patterns before approval.

Profile mutations merge into the latest Terminal Settings under the Storage
lock and compare the selected profile against its read version. Stale writes
fail rather than overwriting another edit. Deletion refuses profiles still
selected by a saved Connection (across all Workspaces) or a live pane; disable
or replace those selections first. Successful writes refresh the global
Terminal Settings in the live app so affected renderers update immediately.

The Settings `settings.syntaxHighlightGenerateWithAi` button remains a separate
review-and-save draft flow. It still does not execute tools.

## Other parity repairs and safety

The Dashboard update tool now advertises the same typed background and nullable
tab-color patch on both transports. Site, Server Room, and Rack background setters
reuse the same background schema and name resolver. Existing public names remain
compatible. The Assistant also exposes the previously MCP-only Connection,
Dashboard view, Dashboard widget and app-window screenshot paths and app-window
listing. MCP adds `kkterm.dashboard.check_widget_health` to match the native
widget runtime-health check. Read-only screenshot/health calls no longer trigger
Dashboard mutation refresh handling in the Assistant.

Native appearance/profile tools follow the Connections or Sessions group toggles;
background discovery is available with any applicable appearance-capable group.
Native mutations and screen captures require normal Prompt-mode approval.
The new MCP mutations contain a `dangerous` name segment and require
`built_in_mcp_allow_all_dangerous`; discovery/read tools do not. Existing MCP
permission contracts are retained. CLI-backed Assistant turns follow their
existing MCP authorization policy; one-shot CLI fallback cannot call app tools.

This parity concerns supported **in-app appearance and visual inspection**.
Provider-specific reasoning, secret prompts, email, arbitrary shell execution,
and private Assistant memory are not newly exposed to external MCP clients.
