# settings.rdpOpenInFullscreenHint

- **English value**: `Open new RDP sessions in fullscreen. Exit fullscreen to return to the workspace.`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/RdpSettings.tsx`; `src/modules/workspace/connections/connection-dialog/RdpConnectionFields.tsx`
- **UI role**: `tooltip`
- **User flow**: Users see this switch below Remote Resolution in global RDP Display settings or in the RDP Connection editor before Advanced options.
- **Tone**: Concise, neutral setting guidance
- **Placeholders**: none
- **Context/meaning**: Explains automatic fullscreen for new RDP Sessions and that leaving fullscreen returns to the existing Workspace.
- **Domain notes**: RDP stays English. Session is live remote-desktop runtime state; Workspace is the existing KKTerm workspace. Inherited Connection options follow global Settings; customized legacy Connections stay off. Best-effort translations are included in all locales and remain pending intentional localization review. zh-TW must use Taiwan terminology, including 連線, 全螢幕, and 工作區.
