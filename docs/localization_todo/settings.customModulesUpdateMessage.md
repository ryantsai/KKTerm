# settings.customModulesUpdateMessage

- **English value**: `Update {{name}} from {{currentVersion}} to {{version}} using the KKTerm-verified signed package?`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/CustomModulesSettings.tsx`
- **UI role**: `status`
- **User flow**: Confirmation body showing the exact installed and target versions.
- **Tone**: direct trust guidance
- **Placeholders**: `{{name}}`, `{{currentVersion}}`, `{{version}}`
- **Context/meaning**: Update is a package-version transition, not a catalog refresh.
- **Domain notes**: KKTerm-verified refers to the curated catalog signature chain.
