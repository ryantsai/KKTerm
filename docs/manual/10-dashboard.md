# 10 — Dashboard

## AI grep hints

- Tutorial targets: `dashboard.views`, `dashboard.addView`, `dashboard.editLayout`, `dashboard.addWidget`, `dashboard.canvas`

- Keys: `dashboard.*` (full namespace)
- Topics: Dashboard Views, Widget Instances, cached Views, instant View switching, embedded Connection pane, embedded SSH terminal, embedded tmux toolbar, hidden embedded SFTP shortcut, presets (panel / ambient / hero), Widget Archetype, Data Monitor, Metric/Chart, Utility Instrument, Desktop Object, Canvas Toy/Game, General Workbench, accents, icons, backgrounds, density, edit layout, empty-canvas context menu, catalog, custom script widgets, AI-authored widgets, widget design preflight, agent widget JSON, UTF-8 widget source, non-English widget text, widget visual context, compact AI context, duplicate widget detection, Notes markdown rendering, Notes folded corner placement, AI coding usage, Codex usage, Claude Code usage, adding AI coding tools, removing AI coding tools, reconnecting AI coding usage, missing CLI binaries, five-hour limit, weekly limit, quota, rate limits
- Synonyms: "homepage", "tiles", "cards", "widgets", "right click dashboard", "context menu", "shortcut menu", "report", "view reload", "connection widget reload", "connection pane tmux", "connection widget tmux", "embedded terminal tmux", "hide SFTP in widget", "switch views", "background image", "wallpaper", "translucent widget", "see-through widget", "canvas opacity", "low contrast widget", "hard to read widget", "sticky note markdown", "note markdown", "notes markdown", "folded corner", "folder corner", "random note corner", "garbled widget text", "mojibake", "encoding", "UTF8", "UTF-8", "Codex quota", "Claude quota", "5h usage", "7d usage", "AI coding meter", "add Codex", "add Claude Code", "remove Codex", "remove Claude Code", "reconnect Claude Code", "refresh Claude Code auth", "install Codex", "install Claude Code", "program not found"

> **Terms:** see `CONTEXT.md`. **Dashboard View** is a durable SQLite-backed tab; **Widget Instance** is a placed widget on a View with its own preset/accent/title/layout. **Dashboard Custom Widget** is an AI-authored script-widget definition. Architecture details live in `docs/DASHBOARD.md`.

## Module entry

Activity Rail icon → label `dashboard.moduleLabel`. Page header uses `dashboard.title`, optional `dashboard.subtitle`, status `dashboard.statusReady`.

## Views

A View is a Dashboard tab. The first View is named `dashboard.defaultView` and seeded on first run with one App Launcher Widget Instance.

- Switcher label: `dashboard.viewsLabel`.
- Add: `dashboard.addView`. New-View dialog `dashboard.newViewPrompt`, field `dashboard.newViewName`.
- Rename: `dashboard.renameView`.
- Remove: `dashboard.removeView`. Confirmation body `dashboard.deleteViewBody`.
- Tab color styling: `dashboard.viewTabGradient`, theme/default swatch `dashboard.clearViewTabGradient`.
- In edit layout mode, drag View tab buttons to reorder Dashboard Views.

Each View has its own `grid_density` (`dashboard.density.compact`, `dashboard.density.default`, `dashboard.density.roomy`) and its own background.
Previously opened Views remain mounted while hidden so switching between View tabs preserves Widget Instance state and keeps embedded Connection panes responsive; hidden Connection panes are marked inactive instead of being closed. Embedded URL Connection panes use a stable owned WebView2 overlay window, so inactive Dashboard Views and Modules hide that overlay instead of closing the URL Session.

## Edit layout mode

`dashboard.editLayout` toggles drag/drop + resize on the 12-column grid. Done editing: `dashboard.editDone`. Empty Views show `dashboard.emptyTitle` and `dashboard.emptyHint`.
Right-clicking empty Dashboard View canvas space opens a shortcut menu for `dashboard.addWidgetLabel`, `dashboard.editLayout`, and `dashboard.changeBackground`. While edit layout mode is active, the same empty-canvas menu remains available and the edit command uses `dashboard.editDone`.

While editing:

- Drag a Widget Instance to move it.
- Drag the bottom-right corner to resize. Widgets snap to grid cells.
- `dashboard.addWidget` / `dashboard.addWidgetLabel` opens the **Widget Catalog**.

## Widget Catalog

A picker over built-in widgets and AI-authored Custom Widgets.

- Title: `dashboard.catalogTitle`, summary `dashboard.catalog`, `dashboard.widgetCount`.
- Search: `dashboard.catalogSearch`. Empty: `dashboard.catalogNoMatches`.
- Group tabs: `dashboard.catalogGroupBuiltIn`, `dashboard.catalogGroupCustom`. Browsing is grouped only by shipped built-ins versus AI Created Widgets; there is no category filter UI.
- Already-placed indicator shows a check badge on cards already on the active View. AI-created cards show `dashboard.catalogBadgeAiGenerated`; imported cards show `dashboard.catalogBadgeImported`.
- Export / import (Custom tab only): each Custom Widget card has an export action (`dashboard.exportCustomWidget`); the Custom tab also offers `dashboard.exportAllWidgets` and `dashboard.importWidget`. Export writes a portable `.kkwidget` JSON file (filter `dashboard.widgetFileFilter`) containing the widget definition only — never instance secrets. Import opens a dialog: users can load a `.kkwidget` file (`dashboard.importWidgetFromFile`) or paste JSON directly (`dashboard.importWidgetPasteLabel`), then KKTerm validates it and shows a preview (`dashboard.importWidgetPreviewTitle`) before the user confirms. Import is additive: it adds each widget as a new imported Custom Widget with a fresh id, suffixing the title on collision, and never overwrites existing widgets. Status `dashboard.exportWidgetsComplete` / `dashboard.importWidgetsComplete`. Built-in widgets are not exportable.

## Customize popover (per Widget Instance)

Opened from a Widget Instance's right-click or properties affordance (`dashboard.properties` / `dashboard.customize`). Implemented as an app-owned popover with a dismiss layer.

Sections:

- `dashboard.customizeSectionCommon` — preset, accent, icon, title.
- `dashboard.customizeSectionWidget` — `dashboard.widgetSettings`. Empty: `dashboard.widgetSettingsEmpty`. Invalid: `dashboard.widgetSettingsInvalid`.

Fields:

- **Preset**: `dashboard.presetLabel`. Options: `dashboard.preset.panel`, `dashboard.preset.ambient`, `dashboard.preset.hero`. Ambient hides the title bar by default; `dashboard.hideTitle` is also offered for other presets.
- **Glass background**: `dashboard.glassBackground`.
- **Canvas opacity**: `dashboard.canvasOpacity` — slider (0-100) that fades the Widget Instance body area only, leaving the title bar fully opaque. Default 70% for the built-in App Launcher and Connection widgets, 100% otherwise; visual effect is applied on the panel preset's `.dw-body`.
- **Accent**: `dashboard.accent`, default `dashboard.accentDefault`.
- **Icon**: `dashboard.icon`.
- **Title**: `dashboard.titleLabel`, placeholder `dashboard.titlePlaceholder`. Untitled widgets show `dashboard.untitledWidget`. On the panel and hero presets the title text in the Widget Instance title bar is also inline-editable: double-click it (tooltip `dashboard.renameTitleHint`) to edit, Enter or blur to commit, Escape to cancel; committing an empty value clears the custom title and reverts to the default. This sets the same `customTitle` field as this Title field.
- **Advanced**: `dashboard.advanced`.

Presets are CSS wrappers that read the Instance's `--w-accent` / `--w-accent-soft` variables — presets do not encode their own palette. Widget customization offers both the named accent palette and the shared rainbow selector for a custom hex accent.

## View background

`dashboard.changeBackground` opens the background picker. Modes:

- `dashboard.backgroundModeDefault` (`dashboard.backgroundDefaultHint`)
- `dashboard.backgroundModePreset` — colour/gradient presets `dashboard.backgroundPresets.*` (mist, sand, sage, sky, blush, lavender, slate, graphite, midnight, pine, aubergine, ember, harbor, moss, wine, steel, plus gradients gDawn / gFog / gMeadow / gDusk / gLinen / gHorizon / gPetal / gTwilight / gMidnight / gHarbor / gEmber / gOrchid / gForest / gEclipse / gCobalt / gNocturne).
- `dashboard.backgroundModeMedia` — choose PNG/JPEG/WebP/GIF/BMP/SVG images or MP4/WebM/MOV/M4V/OGV videos via `dashboard.backgroundChooseMedia`. Remove with `dashboard.backgroundRemoveImage`. File filter `dashboard.backgroundMediaFilter`. Hint `dashboard.backgroundMediaHint`. Fit options under `dashboard.backgroundFitLabel`: `fill`, `fit`, `stretch`, `tile`, `center`. Dim slider: `dashboard.backgroundDimLabel`. Source attribution `dashboard.backgroundMediaSourcePrefix` + link `dashboard.backgroundMediaSourceLink`.
- `dashboard.backgroundModeDynamic` (`dashboard.backgroundDynamicHint`) — app-owned animated backgrounds: `fuji`, `aurora`, `halftone`, `clouds`, `ocean`, `mistySea`, `maelstrom`, `waters`, `raindrops`, `rainyWindow`, `frostedWindow`, `snow`, `sakura`, `fireflies`, `bubbles`, `aquarium`, `jellyfish`, `lighthouse`, `balloons`, `ricefield`, `lanterns`, `starfield`, `nebula`, `orbitals`, `embers`, `lava`, `ink`, `dunes`, `savanna`, `matrix`, `topo`, `synthwave`, `circuit`, `crystals`, `cyberpunk`, `taipei101`, `thunderstorm`, `confetti`, `particleCursor`, `heroGeometric`, `ditherPrismHero`, `webglLiquid`, `silkAurora`, `closingPlasma`, `animatedGradient`, `prismGradient`, and `liquidChrome` (keys under `dashboard.dynamicBackgrounds.*`). `maelstrom` adapts Poseidon’s three.js storm-ocean scene into a portable WebGL background, retaining its directional wind sea, swell, choppiness, whitecaps, analytic sky reflection, and cinematic camera while replacing the WebGPU FFT passes with a vertex spectrum. `mistySea` is a portable WebGL recreation of the supplied procedural sea scene: its haze, sun, clouds, water, and palette play a full 24-hour cycle over five minutes in an endless loop, with fixed wave scale `2` and star density `1.0`. `waters` is a three.js ocean derived from the open-source WaterThreeJS scene: a procedural Gerstner wave spectrum with deep-water dispersion feeds an analytic atmosphere shared by the sky and the water reflections, with Beer–Lambert depth colour, GGX sun glints, and foam seeded from the wave Jacobian; the camera pans on a fixed sweep, the water column is solved analytically instead of with extra render passes, and its fixed-size ocean mesh concentrates vertices near the camera to prevent visible triangular seams on lower-precision integrated GPUs. The eight Componentry-derived backgrounds are procedural WebGL scenes; hidden/off-screen scenes release their WebGL contexts instead of continuing to render. The Dynamic tab also exposes `dashboard.backgroundLivePreview`, which opens `dashboard.backgroundLivePreviewTitle`; that preview dialog stages the selected background until `common.ok`, animates only the selected tile, and uses code-defined static previews for the rest.

The Componentry-derived shaders avoid sine-based pseudo-random hashes because driver-dependent precision can turn their noise discontinuities into straight bands on some integrated GPUs. Deliberately geometric and dithered backgrounds may still contain straight edges as part of their artwork.

Dashboard Views, terminal Connection backgrounds, Document viewer backgrounds, and IT Ops drill-view backgrounds use the same shared background picker datasource. Dynamic backgrounds do not react to pointer clicks or presses; Particle Cursor, Silk Aurora, Closing Plasma, and Liquid Chrome may follow unpressed pointer movement. New preset, media-mode, supported extension, fit, dim, or dynamic background options must be added through the shared picker/registry path so `dashboard.changeBackground`, `terminal.background`, `workspace.fileViewer.background`, and `itops.racks.changeBackground` show the same list.

While Dashboard app-owned overlays are open — including `dashboard.catalogTitle`, `dashboard.customize`, `dashboard.changeBackground`, tab-gradient popovers, and delete confirmation dialogs — embedded URL Connection widgets on the active View are temporarily marked inactive. This hides their owned WebView2 overlay windows so those Dashboard overlays stay visible above the Dashboard.

Dynamic and video backgrounds keep playing on the active View while the Dashboard Module is selected and any portion of the background is on screen, even when another OS window has focus on top of KKTerm. Playback pauses when the app is minimized (the document becomes hidden), when the user switches to another Module (Workspace or Settings), when a different Dashboard View becomes active, or when the background host is fully off-screen.

## Built-in widgets

Each built-in widget is a Body component under `src/modules/dashboard/widgets/`, registered in `src/modules/dashboard/registry/builtInRegistry.ts`. The current built-in widgets are:

- **App Launcher** — `appLauncher.title` / `appLauncher.subtitle`. See [11-app-launcher.md](11-app-launcher.md) for entry management, run modes, and the right-click context menu.
- **Connection** — `dashboard.connectionPaneTitle` / `dashboard.connectionPaneSummary`. Adds one or more Connections through the built-in launcher (`common.add`, `common.search`). Errors: `dashboard.connectionWidgetLoadError`; no match: `dashboard.connectionWidgetNoResults`. Remove `dashboard.connectionWidgetRemove`. Embedded SSH terminals show tmux management through `terminal.showTmux` / `terminal.tmuxSessions` when the Connection uses tmux, but the SFTP shortcut (`terminal.openSftp` / `terminal.sftp`) is hidden inside the widget because the widget is already an embedded surface. The widget uses the same reuse-first tmux Pane id behavior as opening the Connection in Workspace, so returning to an embedded SSH terminal should attach to the stored tmux session instead of allocating a new one during render. The widget looks up the live Connection by id from the raw tree, never from `withLiveConnectionStatuses`, to avoid Session mount/unmount loops. Switching Dashboard Views hides inactive embedded panes without remounting the View, so returning to a View should feel instant.
- **Notes** — sticky-note style. Title `dashboard.notesTitle`, summary `dashboard.notesSummary`, placeholder `dashboard.notesPlaceholder`. Toolbar label `dashboard.notesToolbarLabel`. Page controls use `dashboard.notesPagesToolbarLabel`, `dashboard.notesAddPage`, `dashboard.notesDeletePage`, and the page indicator `dashboard.notesPageIndicator`; deleting a page plays a paper-tear animation from the folded corner before removing it. Background colour `dashboard.notesBackgroundColor` (`yellow`, `pink`, `blue`, `green`, `orange`, `purple`, `white`). Font picker `dashboard.notesFont` (`handwriting`, `marker`, `system`, `serif`, `mono`). Notes use a WYSIWYG Markdown editor by default through the widget setting `dashboard.notesMarkdownEnabled`, so formatting remains visible while the note is edited and single newlines remain visible line breaks. Focusing the editor reveals its compact formatting toolbar above the note text, with large/medium headings, bold, italic, bulleted and numbered lists, block quote, and table insertion; the same row carries add/delete page actions on its right edge and scrolls its formatting actions horizontally when a widget is narrow. A new table starts with two columns, one required Markdown header row, and two body rows. Placing the caret in a table reveals `dashboard.notesAddTableRow`, `dashboard.notesDeleteTableRow`, `dashboard.notesAddTableColumn`, `dashboard.notesDeleteTableColumn`, and `dashboard.notesDeleteTable`; cells remain directly editable and serialize back to GitHub-Flavored Markdown table syntax. Turning Markdown off exposes plain text editing instead. Right-clicking inside editable note text exposes `common.cut`, `common.copy`, and `common.paste`. Each new Notes Widget Instance gets a subtle random rotation, folded-corner size, folded-corner depth, and folded-corner placement. Edit the exact angle with `dashboard.notesRotationDegrees`, depth with `dashboard.notesFoldDepth`, and placement with `dashboard.notesFoldCorner` (`dashboard.notesFoldCornerOption.topRight`, `…topLeft`, `…bottomRight`, `…bottomLeft`).
- **AI Coding Usage** — `dashboard.aiCodingUsageTitle` / `dashboard.aiCodingUsageSummary`. Starts empty with `dashboard.aiCodingUsageEmptyTitle` / `dashboard.aiCodingUsageEmptyHint`; use `dashboard.aiCodingUsageAddTool` to add Codex or Claude Code to that widget instance. Provider labels use `dashboard.aiCodingUsageProvider.codex` and `dashboard.aiCodingUsageProvider.claudeCode`; the provider row product names use `dashboard.aiCodingUsageProviderProduct.codex` and `dashboard.aiCodingUsageProviderProduct.claudeCode` before the subscription badge. Disconnected providers show `dashboard.aiCodingUsageNotConnected`, `dashboard.aiCodingUsageProviderHint`, and `dashboard.aiCodingUsageConnectProvider`; remove a provider from the widget with `dashboard.aiCodingUsageRemoveProvider`, which is only shown while Dashboard edit mode is enabled. If the CLI binary is missing, the provider row shows `dashboard.aiCodingUsageInstallHelp`. Connected providers show `dashboard.aiCodingUsageFiveHour`, `dashboard.aiCodingUsageWeekly`, `dashboard.aiCodingUsagePercent`, reset text `dashboard.aiCodingUsageResetsAt` / `dashboard.aiCodingUsageResetUnknown`, and refresh metadata `dashboard.aiCodingUsageLastRefresh` / `dashboard.aiCodingUsageNeverRefreshed`; last-refresh metadata displays the refresh time only. Automatic refresh is shared by the widget and status bar, refreshes in the background at app launch when the last provider refresh is stale (more than 5 minutes for Codex, more than 15 minutes for Claude Code because its usage endpoint rate-limits aggressively), keeps the last successful snapshot visible, and backs off Claude Code usage polling after HTTP 429 rate-limit responses before trying the endpoint again. Codex refresh is hybrid local-first: when the local Codex CLI/IDE session files carry an account-wide rate-limit snapshot newer than 5 minutes, that snapshot is used without a network call; otherwise the live endpoint is queried, and if the live refresh fails the newest local snapshot (with already-reset windows blanked) is shown together with the refresh error. Last-refresh metadata shows when the displayed data was captured, so a local snapshot reports its session event time rather than the poll time. The status bar display loads Dashboard widget settings at app launch, shows the reset countdown only when the five-hour meter is in warning or danger state, and opens the Dashboard view hosting that widget when clicked. The widget refresh action is `dashboard.aiCodingUsageRefreshNow`; provider refresh/re-auth action is `dashboard.aiCodingUsageReconnectProvider`. Errors use `dashboard.aiCodingUsageProviderError` and `dashboard.aiCodingUsageRefreshError`.

- **PC Info** — `dashboard.pcInfoTitle` / `dashboard.pcInfoSummary`. A Speccy-style snapshot of the local machine with tabbed sections `dashboard.pcInfoSection.summary`, `…os`, `…cpu`, `…memory`, `…motherboard`, `…graphics`, `…storage`, `…network`, `…audio`, and `…battery` (the Battery tab appears only when a battery is present); field labels live under `dashboard.pcInfoField.*`, including `dashboard.pcInfoField.pcModel` for the system-level PC model. Summary and Graphics hide virtual display adapters when physical hardware is present and prefer a discrete GPU over an integrated/embedded GPU. The snapshot is collected once on first load and cached; the user re-collects on demand with the `common.refresh` action, and the footer shows `dashboard.pcInfoUpdatedAt`. States: `dashboard.pcInfoLoading`, `dashboard.pcInfoEmpty`, `dashboard.pcInfoSectionEmpty`, and `dashboard.pcInfoDesktopOnly` outside the desktop runtime. Collection is backend-only (`pc_info_get` / `pc_info_refresh` over `src-tauri/src/pc_info.rs`): Windows runs a hidden PowerShell CIM/WMI query that emits locale-stable JSON (with a native Win32 + registry fallback, and true GPU VRAM read from `HardwareInformation.qwMemorySize` rather than the 4 GB-capped `AdapterRAM`); macOS uses `system_profiler`; other Unix reads `/proc` and DMI sysfs identity files.

The Dashboard also ships two grouped utility widgets. Each hosts several local tools behind a tab strip (rendered by `src/modules/dashboard/widgets/builtin/tool-group/ToolGroupWidget.tsx`; the individual tools live under `src/modules/dashboard/widgets/builtin/<name>/`). Every tool persists its inputs and the active tab in `localStorage` per Widget Instance, renders results as click-to-copy rows (`dashboard.widgetCopyValue` / `dashboard.widgetCopied`), themes from the instance accent through `--w-accent` / `--w-accent-soft`, and honours `prefers-reduced-motion`.

Utility-widget technical inputs, including subnet queries, DNS names, QR/barcode
payloads, cron expressions, time conversions, hash/Base64/URL/JWT text, and
script source editing, disable OS autocorrect, autocapitalization, and
spellcheck in the app WebView on Windows and macOS. The Notes widget remains a
prose surface and may keep spelling assistance.

**Network Tools** — `dashboard.networkToolsTitle` / `dashboard.networkToolsSummary`. Tabs `dashboard.networkToolsTab.subnet`, `…dns`, `…speedtest`, `…ping`, `…whois`:

- **Subnet** (`dashboard.subnetTitle`) — pure IPv4 bit math (no network access). Accepts a CIDR (`192.168.1.0/24`), an address with a dotted mask, or an address range (`10.0.0.5 - 10.0.0.200`, resolved to the smallest covering CIDR). Shows network, netmask, wildcard, broadcast, first/last host, and usable host count (`dashboard.subnetNetwork`, `…Netmask`, `…Wildcard`, `…Broadcast`, `…FirstHost`, `…LastHost`, `…UsableHosts`). The 32-bit prefix strip (`dashboard.subnetBitsLabel`) is interactive — clicking a bit sets the prefix (`dashboard.subnetPrefixBit`). Invalid input shows `dashboard.subnetInvalid`, empty shows `dashboard.subnetHint`.
- **DNS** (`dashboard.dnsTitle`) — resolves A, AAAA, CNAME, MX, TXT, and NS records over Cloudflare DNS-over-HTTPS (`https://cloudflare-dns.com/dns-query`), and looks up the public IP via ipify (`dashboard.dnsMyIp`). Each answer row shows the type, data, and TTL (`dashboard.dnsTtl`). States: `dashboard.dnsLoading`, `dashboard.dnsNoRecords`, `dashboard.dnsError`, empty `dashboard.dnsHint`. Makes outbound network requests on demand only.
- **Speed** (`dashboard.speedtestTitle`) — strictly click-to-run (never auto-refreshes): measures latency, jitter, and download throughput against the selected target from `dashboard.speedtestTargetLabel`, rendering a live SVG gauge. Targets include Cloudflare's CORS-enabled `speed.cloudflare.com` global edge and tested regional LibreSpeed endpoints (`dashboard.speedtestTargets.*`) that require `cors=true`. Start/retest with `dashboard.speedtestStart` / `dashboard.speedtestRetest`; phase labels `dashboard.speedtestPhaseLatency` / `dashboard.speedtestPhaseDownload`; `dashboard.speedtestNote` reminds the user it uses real bandwidth. The run aborts on unmount (including tab switches). Failure shows `dashboard.speedtestError`.
- **Ping** (`dashboard.pingTitle`) — runs in the desktop runtime through the built-in network ping backend. Users paste plain IPv4 addresses or CIDR blocks into `dashboard.pingTargetsLabel`, set `dashboard.pingDuration` and `dashboard.pingInterval`, then start/stop with `dashboard.pingStart` / `dashboard.pingStop`. Rows show `dashboard.pingCurrent`, `dashboard.pingAverage`, and `dashboard.pingLoss`; large CIDR pastes are capped and announced with `dashboard.pingTargetCountCapped`.
- **Whois** (`dashboard.whoisTitle`) — queries public WHOIS records for `dashboard.whoisDomainLabel` with `dashboard.whoisLookup`. Empty, loading, desktop-only, and error states use `dashboard.whoisHint`, `dashboard.whoisLoading`, `dashboard.whoisDesktopOnly`, and `dashboard.whoisError`.

**Generators** — `dashboard.generatorToolsTitle` / `dashboard.generatorToolsSummary`. Tabs `dashboard.generatorToolsTab.qr`, `…cron`, `…password`, `…time`, `…hash`:

- **QR** (`dashboard.qrTitle`) — renders text or a URL to a QR code (`qrcode`) or a CODE128 barcode (`jsbarcode`) on a canvas using the theme text colour. Mode toggle `dashboard.qrModeQr` / `dashboard.qrModeBarcode`; copy the image to the clipboard or, in the desktop runtime, save it as PNG (`dashboard.qrSaveImage`). Empty shows `dashboard.qrHint`, unencodable input shows `dashboard.qrError`.
- **Cron** (`dashboard.cronTitle`) — explains a cron expression with `cronstrue` (localized to the active language) and previews the next five runs with `cron-parser`, each labelled with a relative and absolute time. Preset chips (`dashboard.cronPresetsLabel`) fill common expressions; `dashboard.cronNextRuns` heads the run list. Invalid shows `dashboard.cronInvalid`.
- **Password** (`dashboard.passwordTitle`) — uses `crypto.getRandomValues` with rejection sampling. Password mode has a length slider (`dashboard.passwordLength`) and class toggles (`dashboard.passwordToggle.uppercase` / `…digits` / `…symbols`); passphrase mode joins random words (`dashboard.passwordWords`). Shows an entropy estimate (`dashboard.passwordEntropyBits`) and strength tier (`dashboard.passwordStrength.weak` … `…excellent`). The generated secret is never persisted — only the options are saved. Regenerate with `dashboard.passwordRegenerate`.
- **Time** (`dashboard.timeTitle`) — live epoch clock (`dashboard.timeNow`) plus conversion of epoch seconds, epoch milliseconds, or any parseable date string into local time, ISO 8601 UTC, epoch seconds, and epoch milliseconds (`dashboard.timeLocal`, `…Utc`, `…EpochSeconds`, `…EpochMillis`). The live clock ticks only while the View is active. Invalid shows `dashboard.timeInvalid`.
- **Hash** (`dashboard.hashTitle`) — inner tabs (`dashboard.hashTabHash`, Base64, URL, JWT) over a shared input. Hash computes SHA-256/SHA-1/SHA-384/SHA-512 via Web Crypto plus MD5 and CRC32 locally; in the desktop runtime, `dashboard.hashSelectFile` opens a native file picker and hashes the selected file without persisting its bytes. Base64 and URL encode/decode (`dashboard.hashEncode` / `dashboard.hashDecode`); JWT decodes header and payload with `jwt-decode` (`dashboard.hashJwtHeader` / `dashboard.hashJwtPayload`). All transforms are local. Errors: `dashboard.hashInvalidInput`, `dashboard.hashJwtInvalid`, `dashboard.hashFileReadError`.

**Converters** — `dashboard.convertersTitle` / `dashboard.convertersSummary`. Tabs `dashboard.convertersTab.unit`, `…currency`, `…image`:

- **Unit** — category tabs switch between `dashboard.unitCategory.length`, `…mass`, `…area`, and `…temperature` across metric, imperial, and local units. Source and target are editable amount/unit rows; typing in either amount recalculates the other for quick direction changes. Area includes `dashboard.converterUnit.ping` for Taiwan and `dashboard.converterUnit.tsubo`; mass includes `dashboard.converterUnit.cattyTaiwan`.
- **Currency** — presents source and target as two editable amount/currency rows; typing in either amount recalculates the other after rates load, making direction changes immediate. It fetches no-key estimate rates from Frankfurter on demand with `dashboard.currencyFetchLatest` / `dashboard.currencyRefresh`, caches the validated result in that Widget Instance's local persisted config for reuse after reload, and shows the provider date through the active locale with `dashboard.currencyLastRefresh`. Until rates are available, `dashboard.currencyEstimate` explains that conversion requires an estimate rather than a financial-grade quote.
- **Image** — opens local JPG, PNG, and WebP files and saves them in any of those three formats. Exact resizing can lock the source aspect ratio; percentage resizing accepts 1–500% and provides common presets. JPEG and WebP expose quality controls, while PNG remains lossless. Conversion runs locally in the app WebView, uses high-quality resizing, composites transparency onto white for JPEG output, strips source metadata, and converts an animated WebP's displayed frame into a static image. It rejects inputs or outputs above the documented pixel and dimension limits.

These two widgets replace the old per-request script utilities for the most common operator tasks. For anything outside this set, the AI Assistant still creates a per-request script widget.

## Removing widgets

`dashboard.removeWidget` removes a Widget Instance from the current View. Confirmation hint `dashboard.removeConfirmHint`, body `dashboard.deleteWidgetBody`. Status `dashboard.widgetDeleted`. Deleting the underlying Custom Widget definition uses `dashboard.deleteCustomWidget` (title `…Title`, body `…Body`, confirm `…Confirm`).

## Custom Widgets (AI-authored)

Custom Widgets are authored by the AI Assistant (`ai.createWidget`), not by users directly in v1. AI-authored widgets are script widgets:

- **`script`** — JavaScript hosted inside an isolated `iframe srcdoc` host with declared `dashboard.scriptNetwork` permissions and `dashboard.scriptPollSeconds`. Source viewable via `dashboard.scriptViewSource`. iframe accessible title: `dashboard.scriptWidgetFrameTitle`.
- In the Advanced section, `dashboard.scriptViewSource` includes `common.edit`, `common.save`, and `common.cancel` actions for hand-editing the script source. Saving persists the edited source to the Dashboard Custom Widget definition and reloads the placed Widget Instance from the updated source.

Widget source and settings schema payloads are UTF-8 JSON. When the assistant creates or updates a widget in a non-English output language, titles, summaries, labels, placeholders, setting options, `htmlShim`, and JavaScript string literals should stay as Unicode text; do not rewrite them as mojibake, percent-encoded strings, base64, HTML entities, or ASCII-only text.

When creating a Custom Widget, the assistant chooses a **Widget Archetype** before calling the Dashboard tool. Supported archetypes are Data Monitor, Metric/Chart, Utility Instrument, Desktop Object, Canvas Toy/Game, and the last-resort General Workbench fallback. It then uses an OpenDesign-style preflight: pick an internal visual direction (operator console, data observatory, desktop object, spatial canvas, or branded vignette), choose the rendering library or DOM/canvas approach, size the Widget Instance, then critique contrast, hierarchy, density, responsiveness, and motion cost before saving the widget.

Archetype defaults:

- **Data Monitor** — web/API/list/status data. Use compact provenance, freshness, loading, empty, stale, and error states.
- **Metric/Chart** — numeric summaries, gauges, charts, and meters. Ambient is allowed when the widget renders its own compact label.
- **Utility Instrument** — QR, hash, converter, calculator, parser, generator, formatter, or encoder/decoder tools. Use panel chrome with explicit labels, validation, results, and copy/export actions.
- **Desktop Object** — clock, dial, note, tray, scanner, calculator, tuner, or other tactile singleton object. Use ambient chrome by default; avoid body subtitles and explanatory prose.
- **Canvas Toy/Game** — small games, physics toys, fidget tools, and canvas/WebGL scenes. Use ambient chrome by default; put score/status/controls inside the scene as HUD affordances.
- **General Workbench** — mixed-purpose fallback only when none of the primary archetypes fit.

Validation errors surface as:

- `dashboard.scriptInvalidBody`, `dashboard.invalidScriptWidgetBody`.
- Library load failure: `dashboard.widgetLibraryLoadFailed`.
- Missing references: `dashboard.missingBuiltInWidget`, `dashboard.missingCustomWidget`.
- Resource cap: `dashboard.scriptWidgetCapped`.

Hardening details: `docs/ADR/0006-dashboard-script-widget-hardening.md`. Script widgets are isolated in iframes, capped by the active-script-widget limit, defer, viewport-gate, and stagger iframe startup so the Dashboard can paint before expensive generated code runs and off-screen display widgets run no code until scrolled into view (monitoring widgets declared `periodic` or `realtime` are exempt and keep running in the background), run animation/timer guardrails inside the iframe, honor `body.lifecycle.minTickMs` down to a 16 ms floor for intentional animation widgets, and have parent bridge throttles for expensive host requests.

Visual context for AI-authored script widgets is supplied as `activeView.visualContext` in Dashboard Assistant context. The iframe exposes exact theme values through `KK.getTheme()` and CSS variables such as `--kk-readable-surface`; widgets should place text on readable surfaces when the View background is image, video, dynamic, or otherwise mixed. Script-widget bodies use a fixed light/dark palette matched to the backdrop behind the widget rather than the live app color scheme, so a generated widget keeps its contrast and stays visually stable when the color scheme changes — switching schemes only repaints the surrounding chrome, not the widget body.
The script-widget host keeps the iframe canvas transparent and owns the document-level colour scheme; AI-authored source should style content inside `#root` instead of repainting `:root`, `html`, or `body`.

The Dashboard context sent to the AI Assistant is metadata-only. It includes active View information, Widget Instance placement, AI Created Widget titles/summaries/categories, compact body/settings metadata, widget health errors, compact visual context, and compact library keys/globals. It does not include full script source, `bodyJson`, `settingsSchemaJson`, or per-instance settings values. The assistant uses this metadata to detect likely duplicate AI Created Widgets and offer to edit, place, or create a separate widget. Full source is read only through the scoped `dashboard_read_widget_source` tool after one widget id is selected for checking or editing.

### Agent widget dialog

Used when a tool call creates a widget. Title `dashboard.agentWidgetDialogTitle`, hint `dashboard.agentWidgetDialogHint`. Body field `dashboard.agentWidgetJson` with example `dashboard.agentWidgetExample`. Save button `dashboard.saveWidget` → status `dashboard.agentWidgetSaved`. Built-in id reference `dashboard.agentWidgetBuiltInId`. Validation errors under `dashboard.agentWidgetErrors.*` (`invalidJson`, `invalidTitle`, `invalidCategory`, `invalidSummary`, `invalidBody`).

The "Add agent widget" entry point on a View is `dashboard.addAgentWidget`.

## Widget Secrets

Widget Instances may declare a secret. KKTerm prompts via:

- `dashboard.secretStored` / `dashboard.secretPlaceholder` / `dashboard.secretClear`.

Secret values are stored in the OS keychain under the AI-provider secret owner namespace.

## Assistant context echo

When a tool call describes its output, the Widget Instance can show a small "assistant context" block:

- `dashboard.assistantContextLabel`, `dashboard.assistantContextSource`, `dashboard.assistantContextIntro`, `dashboard.assistantSummary`.
