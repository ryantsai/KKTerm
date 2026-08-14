import { useCallback, useEffect, useState } from "react";
import { Download, Package, RefreshCw, Shield, Trash2 } from "../../lib/reicon";
import { useTranslation } from "react-i18next";
import { Actions, Btn, ConfirmSheet, DialogShell, Sheet } from "../../app/ui/dialog";
import {
  invokeCommand,
  isTauriRuntime,
  selectCustomModulePackage,
} from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type {
  CustomModuleCatalogEntry,
  CustomModuleDataUsage,
  CustomModulePackageReview,
  CustomModulePermissions,
  InstalledCustomModule,
} from "../custom-modules/types";
import { CustomModuleIcon } from "../custom-modules/CustomModuleIcon";
import { compareCustomModuleVersions } from "../custom-modules/catalog";
import { SettingsSectionHeader } from "./shared";
import { ToggleSwitch } from "./ToggleSwitch";

const MODULES_CHANGED_EVENT = "kkterm:custom-modules-changed";

type PendingInstall = {
  path: string;
  review: CustomModulePackageReview;
};

type LicenseDetails = {
  title: string;
  text: string;
};

function formatDataSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }
  return `${value < 10 ? value.toFixed(1) : value.toFixed(0)} ${unit}`;
}

function permissionNames(permissions: CustomModulePermissions): string[] {
  const fileOperations = permissions.files
    ? [permissions.files.open && "open", permissions.files.save && "save"].filter(Boolean)
    : [];
  const files = permissions.files
    ? `files (${fileOperations.join("/")}${permissions.files.extensions.length
        ? `; ${permissions.files.extensions.map((extension) => `.${extension}`).join(", ")}`
        : ""})`
    : false;
  const networkFetch = permissions.networkFetch
    ? `networkFetch (${permissions.networkFetch.methods.join(", ")}; ${permissions.networkFetch.origins.join(", ")}${permissions.networkFetch.allowPrivateNetwork
        ? "; private network"
        : ""}; max ${formatDataSize(permissions.networkFetch.maxResponseBytes)})`
    : false;
  return [
    permissions.storage && "storage",
    permissions.documentStorage && "documentStorage",
    permissions.blobStorage && "blobStorage",
    permissions.browserStorage && "browserStorage",
    permissions.openExternal && "openExternal",
    permissions.clipboard && "clipboard",
    files,
    networkFetch,
    permissions.secretReferences && "secretReferences",
    permissions.hostUi && "hostUi",
  ].filter((name): name is string => Boolean(name));
}

function formatPermissions(permissions: CustomModulePermissions, none: string): string {
  const names = permissionNames(permissions);
  return names.length ? names.join(", ") : none;
}

export function CustomModulesSettings() {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [installed, setInstalled] = useState<InstalledCustomModule[]>([]);
  const [dataUsage, setDataUsage] = useState<Record<string, CustomModuleDataUsage | null>>({});
  const [catalog, setCatalog] = useState<CustomModuleCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<PendingInstall | null>(null);
  const [pendingCatalogInstall, setPendingCatalogInstall] =
    useState<CustomModuleCatalogEntry | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<InstalledCustomModule | null>(null);
  const [pendingClearData, setPendingClearData] = useState<InstalledCustomModule | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  const [licenseDetails, setLicenseDetails] = useState<LicenseDetails | null>(null);

  const reload = useCallback(async () => {
    if (!isTauriRuntime()) {
      setLoading(false);
      return;
    }
    try {
      const [nextInstalled, nextCatalog] = await Promise.all([
        invokeCommand("list_custom_modules"),
        invokeCommand("list_custom_module_catalog"),
      ]);
      setInstalled(nextInstalled);
      setCatalog(nextCatalog);
      const usageEntries = await Promise.all(nextInstalled.map(async (module) => {
        try {
          return [module.id, await invokeCommand("get_custom_module_data_usage", {
            moduleId: module.id,
          })] as const;
        } catch {
          return [module.id, null] as const;
        }
      }));
      setDataUsage(Object.fromEntries(usageEntries));
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [showStatusBarNotice]);

  const refreshCatalog = useCallback(async (announce: boolean) => {
    if (!isTauriRuntime()) return;
    setRefreshing(true);
    try {
      const nextCatalog = await invokeCommand("refresh_custom_module_catalog");
      setCatalog(nextCatalog);
      if (announce) {
        showStatusBarNotice(t("settings.customModulesCatalogRefreshedNotice"), {
          tone: "success",
        });
      }
    } catch (error) {
      if (announce) {
        showStatusBarNotice(error instanceof Error ? error.message : String(error), {
          tone: "error",
        });
      }
    } finally {
      setRefreshing(false);
    }
  }, [showStatusBarNotice, t]);

  useEffect(() => {
    void reload();
    void refreshCatalog(false);
  }, [refreshCatalog, reload]);

  function publishChange() {
    window.dispatchEvent(new Event(MODULES_CHANGED_EVENT));
  }

  async function choosePackage() {
    try {
      const path = await selectCustomModulePackage({
        title: t("settings.customModulesInstallFile"),
        filterName: t("settings.customModulesPackageFilter"),
      });
      if (!path) return;
      const review = await invokeCommand("inspect_custom_module_package", { path });
      setPendingInstall({ path, review });
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    }
  }

  async function installReviewedPackage() {
    const pending = pendingInstall;
    if (!pending) return;
    setPendingInstall(null);
    setBusyId(pending.review.manifest.id);
    try {
      await invokeCommand("install_custom_module_from_file", {
        path: pending.path,
        expectedSha256: pending.review.sha256,
      });
      await reload();
      publishChange();
      showStatusBarNotice(
        t("settings.customModulesInstalledNotice", {
          name: pending.review.manifest.name,
        }),
        { tone: "success" },
      );
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function installCatalogModule(entry: CustomModuleCatalogEntry) {
    const current = installed.find((module) => module.id === entry.id);
    setPendingCatalogInstall(null);
    setBusyId(entry.id);
    try {
      await invokeCommand("install_custom_module_from_catalog", {
        moduleId: entry.id,
        version: entry.version,
      });
      await reload();
      publishChange();
      showStatusBarNotice(t(current
        ? "settings.customModulesUpdatedNotice"
        : "settings.customModulesInstalledNotice", { name: entry.name, version: entry.version }), {
        tone: "success",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("download was cancelled")) {
        showStatusBarNotice(message, { tone: "error" });
      }
    } finally {
      setBusyId(null);
    }
  }

  async function updateFlag(
    module: InstalledCustomModule,
    field: "enabled" | "railVisible",
    value: boolean,
  ) {
    setBusyId(module.id);
    try {
      if (field === "enabled") {
        await invokeCommand("set_custom_module_enabled", {
          moduleId: module.id,
          enabled: value,
        });
      } else {
        await invokeCommand("set_custom_module_rail_visible", {
          moduleId: module.id,
          railVisible: value,
        });
      }
      await reload();
      publishChange();
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function uninstallModule() {
    const module = pendingUninstall;
    if (!module) return;
    setPendingUninstall(null);
    setBusyId(module.id);
    try {
      await invokeCommand("uninstall_custom_module", {
        moduleId: module.id,
        deleteData,
      });
      await reload();
      publishChange();
      showStatusBarNotice(t("settings.customModulesUninstalledNotice", { name: module.name }), {
        tone: "success",
      });
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setBusyId(null);
      setDeleteData(false);
    }
  }

  async function clearModuleData() {
    const module = pendingClearData;
    if (!module) return;
    setPendingClearData(null);
    setBusyId(module.id);
    try {
      await invokeCommand("clear_custom_module_data", { moduleId: module.id });
      await reload();
      showStatusBarNotice(t("settings.customModulesDataClearedNotice", { name: module.name }), {
        tone: "success",
      });
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  async function showLicense(module: InstalledCustomModule, notices: boolean) {
    try {
      const text = await invokeCommand("read_custom_module_license_file", {
        moduleId: module.id,
        notices,
      });
      setLicenseDetails({
        title: notices
          ? t("settings.customModulesNotices")
          : `${module.name} — ${module.license.name}`,
        text,
      });
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    }
  }

  async function rollbackModule(module: InstalledCustomModule) {
    setBusyId(module.id);
    try {
      const rolledBack = await invokeCommand("rollback_custom_module", { moduleId: module.id });
      await reload();
      publishChange();
      showStatusBarNotice(
        t("settings.customModulesRolledBackNotice", {
          name: rolledBack.name,
          version: rolledBack.version,
        }),
        { tone: "success" },
      );
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setBusyId(null);
    }
  }

  const available = catalog.filter((entry) => {
    const current = installed.find((module) => module.id === entry.id);
    return !current || compareCustomModuleVersions(entry.version, current.version) > 0;
  });
  const pendingCatalogCurrent = pendingCatalogInstall
    ? installed.find((module) => module.id === pendingCatalogInstall.id)
    : undefined;

  return (
    <section
      className="settings-card settings-section custom-modules-settings"
      data-tutorial-id="settings.customModules"
    >
      <SettingsSectionHeader
        actions={
          <>
            <button
              className="toolbar-button"
              disabled={refreshing}
              onClick={() => void refreshCatalog(true)}
              type="button"
            >
              <RefreshCw size={15} />
              {t("settings.customModulesRefreshCatalog")}
            </button>
            <button className="toolbar-button" onClick={() => void choosePackage()} type="button">
              <Download size={15} />
              {t("settings.customModulesInstallFile")}
            </button>
          </>
        }
        icon={<Package size={18} />}
        label={t("settings.sectionCustomModules")}
        title={t("settings.sectionCustomModules")}
      />
      <p className="settings-help-text">{t("settings.customModulesIntro")}</p>

      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.customModulesInstalled")}</legend>
        {loading ? <p className="settings-help-text">{t("common.loading")}</p> : null}
        {!loading && installed.length === 0 ? (
          <p className="settings-help-text">{t("settings.customModulesNoneInstalled")}</p>
        ) : null}
        <div className="custom-modules-list custom-modules-installed-list">
          {installed.map((module) => (
            <article className="custom-module-card" key={module.id}>
              <div className="custom-module-card-heading">
                <span className="custom-module-icon" aria-hidden="true">
                  <CustomModuleIcon
                    iconDataUrl={module.modules
                      .map((contribution) => module.iconDataUrls?.[contribution.id])
                      .find((iconDataUrl): iconDataUrl is string => Boolean(iconDataUrl))}
                    size={20}
                  />
                </span>
                <div>
                  <h3>{module.name}</h3>
                  <p>{module.summary}</p>
                </div>
                <span className={`custom-module-trust ${module.trust}`}>
                  <Shield size={13} />
                  {module.trust === "firstParty"
                    ? t("settings.customModulesTrustFirstParty")
                    : t("settings.customModulesTrustLocal")}
                </span>
              </div>
              <dl className="custom-module-meta">
                <div><dt>{t("settings.customModulesPublisher")}</dt><dd>{module.publisher}</dd></div>
                <div><dt>{t("settings.customModulesVersion")}</dt><dd>{module.version}</dd></div>
                <div><dt>{t("settings.customModulesLicense")}</dt><dd>{module.license.name}</dd></div>
              </dl>
              {module.health === "missing" ? (
                <p className="custom-module-health-error">
                  {t("settings.customModulesHealthMissing")}
                </p>
              ) : null}
              <div className="custom-module-permissions">
                <strong>{t("settings.customModulesPermissions")}</strong>
                <span>
                  {formatPermissions(module.permissions, t("settings.customModulesNoPermissions"))}
                </span>
              </div>
              <div className="custom-module-permissions">
                <strong>{t("settings.customModulesDataUsageLabel")}</strong>
                <span>
                  {dataUsage[module.id]
                    ? t("settings.customModulesDataUsage", {
                        size: formatDataSize(dataUsage[module.id]?.totalBytes ?? 0),
                        secretCount: dataUsage[module.id]?.secretCount ?? 0,
                      })
                    : t("settings.customModulesDataUsageUnavailable")}
                </span>
              </div>
              <div className="custom-module-controls">
                <label className="settings-toggle-row custom-module-toggle-row">
                  <span>{t("settings.customModulesEnabled")}</span>
                  <ToggleSwitch
                    checked={module.enabled}
                    disabled={busyId === module.id || module.health !== "ready"}
                    onChange={(value) => void updateFlag(module, "enabled", value)}
                  />
                </label>
                <label className="settings-toggle-row custom-module-toggle-row">
                  <span>{t("settings.customModulesShowRail")}</span>
                  <ToggleSwitch
                    checked={module.railVisible}
                    disabled={busyId === module.id || !module.enabled}
                    onChange={(value) => void updateFlag(module, "railVisible", value)}
                  />
                </label>
              </div>
              <div className="custom-module-actions">
                {module.previousVersion ? (
                  <button className="secondary-button" onClick={() => void rollbackModule(module)} type="button">
                    {t("settings.customModulesRollback", { version: module.previousVersion })}
                  </button>
                ) : null}
                <button className="secondary-button" onClick={() => void showLicense(module, false)} type="button">
                  {t("settings.customModulesOpenLicense")}
                </button>
                {module.license.noticesFile ? (
                  <button className="secondary-button" onClick={() => void showLicense(module, true)} type="button">
                    {t("settings.customModulesOpenNotices")}
                  </button>
                ) : null}
                <button
                  className="secondary-button"
                  disabled={busyId === module.id || module.enabled}
                  onClick={() => setPendingClearData(module)}
                  title={module.enabled ? t("settings.customModulesClearDataDisabled") : undefined}
                  type="button"
                >
                  {t("settings.customModulesClearData")}
                </button>
                <button
                  aria-label={t("settings.customModulesUninstall")}
                  className="settings-icon-danger-button"
                  disabled={busyId === module.id}
                  onClick={() => setPendingUninstall(module)}
                  type="button"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.customModulesAvailable")}</legend>
        {available.length === 0 ? (
          <p className="settings-help-text">{t("settings.customModulesNoneAvailable")}</p>
        ) : (
          <div className="custom-modules-list">
            {available.map((entry) => (
              <article className="custom-module-card compact" key={entry.id}>
                <div className="custom-module-card-heading">
                  <span className="custom-module-icon"><Package size={20} /></span>
                  <div><h3>{entry.name}</h3><p>{entry.summary}</p></div>
                  <button
                    className="primary-button"
                    disabled={busyId === entry.id || entry.apiVersion !== 2}
                    onClick={() => setPendingCatalogInstall(entry)}
                    type="button"
                  >
                    <Download size={14} />
                    {installed.some((module) => module.id === entry.id)
                      ? t("settings.customModulesUpdate")
                      : t("settings.customModulesInstall")}
                  </button>
                </div>
                {entry.apiVersion !== 2 ? (
                  <p className="custom-module-health-error">
                    {t("settings.customModulesIncompatible", { version: entry.apiVersion })}
                  </p>
                ) : null}
                <dl className="custom-module-meta">
                  <div><dt>{t("settings.customModulesPublisher")}</dt><dd>{entry.publisher}</dd></div>
                  <div><dt>{t("settings.customModulesVersion")}</dt><dd>{entry.version}</dd></div>
                  <div><dt>{t("settings.customModulesLicense")}</dt><dd>{entry.license}</dd></div>
                </dl>
                <div className="custom-module-permissions">
                  <strong>{t("settings.customModulesPermissions")}</strong>
                  <span>{formatPermissions(entry.permissions, t("settings.customModulesNoPermissions"))}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </fieldset>

      {pendingInstall ? (
        <ConfirmSheet
          confirmLabel={t("settings.customModulesInstall")}
          icon="info"
          message={
            <div>
              <p>{t("settings.customModulesInstallMessage", {
                name: pendingInstall.review.manifest.name,
                publisher: pendingInstall.review.manifest.publisher,
              })}</p>
              <p><strong>{t("settings.customModulesPermissions")}: </strong>{
                formatPermissions(
                  pendingInstall.review.manifest.permissions,
                  t("settings.customModulesNoPermissions"),
                )
              }</p>
            </div>
          }
          onCancel={() => setPendingInstall(null)}
          onConfirm={() => void installReviewedPackage()}
          title={t("settings.customModulesInstallTitle")}
          tone="warn"
        />
      ) : null}

      {pendingCatalogInstall ? (
        <ConfirmSheet
          confirmLabel={t(pendingCatalogCurrent
            ? "settings.customModulesUpdate"
            : "settings.customModulesInstall")}
          icon="info"
          message={
            <div>
              <p>{t(pendingCatalogCurrent
                ? "settings.customModulesUpdateMessage"
                : "settings.customModulesInstallVerifiedMessage", {
                  name: pendingCatalogInstall.name,
                  publisher: pendingCatalogInstall.publisher,
                  currentVersion: pendingCatalogCurrent?.version,
                  version: pendingCatalogInstall.version,
                })}</p>
              <p><strong>{t("settings.customModulesPermissions")}: </strong>{
                formatPermissions(
                  pendingCatalogInstall.permissions,
                  t("settings.customModulesNoPermissions"),
                )
              }</p>
            </div>
          }
          onCancel={() => setPendingCatalogInstall(null)}
          onConfirm={() => void installCatalogModule(pendingCatalogInstall)}
          title={t(pendingCatalogCurrent
            ? "settings.customModulesUpdateTitle"
            : "settings.customModulesInstallTitle")}
          tone="warn"
        />
      ) : null}

      {pendingUninstall ? (
        <ConfirmSheet
          confirmLabel={t("settings.customModulesUninstall")}
          message={
            <div>
              <p>{t("settings.customModulesUninstallMessage", { name: pendingUninstall.name })}</p>
              <label className="custom-module-delete-data">
                <input
                  checked={deleteData}
                  onChange={(event) => setDeleteData(event.currentTarget.checked)}
                  type="checkbox"
                />
                <span>{t("settings.customModulesDeleteData")}</span>
              </label>
            </div>
          }
          onCancel={() => {
            setPendingUninstall(null);
            setDeleteData(false);
          }}
          onConfirm={() => void uninstallModule()}
          title={t("settings.customModulesUninstallTitle")}
          tone="danger"
        />
      ) : null}

      {pendingClearData ? (
        <ConfirmSheet
          confirmLabel={t("settings.customModulesClearData")}
          message={t("settings.customModulesClearDataMessage", { name: pendingClearData.name })}
          onCancel={() => setPendingClearData(null)}
          onConfirm={() => void clearModuleData()}
          title={t("settings.customModulesClearDataTitle")}
          tone="danger"
        />
      ) : null}

      {licenseDetails ? (
        <DialogShell onBackdrop={() => setLicenseDetails(null)}>
          <Sheet
            ariaLabel={licenseDetails.title}
            footer={
              <Actions
                primary={<Btn onClick={() => setLicenseDetails(null)}>{t("common.close")}</Btn>}
              />
            }
            width={680}
          >
            <div className="custom-module-license-dialog">
              <h2>{licenseDetails.title}</h2>
              <pre>{licenseDetails.text}</pre>
            </div>
          </Sheet>
        </DialogShell>
      ) : null}
    </section>
  );
}
