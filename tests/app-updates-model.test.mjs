import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function importTypeScriptModule(path) {
  const source = await readFile(path, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      verbatimModuleSyntax: true,
    },
  });
  const encoded = encodeURIComponent(transpiled.outputText);
  return import(`data:text/javascript;charset=utf-8,${encoded}`);
}

test("startup update check only runs once when enabled in the Tauri runtime", async () => {
  const { shouldRunStartupUpdateCheck, selectInstallerAssets } = await importTypeScriptModule(
    new URL("../src/lib/appUpdatesModel.ts", import.meta.url),
  );

  assert.equal(
    shouldRunStartupUpdateCheck({
      autoUpdateChecksEnabled: true,
      hasCheckedThisLaunch: false,
      isTauriRuntime: true,
    }),
    true,
  );
  assert.equal(
    shouldRunStartupUpdateCheck({
      autoUpdateChecksEnabled: true,
      hasCheckedThisLaunch: true,
      isTauriRuntime: true,
    }),
    false,
  );
  assert.equal(
    shouldRunStartupUpdateCheck({
      autoUpdateChecksEnabled: false,
      hasCheckedThisLaunch: false,
      isTauriRuntime: true,
    }),
    false,
  );
  assert.equal(
    shouldRunStartupUpdateCheck({
      autoUpdateChecksEnabled: true,
      hasCheckedThisLaunch: false,
      isTauriRuntime: false,
    }),
    false,
  );
});

test("startup update checks are throttled for 24 hours", async () => {
  const { shouldRunStartupUpdateCheck, STARTUP_UPDATE_CHECK_INTERVAL_MS } =
    await importTypeScriptModule(new URL("../src/lib/appUpdatesModel.ts", import.meta.url));
  const now = Date.UTC(2026, 5, 19, 8);

  assert.equal(
    shouldRunStartupUpdateCheck({
      autoUpdateChecksEnabled: true,
      hasCheckedThisLaunch: false,
      isTauriRuntime: true,
      lastCheckedAt: now - STARTUP_UPDATE_CHECK_INTERVAL_MS + 1,
      now,
    }),
    false,
  );
  assert.equal(
    shouldRunStartupUpdateCheck({
      autoUpdateChecksEnabled: true,
      hasCheckedThisLaunch: false,
      isTauriRuntime: true,
      lastCheckedAt: now - STARTUP_UPDATE_CHECK_INTERVAL_MS,
      now,
    }),
    true,
  );
});

test("Microsoft Store releases delegate update checks entirely to the Store", async () => {
  const { shouldRunStartupUpdateCheck } = await importTypeScriptModule(
    new URL("../src/lib/appUpdatesModel.ts", import.meta.url),
  );
  const [appPathsSource, appUpdatesSource, promptSource, settingsSource, appSource] =
    await Promise.all([
      readFile(new URL("../src-tauri/src/app_paths.rs", import.meta.url), "utf8"),
      readFile(new URL("../src/lib/appUpdates.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/app/AppUpdatePrompt.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/modules/settings/GeneralSettings.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    ]);

  assert.equal(
    shouldRunStartupUpdateCheck({
      autoUpdateChecksEnabled: true,
      hasCheckedThisLaunch: false,
      isTauriRuntime: true,
      updatesManagedByMicrosoftStore: true,
    }),
    false,
  );
  assert.match(appPathsSource, /PackageSignatureKind::Store/);
  assert.match(appPathsSource, /updates_managed_by_microsoft_store/);
  assert.match(
    appUpdatesSource,
    /if \(appMode\.updatesManagedByMicrosoftStore\) \{\s*return null;/,
    "the update service must return before fetching release metadata",
  );
  assert.match(
    promptSource,
    /shouldRunStartupUpdateCheck\(\{[\s\S]*?updatesManagedByMicrosoftStore,/,
    "the startup prompt must pass Store-management state into its gate",
  );
  assert.match(
    settingsSource,
    /\{!updatesManagedByMicrosoftStore \? \(\s*<fieldset className="settings-subsection settings-fieldset">/,
    "Store releases must omit the app-owned Software Updates controls",
  );
  assert.match(
    appSource,
    /settingsReady=\{appModeReady\s*&&\s*generalSettingsReady\}/,
    "startup checks must wait until Store-management status is known",
  );
});

test("Cloudflare release manifest selects a verified Windows installer pair", async () => {
  const { parseCloudflareReleaseManifest, selectManifestWindowsInstaller } =
    await importTypeScriptModule(new URL("../src/lib/appUpdatesModel.ts", import.meta.url));
  const manifest = parseCloudflareReleaseManifest({
    version: "0.1.93",
    notes: "notes",
    pub_date: "2026-06-19T00:00:00Z",
    release_url: "https://github.com/ryantsai/KKTerm/releases/tag/v0.1.93",
    platforms: {
      "windows-x64": {
        url: "https://kkterm.ryantsai.com/releases/v0.1.93/kkterm-0.1.93-windows-x64-setup.exe",
        checksum_url:
          "https://kkterm.ryantsai.com/releases/v0.1.93/kkterm-0.1.93-windows-x64-setup.exe.sha256",
      },
    },
  });

  assert.deepEqual(selectManifestWindowsInstaller(manifest, "windows-x64"), {
    assetName: "kkterm-0.1.93-windows-x64-setup.exe",
    downloadUrl: "https://kkterm.ryantsai.com/releases/v0.1.93/kkterm-0.1.93-windows-x64-setup.exe",
    checksumUrl:
      "https://kkterm.ryantsai.com/releases/v0.1.93/kkterm-0.1.93-windows-x64-setup.exe.sha256",
  });
  assert.throws(
    () =>
      parseCloudflareReleaseManifest({
        version: "0.1.93",
        platforms: {
          "windows-x64": {
            url: "http://evil.example/app.exe",
            checksum_url: "https://kkterm.ryantsai.com/app.exe.sha256",
          },
        },
      }),
    /manifest/i,
  );
});

test("each update endpoint request gets an independent timeout signal", async () => {
  const { fetchUpdateJson } = await importTypeScriptModule(
    new URL("../src/lib/appUpdatesModel.ts", import.meta.url),
  );
  const signals = [];
  const fakeFetch = async (_url, init) => {
    signals.push(init.signal);
    return { ok: true, json: async () => ({ version: "0.1.93" }) };
  };
  await fetchUpdateJson("https://first.example", "First", 1000, fakeFetch);
  await fetchUpdateJson("https://second.example", "Second", 1000, fakeFetch);
  assert.notEqual(signals[0], signals[1]);
});

test("installer asset selection requires matching installer and checksum assets", async () => {
  const { selectWindowsInstallerAssets } = await importTypeScriptModule(
    new URL("../src/lib/appUpdatesModel.ts", import.meta.url),
  );

  const assets = [
    {
      name: "kkterm-0.1.54-windows-x64-setup.exe",
      browser_download_url: "https://github.com/ryantsai/KKTerm/releases/download/v0.1.54/kkterm-0.1.54-windows-x64-setup.exe",
    },
    {
      name: "kkterm-0.1.54-windows-x64-setup.exe.sha256",
      browser_download_url: "https://github.com/ryantsai/KKTerm/releases/download/v0.1.54/kkterm-0.1.54-windows-x64-setup.exe.sha256",
    },
    {
      name: "kkterm-0.1.54-windows-arm64-setup.exe",
      browser_download_url: "https://github.com/ryantsai/KKTerm/releases/download/v0.1.54/kkterm-0.1.54-windows-arm64-setup.exe",
    },
  ];

  assert.deepEqual(selectWindowsInstallerAssets(assets, "windows-x64"), {
    assetName: "kkterm-0.1.54-windows-x64-setup.exe",
    downloadUrl: "https://github.com/ryantsai/KKTerm/releases/download/v0.1.54/kkterm-0.1.54-windows-x64-setup.exe",
    checksumUrl: "https://github.com/ryantsai/KKTerm/releases/download/v0.1.54/kkterm-0.1.54-windows-x64-setup.exe.sha256",
  });
  assert.equal(selectWindowsInstallerAssets(assets, "windows-arm64"), null);
});

test("app update install strategy keeps Windows installer flow separate from macOS Tauri updater", async () => {
  const { appUpdateInstallStrategy } = await importTypeScriptModule(
    new URL("../src/lib/appUpdatesModel.ts", import.meta.url),
  );

  assert.equal(appUpdateInstallStrategy("windows"), "windows-installer");
  assert.equal(appUpdateInstallStrategy("windows", true), "portable-self-update");
  assert.equal(appUpdateInstallStrategy("macos"), "tauri-updater");
  assert.equal(appUpdateInstallStrategy("linux"), "tauri-updater");
  assert.equal(appUpdateInstallStrategy("unknown"), "download-page");
});

test("portable update selection requires an exact ZIP and checksum pair", async () => {
  const { selectManifestWindowsPortableZip, selectWindowsPortableAssets } =
    await importTypeScriptModule(new URL("../src/lib/appUpdatesModel.ts", import.meta.url));
  const manifest = {
    version: "0.1.93",
    platforms: {
      "windows-x64-portable": {
        url: "https://kkterm.ryantsai.com/releases/v0.1.93/kkterm-0.1.93-windows-x64-portable.zip",
        checksum_url:
          "https://kkterm.ryantsai.com/releases/v0.1.93/kkterm-0.1.93-windows-x64-portable.zip.sha256",
      },
    },
  };
  assert.deepEqual(selectManifestWindowsPortableZip(manifest, "windows-x64"), {
    assetName: "kkterm-0.1.93-windows-x64-portable.zip",
    downloadUrl:
      "https://kkterm.ryantsai.com/releases/v0.1.93/kkterm-0.1.93-windows-x64-portable.zip",
    checksumUrl:
      "https://kkterm.ryantsai.com/releases/v0.1.93/kkterm-0.1.93-windows-x64-portable.zip.sha256",
  });
  assert.deepEqual(
    selectWindowsPortableAssets(
      [
        {
          name: "kkterm-0.1.93-windows-x64-portable.zip",
          browser_download_url: "https://github.example/portable.zip",
        },
        {
          name: "kkterm-0.1.93-windows-x64-portable.zip.sha256",
          browser_download_url: "https://github.example/portable.zip.sha256",
        },
      ],
      "windows-x64",
    ),
    {
      assetName: "kkterm-0.1.93-windows-x64-portable.zip",
      downloadUrl: "https://github.example/portable.zip",
      checksumUrl: "https://github.example/portable.zip.sha256",
    },
  );
  assert.equal(selectWindowsPortableAssets([], "windows-x64"), null);
});

test("app update install flow is exposed across the frontend and backend boundary", async () => {
  const [tauriSource, libSource, promptSource, localeSource, releaseDoc, manualSource] =
    await Promise.all([
      readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8"),
      readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
      readFile(new URL("../src/app/AppUpdatePrompt.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/i18n/locales/en.json", import.meta.url), "utf8"),
      readFile(new URL("../docs/RELEASE.md", import.meta.url), "utf8"),
      readFile(new URL("../docs/manual/15-settings.md", import.meta.url), "utf8"),
    ]);
  const locale = JSON.parse(localeSource);

  assert.match(tauriSource, /download_app_update/);
  assert.match(libSource, /download_app_update/);
  assert.match(promptSource, /settings\.updateDownloadAndInstall/);
  assert.match(promptSource, /settings\.portableUpdateDownload/);
  assert.equal(locale.settings.updateDownloadAndInstall, "Download and Install");
  assert.match(releaseDoc, /Download and Install/);
  assert.match(manualSource, /settings\.updateDownloadAndInstall/);
});

test("app update progress clamps real byte progress to a whole percentage", async () => {
  const { appUpdateProgressPercent } = await importTypeScriptModule(
    new URL("../src/lib/appUpdatesModel.ts", import.meta.url),
  );

  assert.equal(appUpdateProgressPercent(0, 100), 0);
  assert.equal(appUpdateProgressPercent(49, 100), 49);
  assert.equal(appUpdateProgressPercent(150, 100), 100);
  assert.equal(appUpdateProgressPercent(-1, 100), 0);
  assert.equal(appUpdateProgressPercent(50, 0), null);
});

test("app update uses a cancellable download phase before delayed installation", async () => {
  const [tauriSource, libSource, promptSource, statusBarSource, workspaceCss] = await Promise.all([
    readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8"),
    readFile(new URL("../src/app/AppUpdatePrompt.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/workspace/StatusBar.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/workspace/workspace.css", import.meta.url), "utf8"),
  ]);

  for (const command of [
    "download_app_update",
    "cancel_app_update_download",
    "take_portable_update_error",
    "install_downloaded_app_update",
  ]) {
    assert.match(tauriSource, new RegExp(command));
    assert.match(libSource, new RegExp(command));
  }
  assert.match(promptSource, /APP_UPDATE_INSTALL_DELAY_MS\s*=\s*3_000/);
  assert.match(promptSource, /showStatusBarProgress/);
  assert.match(statusBarSource, /CircleGauge/);
  assert.match(statusBarSource, /role="progressbar"/);
  assert.match(statusBarSource, /aria-valuemin=\{0\}/);
  assert.match(statusBarSource, /aria-valuemax=\{100\}/);
  assert.match(statusBarSource, /aria-valuenow=\{progress\}/);
  assert.match(statusBarSource, /Math\.round\(progress\)\}%/);
  assert.match(
    statusBarSource,
    /status-popup-message[\s\S]*status-popup-progress[\s\S]*status-popup-progress-label/,
    "the filling track should render between the message and percentage",
  );
  assert.match(
    workspaceCss,
    /\.status-popup-content\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;/s,
    "update progress content should stay on one horizontal row",
  );
  assert.match(
    statusBarSource,
    /isProgress \? "is-progress" : ""/,
    "progress notices should opt into the wider popup treatment",
  );
  assert.match(
    workspaceCss,
    /\.status-popup\.is-progress\s*\{[^}]*width:\s*min\(520px,\s*calc\(100vw - 48px\)\)/s,
    "update progress popup should be wide enough to keep the download label on one line",
  );
});
