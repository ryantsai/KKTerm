# screenshots.editor.copyCursorPosition

- **English value**: `Copy cursor position`
- **Namespace**: `screenshots`
- **File/component**: `src/modules/screenshots/ScreenshotEditor.tsx`
- **UI role**: tooltip
- **User flow**: Hover tooltip and accessible description for the coordinate readout at the bottom right of the unified screenshot editor footer. Clicking that readout copies the current `x, y` pair to the clipboard.
- **Tone**: Short imperative action label.
- **Placeholders**: none
- **Context/meaning**: "Copy" means place on the system clipboard, not duplicate an annotation (that sense is `screenshots.editor.copyElement`). "Cursor position" is the pointer's coordinate over the image, expressed in 1x image pixels from the image's top-left corner — not a text-insertion caret and not the mouse pointer graphic itself.
- **Domain notes**: The value copied is plain digits (`640, 360`), so nothing in this label is interpolated. Reuse each locale's existing word for the mouse cursor from `settings.screenshotsIncludeCursor`. Best-effort translations are included in all locales; retain this record for an intentional localization review. See [[screenshots.editor.cursorPosition]] and [[screenshots.editor.cursorPositionCopied]].
