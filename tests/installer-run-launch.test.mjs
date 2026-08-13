import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function read(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("installed tiles expose a Run button routed by launch kind", async () => {
  const toolRow = await read("../src/modules/installer/ToolRow.tsx");
  const runAction = await read("../src/modules/installer/useInstallerRunAction.ts");

  assert.match(
    toolRow,
    /useInstallerRunAction\(recipe\)/,
    "ToolRow should share the same Run routing as List and details surfaces",
  );
  assert.match(
    toolRow,
    /isInstalled && !busy/,
    "Run should only show for installed tools with no operation in flight",
  );
  assert.match(
    runAction,
    /launchKindForRecipe\(recipe\.id\)/,
    "the shared action should classify installed recipes through launch.ts",
  );
  assert.match(
    runAction,
    /installer_launch_app/,
    "GUI apps should launch through the dedicated backend command",
  );
  assert.match(
    runAction,
    /openLauncherDialog\(recipe\.id\)/,
    "CLI, suite, and managed web UI tools should open a separate Run dialog",
  );
  assert.match(
    toolRow,
    /installer\.actions\.run/,
    "Run label should be translated",
  );
});

test("installed details route CLI Run through the launcher dialog", async () => {
  const dialog = await read("../src/modules/installer/InstallerToolDialog.tsx");
  const installedInfo = dialog.match(
    /function InstalledInfoBody[\s\S]*?function NotInstalledInfoBody/,
  )?.[0];

  assert.ok(installedInfo, "the installed-details component should exist");
  assert.match(
    installedInfo,
    /const runAction = useInstallerRunAction\(recipe\)/,
    "installed details should use the shared Run action",
  );
  assert.match(
    installedInfo,
    /runAction\.launchKind === "suite"[\s\S]*onClick=\{runAction\.run\}/,
    "the details Run button should open the same separate Run dialog as tile Run",
  );
});

test("Gallery and List base views both expose shared Run and install actions", async () => {
  const toolRow = await read("../src/modules/installer/ToolRow.tsx");
  const listRow = await read("../src/modules/installer/InstallerListRow.tsx");

  for (const source of [toolRow, listRow]) {
    assert.match(source, /useInstallerRunAction\(recipe\)/);
    assert.match(source, /installer\.actions\.run/);
    assert.match(source, /installer\.actions\.install/);
  }
});

test("coding-agent launcher shows persisted options instead of samples", async () => {
  const dialog = await read("../src/modules/installer/InstallerToolDialog.tsx");
  const launch = await read("../src/modules/installer/launch.ts");
  const durable = await read("../src/lib/durableUiState.ts");

  assert.match(dialog, /function LauncherBody/);
  assert.match(
    dialog,
    /installer\.launcher\.title/,
    "launcher dialog title should be translated",
  );
  assert.match(dialog, /codingAgentLaunchOptionsForRecipe\(recipe\.id\)/);
  assert.match(dialog, /codingAgentCommandReferenceUrlForRecipe\(recipe\.id\)/);
  assert.match(dialog, /installer\.launcher\.commonOption/);
  assert.match(dialog, /installer\.launcher\.arguments/);
  assert.match(dialog, /installer\.launcher\.commandReference/);
  assert.match(dialog, /<ExternalLink href=\{commandReferenceUrl\}>/);
  assert.match(dialog, /readCodingAgentLaunchSettings\(recipe\.id\)/);
  assert.match(dialog, /writeCodingAgentLaunchSettings\(recipe\.id/);
  assert.match(dialog, /arguments: launchArguments/);
  assert.match(
    dialog,
    /execute: usesProjectFolders/,
    "directory-scoped coding agents should request immediate execution",
  );
  assert.match(
    dialog,
    /codingAgentOptions \? \([\s\S]*installer\.launcher\.commonOption[\s\S]*\) : \([\s\S]*installer\.launcher\.samples/,
    "samples should only render on the non-coding-agent branch",
  );
  assert.match(launch, /kkterm\.installerLauncherOptions\.v1/);
  const referenceBlock = launch.match(
    /CODING_AGENT_COMMAND_REFERENCE_URLS: Record<string, string> = \{([\s\S]*?)\n\};/,
  )?.[1];
  assert.ok(referenceBlock, "launch.ts should declare coding-agent reference URLs");
  for (const [id, domain] of [
    ["antigravity-cli", "antigravity.google"],
    ["claude-code-cli", "code.claude.com"],
    ["codex-cli", "developers.openai.com"],
    ["cursor-cli", "docs.cursor.com"],
    ["kimi-code-cli", "www.kimi.com"],
    ["grok-build", "docs.x.ai"],
    ["opencode", "opencode.ai"],
    ["pi", "pi.dev"],
    ["oh-my-pi", "omp.sh"],
  ]) {
    assert.match(referenceBlock, new RegExp(`"?${id}"?:`));
    assert.match(referenceBlock, new RegExp(domain.replaceAll(".", "\\.")));
  }
  assert.match(durable, /"kkterm\.installerLauncherOptions\.v1"/);
  assert.match(dialog, /usesProjectFolders[\s\S]*installer\.actions\.run/);
  assert.match(dialog, /installer\.launcher\.openTerminal/);
  assert.match(
    dialog,
    /installer_open_terminal_launcher/,
    "open terminal should call the backend terminal launcher",
  );
});

test("terminal launchers use the Windows shell from the GUI-subsystem app", async () => {
  const commands = await read("../src-tauri/src/installer/commands.rs");
  const launcher = commands.match(
    /#\[cfg\(target_os = "windows"\)\]\s*fn spawn_terminal_launcher[\s\S]*?\n\}/,
  )?.[0];

  assert.ok(launcher, "the Windows terminal launcher should exist");
  assert.match(
    launcher,
    /ShellExecuteW\(/,
    "a release GUI-subsystem process should ask the Windows shell to create the interactive console",
  );
  assert.match(
    commands,
    /fn build_terminal_launcher_shell_parameters[\s\S]*-EncodedCommand/,
    "the generated PowerShell setup should cross ShellExecute without command-line quoting loss",
  );
  assert.doesNotMatch(
    launcher,
    /const CREATE_NEW_CONSOLE|Command::new\("powershell"\)/,
    "the console must not inherit invalid standard handles from the GUI-subsystem parent",
  );
});

test("frontend launch classification stays in sync with the Rust allow-lists", async () => {
  const launch = await read("../src/modules/installer/launch.ts");
  const commands = await read("../src-tauri/src/installer/commands.rs");

  // Every frontend GUI recipe has Rust launch candidates.
  const guiBlock = launch.match(
    /GUI_LAUNCH_RECIPES = new Set<string>\(\[([\s\S]*?)\]\)/,
  )?.[1];
  assert.ok(guiBlock, "launch.ts should declare the GUI recipe set");
  const guiIds = [...guiBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.ok(guiIds.length > 20, "GUI launch set should cover the catalog's desktop apps");
  const guiAffordance = commands.match(
    /fn gui_launch_affordance[\s\S]*?\n\}\n/,
  )?.[0];
  assert.ok(guiAffordance, "commands.rs should declare gui_launch_affordance");
  for (const id of guiIds) {
    assert.match(
      guiAffordance,
      new RegExp(`"${id.replace(/[+*?.]/g, "\\$&")}" =>`),
      `${id} should have Rust GUI launch candidates`,
    );
  }

  // Every frontend CLI launcher entry has a Rust terminal launcher.
  const cliBlock = launch.match(
    /CLI_LAUNCH_COMMANDS: Record<string, string> = \{([\s\S]*?)\n\};/,
  )?.[1];
  assert.ok(cliBlock, "launch.ts should declare the CLI command map");
  const cliIds = [...cliBlock.matchAll(/^  (?:"([^"]+)"|([\w-]+)):/gm)].map(
    (match) => match[1] ?? match[2],
  );
  assert.ok(cliIds.length > 15, "CLI command map should cover the catalog's command-line tools");
  const terminalAffordance = commands.match(
    /fn terminal_launch_affordance[\s\S]*?\n\}\n/,
  )?.[0];
  assert.ok(terminalAffordance, "commands.rs should declare terminal_launch_affordance");
  for (const id of cliIds) {
    assert.match(
      terminalAffordance,
      new RegExp(`"${id}" =>`),
      `${id} should have a Rust terminal launcher`,
    );
  }

  // Suites match the Rust quick-launch allow-list.
  assert.match(launch, /"sysinternals-suite", "coreutils"/);
  assert.match(commands, /"coreutils" => vec!\[/);
});

test("coding-agent launchers remember project folders", async () => {
  const launch = await read("../src/modules/installer/launch.ts");
  const dialog = await read("../src/modules/installer/InstallerToolDialog.tsx");
  const commands = await read("../src-tauri/src/installer/commands.rs");
  const durable = await read("../src/lib/durableUiState.ts");

  // Every coding agent in the folder-remembering set is also a CLI launcher.
  const agentBlock = launch.match(
    /CODING_AGENT_CLI_RECIPES = new Set<string>\(\[([\s\S]*?)\]\)/,
  )?.[1];
  assert.ok(agentBlock, "launch.ts should declare the coding-agent set");
  const agentIds = [...agentBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  for (const id of ["antigravity-cli", "claude-code-cli", "codex-cli", "cursor-cli", "kimi-code-cli", "grok-build", "opencode", "pi", "oh-my-pi"]) {
    assert.ok(agentIds.includes(id), `${id} should remember launch folders`);
  }
  for (const id of agentIds) {
    const commandKey = /^[A-Za-z_$][\w$]*$/.test(id)
      ? `(?:${id}|["']${id}["'])`
      : `["']${id}["']`;
    assert.match(
      launch,
      new RegExp(`${commandKey}:`),
      `${id} should also have a CLI launcher command`,
    );
  }

  // Recents persist in the durable UI-state tier (survives reinstall, wiped
  // by Reset All Settings).
  assert.match(launch, /kkterm\.installerLauncherRecentPaths\.v1/);
  assert.match(durable, /"kkterm\.installerLauncherRecentPaths\.v1"/);
  assert.match(launch, /MAX_RECENT_LAUNCH_FOLDERS = 20/);

  // Dialog shows five, expands on demand, and offers the folder picker.
  assert.match(dialog, /RECENT_LAUNCH_FOLDERS_VISIBLE = 5/);
  assert.match(dialog, /installer\.launcher\.recentFolders/);
  assert.match(dialog, /installer\.launcher\.showMore/);
  assert.match(dialog, /installer\.launcher\.chooseFolder/);
  assert.match(dialog, /selectInstallerLaunchFolder/);
  assert.match(dialog, /rememberLaunchFolder\(recipe\.id/);
  assert.ok(
    dialog.indexOf("{codingAgentOptions ? (") <
      dialog.indexOf("{usesProjectFolders && recentFolders.length > 0 ? ("),
    "command-line options should render above recent folders",
  );

  // Backend validates the requested folder before spawning there.
  assert.match(commands, /path: Option<String>/);
  assert.match(commands, /arguments: Option<String>/);
  assert.match(commands, /execute: Option<bool>/);
  assert.match(commands, /fn coding_agent_terminal_launcher/);
  assert.match(commands, /fn validated_launch_dir/);
  assert.match(commands, /let working_directory = working_dir\.map/);
});

test("GUI automatic launch runs through a closed backend allow-list", async () => {
  const commands = await read("../src-tauri/src/installer/commands.rs");

  assert.match(
    commands,
    /pub async fn installer_launch_app\(/,
    "installer_launch_app should be async so blocking work can leave the command path",
  );
  assert.match(
    commands,
    /does not have an app launcher/,
    "unknown tools should be refused instead of spawning arbitrary programs",
  );
  assert.match(
    commands,
    /App Paths/,
    "bare-name candidates should consult the Windows App Paths registry",
  );
  assert.match(
    commands,
    /shell:AppsFolder/,
    "Store apps should launch through shell:AppsFolder",
  );
  assert.match(
    commands,
    /Get-StartApps/,
    "registered Start-menu AppIDs should be resolved before guessed paths",
  );
  assert.match(
    commands,
    /DisplayIcon/,
    "matching uninstall registrations should supply their authoritative executable",
  );
  assert.match(
    commands,
    /Test-AllowedExe/,
    "registered executables should remain inside the tool-specific allow-list",
  );
  assert.match(
    commands,
    /Test-LaunchableAppId/,
    "Start-menu help pages and URLs should not be treated as app launch targets",
  );
  assert.match(
    commands,
    /Get-VersionSortKey/,
    "duplicate uninstall registrations should prefer the newest version",
  );
});

test("GUI launch falls back to a persisted user-selected executable or shortcut", async () => {
  const runAction = await read("../src/modules/installer/useInstallerRunAction.ts");
  const launch = await read("../src/modules/installer/launch.ts");
  const durable = await read("../src/lib/durableUiState.ts");
  const tauri = await read("../src/lib/tauri.ts");
  const commands = await read("../src-tauri/src/installer/commands.rs");

  assert.match(runAction, /readGuiLauncherPath\(recipe\.id\)/);
  assert.match(runAction, /selectInstallerGuiLauncherFile/);
  assert.match(runAction, /customPath: selectedPath/);
  assert.match(runAction, /writeGuiLauncherPath\(recipe\.id, selectedPath\)/);
  assert.match(runAction, /removeGuiLauncherPath\(recipe\.id\)/);
  assert.match(runAction, /installer\.launcher\.selectAppTitle/);
  assert.match(runAction, /installer\.launcher\.selectedAppFailed/);

  assert.match(launch, /kkterm\.installerGuiLauncherPaths\.v1/);
  assert.match(durable, /"kkterm\.installerGuiLauncherPaths\.v1"/);
  assert.match(tauri, /extensions: \["exe", "com", "bat", "cmd", "lnk"\]/);
  assert.match(tauri, /args: \{ toolId: string; customPath\?: string \}/);
  assert.match(tauri, /result: boolean/);

  assert.match(commands, /custom_path: Option<String>/);
  assert.match(commands, /fn validated_custom_gui_launcher/);
  assert.match(commands, /fn is_supported_custom_gui_launcher/);
  assert.match(commands, /"exe" \| "com" \| "bat" \| "cmd" \| "lnk"/);
  assert.match(commands, /if let Some\(path\) = custom_path/);
});

test("Coreutils quick launch opens a plain terminal, Sysinternals stays elevated", async () => {
  const commands = await read("../src-tauri/src/installer/commands.rs");
  const dialog = await read("../src/modules/installer/InstallerToolDialog.tsx");

  assert.match(
    commands,
    /"sysinternals-suite" => spawn_elevated_powershell\(\)/,
    "Sysinternals terminal should stay elevated",
  );
  assert.match(
    commands,
    /"coreutils" => spawn_terminal_launcher\(/,
    "Coreutils terminal should open non-elevated with hints",
  );
  assert.match(
    dialog,
    /suiteTerminalIsElevated\(recipe\.id\)/,
    "quick-launch terminal button label should reflect elevation",
  );
});
