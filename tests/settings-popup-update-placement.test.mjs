import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("manual app update controls live in General instead of About", async () => {
  const [generalSource, aboutSource, localeSource, manualSource] = await Promise.all([
    readFile(new URL("../src/modules/settings/GeneralSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/settings/AboutSettings.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/i18n/locales/en.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/manual/15-settings.md", import.meta.url), "utf8"),
  ]);
  const locale = JSON.parse(localeSource);
  const appUpdateStart = generalSource.indexOf('t("settings.softwareUpdates")');
  const appUpdateEnd = generalSource.indexOf("</fieldset>", appUpdateStart);
  const appUpdateFieldset = generalSource.slice(appUpdateStart, appUpdateEnd);

  assert.match(generalSource, /CHECK_FOR_APP_UPDATES_EVENT/);
  assert.match(generalSource, /settings\.softwareUpdates/);
  assert.match(generalSource, /settings\.updates/);
  assert.match(generalSource, /settings\.checkForUpdates/);
  assert.match(generalSource, /app-update-summary-grid/);
  assert.match(generalSource, /app-update-check-controls/);
  assert.match(generalSource, /className="settings-toggle-row app-update-auto-checks"/);
  assert.ok(appUpdateStart >= 0);
  assert.ok(appUpdateEnd > appUpdateStart);
  assert.doesNotMatch(appUpdateFieldset, /settings-toggle-list/);
  assert.doesNotMatch(appUpdateFieldset, /autoUpdateChecksHint/);
  assert.doesNotMatch(aboutSource, /CHECK_FOR_APP_UPDATES_EVENT/);
  assert.doesNotMatch(aboutSource, /settings\.checkForUpdates/);
  assert.equal(locale.settings.softwareUpdates, "App Update");
  assert.equal(locale.settings.updates, "Updates");
  assert.equal(locale.settings.checkForUpdates, "Check now");
  assert.equal(locale.settings.autoUpdateChecks, "On startup");
  assert.match(manualSource, /App Update subsection/);
});

test("Settings renders as an app-owned popup over the active base Module", async () => {
  const [appSource, settingsSource, settingsStyles, nativeOverlaySource] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/settings/SettingsPage.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/settings/settings.css", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/workspace/nativeOverlay.ts", import.meta.url), "utf8"),
  ]);

  assert.match(appSource, /const visibleBasePage = isOverlayPage\(activePage\)/);
  assert.match(appSource, /dashboardActive=\{visibleBasePage === "dashboard"\}/);
  assert.match(settingsSource, /className="settings-backdrop"/);
  assert.match(settingsSource, /onClick=\{handleBackdropClick\}/);
  assert.match(settingsSource, /className="settings-popup settings-page"/);
  assert.match(settingsSource, /className="settings-page-actions"/);
  assert.match(settingsSource, /settings\.changesNotSaved/);
  assert.match(settingsSource, /settings-page-save-button/);
  assert.match(settingsSource, /saveRegistrations/);
  assert.match(settingsSource, /visitedSectionIds/);
  assert.match(settingsSource, /handleSaveAllDirty/);
  assert.match(settingsSource, /requestCloseSettings/);
  assert.match(settingsSource, /settings-section-panel/);
  assert.match(settingsSource, /unsavedQuitDialogOpen/);
  assert.match(settingsSource, /settings\.unsavedQuitTitle/);
  assert.match(settingsSource, /settings\.unsavedQuitBody/);
  assert.match(settingsSource, /settings\.saveAndQuit/);
  assert.match(settingsSource, /settings\.quitWithoutSaving/);
  assert.doesNotMatch(settingsSource, /setSaveRegistration\(\{ hasChanges: false \}\);\s*\}, \[activeSectionId\]\);/s);
  assert.match(settingsSource, /connection-dialog-close/);
  assert.match(settingsSource, /<p className="panel-label">\{t\("settings\.title"\)\}<\/p>/);
  assert.doesNotMatch(settingsSource, /<h1>\{t\("settings\.title"\)\}<\/h1>/);
  assert.doesNotMatch(settingsSource, /<p className="panel-label">KKTerm<\/p>/);
  assert.match(settingsStyles, /\.settings-backdrop\s*\{[^}]*position:\s*fixed;/s);
  assert.match(settingsStyles, /\.settings-popup\.settings-page\s*\{[^}]*overflow:\s*hidden;[^}]*box-shadow:\s*var\(--shadow\)/s);
  assert.match(settingsStyles, /\.settings-popup\.settings-page\s*\{[^}]*padding:\s*13px 2px 14px 17px;/s);
  assert.match(settingsStyles, /\.settings-popup\s+\.settings-page-header\s*\{[^}]*position:\s*static;[^}]*margin:\s*0 0 12px;[^}]*padding:\s*0 220px 10px 0;/s);
  assert.match(settingsStyles, /\.settings-page-actions\s*\{[^}]*position:\s*absolute;[^}]*right:\s*48px;/s);
  assert.match(settingsStyles, /\.settings-unsaved-label\s*\{[^}]*color:\s*var\(--red\);/s);
  assert.match(settingsStyles, /\.settings-page-save-button\s*\{[^}]*display:\s*inline-flex;/s);
  assert.match(settingsStyles, /\.settings-page-save-button\s*\{[^}]*border-color:\s*transparent;/s);
  assert.match(settingsStyles, /\.settings-page-save-button svg\s*\{[^}]*color:\s*var\(--accent\);/s);
  assert.match(settingsStyles, /\.settings-section-panel\[hidden\]\s*\{[^}]*display:\s*none;/s);
  assert.match(settingsStyles, /\.settings-unsaved-dialog\s*\{[^}]*width:\s*min\(420px,\s*calc\(100vw - 48px\)\);/s);
  assert.match(settingsStyles, /\.settings-popup\.settings-page\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/s);
  assert.match(settingsStyles, /\.settings-popup\s+\.settings-layout\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
  assert.match(
    settingsStyles,
    /\.settings-popup\s+\.settings-nav\s*\{[^}]*align-self:\s*stretch;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s,
  );
  assert.match(settingsStyles, /\.settings-popup\s+\.settings-nav-item\s*\{[^}]*min-height:\s*34px;/s);
  assert.match(settingsStyles, /\.settings-popup\s+\.settings-content\s*\{[^}]*overflow:\s*auto;/s);
  assert.match(settingsStyles, /\.settings-popup\s+\.connection-dialog-close\s*\{[^}]*position:\s*absolute;[^}]*top:\s*6px;[^}]*right:\s*4px;/s);
  assert.match(
    settingsStyles,
    /\.app-update-summary-grid \.settings-summary-item\s*\{[^}]*background:\s*transparent;[^}]*border:\s*0;[^}]*border-bottom:\s*1px solid var\(--border\);/s,
  );
  assert.match(
    settingsStyles,
    /\.app-update-summary-grid \.settings-summary-item:last-child\s*\{[^}]*border-bottom:\s*0;/s,
  );
  assert.match(
    settingsStyles,
    /\.app-update-check-row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) max-content max-content;[^}]*gap:\s*20px;/s,
  );
  assert.match(
    settingsStyles,
    /\.app-update-summary-grid \.app-update-check-row > strong\s*\{[^}]*color:\s*var\(--text-muted\);[^}]*font-size:\s*12px;[^}]*font-weight:\s*500;/s,
  );
  assert.match(
    settingsStyles,
    /\.app-update-check-controls\s*\{[^}]*display:\s*flex;[^}]*gap:\s*18px;[^}]*justify-content:\s*flex-end;/s,
  );
  assert.match(
    settingsStyles,
    /\.app-update-check-controls \.secondary-button\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*gap:\s*6px;[^}]*white-space:\s*nowrap;/s,
  );
  assert.match(nativeOverlaySource, /"\.settings-backdrop"/);
});
