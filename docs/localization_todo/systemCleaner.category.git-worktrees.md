# systemCleaner.category.git-worktrees

- **English value**: `Git worktrees (agent folders)`
- **Namespace**: `systemCleaner`
- **File/component**: `src/modules/system-cleaner/SystemCleanerPage.tsx` (values come from `src-tauri/src/system_cleaner_recipes.rs`)
- **UI role**: `label`
- **User flow**: Name of a Cleanup category row in the System Cleaner Overview, shown with a Risky safety badge and never selected automatically.
- **Tone**: `concise/neutral, category name`
- **Placeholders**: `none`
- **Context/meaning**: "Worktree" is the Git feature: an additional checkout of one repository in its own folder. "Agent folders" narrows it to the coding-agent worktree roots this category targets, not every worktree on the computer.
- **Domain notes**: `Git` and `worktree` are Git terminology; keep `worktree` recognisable to Git users even where the locale has a native word for "working copy". Do not translate the literal folder names `.claude` and `.codex`.

<!--
Filename: systemCleaner.category.git-worktrees.md
Delete this file once every non-English locale under src/i18n/locales/ has the key translated.
-->
