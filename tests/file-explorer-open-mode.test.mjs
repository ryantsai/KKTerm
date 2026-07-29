import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("File Explorer can open local files in the inline Document", async () => {
  const [typesSource, defaultsSource, storeSource, workspaceSource, settingsSource, fileViewerCss] =
    await Promise.all([
      readFile(new URL("../src/types.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/app-defaults.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/store.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../src/modules/workspace/connections/sftp/SftpWorkspace.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/modules/settings/FileExplorerSettings.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/modules/workspace/connections/file-viewer/file-viewer.css", import.meta.url),
        "utf8",
      ),
    ]);

  assert.match(
    typesSource,
    /export type FileExplorerOpenMode = "external" \| "inlineEditor";/,
    "the setting should use a narrow mode union",
  );
  assert.match(
    defaultsSource,
    /fileExplorerOpenMode: "external"/,
    "File Explorer should keep opening files externally by default",
  );
  assert.match(defaultsSource, /fileExplorerTerminalShell: defaultLocalShell\(\)/);
  assert.match(defaultsSource, /fileExplorerTerminalElevated: false/);
  assert.match(
    storeSource,
    /openFileViewerPath: \([\s\S]*?path: string,[\s\S]*?sourceConnection\?: Connection; ephemeral\?: boolean[\s\S]*?\) => void;/,
    "the store should expose a runtime-only path opener for inline Document tabs",
  );
  assert.match(
    typesSource,
    /export interface WorkspaceChildConnection[\s\S]*fileViewPath\?: string;/,
    "Document children opened from File Explorer should remember the local file path",
  );
  assert.match(
    storeSource,
    /openFileViewerPath: \(path, options\) => \{[\s\S]*type: "fileView"[\s\S]*kind: "fileViewer"/,
    "opening by path should create an inline Document tab without requiring a saved fileView Connection",
  );
  assert.match(
    storeSource,
    /sourceConnection\?\.type === "localFiles" &&[\s\S]*!options\?\.ephemeral &&[\s\S]*get\(\)\.generalSettings\.hideTopTabButtons[\s\S]*fileViewPath: filePath[\s\S]*childConnectionGroupParentId: sourceConnection\.id[\s\S]*maximizedPaneId: filePane\.id/,
    "when Child Connection Tabs are enabled, File Explorer inline Documents should be parented under the File Explorer child layout",
  );
  assert.match(
    storeSource,
    /openChildConnection: \(connection, child\) => \{[\s\S]*connection\.type === "localFiles"[\s\S]*openChildConnectionLayout\([\s\S]*maximizeChildConnectionPane/,
    "reopening a File Explorer child row should rebuild the parent child layout instead of spawning a standalone Document rail item",
  );
  assert.match(
    storeSource,
    /function connectionForChild\(connection: Connection, child: WorkspaceChildConnection\)[\s\S]*child\.fileViewPath\?\.trim\(\)[\s\S]*type: "fileView"/,
    "stored File Explorer Document children should reconstruct fileViewer panes from their saved file path",
  );
  assert.match(
    workspaceSource,
    /const sftpSettings = useWorkspaceStore\(\(state\) => state\.sftpSettings\);[\s\S]*const fileExplorerOpenMode = sftpSettings\.fileExplorerOpenMode;/,
    "File Explorer should read the persisted open mode",
  );
  assert.match(
    workspaceSource,
    /if \(isLocalFilesBrowser && fileExplorerOpenMode === "inlineEditor"\) \{[\s\S]*openFileViewerPath\(path, \{[\s\S]*sourceConnection: tab\.connection,[\s\S]*ephemeral: tab\.ephemeral,[\s\S]*\}\);[\s\S]*return;[\s\S]*\}[\s\S]*await openFilesystemPath\(path\);/,
    "local File Explorer files should route to Document only when inline mode is selected",
  );
  assert.match(
    settingsSource,
    /<legend>\{t\("settings\.fileExplorer"\)\}<\/legend>[\s\S]*settings\.fileExplorerOpenMode[\s\S]*settings\.fileExplorerOpenModeExternal[\s\S]*settings\.fileExplorerOpenModeInlineEditor/,
    "Workspace Settings should expose the File Explorer open-mode selector",
  );
  assert.match(settingsSource, /fileExplorerTerminalOptionsForPlatform\(\s*terminalSettings\.customShells/);
  assert.match(settingsSource, /settings\.fileExplorerTerminal/);
  assert.match(
    fileViewerCss,
    /\.file-viewer-workspace\s*\{[\s\S]*?display:\s*none;/,
    "inactive Document tabs should stay mounted but hidden like other Workspace surfaces",
  );
  assert.match(
    fileViewerCss,
    /\.file-viewer-workspace\.active\s*\{[\s\S]*?display:\s*flex;/,
    "the active Document tab should be the only visible Document surface",
  );
});
