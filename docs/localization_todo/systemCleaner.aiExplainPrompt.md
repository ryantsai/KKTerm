# systemCleaner.aiExplainPrompt

- **English value**: `Explain what {{name}} is, what it is normally used for, and whether uninstalling it is likely to affect Windows or other applications. Do not recommend uninstalling it unless the package details justify that advice.`
- **Namespace**: `systemCleaner`
- **File/component**: `src/modules/system-cleaner/SystemCleanerPage.tsx`
- **UI role**: `fragment`
- **User flow**: Submitted as the direct AI Assistant prompt after Explain with AI is selected.
- **Tone**: `cautious technical guidance`
- **Placeholders**: `{{name}}`
- **Context/meaning**: Requests identification and uninstall-impact guidance, not permission to uninstall.
- **Domain notes**: `Windows and AI Assistant stay product names.`
