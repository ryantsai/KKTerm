# settings.rdpOpenInFullscreen

- **English value**: `Open in fullscreen`
- **Namespace**: `settings`
- **File/component**: `src/modules/settings/RdpSettings.tsx`; `src/modules/workspace/connections/connection-dialog/RdpConnectionFields.tsx`
- **UI role**: `label`
- **User flow**: Users see this switch below Remote Resolution in global RDP Display settings or in the RDP Connection editor before Advanced options.
- **Tone**: Concise, neutral setting guidance
- **Placeholders**: none
- **Context/meaning**: A default-off startup preference for opening a newly connected RDP Session in fullscreen, separate from viewer scaling.
- **Domain notes**: RDP stays English. Session is live remote-desktop runtime state; Workspace is the existing KKTerm workspace. Inherited Connection options follow global Settings; customized legacy Connections stay off. Best-effort translations are included in all locales and remain pending intentional localization review. zh-TW must use Taiwan terminology, including 連線, 全螢幕, and 工作區.
