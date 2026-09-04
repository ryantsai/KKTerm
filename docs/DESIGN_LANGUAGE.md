# KKTerm Design Language

KKTerm's UI follows one Apple/Finder-flavoured design language. This document is
the source of truth for that language: read it before adding any dialog, sheet,
settings surface, or file-browser UI so new work stays consistent.

The reference appearance is the **Default** color scheme (light) and the **Dark**
color scheme. Both are tuned to match the design exactly; every other scheme
reuses the same components and tokens, so building against the tokens makes new
UI theme automatically across all 14 schemes.

## Color tokens

Tokens live in `src/styles/colorSchemes.css`. Each scheme sets the same token
names; **always read these, never hard-code hex** (hard-coded colors break the
other schemes and dark mode).

Core: `--app-bg`, `--surface`, `--surface-muted`, `--chrome`, `--chrome-strong`,
`--text`, `--text-muted`, `--text-faint`, `--border`, `--border-strong`,
`--accent`, `--accent-soft`, `--green`, `--amber`, `--red`, `--shadow`,
`--app-ui-font-family`.

Raised controls use `--control-shadow`. Text inputs, textareas, and selects tint
it with neutral `--border-strong`; their focus ring layers above the shadow.
Action buttons use the `--button-shadow` alias and set `--button-shadow-color`
to their own surface color (`--accent`, `--green`, `--red`, or neutral
`--border-strong`) so elevation follows the active color scheme. Keep flat
navigation, tabs, segmented controls, menu rows, swatches, and title-bar chrome
shadowless; those controls communicate selection or navigation rather than
elevation.

Use `--accent-text` for accent-colored text and `--sel` for selected navigation
with white text. Default and Dark keep these readable independently of decorative
accent colors. `--focus` is a color for `outline`; `--ring` is a complete
`box-shadow` value, never an outline color or the color portion of another shadow.
Retain a visible outline in forced-colors mode, where box shadows are suppressed.

Design-language surface tokens (added for this language): `--hover`, `--press`,
`--hairline`, `--accent-press`, `--sel`, `--sel-soft`, `--folder-top`,
`--folder-bot`, `--doc-fill`, `--doc-stroke`, `--ring`. Exact values are authored
for Default + Dark; all other schemes derive them with `color-mix()` in the
`:where(:root)` block so they adapt light/dark on their own.

Font: `--app-ui-font-family` resolves to SF Pro on macOS and bundled **Inter** on
Windows (`-apple-system, "SF Pro Text", "SF Pro Display", "Inter", "Segoe UI"`).
Inter is also selectable explicitly in Settings → Appearance.

## Compact Module header

Every top-level Module uses the shared compact header template in
`src/app/ModuleHeader.tsx`, with its shared styling in
`src/app/moduleHeader.css`. Compose Module-owned navigation and actions inside
that template instead of rebuilding the icon, title, divider, or spacer markup.

- The header is 44px tall with 14px horizontal insets. Its title uses the
  shared 15px/680-weight/1.2-line-height treatment and stays vertically centered.
- `ModuleIconTile` is the Module identity source: Workspace is green, Dashboard
  uses the accent tint, Install Helper uses the accent/red tint, IT Ops uses
  the accent/green tint, and System Cleaner uses the accent/green tint at a
  lower accent share to stay distinct from IT Ops. Use the same glyph and tint
  in General → Activity Rail
  and in a Module-specific Settings navigation entry.
- Put the Module identity first, optional local navigation after
  `ModuleHeaderDivider`, and primary actions at the far right using
  `ModuleHeaderSpacer`. A Module may center its navigation when its information
  architecture requires it, but must keep the shared title position and height.
- Do not add a subtitle by default. Supporting state belongs in compact metadata
  or the content area, not in a second title line.
- Module identity tiles, titles, and compact metadata are non-selectable chrome;
  dragging across a header must not produce browser selection highlighting.
  Keep inputs and other editable controls inside the header normally selectable.
- Workspace keeps its resizable Connection-panel divider. Its header action sits
  to the right of the Workspace name, and the content-area top bar is reserved
  for the Tab Strip when that strip is enabled.

When adding a Module, add its `ModuleKind` and tint to the shared template, use
that template for the Module header, and reuse the same `ModuleIconTile` wherever
Settings represents that Module.

### IT Ops destination pages

IT Ops has a Module-internal destination-page contract in
`docs/ITOPS.md` → **IT Ops destination-page UI contract**. Read it before
adding or redesigning Hosts, Automations, Run History, Task Library, or any new
non-spatial IT Ops destination. Those pages share one inset, compact
title/description header, stable right-aligned actions, optional toolbar, and
bordered-row rhythm. Site, Server Room, and Rack drill-down views are the
documented spatial-canvas exception; their empty setup states use explanatory
text with inline action links rather than isolated primary buttons.

## Dialog primitives — `src/app/ui/dialog/`

Build dialogs from these typed primitives instead of bespoke markup. Import from
`@/app/ui/dialog` (relative `src/app/ui/dialog`). All text is passed in **already
translated** — primitives contain no English.

Blocking dialog backdrops cover the full app content area, including the
Activity Rail, and stack above the rail so its controls are both dimmed and
non-interactive while a dialog is open. Do not inset a blocking backdrop around
the rail or assign it a lower layer. **All new blocking dialogs must use
`DialogShell`; do not create custom backdrop elements or per-dialog backdrop
layer rules.** Existing legacy dialogs use the shared
`.dialog-backdrop.connection-dialog-backdrop` classes until migrated.

- `DialogShell` — portal + dimmed backdrop (`onBackdrop` for click-to-dismiss).
- `Sheet` — the panel: `width`, optional `eyebrow`/`title`/`sub`, `footer`,
  `onClose`. **Only pass `onClose` when there is no footer dismiss action**
  (AGENTS.md close-X rule) — the X renders only then.
- `Field`, `TextInput`, `TextArea`, `Select`, `Switch`, `Segmented`, `Stepper`.
- `Group` + `GRow` — grouped option cards (icon, label, description, control).
- `Btn` (`kind`: `""` | `primary` | `danger` | `ghost`) and `Actions`.
- `ConnTile` + `Swatches` — connection identity tile and accent swatches.
- `DIcon` — the shared SF-Symbols-ish glyph set (`src/app/ui/dialog/icons.tsx`).

`Sheet` uses `useDialogFocus` to focus its first available control, wrap Tab and
Shift+Tab within the top dialog, and restore the opener on dismissal. Explicit
autofocus takes precedence; `ConfirmSheet` defaults to its cancel action unless
`autoFocusConfirm` is requested. Escape uses the existing `onClose` or shell
`onBackdrop` callback unless the child already handled the key. Legacy Connection
forms use the same hook with their existing cancel callback. The hook does not
alter native overlay visibility or make portaled Status Bar notices inert.

`Sheet` supplies the private design-token bridge used by all of these
primitives. When a primitive is intentionally rendered on a custom non-`Sheet`
surface—such as a full-canvas editor inspector—the nearest surface root must
carry `kk-surface`. Do not copy the primitive CSS or allow unresolved
`--radius-field`, `--field`, `--field-h`, `--text-2`, or `--text-3` variables
to fall back to native square controls. The surface marker keeps field radii,
fills, shadows, typography, and focus rings identical to normal dialogs.

CSS: `src/app/ui/dialog/dialogs.css`, kk- prefixed classes aliased onto the app
tokens. Existing shared dialog classes (`.connection-dialog`, `.settings-*`,
`.primary-button`, `.secondary-button`, dialog inputs, `.dialog-backdrop`) are
restyled in `src/styles/base.css` to the same language, so legacy dialogs match.
For an inline cautionary banner inside a `Sheet` body (e.g. the credential-export
passphrase warning), use the shared `.kk-dlg-warn` class rather than hand-rolling
an amber callout.

### Transient feedback

The Status Bar owns both transient notifications and app-global work progress.
Route every informational outcome, success confirmation, warning, and error
through `showStatusBarNotice` with the matching `tone`. Routine determinate work
(file loading, scans, imports, and similar background operations) uses
`showStatusBarInlineProgress`, `updateStatusBarInlineProgress`, and
`clearStatusBarInlineProgress`. This compact shadcn-style bar renders inside the
right side of the Status Bar and is the default progress pattern.

Reserve the portaled `showStatusBarProgress` popup for high-salience or cancelable
work that must remain visible above dialogs, such as downloading an app update.
Do not use the prominent popup merely because an operation reports a percentage.
Dialogs and pages must not render transient results inline or create local toast,
banner, snackbar, or status-message systems. Static guidance and cautions that
are part of the form before an action occurs are content, not transient
notifications, and may remain beside the relevant controls.

`TextInput` and `TextArea` default to the shared technical-input behaviour from
`src/lib/inputBehavior.ts`, disabling autocorrect, autocapitalization, and
spellcheck for machine-oriented dialog fields. Callers may override those props
only for prose fields where spelling assistance is useful.

### Add/Edit Connection default options

When an add/edit Connection dialog has a "Use Settings defaults" mode, the mode
owns the whole related option group. Enabled means the grouped controls are
muted/disabled, show the current Settings default values, and saving writes
those displayed defaults into the Connection. Disabled means the controls are
editable per-Connection values. For SSH, ProxyJump, SOCKS proxy, and tmux
management must move together under this rule; never leave one editable while
the default-options mode is on.

### Button order

KKTerm follows the host platform. macOS ends its bottom-right action group with
Cancel then the primary/confirm action, placing the primary action at the outer
right edge. Windows and Linux end with the primary/confirm action then Cancel.
Auxiliary actions stay left of the spacer on every platform. `Actions` selects
the convention from the runtime platform; `DialogConventionProvider` exists
only for explicit previews and tests. Do not reorder per-dialog or use CSS row
reversal.

### Shortcut editors

Every Settings shortcut row uses the shared recorder treatment: an action label,
the `.shortcut-binding-button`, and an icon-only clear action when a binding is
set. Clicking the binding button puts that row into recording mode; the next
valid key combination replaces the binding, while Escape or focus loss cancels
recording. An unbound row shows the translated `settings.shortcutNotSet` state.
Do not use free-form text inputs, per-row enable switches, or a feature-specific
shortcut control. When one shortcut setting appears on multiple Settings pages,
render the same component and shared draft on every surface; screenshot capture
shortcuts use `ScreenshotShortcutRows` in both Screenshots and Shortcuts.

### Footer & buttons

Build every dialog footer from the kit — never hand-roll the action row:

- Primitive dialogs (`Sheet`): pass `footer={<Actions … />}` built from `Btn`s.
  `Actions` packs the group bottom-right in host-platform order automatically.
- Legacy `.connection-dialog` surfaces: use the styled `.dialog-actions` row
  through `LegacyDialogActions`, passing named `primary`, `cancel`, and optional
  `extraLeft` slots. Keep `.approve-button` primary + `.toolbar-button` cancel,
  and put a glyph on the primary (e.g. a line icon such as `<Save size={15} />`).
- The primary action carries an icon; primary and Cancel share one button size.

**Never use the `connection-dialog-footer` class.** It has no CSS rule, so it
renders a left-aligned, gap-less, icon-less footer (the bug this paradigm
exists to prevent). `tests/dialog-footer-policy.test.mjs` fails the build if it
reappears or if the Delete Workspace confirmation stops using `ConfirmSheet`.

### Titles

One concise title by default (no subtitle/explanatory header unless the flow
truly needs it — put supporting text in the body near the relevant control).

Settings subsection titles and equivalent section titles inside app-owned
dialogs use a 12px bottom margin before the section's normal layout gap. Keep
that spacing on the shared heading/legend rule rather than adding margin to the
first control, so every section retains the same title-to-content rhythm.

## Confirmation template — `ConfirmSheet`

Use `ConfirmSheet` for every confirmation; do not hand-roll alert dialogs. It is
a compact sheet with a tinted glyph, single title, optional body, footer in
host-platform order, and no title-bar X. Three presets:

- `tone="info"` — informational / run-command confirmations (accent glyph).
- `tone="danger"` — destructive deletes (red glyph, danger confirm button).
- `tone="warn"` + `extraLeft` "Don't Save" — unsaved-changes (amber glyph).

`src/app/ConfirmDialog.tsx` and `DeleteConfirmationDialog.tsx` are thin wrappers
over `ConfirmSheet`, so existing call sites already use it. The unsaved-changes
preset is a **template only** — never wire it to app-window close (High-Risk
Invariant: no frontend close hooks).

## SFTP / file browser pattern

`src/modules/workspace/connections/sftp/` is the reference file-manager surface:
symmetric dual-pane (Local | center transfer-arrow gutter | Remote), per-pane
breadcrumb with double-click-to-edit path, List + Gallery view switch, sortable
columns, a collapsible transfer-activity bar, and a native context menu with
Copy Path / Get Info. Reuse `FilePane` and these patterns for new browser UIs.

The SFTP/File Explorer right-click menu is a Tauri native context menu through
`src/lib/nativeContextMenu.ts`. Native menu styling intentionally wins over a
custom Finder-like surface because this menu can cross an adjacent URL
Connection `WebviewWindow` or RDP ActiveX HWND in a split layout. Keep command
menus native; only forms, sliders, live previews, and similarly interactive
content justify a DOM popover, which must join the shared native-surface
intersection registry.

## Checklist for new UI

1. Read tokens; never hard-code colors.
2. Compose from `src/app/ui/dialog` primitives; confirmations use `ConfirmSheet`.
3. Host-platform button order; one concise title; close-X only without a footer dismiss.
   Footer from `Actions`/`LegacyDialogActions` with an icon'd primary — never
   `connection-dialog-footer`.
4. Route transient information, success, warning, and error outcomes through
   `showStatusBarNotice`. Use `showStatusBarInlineProgress` for routine determinate
   work; reserve `showStatusBarProgress` for high-salience or cancelable work.
5. Route every string through `t()`; add `en.json` keys + a
   `docs/localization_todo/` pending file (see that README).
6. Verify in Default and Dark plus one extra scheme in the real Tauri runtime.
7. For IT Ops, apply the destination-page contract in `docs/ITOPS.md` and review
   Hosts, Automations, Run History, and Task Library together for drift.
