# settings.exaSearchApiKey

- **English value**: `Exa API key (optional, higher limits)`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/AiSettings.tsx`
- **UI role**: `label`
- **User flow**: The user sees this password field after selecting Exa and may enter their own key to use higher account limits.
- **Tone**: concise setup guidance
- **Placeholders**: none
- **Context/meaning**: The credential is optional because anonymous Exa MCP search remains available; entering a key changes the request to the user's Exa account limits.
- **Domain notes**: Exa, API, and MCP are technical proper names and should remain unchanged. The value is stored in the configured secret store, never SQLite settings.
