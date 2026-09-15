import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildFileViewConnectionDraftFromPath } from "../src/modules/workspace/connections/fileViewConnectionDraft.ts";

test("Document Connection drafts use the selected filename and Material file icon", () => {
  const draft = buildFileViewConnectionDraftFromPath("C:\\Users\\ryan\\Desktop\\report.md", {
    workspaceId: "workspace-1",
  });

  assert.deepEqual(draft, {
    name: "report.md",
    host: "localhost",
    user: "local",
    type: "fileView",
    workspaceId: "workspace-1",
    localStartupDirectory: "C:\\Users\\ryan\\Desktop\\report.md",
    iconDataUrl: "material:markdown",
  });
});

test("Document Connection add menu opens the file picker instead of the properties dialog", async () => {
  const sidebarSource = await readFile(
    new URL("../src/modules/workspace/connections/ConnectionSidebar.tsx", import.meta.url),
    "utf8",
  );
  const menuSource = await readFile(
    new URL("../src/modules/workspace/connections/connectionCreationOptions.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    sidebarSource,
    /connectionType === "fileView"\s*\?\s*handleNewFileViewConnectionSelected/,
    "The Document add action should select a file before creating the Connection.",
  );
  assert.match(
    sidebarSource,
    /if \(connectionType === "fileView"\) \{\s*void handleNewFileViewConnectionSelected\(\);\s*return;\s*\}/,
    "The shared type selector should return before opening the add properties dialog for Document.",
  );
  assert.match(
    menuSource,
    /\{ type: "fileView", labelKey: "connections\.fileView" \}/,
    "The React Add Connection menu should expose the Document Connection type.",
  );
});
