# `notes.search.matchCount`

English: `{{position}} of {{total}}`

- **Namespace**: `notes` (Connection notes: the pane-toolbar post-it affordance and the rich-text note editor)
- **UI role**: status
- **User flow**: Shows which match is selected out of how many, e.g. "3 of 12".
- **Placeholders**: `{{position}}`, `{{total}}` — each token must survive verbatim in every locale
- **Domain notes**: "Connection" is the durable stored resource and "Workspace" is the named container of Connections (see `CONTEXT.md`); translate both with the terms already used for those concepts in this locale. A "note" here is one rich-text note bound to a single Connection, not the Notes Dashboard widget sticky note.

Best-effort translations exist in the locale files; keep this pending file until a
verified localization pass completes per `docs/localization_todo/README.md`.
