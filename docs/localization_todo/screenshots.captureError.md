# screenshots.captureError

- **English value**: `Screenshot capture failed: {{message}}`
- **Namespace**: `screenshots`
- **File/component**: `src/modules/screenshots/ScreenshotsPage.tsx`
- **UI role**: `error`
- **User flow**: Status Bar error notice when a capture fails (not shown when the user cancels the picker).
- **Tone**: concise/neutral
- **Placeholders**: {{message}} — each {{…}} token must survive unchanged in every locale
- **Context/meaning**: {{message}} is an untranslated backend error string.
- **Domain notes**: "Screenshots" names the Activity Rail Module that captures and lists screen images; KKTerm, PNG, JPEG, DirectX, and key combinations like Ctrl+Alt+R stay English. Best-effort translations were added for all locales in the same change and still need a verified localization pass.
