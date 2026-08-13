# settings.customModulesInstallVerifiedMessage

- **English value**: `Install {{name}} from {{publisher}}? KKTerm verified this signed catalog package.`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/CustomModulesSettings.tsx`
- **UI role**: `status`
- **User flow**: Confirmation body before installing a curated signed package.
- **Tone**: direct trust guidance
- **Placeholders**: `{{name}}`, `{{publisher}}`
- **Context/meaning**: Verified means signature, hash, identity, permissions, and license metadata passed KKTerm checks.
- **Domain notes**: Do not reuse the warning for unverified local packages.
