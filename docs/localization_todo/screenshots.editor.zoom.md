# screenshots.editor.zoom

- **English value**: `Zoom`
- **Namespace**: `screenshots`
- **File/component**: `src/modules/screenshots/ScreenshotEditor.tsx`
- **UI role**: label
- **User flow**: Label of the zoom submenu in the unified screenshot editor's right-click menu. The submenu holds Zoom in, Zoom out, Fit, and the fixed 25–200% levels, with a check mark on the active level.
- **Tone**: Single-word menu label.
- **Placeholders**: none
- **Context/meaning**: The magnification of the displayed image — the same sense as `sftp.zoom` and `itops.floorPlan.zoomLabel`. Not a camera lens action and not the zoom of the app window or UI scale.
- **Domain notes**: Each locale's value is taken from that same locale's existing `sftp.zoom`, which is the identical control in another Module, so no locale was translated from a sibling language. The percentage entries beside it (`25%`…`200%`) are numeric and are not translated. Retain this record until a localization pass confirms the menu reads correctly in context.
