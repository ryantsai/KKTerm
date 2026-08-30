# app.storePurchaseOpenFailed

- **English value**: `Could not open Microsoft Store: {{message}}`
- **Namespace**: `app`
- **File/component**: `src/app/StoreLicensePrompt.tsx`
- **UI role**: `error`
- **User flow**: Status Bar error shown if Windows cannot open the Store product listing from the expired-trial dialog.
- **Tone**: `concise/error`
- **Placeholders**: `{{message}}` — the opener error; it must survive unchanged in every locale.
- **Context/meaning**: Opening the external Microsoft Store listing failed; the license check itself did not necessarily fail.
- **Domain notes**: Microsoft Store is a product name.
