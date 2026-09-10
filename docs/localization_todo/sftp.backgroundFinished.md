# sftp.backgroundFinished

- **English value**: `File transfers for {{host}} have finished; reopen the file browser to review the results.`
- **Namespace**: `sftp`
- **File/component**: `src/modules/workspace/connections/sftp/SftpWorkspace.tsx`, `src/modules/workspace/connections/terminal/SftpToolbarPopup.tsx`
- **UI role**: status
- **User flow**: The background transfer queue has drained. Finished includes canceled or skipped work; this is not a guarantee that every file was copied successfully.
- **Tone**: Concise, neutral guidance.
- **Placeholders**: `{{host}}` is the Connection display name; preserve it unchanged in every locale.
- **Context/meaning**: The background transfer queue has drained. Finished includes canceled or skipped work; this is not a guarantee that every file was copied successfully.
- **Domain notes**: SFTP is a file-browser Session launched from an SSH Connection. The same popup can use FTP/FTPS. Best-effort translations are included in all locales; retain this record for an intentional localization review.
