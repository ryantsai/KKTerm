!define KKTERM_DOCUMENT_PROGID "KKTerm.Document"

; Keep KKTerm available as an explicit Open with choice without changing the
; extension's default ProgID or Windows' per-user UserChoice. Tauri's built-in
; bundle.fileAssociations macro writes the default extension value, so it is
; intentionally not used here.

!macro KKTERM_REGISTER_OPEN_WITH EXT
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${KKTERM_DOCUMENT_PROGID}" ""
!macroend

!macro KKTERM_UNREGISTER_OPEN_WITH EXT
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${KKTERM_DOCUMENT_PROGID}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}\OpenWithProgids"
!macroend

!macro KKTERM_FOR_EACH_SUPPORTED_EXTENSION ACTION
  !insertmacro ${ACTION} "png"
  !insertmacro ${ACTION} "jpg"
  !insertmacro ${ACTION} "jpeg"
  !insertmacro ${ACTION} "gif"
  !insertmacro ${ACTION} "webp"
  !insertmacro ${ACTION} "bmp"
  !insertmacro ${ACTION} "ico"
  !insertmacro ${ACTION} "avif"
  !insertmacro ${ACTION} "svg"
  !insertmacro ${ACTION} "md"
  !insertmacro ${ACTION} "markdown"
  !insertmacro ${ACTION} "mdown"
  !insertmacro ${ACTION} "mkd"
  !insertmacro ${ACTION} "mdx"
  !insertmacro ${ACTION} "csv"
  !insertmacro ${ACTION} "tsv"
  !insertmacro ${ACTION} "json"
  !insertmacro ${ACTION} "json5"
  !insertmacro ${ACTION} "geojson"
  !insertmacro ${ACTION} "ipynb"
  !insertmacro ${ACTION} "webmanifest"
  !insertmacro ${ACTION} "log"
  !insertmacro ${ACTION} "ndjson"
  !insertmacro ${ACTION} "jsonl"
  !insertmacro ${ACTION} "txt"
  !insertmacro ${ACTION} "text"
  !insertmacro ${ACTION} "yaml"
  !insertmacro ${ACTION} "yml"
  !insertmacro ${ACTION} "toml"
  !insertmacro ${ACTION} "ini"
  !insertmacro ${ACTION} "conf"
  !insertmacro ${ACTION} "cfg"
  !insertmacro ${ACTION} "env"
  !insertmacro ${ACTION} "properties"
  !insertmacro ${ACTION} "xml"
  !insertmacro ${ACTION} "html"
  !insertmacro ${ACTION} "htm"
  !insertmacro ${ACTION} "css"
  !insertmacro ${ACTION} "scss"
  !insertmacro ${ACTION} "less"
  !insertmacro ${ACTION} "js"
  !insertmacro ${ACTION} "mjs"
  !insertmacro ${ACTION} "cjs"
  !insertmacro ${ACTION} "jsx"
  !insertmacro ${ACTION} "ts"
  !insertmacro ${ACTION} "tsx"
  !insertmacro ${ACTION} "py"
  !insertmacro ${ACTION} "rb"
  !insertmacro ${ACTION} "rs"
  !insertmacro ${ACTION} "go"
  !insertmacro ${ACTION} "java"
  !insertmacro ${ACTION} "c"
  !insertmacro ${ACTION} "h"
  !insertmacro ${ACTION} "cpp"
  !insertmacro ${ACTION} "hpp"
  !insertmacro ${ACTION} "cs"
  !insertmacro ${ACTION} "php"
  !insertmacro ${ACTION} "sh"
  !insertmacro ${ACTION} "bash"
  !insertmacro ${ACTION} "zsh"
  !insertmacro ${ACTION} "ps1"
  !insertmacro ${ACTION} "bat"
  !insertmacro ${ACTION} "cmd"
  !insertmacro ${ACTION} "sql"
  !insertmacro ${ACTION} "diff"
  !insertmacro ${ACTION} "patch"
  !insertmacro ${ACTION} "pdf"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr SHCTX "Software\Classes\${KKTERM_DOCUMENT_PROGID}" "" "KKTerm Document"
  WriteRegStr SHCTX "Software\Classes\${KKTERM_DOCUMENT_PROGID}" "FriendlyTypeName" "KKTerm Document"
  WriteRegStr SHCTX "Software\Classes\${KKTERM_DOCUMENT_PROGID}" "AllowSilentDefaultTakeOver" ""
  WriteRegStr SHCTX "Software\Classes\${KKTERM_DOCUMENT_PROGID}\Application" "ApplicationName" "KKTerm"
  WriteRegStr SHCTX "Software\Classes\${KKTERM_DOCUMENT_PROGID}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\${KKTERM_DOCUMENT_PROGID}\shell\open" "" "Open with KKTerm"
  WriteRegStr SHCTX "Software\Classes\${KKTERM_DOCUMENT_PROGID}\shell\open\command" "" '$"$INSTDIR\${MAINBINARYNAME}.exe$" $"%1$"'

  !insertmacro KKTERM_FOR_EACH_SUPPORTED_EXTENSION KKTERM_REGISTER_OPEN_WITH
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro KKTERM_FOR_EACH_SUPPORTED_EXTENSION KKTERM_UNREGISTER_OPEN_WITH
  DeleteRegKey SHCTX "Software\Classes\${KKTERM_DOCUMENT_PROGID}"
  !insertmacro UPDATEFILEASSOC

  ; When the user selected "Delete app data", move the automatic database
  ; backup folder out of the app-data directory before the uninstaller wipes
  ; it, so a mistaken choice does not destroy the periodic backup history.
  ; The backups land in %APPDATA%\KKTerm\backups (a folder the uninstaller
  ; never touches) and the user is told where they went.
  ${If} $DeleteAppDataCheckboxState = 1
    IfFileExists "$APPDATA\${BUNDLEID}\backups\*.*" 0 kkterm_retain_backups_done
    CreateDirectory "$APPDATA\KKTerm"
    StrCpy $R0 "$APPDATA\KKTerm\backups"
    StrCpy $R1 2
    kkterm_retain_backups_pick_name:
      IfFileExists "$R0\*.*" 0 kkterm_retain_backups_move
      StrCpy $R0 "$APPDATA\KKTerm\backups-$R1"
      IntOp $R1 $R1 + 1
      Goto kkterm_retain_backups_pick_name
    kkterm_retain_backups_move:
      Rename "$APPDATA\${BUNDLEID}\backups" "$R0"
      IfErrors kkterm_retain_backups_done
      MessageBox MB_ICONINFORMATION|MB_OK "KKTerm preserved your automatic database backups so you can recover them later. They are saved here:$\n$\n$R0"
    kkterm_retain_backups_done:
  ${EndIf}
!macroend
