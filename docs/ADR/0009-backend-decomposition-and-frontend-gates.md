# ADR 0009: Backend Module Decomposition and Frontend Test/Lint Gates

## Status

Accepted.

## Context

Two backend modules had grown into god-files: `ai.rs` (~11,500 lines) and
`storage.rs` (~8,200 lines), with `lib.rs` (~3,200 lines) registering ~200
Tauri commands in one flat `generate_handler!`. Size concentrated change-risk
and worked against the repo's stated goal of AI-navigability.

Two test/quality gaps compounded it:

1. **CI did not run the Rust test suite** — only `cargo check`. 600+ behavioral
   tests never gated merges.
2. **The frontend `pnpm run check` was a hand-maintained `&&` chain** of ~38
   explicit `node tests/<file>` invocations. ~39 other `tests/*.test.mjs` files
   were silently never run, and ~12 of those had rotted — they assert exact
   source text (`assert.match(source, /regex/)`) that drifted from the
   implementation. There was also no linter and no frontend runtime test
   capability (only the brittle source-grep style).

## Decision

### 1. Decompose god-files into directory modules, preserving the public surface

`ai.rs` and `storage.rs` become directory modules (`ai/`, `storage/`) following
the pattern already used by `ai/providers` and `ai/prompt_contracts`:

- Submodules open with `use super::*;`. Because a submodule is a descendant of
  its parent module, it sees the parent's private items, so most moves need no
  new imports.
- Items the rest of the crate (or the test module) still call are re-exported
  with `pub(crate) use <submodule>::*;` and narrowed to `pub(crate)` where they
  were private.
- For `storage`, methods move into additional `impl Storage { … }` blocks in
  submodule files. Rust attaches every `impl Storage` block to the same type
  regardless of file, so **public method call sites are unchanged**; only
  private helpers called across the new seam are widened to `pub(crate)`.
- Shared `macro_rules!` macros (`ai_interaction_debug`, `ai_debug`) stay in the
  parent and are made path-reachable with `pub(crate) use <macro>;` so child
  modules declared above the definition can import them by path.
- Each module's inline `#[cfg(test)]` suite moves verbatim to
  `<module>/tests.rs`; `super::*` resolves identically from the child file.

Result: `ai.rs` 11,472 → 5,360; `storage.rs` 8,247 → 4,125; behavior unchanged,
all 614 backend tests green after every extraction. Further decomposition (the
AI tool-dispatch section, the remaining `impl Storage`) is deferred follow-up,
not a reversal of this pattern.

### 2. lib.rs command grouping is documentation-only, not a mass move

Relocating ~200 `#[tauri::command]` wrappers into domain modules is high-risk
(macro path resolution) and low-payoff (the wrappers are thin glue). Instead:
the `generate_handler!` registry is annotated with 27 domain section headers
(comments are lexer-whitespace, so the command set is byte-for-byte identical),
and only the pure, command-free media/font helpers were extracted to `media.rs`.
A full command move remains available if `lib.rs` growth ever justifies it.

### 3. Test runner auto-discovers; stale guards stay visible

`pnpm run check` runs `tests/run-all.mjs`, which discovers every
`tests/*.test.{mjs,ts}` automatically — adding a test never requires editing a
list. The stale source-grep guards from the original runner migration were
triaged:

- Tests importing **removed modules** were deleted as obsolete.
- The rest were either realigned with the live source or replaced by behavioral
  coverage. The runner still keeps a visible `QUARANTINE` set for emergencies,
  but it is currently empty and new entries should be avoided in favor of fixing
  the test.

### 4. ESLint gate: correctness errors, pre-existing noise as warnings

A flat ESLint config (`typescript-eslint` + `eslint-plugin-react-hooks`) is
wired into `pnpm run check`. It must stay **green on current code** so it can
block *new* problems: `react-hooks/rules-of-hooks` and the serious
`js.recommended` rules are errors; pre-existing stylistic findings
(`prefer-const`, `no-case-declarations`, etc.) are warnings until burned down.

### 5. Frontend behavioral tests for pure modules via tsx (no jsdom/RTL yet)

`.test.ts` files run through the `tsx` loader and test genuinely pure,
Tauri-free modules (type-only imports), e.g. the script-widget sandbox CSP
(`buildCsp`) and schema validation. This buys real behavioral coverage without
standing up a jsdom + React Testing Library + Tauri-API-mock harness. That
heavier harness is deferred until component-level coverage is needed.

### 6. The AI command-safety classifier is documented as a heuristic, not a gate

`classify_command_safety` matches lowercase substrings and is trivially evaded;
its keyword sets are consolidated into named consts and a doc comment states it
is an advisory hint. The real safety boundary remains mandatory user approval
(ADR 0003).

## Consequences

**Positive**

- The two god-files are roughly halved and navigable by concern; new work lands
  in a focused submodule.
- CI now runs `cargo test`, so the 614 backend tests gate merges.
- The frontend gains a lint gate and its first runtime behavioral tests; adding
  a test is friction-free and can no longer be silently skipped.
- Two unsanitized `dangerouslySetInnerHTML` markdown paths (AI assistant output,
  manual) were closed with DOMPurify, matching the existing `NotesWidget`
  pattern.

**Negative / cost**

- `pub(crate)` surface widened slightly at the new seams (crate-internal only).
- The decomposition is partial: `ai.rs` and `storage.rs` still exceed a
  2,500-line target; finishing them is follow-up work.
- The `QUARANTINE` mechanism remains as an explicit escape hatch, but using it
  again would reintroduce manual follow-up work.

**Neutral**

- Source-grep tests that assert backend source text remain brittle by nature;
  the directory-module moves were validated to not break the active suite, but
  the long-term direction is to replace them with behavioral tests (item 5).

## When this might be revisited

- If `lib.rs` keeps growing, revisit the deferred full command move (item 2).
- When component-level frontend coverage is needed, stand up the jsdom/RTL
  harness so UI behavior can be tested directly (item 5).
