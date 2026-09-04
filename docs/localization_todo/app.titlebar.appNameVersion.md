# app.titlebar.appNameVersion

- **English value**: `KKTerm v{{version}}`
- **Namespace**: `app`
- **File/component**: `src/app/TitleBar.tsx`
- **UI role**: `label`
- **User flow**: Hovering the title-bar icon or app name reveals the full title with the installed app version. Assistive technology can read the full title at all times.
- **Tone**: Concise product name and technical version.
- **Placeholders**: `{{version}}` is the installed app version, such as `3000.0.9`, and must survive unchanged in every locale.
- **Context/meaning**: The complete main-window title; the `v` prefix denotes a software version.
- **Domain notes**: KKTerm is the product name and stays unchanged in every locale. Keep the title as one string so locale-specific order is supported. Locale values are populated; this record remains pending localization review.
