# Watermelon UI Migration Plan

**Status:** Proposal, exploratory. Lives on `feat/watermelon-ui-migration-plan`.
Not an ADR yet — promote to `docs/ADR/` only after the go/no-go decision in
Phase 3 comes back "adopt."

## 1. Goal

Evaluate replacing KKTerm's hand-built dialog/control visual language with
[Watermelon UI](https://ui.watermelon.sh)'s shadcn/Tailwind component
registry, without committing to it. The branch exists so the look can be
checked out and compared before deciding whether to carry it into `main`.

A visual before/after reference for the screens below is published at
https://claude.ai/code/artifact/833931c4-7dc0-4f94-830b-f98cd9e10ea1.

## 2. Scope

| | Count | Source |
|---|---|---|
| Top-level screens (Modules) | 8 | hand-rolled `ActivePage` switch in `src/App.tsx` |
| Dialogs / sheets / popovers / pickers | ~57 | see module breakdown below |
| Tauri window types | 6 | 1 fixed `main` + 5 dynamically spawned (shutdown warning, recording controls, remote-desktop fullscreen, per-connection URL webview overlay, custom-module host) |
| `.tsx` components under `src/` | 279 | proxy for total UI surface |
| Named color schemes | 20 | `src/styles/colorSchemes.css` |

Dialog/overlay count by module:

| Module | Screens | Dialogs/overlays | Notes |
|---|---|---|---|
| Workspace & Connections | 1 | ~20 | connection setup, env vars, port forwarding, tmux, recordings, notes, icon/background pickers |
| IT Ops | 1 | ~13 | Site/Server Room/Rack/Host/VLAN/IPAM CRUD — most repetitive form pattern |
| Settings | 1 | ~12 | credentials, secret store, MCP servers, import/export |
| App shell (cross-cutting) | — | ~7 | confirm/delete dialogs, update prompt, icon/color pickers reused everywhere |
| Installer | 1 | 2 | |
| Screenshots | 1 | 2 | |
| Dashboard | 1 | 0* | *widgets carry their own chrome, not dialog-based |
| System Cleaner + Custom Modules | 2 | — | lighter list/action surfaces |

## 3. What already exists — read before touching anything

This is **not** a greenfield UI. `docs/DESIGN_LANGUAGE.md` and `AGENTS.md`
document a mature shared kit that almost every dialog in the table above
already composes from:

- **Primitives** (`src/app/ui/dialog/`): `DialogShell`, `Sheet`, `Field`,
  `TextInput`, `TextArea`, `Select`, `Switch`, `Segmented`, `Stepper`,
  `Group`/`GRow`, `Btn`, `Actions`, `ConnTile`, `Swatches`, `DIcon`.
- **`ConfirmSheet`** — the one confirmation template (`info`/`danger`/`warn`
  tones); nothing hand-rolls `window.confirm` or a bespoke alert.
- **Platform-aware button order** — macOS ends Cancel-then-primary; Windows/
  Linux end primary-then-Cancel. Selected by `Actions` from the runtime
  platform, never per-dialog or via CSS reversal.
- **Portal + overlay rules** — blocking backdrops mount through
  `DialogShell`/`document.body`; any overlay that can intersect a URL
  `WebviewWindow` or the RDP ActiveX HWND must join
  `src/modules/workspace/nativeOverlay.ts`.
- **Transient feedback** — every notification routes through
  `showStatusBarNotice`/`showStatusBarInlineProgress`; no local toasts.
- **i18n** — all strings via `t()`, English key first, then a
  `docs/localization_todo/` pending file per `docs/localization_todo/README.md`,
  across 14 locales.
- **Policy tests that fail the build** if these are bypassed:
  `tests/dialog-footer-policy.test.mjs`, `tests/dialog-portal-policy.test.mjs`,
  `tests/native-surface-overlay-policy.test.mjs`.

**Consequence for this migration:** the gap to Watermelon isn't "57
independent dialogs to rebuild" — it's "one shared primitive kit whose
internals are hand-written CSS instead of Tailwind/shadcn conventions." That
reframes the whole plan (see §4).

## 4. Strategic paths — decide before Phase 1 starts implementation

Three options, increasing in cost and in how much they actually prove:

**A. Reskin the shared kit in place (recommended default).**
Rewrite `dialogs.css`/`base.css` and the ~10 primitive components' internals
to Watermelon's visual language (control height, radius, shadow, spacing,
motion, Select/Switch/Tabs look) while keeping every primitive's React
props/behavior identical. Because all 57 dialogs compose from these
primitives, the whole app restyles from a small, reviewable diff. Doesn't
touch button-order logic, portal rules, i18n, tutorial IDs, or any of the 57
call sites. Lowest risk, fastest "check out how it looks."

**B. Rebuild 2-3 pilot screens with real shadcn components.**
Install Tailwind/shadcn properly and rewrite specific screens end-to-end
(e.g. the Connection dialog, one Settings section) with generated Watermelon
components. Gives a truer feel for the actual target stack and its DX, but
each pilot has to independently re-satisfy every invariant in §3 that the
shared kit currently handles for free — higher risk, more code, proves less
about the other 50+ dialogs.

**C. Both.** Do A first so the whole app previews immediately, then pick 1-2
dialogs for B as a deeper proof of concept for what a real component-registry
migration would look like.

This plan defaults to **Path A** for Phase 1 below. Switch to B/C only with
an explicit decision — B changes the risk profile enough that it needs its
own review before starting.

## 5. Phased plan

### Phase 0 — Baseline (this change)
- [x] Branch created: `feat/watermelon-ui-migration-plan`.
- [x] This plan committed.
- [ ] Confirm Path A/B/C before Phase 1 work begins.

### Phase 1 — Reskin the shared primitive kit (Path A)
Touch only:
- `src/app/ui/dialog/dialogs.css`, `src/styles/base.css`
- The primitive components themselves (`Sheet.tsx`, `Field`/`Select`/
  `Switch`/`Segmented` implementations) — internals only, props unchanged
- Design tokens in `src/styles/colorSchemes.css` if radius/shadow tokens need
  new entries (add, don't rename — 20 schemes depend on current names)

Do not touch: the 57 dialog call sites, i18n keys, button-order selection
logic, portal/overlay registries, `ConfirmSheet`'s tone contract.

Exit criterion: every dialog in the app visually reflects the new language
just by being open, with zero changes outside the files listed above.

### Phase 2 — Targeted verification, not a full rollout
Spot-check the highest-traffic surfaces rather than all 57 dialogs
individually, since they share the same primitives:
1. Workspace: New/Edit Connection dialog (SSH — simple) and RDP (wide,
   two-column options layout) — these two shapes cover most of the other 18.
2. IT Ops: one CRUD dialog (e.g. Host or Rack) — most repetitive pattern,
   highest dialog density.
3. Settings: Appearance section (toggle-row list) and one credential dialog.
4. `ConfirmSheet` in all three tones (info/danger/warn), including the
   Delete Workspace flow the policy test pins to it.

### Phase 3 — Go/no-go decision
Compare the branch against `main` using the checklist in §7. Decide:
- **Adopt** → Phase 4A.
- **Partial adopt** (e.g. keep new tokens, revert component internals, or
  vice versa) → scope a follow-up plan.
- **Abandon** → Phase 4B.

### Phase 4A — If adopted
- Write the ADR (`docs/ADR/00XX-watermelon-ui-adoption.md`) recording the
  decision and the reskin-vs-rebuild rationale.
- Update `docs/DESIGN_LANGUAGE.md` token/primitive references if any names
  changed.
- Run the full check suite (§7) and open the PR against `main`.
- Only *then* consider Path B/C for any screen that still looks visibly
  dated next to the reskinned primitives — as a separate, scoped follow-up,
  not part of this branch.

### Phase 4B — If abandoned
- Delete the branch. No cleanup needed elsewhere since Phase 1 never touched
  `main`.

## 6. Out of scope (all phases)

Canvas-heavy, non-form surfaces gain little from a component-registry
reskin and are excluded:
- Terminal (`xterm.js`), SFTP/FTP dual-pane browser, remote-desktop (RDP/VNC)
  canvases
- IT Ops Network Maps and Rack elevation views
- Any native-rendered surface (RDP ActiveX, VNC framebuffer, WebView2
  overlay) — these are governed by the High-Risk Invariants in `AGENTS.md`
  and must not be touched by a styling change

## 7. Verification checklist

From `docs/DESIGN_LANGUAGE.md` §"Checklist for new UI," applied to whatever
Phase 1 touches:

- [ ] Tokens read from `src/styles/colorSchemes.css`; nothing hard-coded.
- [ ] Verified in **Default** and **Dark** schemes, plus one extra scheme
      (e.g. `purple` or `blue-see`, since they diverge furthest from Default).
- [ ] Host-platform button order still correct (test on the actual OS, or via
      `DialogConventionProvider` preview for both conventions).
- [ ] `npm run check` passes (ESLint, `tests/run-all.mjs` including the three
      policy tests named in §3, `tsc --noEmit`).
- [ ] No new i18n keys needed (Phase 1 is styling-only — if a component swap
      requires new copy, stop and follow the localization flow before
      continuing).
- [ ] **Real Tauri runtime check**, not just Vite/browser preview, for
      anything near a native surface: title-bar close X placement, any
      dialog that can overlap a URL Connection or RDP/VNC pane. Pure form
      dialogs (Settings, most Connection types) are fine to eyeball in
      `npm run dev`.

## 8. Open questions

- Path A vs. B vs. C for Phase 1 (§4) — **undecided**, pick before starting.
- Should the 20 named color schemes (including the seasonal/national-team
  ones) all get new token values, or only Default/Dark with the rest
  continuing to derive via `color-mix()` as they do today? Default should be
  the latter unless a scheme visibly breaks.
- Branch name/PR target — currently local-only; not pushed to `origin`.

## References

- `docs/DESIGN_LANGUAGE.md` — source of truth for tokens, primitives, button
  order, `ConfirmSheet`, SFTP pattern.
- `AGENTS.md` — constitution (simplicity, surgical changes) and High-Risk
  Invariants that must survive any restyle.
- `src/styles/colorSchemes.css` — the 20-scheme token system.
- Visual comparison artifact: https://claude.ai/code/artifact/833931c4-7dc0-4f94-830b-f98cd9e10ea1
