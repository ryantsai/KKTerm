# screenshots.editor.cursorPosition

- **English value**: `X {{x}}, Y {{y}}`
- **Namespace**: `screenshots`
- **File/component**: `src/modules/screenshots/ScreenshotEditor.tsx`
- **UI role**: status
- **User flow**: Sits at the bottom right of the unified screenshot editor's footer and reports where the pointer currently is over the image. It appears while the pointer is over the image and disappears when the pointer leaves it.
- **Tone**: Compact numeric readout, no sentence punctuation.
- **Placeholders**: `{{x}}` and `{{y}}` are integer image pixel coordinates. Both must survive verbatim; translators may reorder the axis pairs but must keep each number next to its own axis label.
- **Context/meaning**: `X` and `Y` are the horizontal and vertical image axes, as in any image editor's coordinate readout — not a letter grade, a close/cancel mark, or a multiplication sign. The origin `0, 0` is the top-left of the image currently open in the editor, and the numbers are always 1x image pixels regardless of the editor's zoom level.
- **Domain notes**: The axis labels `X`/`Y` are mathematical symbols and normally stay as `X`/`Y` in every locale; localize only the separator or spacing if the locale requires it. Best-effort locale-invariant values are already present in all locales; retain this record until a localization pass confirms each locale's spacing and separator conventions.
