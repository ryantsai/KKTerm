import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("every major Module has MCP discovery and dispatch coverage", async () => {
  const [catalog, bridge] = await Promise.all([
    read("src-tauri/src/mcp_tool_catalog.rs"),
    read("src-tauri/src/mcp_bridge.rs"),
  ]);

  for (const [moduleName, representativeTool] of [
    ["Workspace", "kkterm.workspace.connections.list"],
    ["Dashboard", "kkterm.dashboard.load_state"],
    ["Install Helper", "kkterm.installer.tools.list"],
    ["Screenshots", "kkterm.screenshots.list"],
    ["System Cleaner", "kkterm.system_cleaner.drives.list"],
    ["IT Ops", "kkterm.itops.sites.list"],
  ]) {
    assert.ok(
      catalog.includes(representativeTool),
      `${moduleName} must be discoverable through tools/list`,
    );
    assert.ok(
      bridge.includes(`"${representativeTool}" =>`) ||
        (representativeTool.startsWith("kkterm.system_cleaner.") &&
          bridge.includes('name.starts_with("kkterm.system_cleaner.")')),
      `${moduleName} must have an MCP dispatch path`,
    );
  }
});

test("native assistant exposes every major Module and all persisted tool groups", async () => {
  const [ai, liveTools, settings] = await Promise.all([
    read("src-tauri/src/ai.rs"),
    read("src/ai/assistantLiveTools.ts"),
    read("src/modules/settings/AiSettings.tsx"),
  ]);

  for (const representativeTool of [
    "connection_list",
    "dashboard_load_state",
    "itops_list_sites",
    "installer_list_tools",
    "system_cleaner_list_drives",
    "screenshot_list",
  ]) {
    assert.ok(
      ai.includes(`"${representativeTool}"`),
      `assistant must publish ${representativeTool}`,
    );
  }

  for (const installerTool of [
    "installer_list_tools",
    "installer_check_updates",
    "installer_install",
    "installer_uninstall",
    "installer_cancel",
    "installer_launch",
  ]) {
    assert.ok(
      liveTools.includes(`case "${installerTool}"`),
      `frontend live-tool bridge must dispatch ${installerTool}`,
    );
  }

  const configuredTools = settings.match(
    /const AI_ASSISTANT_TOOL_IDS:[\s\S]*?=\s*\[([\s\S]*?)\];/,
  )?.[1];
  assert.ok(configuredTools, "AI Assistant tool-toggle registry must exist");
  for (const toolId of [
    "dashboard",
    "itops",
    "installer",
    "systemCleaner",
    "screenshots",
    "connections",
    "sessions",
    "watchdog",
  ]) {
    assert.ok(
      configuredTools.includes(`"${toolId}"`),
      `${toolId} must have a visible Settings toggle`,
    );
  }
});

test("Tutorial navigation accepts the advertised Screenshots and System Cleaner Module pages", async () => {
  const ai = await read("src-tauri/src/ai.rs");
  assert.match(
    ai,
    /"page":\{"type":"string","enum":\["workspace","dashboard","itops","installer","screenshots","systemCleaner","settings"\]\}/,
  );
});

test("System Cleaner Assistant and MCP surfaces stay complete and dispatchable", async () => {
  const [ai, catalog, bridge] = await Promise.all([
    read("src-tauri/src/ai.rs"),
    read("src-tauri/src/mcp_tool_catalog.rs"),
    read("src-tauri/src/mcp_bridge.rs"),
  ]);
  const mcpNames = [...catalog.matchAll(/"(kkterm\.system_cleaner\.[a-z0-9_.]+)"/g)]
    .map((match) => match[1]);
  assert.equal(new Set(mcpNames).size, 27, "every supported System Cleaner flow must be published");
  for (const name of new Set(mcpNames)) {
    assert.ok(bridge.includes(`"${name}"`), `${name} must dispatch through the bridge`);
  }

  const definitionBlock = ai.match(/fn system_cleaner_tool_definitions[\s\S]*?fn watchdog_create_schema/)?.[0] ?? "";
  const assistantNames = [...definitionBlock.matchAll(/"(system_cleaner_[a-z0-9_]+)"/g)]
    .map((match) => match[1]);
  assert.equal(new Set(assistantNames).size, 27, "every supported System Cleaner flow must be available to the Assistant");
  for (const name of new Set(assistantNames)) {
    assert.ok(bridge.includes(`"${name}"`), `${name} must have an MCP-to-Assistant mapping`);
  }
});

test("native Assistant publishes every IT Ops operation already exposed through CLI MCP", async () => {
  const [ai, bridge] = await Promise.all([
    read("src-tauri/src/ai.rs"),
    read("src-tauri/src/mcp_bridge.rs"),
  ]);
  const definitionBlock = ai.slice(
    ai.indexOf("if settings.itops()"),
    ai.indexOf("if settings.connections()", ai.indexOf("if settings.itops()")),
  );
  const assistantNames = new Set(
    [...definitionBlock.matchAll(/"(itops_[a-z0-9_]+)"/g)].map((match) => match[1]),
  );
  const bridgeNames = new Set(
    [...bridge.matchAll(/crate::ai::itops_tool\(app,\s*"(itops_[a-z0-9_]+)"/g)]
      .map((match) => match[1]),
  );
  assert.ok(bridgeNames.size > 50, "the parity guard must cover the full IT Ops MCP surface");
  assert.deepEqual(
    [...bridgeNames].filter((name) => !assistantNames.has(name)).sort(),
    [],
    "CLI MCP must not expose IT Ops operations that the native Assistant cannot discover",
  );
});
