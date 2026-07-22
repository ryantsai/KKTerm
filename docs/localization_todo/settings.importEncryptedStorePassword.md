# settings.importEncryptedStorePassword

- **English value**: `Encrypted database master password`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/SelectiveImportDialog.tsx`
- **UI role**: `label`
- **User flow**: Shown in the backup Import dialog when the chosen `.kkbackup` carries passwords that will land in the encrypted database and that store is not yet set up or unlocked on this machine. The user types this machine's encrypted-database master password so the imported passwords can be written into it.
- **Tone**: concise/neutral form-field label
- **Placeholders**: none
- **Context/meaning**: The master password that unlocks (or, on first setup, creates) KKTerm's local encrypted SQLite secret store. Distinct from `settings.importPassphrase`, which is the passphrase that decrypts the exported bundle. Do not merge with that key.
- **Domain notes**: "Encrypted database" is KKTerm's encrypted SQLite secret store (the credential backend), not the main SQLite settings database. "Master password" is the single password guarding that store.
