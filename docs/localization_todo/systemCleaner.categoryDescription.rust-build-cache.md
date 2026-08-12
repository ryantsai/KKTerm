# systemCleaner.categoryDescription.rust-build-cache

- **English value**: `Extracted crate sources, rustup downloads, and the sccache compiler cache. Cargo re-extracts and rustup re-downloads whatever your next build needs.`
- **Namespace**: `systemCleaner`
- **File/component**: `src/modules/system-cleaner/SystemCleanerPage.tsx` (values come from `src-tauri/src/system_cleaner_recipes.rs`)
- **UI role**: `status`
- **User flow**: Plain-language description under the category name, explaining what the category removes and what the cost of removing it is.
- **Tone**: `reassuring, explains the consequence in one sentence`
- **Placeholders**: `none`
- **Context/meaning**: Reassures the reader that removing these costs build time rather than data. Keep the two-sentence structure: what it is, then what happens after deletion.
- **Domain notes**: `crate`, `Cargo`, `rustup`, and `sccache` stay in English. "Extracted" refers to unpacked archives; "re-extracts" means Cargo unpacks them again automatically.

<!--
Filename: systemCleaner.categoryDescription.rust-build-cache.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->
