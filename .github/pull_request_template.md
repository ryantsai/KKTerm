<!--
KKTerm pull request. Keep changes surgical (AGENTS.md Rule 3).
Delete any section that does not apply.
-->

## Summary

<!-- What does this PR change and why? Link issues with "Closes #123". -->

## Type of change

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor / cleanup
- [ ] Docs / manual
- [ ] Build / CI / tooling

## Areas touched

- [ ] Frontend (React/TypeScript — `src/`)
- [ ] Backend (Rust/Tauri — `src-tauri/`)
- [ ] Docs (`docs/`, manual, ADR)

## Domain & docs

<!-- See CONTEXT.md and AGENTS.md before changing behavior, terminology, or placement. -->

- [ ] Uses the canonical vocabulary (Connection / Session / Tab / Workspace / Module — not "profile" for a stored Connection)
- [ ] Source placement follows `docs/ARCHITECTURE.md` → Frontend Source Map; reused typed wrappers in `src/lib/tauri.ts` where applicable
- [ ] New/changed behavior in a manual chapter's scope updates the relevant `docs/manual/` chapter
- [ ] Architectural decisions captured in `docs/ADR/` (if applicable)
- [ ] Built-in MCP tool changes update `docs/MCP.md`; Settings AI safety text changes update `docs/manual/15-settings.md` (if applicable)

## i18n

<!-- All user-visible strings go through i18n. See AGENTS.md + docs/localization_todo/README.md. -->

- [ ] No user-visible strings, OR
- [ ] English keys added first in `src/i18n/locales/en.json`, and pending translation files added under `docs/localization_todo/` per the README flow
- [ ] Named `{{…}}` placeholders, one full sentence per key (no concatenated fragments)

## UI / design language (if UI changed)

<!-- See docs/DESIGN_LANGUAGE.md. -->

- [ ] Dialogs built from `src/app/ui/dialog` primitives; colors read from tokens (no hard-coded hex)
- [ ] Windows footer button order (primary before Cancel, bottom-right); single dismiss path (no duplicate close X)
- [ ] Transient status uses `showStatusBarNotice` (no one-off toasts); no `window.alert/confirm/prompt`
- [ ] Tutorial-capable UI wired with `data-tutorial-id` + nav/metadata mappings (`pnpm run check` passes)

## High-risk invariants

<!-- Tick if relevant; otherwise confirm none of these were violated (see AGENTS.md). -->

- [ ] No frontend close hooks / close-confirmation flows added
- [ ] No live Session state added to the durable Connection model
- [ ] RDP/VNC/WebView2 surface rules respected (RDP ActiveX parking stays RDP-only; correct RDP bounds command used)

## Checks

<!-- Full suite expected for changes > 500 LOC; skip for cosmetic/docs-only (AGENTS.md). State what you ran. -->

- [ ] `pnpm run check`
- [ ] `pnpm run build`
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`
- [ ] Validated in the real Tauri desktop runtime (required for terminal focus/input, WebView2, RDP/VNC, keychain, native menus, title-bar close, OS integration)

## Notes for reviewers

<!-- Screenshots, follow-ups, anything that needs extra eyes. -->
