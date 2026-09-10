# sftp.backgroundFailed

- **English value**: `A file transfer for {{host}} failed; reopen the file browser to review the results.`
- **Namespace**: `sftp`
- **File/component**: `src/modules/workspace/connections/sftp/SftpWorkspace.tsx`, `src/modules/workspace/connections/terminal/SftpToolbarPopup.tsx`
- **UI role**: error
- **User flow**: A background file transfer failed. The Status Bar error notice points to the retained browser transfer history for details.
- **Tone**: Concise, neutral guidance.
- **Placeholders**: `{{host}}` is the Connection display name; preserve it unchanged in every locale.
- **Context/meaning**: A background file transfer failed. The Status Bar error notice points to the retained browser transfer history for details.
- **Domain notes**: SFTP is a file-browser Session launched from an SSH Connection. The same popup can use FTP/FTPS. Best-effort translations are included in all locales; retain this record for an intentional localization review.
