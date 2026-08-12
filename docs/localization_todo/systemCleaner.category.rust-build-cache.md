# systemCleaner.category.rust-build-cache

- **English value**: `Rust build and toolchain caches`
- **Namespace**: `systemCleaner`
- **File/component**: `src/modules/system-cleaner/SystemCleanerPage.tsx` (values come from `src-tauri/src/system_cleaner_recipes.rs`)
- **UI role**: `label`
- **User flow**: Name of a Cleanup category row in the System Cleaner Overview, shown with a Review safety badge.
- **Tone**: `concise/neutral, category name`
- **Placeholders**: `none`
- **Context/meaning**: Names the rebuildable Rust compile inputs on disk. "Build" here means compiling a project, not a released build artifact of KKTerm.
- **Domain notes**: `Rust`, `Cargo`, `rustup`, `sccache`, and `crate` are tool and ecosystem names that stay in English. "Toolchain" is the rustup sense: a pinned compiler plus its components.

<!--
Filename: systemCleaner.category.rust-build-cache.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->
