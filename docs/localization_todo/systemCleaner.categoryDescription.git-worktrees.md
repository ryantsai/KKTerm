# systemCleaner.categoryDescription.git-worktrees

- **English value**: `Working trees checked out by coding agents under your .claude and .codex worktree folders. These are not caches: they can hold uncommitted work, and each parent repository keeps a stale registration until you run git worktree prune.`
- **Namespace**: `systemCleaner`
- **File/component**: `src/modules/system-cleaner/SystemCleanerPage.tsx` (values come from `src-tauri/src/system_cleaner_recipes.rs`)
- **UI role**: `status`
- **User flow**: Plain-language description under the category name, warning that this category removes real work rather than rebuildable cache data.
- **Tone**: `cautionary, states the risk plainly without alarm`
- **Placeholders**: `none`
- **Context/meaning**: The warning sense matters more than the wording: the reader must understand these hold real, possibly unsaved work, and that a follow-up Git command is needed. Keep the "These are not caches" contrast, which distinguishes this row from every other Cleanup category.
- **Domain notes**: `git worktree prune` is a literal command and must stay exactly as written in every locale. `.claude` and `.codex` are literal folder names. "Uncommitted" is the Git sense: changes not yet recorded in a commit.

<!--
Filename: systemCleaner.categoryDescription.git-worktrees.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->
