# settings.importEncryptedStorePasswordHint

- **English value**: `These passwords are stored in the encrypted database. Enter its master password to unlock it on this machine, or set a new one if it is not configured yet.`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/SelectiveImportDialog.tsx`
- **UI role**: `fragment`
- **User flow**: Hint under the `settings.importEncryptedStorePassword` field in the backup Import dialog. Explains why a master password is being requested during import: the passwords in the bundle are destined for the encrypted database, which must be unlocked (or set up for the first time) on this machine before they can be written.
- **Tone**: short setup guidance, one sentence pair
- **Placeholders**: none
- **Context/meaning**: Covers both cases with one string — unlocking an existing encrypted store and creating one on a fresh machine. "It" refers to the encrypted database.
- **Domain notes**: "Encrypted database" is KKTerm's encrypted SQLite secret store (the credential backend). Keep it consistent with `settings.credentialStorageFilePortable` and related encrypted-store strings.
