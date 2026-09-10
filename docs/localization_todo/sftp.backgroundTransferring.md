# sftp.backgroundTransferring

- **English value**: `File transfers for {{host}} are running in the background; reopen the file browser to view progress.`
- **Namespace**: `sftp`
- **File/component**: `src/modules/workspace/connections/sftp/SftpWorkspace.tsx`, `src/modules/workspace/connections/terminal/SftpToolbarPopup.tsx`
- **UI role**: tooltip
- **User flow**: The originating terminal folder icon pulses after the browser is minimized with pending transfers. This tooltip explains that work continues and the icon restores the browser.
- **Tone**: Concise, neutral guidance.
- **Placeholders**: `{{host}}` is the Connection display name; preserve it unchanged in every locale.
- **Context/meaning**: The originating terminal folder icon pulses after the browser is minimized with pending transfers. This tooltip explains that work continues and the icon restores the browser.
- **Domain notes**: SFTP is a file-browser Session launched from an SSH Connection. The same popup can use FTP/FTPS. Best-effort translations are included in all locales; retain this record for an intentional localization review.
