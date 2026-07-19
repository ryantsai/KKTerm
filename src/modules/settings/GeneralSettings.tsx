import { useEffect, useState } from "react";
import {
  BedSingle,
  Download,
  FolderOpen,
  Gauge,
  GripVertical,
  Languages,
  LayoutDashboard,
  RefreshCw,
  RotateCcw,
  Settings as SettingsIcon,
  Upload,
} from "../../lib/reicon";
import { useTranslation } from "react-i18next";
import { CHECK_FOR_APP_UPDATES_EVENT } from "../../app/AppUpdatePrompt";
import { ModuleIconTile, type ModuleKind } from "../../app/ModuleHeader";
import { InstallHelperModuleIcon, ScreenshotsModuleIcon } from "../../app/moduleIdentityIcons";
import {
  activityRailModuleOrder,
  canHideActivityRailModule,
  reorderActivityRailItems,
} from "../../app/activityRailOrder";
import { LegacyDialogActions } from "../../app/ui/dialog";
import {
  defaultAppearanceSettings,
  defaultAiProviderSettings,
  defaultCredentialSettings,
  defaultDashboardSettings,
  defaultRdpSettings,
  defaultGeneralSettings,
  defaultSftpSettings,
  defaultSshSettings,
  defaultTerminalSettings,
  defaultUrlSettings,
  defaultVncSettings,
} from "../../app-defaults";
import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_STORAGE_KEY,
  switchLanguage,
  detectLanguage,
  type SupportedLanguage,
} from "../../i18n/config";
import {
  invokeCommand,
  isTauriRuntime,
  openFilesystemPath,
} from "../../lib/tauri";
import {
  isWindowsPlatform,
  supportsInstallerHelper,
  supportsMinimizeToTray,
} from "../../lib/platform";
import { useWorkspaceStore } from "../../store";
import {
  AI_PROVIDER_SECRET_OWNER_ID,
  EMAIL_API_SECRET_OWNER_ID,
  EMAIL_SMTP_SECRET_OWNER_ID,
  allAiProviderSecretOwnerIds,
} from "../../lib/settings";
import { useLastUpdateCheckAt } from "../../lib/lastUpdateCheck";
import { resetDurableUiState } from "../../lib/durableUiState";
import { CHILD_CONNECTIONS_UPDATED_EVENT } from "../workspace/connections/childConnections";
import { ABOUT_PRODUCT } from "./aboutData";
import { SelectiveExportDialog } from "./SelectiveExportDialog";
import { SelectiveImportDialog } from "./SelectiveImportDialog";
import {
  SettingsSectionHeader,
  SettingsSummary,
  useSettingsSaveRegistration,
} from "./shared";
import { ToggleSwitch } from "./ToggleSwitch";
import { ItIcon } from "../itops/icons";
import type { ActivityRailItemId } from "../../types";

const STATUS_BAR_MONITOR_INTERVAL_OPTIONS = [5, 15, 30, 60, 300] as const;

type ActivityRailVisibilitySetting =
  | "showWorkspaceOnRail"
  | "showDashboardOnRail"
  | "showInstallerOnRail"
  | "showScreenshotsOnRail"
  | "showItOps"
  | "showDontSleepOnRail";
const ACTIVITY_RAIL_SETTINGS: Record<
  ActivityRailItemId,
  [ActivityRailVisibilitySetting, string]
> = {
  workspace: ["showWorkspaceOnRail", "settings.sectionWorkspace"],
  dashboard: ["showDashboardOnRail", "settings.sectionDashboard"],
  installer: ["showInstallerOnRail", "settings.sectionInstaller"],
  screenshots: ["showScreenshotsOnRail", "settings.sectionScreenshots"],
  itops: ["showItOps", "settings.sectionItOps"],
  dontSleep: ["showDontSleepOnRail", "settings.sectionDontSleep"],
};

function ActivityRailModuleIcon({ id }: { id: ActivityRailItemId }) {
  if (id === "dontSleep") {
    return <BedSingle className="activity-rail-order-icon" size={17} />;
  }

  const module = id as ModuleKind;
  const icon =
    id === "workspace" ? (
      <LayoutDashboard aria-hidden="true" />
    ) : id === "dashboard" ? (
      <Gauge aria-hidden="true" />
    ) : id === "installer" ? (
      <InstallHelperModuleIcon aria-hidden="true" />
    ) : id === "screenshots" ? (
      <ScreenshotsModuleIcon aria-hidden="true" />
    ) : (
      <ItIcon name="ops" size={17} sw={1.7} />
    );

  return <ModuleIconTile compact module={module}>{icon}</ModuleIconTile>;
}

function formatBackupDate(value?: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function GeneralSettings() {
  const { t, i18n } = useTranslation();
  const windowsPlatform = isWindowsPlatform();
  const installerSupported = supportsInstallerHelper();
  const minimizeToTraySupported = supportsMinimizeToTray();
  const showWindowSettings = windowsPlatform || minimizeToTraySupported;
  const showPerformanceSettings = windowsPlatform;
  const lastCheckedAt = useLastUpdateCheckAt();
  const [currentLanguage, setCurrentLanguage] =
    useState<SupportedLanguage>(detectLanguage);
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const setGeneralSettings = useWorkspaceStore(
    (state) => state.setGeneralSettings,
  );
  const setCredentialSettings = useWorkspaceStore(
    (state) => state.setCredentialSettings,
  );
  const setTerminalSettings = useWorkspaceStore(
    (state) => state.setTerminalSettings,
  );
  const setDashboardSettings = useWorkspaceStore(
    (state) => state.setDashboardSettings,
  );
  const setAppearanceSettings = useWorkspaceStore(
    (state) => state.setAppearanceSettings,
  );
  const setSshSettings = useWorkspaceStore((state) => state.setSshSettings);
  const setSftpSettings = useWorkspaceStore((state) => state.setSftpSettings);
  const setUrlSettings = useWorkspaceStore((state) => state.setUrlSettings);
  const setRdpSettings = useWorkspaceStore((state) => state.setRdpSettings);
  const setVncSettings = useWorkspaceStore((state) => state.setVncSettings);
  const setAiProviderSettings = useWorkspaceStore(
    (state) => state.setAiProviderSettings,
  );
  const closeAllTabs = useWorkspaceStore((state) => state.closeAllTabs);
  const resetAllLayouts = useWorkspaceStore((state) => state.resetAllLayouts);
  const setAiProviderHasApiKey = useWorkspaceStore(
    (state) => state.setAiProviderHasApiKey,
  );
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [draft, setDraft] = useState(generalSettings);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [selectiveExportOpen, setSelectiveExportOpen] = useState(false);
  const [selectiveImportOpen, setSelectiveImportOpen] = useState(false);
  const [draggedRailItem, setDraggedRailItem] = useState<ActivityRailItemId | null>(null);
  const hasChanges =
    JSON.stringify(draft) !== JSON.stringify(generalSettings) ||
    currentLanguage !== detectLanguage();

  useEffect(() => {
    setDraft(generalSettings);
  }, [generalSettings]);

  async function handleSave() {
    try {
      const saved = isTauriRuntime()
        ? await invokeCommand("update_general_settings", { request: draft })
        : draft;
      setGeneralSettings(saved);
      setDraft(saved);
      await switchLanguage(currentLanguage);
      showStatusBarNotice(t("settings.generalDefaultsSaved"), { tone: "success" });
    } catch (saveError) {
      showStatusBarNotice(saveError instanceof Error ? saveError.message : String(saveError), { tone: "error" });
    }
  }

  async function handleOpenDatabaseFolder() {
    try {
      const path = await invokeCommand("get_database_folder");
      await openFilesystemPath(path);
    } catch (openError) {
      showStatusBarNotice(openError instanceof Error ? openError.message : String(openError), { tone: "error" });
    }
  }

  async function handleOpenLogFolder() {
    try {
      await invokeCommand("open_log_folder");
    } catch (openError) {
      showStatusBarNotice(openError instanceof Error ? openError.message : String(openError), {
        tone: "error",
      });
    }
  }

  async function handleResetAllSettings() {
    try {
      closeAllTabs();
      resetAllLayouts();

      if (isTauriRuntime()) {
        const [
          general,
          terminal,
          appearance,
          ssh,
          sftp,
          url,
          rdp,
          vnc,
          credential,
          aiProvider,
          dashboardSettings,
        ] = await Promise.all([
          invokeCommand("update_general_settings", {
            request: defaultGeneralSettings,
          }),
          invokeCommand("update_terminal_settings", {
            request: defaultTerminalSettings,
          }),
          invokeCommand("update_appearance_settings", {
            request: defaultAppearanceSettings,
          }),
          invokeCommand("update_ssh_settings", { request: defaultSshSettings }),
          invokeCommand("update_sftp_settings", { request: defaultSftpSettings }),
          invokeCommand("update_url_settings", { request: defaultUrlSettings }),
          invokeCommand("update_rdp_settings", { request: defaultRdpSettings }),
          invokeCommand("update_vnc_settings", { request: defaultVncSettings }),
          invokeCommand("update_credential_settings", {
            request: defaultCredentialSettings,
          }),
          invokeCommand("update_ai_provider_settings", {
            request: defaultAiProviderSettings,
          }),
          invokeCommand("update_dashboard_settings", {
            request: defaultDashboardSettings,
          }),
        ]);
        await Promise.all(
          Array.from(
            new Set([AI_PROVIDER_SECRET_OWNER_ID, ...allAiProviderSecretOwnerIds()]),
          ).map((ownerId) =>
            invokeCommand("delete_secret", {
              request: {
                kind: "aiApiKey",
                ownerId,
              },
            }),
          ),
        );
        await Promise.all([
          invokeCommand("delete_secret", {
            request: {
              kind: "emailApiKey",
              ownerId: EMAIL_API_SECRET_OWNER_ID,
            },
          }),
          invokeCommand("delete_secret", {
            request: {
              kind: "emailSmtpPassword",
              ownerId: EMAIL_SMTP_SECRET_OWNER_ID,
            },
          }),
        ]);
        setGeneralSettings(general);
        setTerminalSettings(terminal);
        setAppearanceSettings(appearance);
        setSshSettings(ssh);
        setSftpSettings(sftp);
        setUrlSettings(url);
        setRdpSettings(rdp);
        setVncSettings(vnc);
        setCredentialSettings(credential);
        setAiProviderSettings(aiProvider);
        setDashboardSettings(dashboardSettings);
      } else {
        setGeneralSettings(defaultGeneralSettings);
        setCredentialSettings(defaultCredentialSettings);
        setDashboardSettings(defaultDashboardSettings);
        setTerminalSettings(defaultTerminalSettings);
        setAppearanceSettings(defaultAppearanceSettings);
        setSshSettings(defaultSshSettings);
        setSftpSettings(defaultSftpSettings);
        setUrlSettings(defaultUrlSettings);
        setRdpSettings(defaultRdpSettings);
        setVncSettings(defaultVncSettings);
        setAiProviderSettings(defaultAiProviderSettings);
      }

      try {
        window.localStorage.removeItem(LANGUAGE_STORAGE_KEY);
      } catch {
        // Storage may be unavailable.
      }
      // Wipe durable frontend UI state (Quick Commands, Child Connection Tabs,
      // Notes content, favorites, CLI labels, IT Ops layout) from both the
      // database and the cache so it does not survive a settings reset.
      await resetDurableUiState();
      window.dispatchEvent(new CustomEvent(CHILD_CONNECTIONS_UPDATED_EVENT));
      const resetLanguage = detectLanguage();
      await switchLanguage(resetLanguage);
      setCurrentLanguage(resetLanguage);
      setAiProviderHasApiKey(false);
      window.dispatchEvent(
        new CustomEvent("kkterm:connection-tree-invalidated"),
      );
      showStatusBarNotice(t("settings.resetAllSettingsComplete"), { tone: "success" });
      setResetDialogOpen(false);
    } catch (resetError) {
      showStatusBarNotice(resetError instanceof Error ? resetError.message : String(resetError), { tone: "error" });
    }
  }

  async function handleImportFullSettings(path: string) {
    closeAllTabs();
    const snapshot = await invokeCommand("import_settings_database", { path });
    setGeneralSettings(snapshot.generalSettings);
    setDraft(snapshot.generalSettings);
    setCredentialSettings(snapshot.credentialSettings);
    setDashboardSettings(snapshot.dashboardSettings);
    setTerminalSettings(snapshot.terminalSettings);
    setAppearanceSettings(snapshot.appearanceSettings);
    setSshSettings(snapshot.sshSettings);
    setSftpSettings(snapshot.sftpSettings);
    setUrlSettings(snapshot.urlSettings);
    setRdpSettings(snapshot.rdpSettings);
    setVncSettings(snapshot.vncSettings);
    setAiProviderSettings(snapshot.aiProviderSettings);
    window.dispatchEvent(new CustomEvent("kkterm:connection-tree-invalidated"));
    showStatusBarNotice(t("settings.importSettingsComplete", { filename: snapshot.backup.filename }), {
      tone: "success",
    });
    window.setTimeout(() => window.location.reload(), 250);
  }

  const lastBackup = formatBackupDate(generalSettings.lastBackupAt);
  const lastCheckedLabel = lastCheckedAt
    ? t("settings.lastCheckedAt", {
        time: new Date(lastCheckedAt).toLocaleString(i18n.language),
      })
    : t("settings.lastCheckedNever");
  const visibleActivityRailModuleOrder = activityRailModuleOrder(
    draft.activityRailOrder,
  ).filter((id) => id !== "installer" || installerSupported);

  useSettingsSaveRegistration({ hasChanges, onSave: handleSave });

  return (
    <section className="settings-card settings-section">
      <SettingsSectionHeader
        icon={<SettingsIcon size={18} />}
        label={t("settings.sectionGeneral")}
        title={t("settings.generalDefaults")}
      />

      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.softwareUpdates")}</legend>
        <div className="settings-summary-grid compact app-update-summary-grid">
          <SettingsSummary label={t("settings.version")} value={ABOUT_PRODUCT.version} />
          <div className="settings-summary-item app-update-check-row">
            <span>{t("settings.updates")}</span>
            <strong>{lastCheckedLabel}</strong>
            <div className="app-update-check-controls">
              <label className="settings-toggle-row app-update-auto-checks">
                <span>
                  <strong>{t("settings.autoUpdateChecks")}</strong>
                </span>
                <ToggleSwitch
                  checked={draft.autoUpdateChecksEnabled}
                  onChange={(checked) =>
                    setDraft((s) => ({ ...s, autoUpdateChecksEnabled: checked }))
                  }
                />
              </label>
              <button
                className="secondary-button"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent(CHECK_FOR_APP_UPDATES_EVENT))
                }
                type="button"
              >
                <RefreshCw size={16} />
                {t("settings.checkForUpdates")}
              </button>
            </div>
          </div>
        </div>
      </fieldset>

      <div className="form-grid general-settings-grid">
        <label data-tutorial-id="settings.language">
          <span>
            <Languages size={17} /> {t("settings.language")}
          </span>
          <select
            value={currentLanguage}
            onChange={(event) => {
              const lang = event.currentTarget.value as SupportedLanguage;
              setCurrentLanguage(lang);
            }}
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>
                {t(`languages.${lang}`)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset
        className="settings-subsection settings-fieldset"
        data-tutorial-id="settings.activityRail"
      >
        <legend>{t("settings.activityRail")}</legend>
        <div className="settings-toggle-list">
          {visibleActivityRailModuleOrder.map((id) => {
            const [setting, labelKey] = ACTIVITY_RAIL_SETTINGS[id];
            const isLastVisibleModule =
              draft[setting] && !canHideActivityRailModule(draft, id);
            return <label
              className={`settings-toggle-row activity-rail-order-row${draggedRailItem === id ? " dragging" : ""}`}
              draggable
              key={id}
              onDragEnd={() => setDraggedRailItem(null)}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={(event) => {
                setDraggedRailItem(id);
                event.dataTransfer.effectAllowed = "move";
              }}
              onDrop={() => {
                if (draggedRailItem) {
                  setDraft((state) => ({
                    ...state,
                    activityRailOrder: reorderActivityRailItems(
                      state.activityRailOrder,
                      draggedRailItem,
                      id,
                    ),
                  }));
                }
                setDraggedRailItem(null);
              }}
            >
              <span className="activity-rail-order-main">
                <GripVertical className="activity-rail-order-grip" size={16} />
                <ActivityRailModuleIcon id={id} />
                <strong>{t(labelKey)}</strong>
              </span>
              <ToggleSwitch
                checked={draft[setting]}
                disabled={isLastVisibleModule}
                onChange={(checked) =>
                  setDraft((state) => ({ ...state, [setting]: checked }))
                }
              />
            </label>;
          })}
          <label className="settings-toggle-row activity-rail-order-row">
            <span className="activity-rail-order-main">
              <BedSingle className="activity-rail-order-icon" size={17} />
              <strong>{t("settings.sectionDontSleep")}</strong>
            </span>
            <ToggleSwitch
              checked={draft.showDontSleepOnRail}
              onChange={(checked) =>
                setDraft((state) => ({ ...state, showDontSleepOnRail: checked }))
              }
            />
          </label>
        </div>
      </fieldset>

      {showWindowSettings ? (
        <fieldset className="settings-subsection settings-fieldset">
          <legend>{t("settings.workspaceAccess")}</legend>
          <div>
            <p className="field-hint">{t("settings.workspaceAccessHint")}</p>
          </div>
          <div className="settings-toggle-list">
            {windowsPlatform ? (
              <label className="settings-toggle-row">
                <ToggleSwitch
                  checked={draft.autoStartWithWindows}
                  onChange={(checked) =>
                    setDraft((s) => ({ ...s, autoStartWithWindows: checked }))
                  }
                />
                <span>
                  <strong>{t("settings.autoStartWithWindows")}</strong>
                  <small>{t("settings.autoStartWithWindowsHint")}</small>
                </span>
              </label>
            ) : null}
            {minimizeToTraySupported ? (
              <label className="settings-toggle-row">
                <ToggleSwitch
                  checked={draft.minimizeToTray}
                  onChange={(checked) =>
                    setDraft((s) => ({ ...s, minimizeToTray: checked }))
                  }
                />
                <span>
                  <strong>{t("settings.minimizeToTray")}</strong>
                  <small>{t("settings.minimizeToTrayHint")}</small>
                </span>
              </label>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      {showPerformanceSettings ? (
        <fieldset
          className="settings-subsection settings-fieldset"
          data-tutorial-id="settings.workspaceAccess"
        >
          <legend>{t("settings.performance")}</legend>
          <div>
            <p className="field-hint">{t("settings.performanceHint")}</p>
          </div>
          <div className="settings-toggle-list">
            <label
              className="settings-toggle-row"
              data-tutorial-id="settings.useDirectxScreenCapture"
            >
              <ToggleSwitch
                checked={draft.useDirectxScreenCapture}
                onChange={(checked) =>
                  setDraft((s) => ({ ...s, useDirectxScreenCapture: checked }))
                }
              />
              <span>
                <strong>{t("settings.useDirectxScreenCapture")}</strong>
                <small>{t("settings.useDirectxScreenCaptureHint")}</small>
              </span>
            </label>
          </div>
        </fieldset>
      ) : null}

      <fieldset
        className="settings-subsection settings-fieldset"
        data-tutorial-id="settings.statusBar"
      >
        <legend>{t("settings.statusBar")}</legend>
        <div>
          <p className="field-hint">{t("settings.statusBarHint")}</p>
        </div>
        <div className="settings-toggle-list">
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.statusBarEnabled}
              onChange={(checked) =>
                setDraft((state) => ({ ...state, statusBarEnabled: checked }))
              }
            />
            <span>
              <strong>{t("settings.statusBarVisible")}</strong>
              <small>{t("settings.statusBarVisibleHint")}</small>
            </span>
          </label>
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.statusBarMonitorEnabled}
              onChange={(checked) =>
                setDraft((s) => ({ ...s, statusBarMonitorEnabled: checked }))
              }
            />
            <span>
              <strong>{t("settings.statusBarMonitor")}</strong>
              <small>{t("settings.statusBarMonitorHint")}</small>
            </span>
          </label>
        </div>
        <div className="form-grid general-settings-grid settings-merged-block">
          <label>
            <span>{t("settings.statusBarMonitorInterval")}</span>
            <select
              disabled={!draft.statusBarEnabled || !draft.statusBarMonitorEnabled}
              value={draft.statusBarMonitorIntervalSeconds}
              onChange={(event) =>
                setDraft((s) => ({
                  ...s,
                  statusBarMonitorIntervalSeconds: Number(event.currentTarget.value),
                }))
              }
            >
              {STATUS_BAR_MONITOR_INTERVAL_OPTIONS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {t(`settings.statusBarMonitorInterval${seconds}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </fieldset>

      <fieldset
        className="settings-subsection settings-fieldset"
        data-tutorial-id="settings.settingsData"
      >
        <legend>{t("settings.settingsData")}</legend>
        <div>
          <p className="field-hint">
            {t("settings.lastBackup", {
              value: lastBackup ?? t("settings.lastBackupNever"),
            })}
          </p>
        </div>
        <div className="settings-toggle-list">
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.autoBackupEnabled}
              onChange={(checked) =>
                setDraft((s) => ({ ...s, autoBackupEnabled: checked }))
              }
            />
            <span>
              <strong>{t("settings.autoBackup")}</strong>
              <small>{t("settings.autoBackupHint")}</small>
            </span>
          </label>
        </div>
        <div
          className="settings-data-actions settings-merged-block"
          aria-label={t("settings.settingsDataActions")}
        >
          <button
            className="secondary-button"
            type="button"
            onClick={() => setSelectiveExportOpen(true)}
          >
            <Download size={16} />
            {t("settings.exportSettings")}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => setSelectiveImportOpen(true)}
          >
            <Upload size={16} />
            {t("settings.importSettings")}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void handleOpenDatabaseFolder()}
          >
            <FolderOpen size={16} />
            {t("settings.openDatabaseFolder")}
          </button>
          <button
            className="secondary-button danger"
            type="button"
            onClick={() => setResetDialogOpen(true)}
          >
            <RotateCcw size={16} />
            {t("settings.resetAllSettings")}
          </button>
        </div>
      </fieldset>

      <fieldset
        className="settings-subsection settings-fieldset"
        data-tutorial-id="settings.debug"
      >
        <legend>{t("settings.debug")}</legend>
        <div>
          <p className="field-hint">{t("settings.debugHint")}</p>
        </div>
        <div className="settings-toggle-list">
          <div className="settings-toggle-row">
            <span>
              <strong>{t("settings.advancedDebugging")}</strong>
              <small>{t("settings.advancedDebuggingHint")}</small>
            </span>
            <div className="settings-toggle-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => void handleOpenLogFolder()}
              >
                <FolderOpen size={16} />
                {t("settings.openLogFolder")}
              </button>
              <ToggleSwitch
                checked={draft.advancedDebuggingEnabled}
                onChange={(checked) =>
                  setDraft((s) => ({ ...s, advancedDebuggingEnabled: checked }))
                }
              />
            </div>
          </div>
          {windowsPlatform ? (
            <label className="settings-toggle-row">
              <ToggleSwitch
                checked={draft.rdpWebviewStability}
                onChange={(checked) =>
                  setDraft((s) => ({ ...s, rdpWebviewStability: checked }))
                }
              />
              <span>
                <strong>{t("settings.rdpWebviewStability")}</strong>
                <small>{t("settings.rdpWebviewStabilityHint")}</small>
              </span>
            </label>
          ) : null}
        </div>
      </fieldset>

      {resetDialogOpen ? (
        <div className="dialog-backdrop connection-dialog-backdrop" role="presentation">
          <div
            aria-label={t("settings.resetAllSettings")}
            aria-modal="true"
            className="connection-dialog settings-reset-dialog"
            role="dialog"
          >
            <header className="connection-dialog-header compact">
              <div>
                <p className="panel-label">{t("settings.sectionGeneral")}</p>
                <h2>{t("settings.resetAllSettings")}</h2>
              </div>
            </header>
            <p className="field-hint">{t("settings.resetAllSettingsConfirm")}</p>
            <LegacyDialogActions
              primary={<button
                className="secondary-button danger"
                onClick={() => void handleResetAllSettings()}
                type="button"
              >
                <RotateCcw size={15} />
                {t("settings.resetAllSettings")}
              </button>}
              cancel={<button
                className="toolbar-button"
                onClick={() => setResetDialogOpen(false)}
                type="button"
              >
                {t("common.cancel")}
              </button>}
            />
          </div>
        </div>
      ) : null}
      {selectiveExportOpen ? (
        <SelectiveExportDialog onClose={() => setSelectiveExportOpen(false)} />
      ) : null}
      {selectiveImportOpen ? (
        <SelectiveImportDialog
          onClose={() => setSelectiveImportOpen(false)}
          onFullImport={handleImportFullSettings}
        />
      ) : null}
    </section>
  );
}
