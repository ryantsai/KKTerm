# sftp.backgroundAttention

- **English value**: `File transfers for {{host}} need attention; reopen the file browser to continue.`
- **Namespace**: `sftp`
- **File/component**: `src/modules/workspace/connections/sftp/SftpWorkspace.tsx`, `src/modules/workspace/connections/terminal/SftpToolbarPopup.tsx`
- **UI role**: status / tooltip
- **User flow**: A background transfer is waiting for an overwrite decision or another dialog. The Status Bar notice and terminal icon tooltip invite the user to restore the browser and respond.
- **Tone**: Concise, neutral guidance.
- **Placeholders**: `{{host}}` is the Connection display name; preserve it unchanged in every locale.
- **Context/meaning**: A background transfer is waiting for an overwrite decision or another dialog. The Status Bar notice and terminal icon tooltip invite the user to restore the browser and respond.
- **Domain notes**: SFTP is a file-browser Session launched from an SSH Connection. The same popup can use FTP/FTPS. Best-effort translations are included in all locales; retain this record for an intentional localization review.
