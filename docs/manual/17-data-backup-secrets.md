# 17 — Data, Backup, and Secrets

## AI grep hints

- Keys: `settings.exportSettings`, `settings.importSettings`, `settings.importBackupFileHint`, `settings.fullBackupImport`, `settings.includeCredentials`, `settings.includeCredentialsWarning`, `settings.importActionAdd`, `settings.importActionReplace`, `settings.segment_workspacesConnections`, `settings.segment_dashboards`, `settings.segment_itops`, `settings.segment_assistant`, `settings.segment_settings`, `settings.resetAllSettings`, `settings.resetAllSettingsConfirm`, `settings.resetAllSettingsComplete`, `settings.sectionCredentials`, `settings.credentialStorage`, `settings.credentialStorageFilePortable`, `settings.portableCredentialStorageOsWarning`, `settings.credentialsStored`, `settings.deleteCredential`
- Topics: SQLite store, OS keychain, encrypted SQLite secret store, settings Import/Export `.kkbackup`, startup backup ZIP snapshots, import / restore, reset all, where my data lives
- Synonyms: "where is my data", "back up settings", "restore", "factory reset", "uninstall", "API key storage", "export connections without passwords", "share connections", "selective backup"

## Storage model

KKTerm is local-first. Two distinct store families:

1. **SQLite** — non-secret durable data. Lives on the user's machine, never sent off-device. Holds Connections, Dashboard Views and Widget Instances, Custom Widgets, Settings rows, and assistant chat history.
2. **Credential backend** — secrets. Holds Connection passwords, URL credentials, AI provider API keys, email API keys / SMTP passwords, widget secrets, MCP server secrets. Windows and macOS default to the OS keystore and may optionally use the encrypted SQLite store. Linux uses the encrypted SQLite store only.

Terminal contents are **not** logged by default. There is no telemetry and no cloud sync.

On Windows, installed mode stores SQLite under `%APPDATA%\com.kkterm.app` and uses Tauri's profile/cache locations. Portable mode stores KKTerm-owned mutable state under `data` beside `KKTerm.exe`, including SQLite, cache, logs, WebView2 data, backgrounds, fonts, diagnostics, recordings, and the live MCP bridge descriptor. The portable folder is therefore the backup unit for KKTerm-owned state. Quit KKTerm using the tray Exit action before copying the folder or removing its drive so SQLite can checkpoint its WAL. Network and cloud-synchronized roots are unsupported.

Portable mode defaults a new database to `settings.credentialStorageFilePortable`, but its first-run setup is skippable. The encrypted rows travel with SQLite; the master password does not. Non-secret Connection metadata, usernames, notes, inventory, and Settings remain plaintext SQLite. Choosing the OS backend is still allowed and shows `settings.portableCredentialStorageOsWarning`, because those secrets remain bound to the current Windows user and machine. Never put `KKTERM_SECRET_STORE_PASSWORD` in a launcher script beside the portable executable.

Do **not** put live session state (open Tabs, focused Pane, in-flight Sessions) into the SQLite Connection model. Live state belongs to the frontend workspace layer.

## Export `.kkbackup`

`settings.exportSettings` opens the category-aware export dialog and produces a `.kkbackup` bundle (a ZIP holding `manifest.json`, `data.json`, and an optional `secrets.enc`). The dialog offers five UI groups: `settings.segment_workspacesConnections` maps to the existing `workspaces` and `connections` segments; `settings.segment_dashboards` maps to `dashboards`; `settings.segment_itops` maps to `itops` (Sites, Server Rooms, Racks, Hosts, Tasks, Automations, and run history); `settings.segment_assistant` maps to `assistant` (AI Assistant chat history and memories); and `settings.segment_settings` maps to `settings` and `mcpServers`. The bundle manifest and `data.json` retain those individual segment names for forward/backward compatibility. Import shows only groups represented in the selected bundle and applies one chosen action to every present segment in a group, including when an older bundle contains only one of the now-grouped segments. Machine-local state — the encrypted secret store rows, AI coding usage accounts/snapshots, and Install Helper tool state — is never part of a selective bundle; the full ZIP snapshot still carries it.

## Automatic backup snapshots

Full database snapshot backups may run at:

- App startup (configured).

Automatic backups must **not** run from app-window close.

## Import / restore

`settings.importSettings` opens the backup import dialog. A chosen `.kkbackup` is inspected before applying anything; a chosen full `.zip` backup restores the complete settings database and reloads the app.

Installed-to-portable and portable-to-installed migration use this same export/import flow; neither mode reads the other mode's database directly. Extracting a newer portable release over the program folder does not migrate or overwrite data because release ZIPs never contain `data`.

## Selective export / import

The Settings data Export button is the selective `.kkbackup` flow; the Settings data Import button accepts both selective `.kkbackup` files and full KKTerm settings backup `.zip` snapshots. The old separate whole-database single-file import/export buttons are no longer shown.

By default the bundle carries **no passwords**, which is the safe way to share Connections with a colleague. Turning on `settings.includeCredentials` (only available when Connections is selected) requires a passphrase; Connection passwords, SSH key passphrases, URL form-data passwords, and SOCKS proxy passwords are then encrypted into `secrets.enc` (Argon2id + AES-256-GCM) and can only be imported by someone who knows the passphrase (`settings.includeCredentialsWarning`). Other secrets — widget secrets, AI/email/MCP keys, and IT Ops Task vault entries — are **not** carried. Imported IT Ops Tasks that used vault-backed steps require those credentials to be entered again.

On import, KKTerm lets the user choose an action per segment present: `settings.importActionSkip`, `settings.importActionAdd` (keep existing items and add the imported ones with fresh ids), or `settings.importActionReplace` (clear that category first). Replacing Workspaces is paired with replacing Connections so saved Connections are not left pointing at deleted Workspace ids. A safety database backup runs before any change (`settings.selectiveImportWarning`). Imported Dashboard, IT Ops, and AI Assistant data refreshes its live UI state immediately; imported Automations are reconciled with the live Watchdog runtime. Importing the Settings segment reloads the app to re-read preferences. See [docs/ADR/0010-selective-export-import.md](../ADR/0010-selective-export-import.md) for the merge and secret-handling decisions.

## Reset all settings

`settings.resetAllSettings` returns settings to defaults, closes open Sessions, resets saved layouts, clears the saved language override, and removes saved AI/email secrets from the active credential backend. Confirmation `settings.resetAllSettingsConfirm`. Status `settings.resetAllSettingsComplete`. Other stored credentials must be removed individually from Settings → Credentials, or by the user through the selected external backend where applicable.

## Managing credential entries from inside KKTerm

Settings → Credentials (`settings.sectionCredentials`) lists every credential KKTerm has stored, grouped by kind:

- `settings.savedCredentials` — reusable SSH / RDP / VNC / Telnet / FTP password bundles that Connections link to. Rows support rename/password Edit, a usage dialog listing and bulk-linking Connections, same-type duplicate Merge, Convert of per-Connection passwords, and Delete (usage-aware confirmation `settings.savedCredentialDeleteUsed`). Legacy single-Connection passwords appear separately under `settings.perConnectionPasswords` with a Convert action that moves them into a Saved Credential.
- `settings.credentialKindUrlPassword` — saved URL Connection passwords and captured non-secret input data. These records use the same one-row Edit/Delete controls and compact editor as Settings → URL.
- `settings.credentialKindAiApiKey` — AI provider keys (stored under `AI_PROVIDER_SECRET_OWNER_ID`).
- `settings.credentialKindEmailApiKey` / `settings.credentialKindEmailSmtpPassword` — Email tool credentials.
- `settings.credentialKindWidgetSecret` — Dashboard Widget Instance secrets.

The secret storage selector (`settings.credentialStorage`) controls which backend KKTerm reads and writes from. Switching stores does not copy existing entries between backends; save a credential again if it should exist in the newly selected store. OS keystore storage relies on the operating system credential manager and signed-in account. The encrypted SQLite backend is cross-platform and unlocks with a master password or the `KKTERM_SECRET_STORE_PASSWORD` launch environment variable, but the user is responsible for protecting the database file, backups, and master password. After setup, KKTerm defers encrypted database unlock on later launches until a feature needs to read or write a saved secret or the user activates the Status Bar `app.credentialStoreUnlockAction`; `app.credentialStoreLockAction` locks it again for the current app run. Settings can change the master password with `settings.encryptedSecretStoreChangePasswordAction`; KKTerm verifies the current password and atomically re-encrypts all encrypted credential rows so their secret values remain available. Secret-writing Connection flows pause before changing durable Connection data, open the unlock dialog, and resume automatically after a successful unlock; canceling leaves the original form and Connection data unchanged. If the master password cannot decrypt the existing store, creating a new master password clears the encrypted credential rows saved with the previous password. General credential rows show their owner details with a red icon-only trash button (`settings.deleteCredential`, confirmation `settings.deleteCredentialConfirmBody`). Website records additionally provide the same Edit action used in Settings → URL. Their editor reads the selected record's primary password from the credential backend and keeps it masked unless the user activates its eye control. Captured non-password inputs remain in SQLite; locking one persists only a masked editor presentation and does not encrypt or relocate its value.

## Uninstall behaviour

Uninstalling KKTerm removes the executable. The SQLite database and credential backend entries persist unless the user deletes them explicitly. Reinstalling reuses the same SQLite database file from the same user profile location.

Portable mode has no uninstaller. Deleting its folder removes its KKTerm-owned data, but machine-owned effects from explicit integrations remain: OS-keychain entries, external MCP client configuration, Install Helper tools, managed web apps, and Windows services are not removed with the folder.

## What is _not_ stored

- Live terminal scrollback (only in-memory until `terminal.saveBuffer` writes it to disk).
- WebView2 cookies and local storage are owned by the system WebView2 user-data folder, which is currently shared across all URL Connections (the `dataPartition` field is persisted but a no-op in Phase 1 — see [08-url-webview.md](08-url-webview.md)).
- Network traffic — KKTerm is a thin frontend on top of OS-level SSH, RDP, VNC, and HTTP stacks.
