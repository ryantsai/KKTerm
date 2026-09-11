# screenshots.editor.cursorPositionCopied

- **English value**: `Cursor position copied to clipboard.`
- **Namespace**: `screenshots`
- **File/component**: `src/modules/screenshots/ScreenshotEditor.tsx`
- **UI role**: status
- **User flow**: Status Bar success notice shown after clicking the coordinate readout in the unified screenshot editor footer, which copies the current `x, y` pair to the clipboard.
- **Tone**: Short past-tense confirmation, matching `screenshots.copied`.
- **Placeholders**: none
- **Context/meaning**: Confirms a clipboard write of the pointer's image coordinates, not a copy of the screenshot image itself (that confirmation is `screenshots.copied`). "Cursor position" is the pointer's coordinate over the image, in 1x image pixels from the image's top-left corner.
- **Domain notes**: Mirror the clipboard wording each locale already uses in `screenshots.copied`, and the cursor wording from `settings.screenshotsIncludeCursor`. Best-effort translations are included in all locales; retain this record for an intentional localization review. See [[screenshots.editor.copyCursorPosition]].
