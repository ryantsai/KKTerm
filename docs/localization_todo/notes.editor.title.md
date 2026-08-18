# `notes.editor.title`

English: `Note — {{name}}`

- **Namespace**: `notes` (Connection notes: the pane-toolbar post-it affordance and the rich-text note editor)
- **UI role**: heading
- **User flow**: Title of the note editor dialog; {{name}} is the Connection name.
- **Placeholders**: `{{name}}` — each token must survive verbatim in every locale
- **Domain notes**: "Connection" is the durable stored resource and "Workspace" is the named container of Connections (see `CONTEXT.md`); translate both with the terms already used for those concepts in this locale. A "note" here is one rich-text note bound to a single Connection, not the Notes Dashboard widget sticky note.

Best-effort translations exist in the locale files; keep this pending file until a
verified localization pass completes per `docs/localization_todo/README.md`.
