import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Workspace empty state offers every supported Connection creation flow", async () => {
  const [canvasSource, menuSource, sidebarSource, enLocaleSource] = await Promise.all([
    readFile(new URL("../src/modules/workspace/WorkspaceCanvas.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/modules/workspace/connections/connectionCreationOptions.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/i18n/locales/en.json", import.meta.url), "utf8"),
  ]);
  const enLocale = JSON.parse(enLocaleSource);
  const expectedTypes = [
    "local",
    "ssh",
    "telnet",
    "serial",
    "url",
    "rdp",
    "vnc",
    "ftp",
    "localFiles",
    "fileView",
  ];
  const optionBlock = menuSource.match(
    /export const CONNECTION_CREATION_OPTIONS = \[(?<options>[\s\S]*?)\] as const/,
  )?.groups?.options;
  const actualTypes = [...(optionBlock ?? "").matchAll(/type: "([^"]+)"/g)].map(
    ([, type]) => type,
  );

  assert.deepEqual(actualTypes, expectedTypes, "creation options should cover the ConnectionType union");
  assert.match(
    canvasSource,
    /connectionCreationOptions\(macAppStoreBuild\)\.map\(\(\{ labelKey, type \}\) =>[\s\S]*requestNewConnection\(type, \{ openAfterCreate: true \}\)/,
    "the empty state should render each Store-filtered shared option as a direct creation action",
  );
  assert.match(
    sidebarSource,
    /NEW_CONNECTION_REQUEST_EVENT[\s\S]*handleNewConnectionTypeSelected\(connectionType\)/,
    "empty-state actions should reuse the sidebar's existing add-flow handler",
  );
  assert.equal(
    enLocale.workspace.openFromTree,
    "Open a Connection from the tree, or create a new Connection:",
  );
});
