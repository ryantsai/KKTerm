import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sites = await readFile(new URL("../src/modules/itops/SitesTab.tsx", import.meta.url), "utf8");
const library = await readFile(new URL("../src/modules/itops/TaskLibrary.tsx", import.meta.url), "utf8");
const itopsCss = await readFile(new URL("../src/modules/itops/itops.css", import.meta.url), "utf8");
const hosts = await readFile(new URL("../src/modules/itops/HostsPanel.tsx", import.meta.url), "utf8");
const launcher = await readFile(new URL("../src/modules/itops/BatchRunDialog.tsx", import.meta.url), "utf8");
const schema = await readFile(new URL("../src-tauri/src/storage.rs", import.meta.url), "utf8");
const commands = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const taskStorage = await readFile(new URL("../src-tauri/src/itops/task_storage.rs", import.meta.url), "utf8");
const taskCommands = await readFile(new URL("../src-tauri/src/itops/task_commands.rs", import.meta.url), "utf8");
const runner = await readFile(new URL("../src-tauri/src/itops/runner.rs", import.meta.url), "utf8");
const ai = await readFile(new URL("../src-tauri/src/ai.rs", import.meta.url), "utf8");

test("IT Ops navigator keeps Tasks global and Site operations virtual", () => {
  assert.match(sites, /itops\.navigation\.serverRooms/);
  assert.match(sites, /itops\.navigation\.runHistory/);
  assert.match(sites, /itops\.tasks\.heading/);
  assert.match(sites, /rootSurface === "tasks"/);
  assert.match(sites, /<TaskLibrary onOpenRunHistory=/);
});

test("Server Room topology stays inside its destination and selection is exclusive", () => {
  const serverRoomsRow = sites.indexOf('label={t("itops.navigation.serverRooms")}');
  const topologyRows = sites.indexOf("siteTopo\n                          .filter", serverRoomsRow);
  const hostsRow = sites.indexOf('label={t("itops.tabs.hosts")}', serverRoomsRow);
  assert.ok(serverRoomsRow >= 0 && topologyRows > serverRoomsRow && hostsRow > topologyRows);
  assert.match(sites, /selectedDestination === "site"/);
  assert.match(sites, /selectedDestination === "serverRooms"/);
});

test("Collapse All closes every Site and Server Rooms container", () => {
  const collapseBlock =
    sites.match(/const collapseAllNodes = useCallback\([\s\S]*?\n  \}, \[[^\]]*\]\);/)?.[0] ?? "";
  assert.match(collapseBlock, /next\.add\(siteId\);/);
  assert.match(collapseBlock, /next\.add\(`\$\{siteId\}:rooms`\);/);
  assert.doesNotMatch(collapseBlock, /if \(siteTopo\.length > 0\) \{\s*next\.add\(siteId\)/);
});

test("Task Library manages definitions while the Hosts launcher selects saved Tasks", () => {
  assert.doesNotMatch(library, /requestNewBatchRun/);
  assert.match(hosts, /requestNewBatchRun\(siteId, \{ hostIds: \[\.\.\.selectedHostIds\] \}\)/);
  assert.match(launcher, /const tasks = useItOpsStore/);
  assert.match(launcher, /itops\.batchRuns\.taskSourceLabel/);
  assert.match(library, /const createTask = useItOpsStore/);
  assert.match(library, /const updateTask = useItOpsStore/);
  assert.match(library, /kind: "playbook"/);
  assert.match(library, /<ReactFlow/);
  assert.match(library, /addStep\("sudo"\)/);
  assert.match(library, /addStep\("ai"\)/);
  assert.doesNotMatch(library, /playbookEditLater/);
});

test("Tasks carry Applicable OS metadata and built-ins duplicate before customization", () => {
  assert.match(library, /function ApplicableOsPicker/);
  assert.match(library, /TASK_OPERATING_SYSTEMS/);
  assert.match(library, /itops\.tasks\.applicableOsLabel/);
  assert.match(library, /task\.applicableOs/);
  assert.match(library, /task\.builtInKey \? <button/);
  assert.match(library, /duplicateBuiltin/);
  assert.match(taskStorage, /const BUILTIN_TASKS/);
  assert.match(taskStorage, /linux\.identity/);
  assert.match(taskStorage, /windows\.identity/);
  assert.match(taskStorage, /ciscoIos\.identity/);
  assert.match(taskStorage, /fortiOs\.identity/);
  assert.match(taskStorage, /junos\.identity/);
  assert.match(taskStorage, /aristaEos\.identity/);
  assert.match(taskCommands, /built-in tasks are read-only/);
  assert.match(taskCommands, /built-in tasks cannot be deleted/);
});

test("Batch Run shows saved Task definitions in a read-only Task Editor preview", () => {
  assert.match(launcher, /const selectedTask = tasks\.find/);
  assert.match(launcher, /function ReadonlyTaskDefinition/);
  assert.match(launcher, /function ReadonlyScriptTask/);
  assert.match(launcher, /function ReadonlyPlaybookTask/);
  assert.match(launcher, /className="br-task-preview"/);
  assert.match(launcher, /<ReactFlow/);
  assert.match(launcher, /<TextInput readOnly/);
  assert.match(launcher, /<TextArea readOnly/);
  assert.match(launcher, /selectedTask \? 1040 : 580/);
  assert.match(launcher, /selectedTask \? \([\s\S]*<ReadonlyTaskDefinition[\s\S]*\) : \(/);
});

test("Ad hoc Batch Runs support Script definitions only", () => {
  assert.match(launcher, /selectedTask\?\.task \?\? \{ kind: "script", body \}/);
  assert.match(launcher, /selectedTask \? \([\s\S]*<ReadonlyTaskDefinition[\s\S]*\) : \([\s\S]*itops\.batchRuns\.scriptLabel/);
  assert.doesNotMatch(launcher, /type TaskMode/);
  assert.doesNotMatch(launcher, /setPlaybookName|updateStep|setSteps/);
  assert.doesNotMatch(launcher, /itops\.batchRuns\.addStep/);
});

test("AI nodes consume previous output through a closed non-executable decision contract", () => {
  assert.match(library, /aiInstruction: step\.kind === "ai"/);
  assert.match(launcher, /return selectedTask\?\.task \?\? \{ kind: "script", body \}/);
  assert.match(launcher, /selectedStep\.aiInstruction/);
  assert.match(runner, /run_playbook_ai_decision/);
  assert.match(ai, /allow_tools: false/);
  assert.match(ai, /PlaybookAiDecisionKind/);
  assert.match(ai, /Continue,[\s\S]*Success,[\s\S]*Fail,/);
  assert.doesNotMatch(ai, /decision.*runCommand/);
});

test("Playbook sudo nodes persist only a vault reference and survive the launcher", () => {
  assert.match(library, /kind: "itopsTaskSecret"/);
  assert.match(library, /secretOwnerId: step\.kind === "sudo"/);
  assert.match(launcher, /return selectedTask\?\.task \?\? \{ kind: "script", body \}/);
  assert.match(launcher, /step\.kind === "sudo"/);
});

test("Task Library uses the shared destination page frame", () => {
  assert.match(sites, /rootSurface === "tasks"[\s\S]*className="hg-detail it-destination-page"/);
  assert.match(library, /className="it-task-library-page it-destination-surface"/);
  assert.match(library, /className="it-destination-page-head"/);
  assert.match(library, /itops\.tasks\.pageDescription/);
  assert.match(library, /className="it-btn primary"[\s\S]*itops\.tasks\.newTitle/);
});

test("Task Library is a spreadsheet list with stable-id run statistics", () => {
  assert.match(library, /className="it-task-table"/);
  assert.match(library, /run\.taskId/);
  assert.match(library, /current\.executions \+= 1/);
  assert.match(library, /current\.failures \+= run\.report\.failed/);
  assert.match(library, /onOpenRunHistory\(stats\.lastSiteId\)/);
});

test("Playbook connector buttons open a node picker and insert the selected kind at that edge", () => {
  assert.match(library, /function TaskEdge/);
  assert.match(library, /className="pb-edge-add nodrag nopan"/);
  assert.match(library, /className="pb-edge-picker nodrag nopan"/);
  assert.match(library, /role="menu"/);
  assert.match(library, /onInsert\(data\.insertIndex, kind\)/);
  assert.match(library, /insertStepAt/);
  assert.match(library, /"command", "sudo", "ai"/);
  assert.match(library, /insertIndex: index/);
  assert.match(itopsCss, /\.pb-edge-control\s*\{[^}]*pointer-events:\s*all/s);
});

test("sudo credential typing stays local and outside React Flow node state", () => {
  assert.match(library, /function SudoCredentialInput[\s\S]*const \[value, setValue\] = useState/);
  assert.match(library, /drafts\.current\[ownerId\] = next/);
  assert.match(library, /const secretDrafts = useRef/);
  assert.doesNotMatch(library, /setSecretDrafts/);
});

test("Tasks are durable global rows with registered CRUD commands", () => {
  assert.match(schema, /CREATE TABLE IF NOT EXISTS itops_tasks/);
  const taskTable = schema.match(/CREATE TABLE IF NOT EXISTS itops_tasks \([\s\S]*?\n\);/)?.[0] ?? "";
  assert.doesNotMatch(taskTable, /site_id/);
  assert.match(taskTable, /applicable_os_json/);
  assert.match(taskTable, /built_in_key/);
  for (const command of ["itops_list_tasks", "itops_create_task", "itops_update_task", "itops_remove_task"]) {
    assert.match(commands, new RegExp(`task_commands::${command}`));
  }
});
