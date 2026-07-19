# screenshots.deleteMessage

- **English value**: `"{{name}}" will be permanently deleted.`
- **Namespace**: `screenshots`
- **File/component**: `src/modules/screenshots/ScreenshotsPage.tsx`
- **UI role**: `fragment`
- **User flow**: Confirmation dialog body before deleting one screenshot.
- **Tone**: concise/neutral
- **Placeholders**: {{name}} — each {{…}} token must survive unchanged in every locale
- **Context/meaning**: {{name}} is the screenshot file name; deletion is permanent.
- **Domain notes**: "Screenshots" names the Activity Rail Module that captures and lists screen images; KKTerm, PNG, JPEG, DirectX, and key combinations like Ctrl+Alt+R stay English. Best-effort translations were added for all locales in the same change and still need a verified localization pass.
