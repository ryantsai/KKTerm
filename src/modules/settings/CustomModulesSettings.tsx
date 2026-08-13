import { useCallback, useEffect, useState } from "react";
import { Download, Package, Shield, Trash2 } from "../../lib/reicon";
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
  CustomModulePackageReview,
  InstalledCustomModule,
} from "../custom-modules/types";
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

export function CustomModulesSettings() {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [installed, setInstalled] = useState<InstalledCustomModule[]>([]);
  const [catalog, setCatalog] = useState<CustomModuleCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] = useState<PendingInstall | null>(null);
  const [pendingCatalogInstall, setPendingCatalogInstall] =
    useState<CustomModuleCatalogEntry | null>(null);
  const [pendingUninstall, setPendingUninstall] = useState<InstalledCustomModule | null>(null);
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
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [showStatusBarNotice]);

  useEffect(() => {
    void reload();
  }, [reload]);

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
    setPendingCatalogInstall(null);
    setBusyId(entry.id);
    try {
      await invokeCommand("install_custom_module_from_catalog", { moduleId: entry.id });
      await reload();
      publishChange();
      showStatusBarNotice(t("settings.customModulesInstalledNotice", { name: entry.name }), {
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

  const available = catalog.filter(
    (entry) => !installed.some((module) => module.id === entry.id && module.version === entry.version),
  );

  return (
    <section
      className="settings-card settings-section custom-modules-settings"
      data-tutorial-id="settings.customModules"
    >
      <SettingsSectionHeader
        actions={
          <button className="toolbar-button" onClick={() => void choosePackage()} type="button">
            <Download size={15} />
            {t("settings.customModulesInstallFile")}
          </button>
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
        <div className="custom-modules-list">
          {installed.map((module) => (
            <article className="custom-module-card" key={module.id}>
              <div className="custom-module-card-heading">
                <span className="custom-module-icon" aria-hidden="true">
                  <Package size={20} />
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
                  {module.permissions.length > 0
                    ? module.permissions.join(", ")
                    : t("settings.customModulesNoPermissions")}
                </span>
              </div>
              <div className="custom-module-controls">
                <label>
                  <span>{t("settings.customModulesEnabled")}</span>
                  <ToggleSwitch
                    checked={module.enabled}
                    disabled={busyId === module.id || module.health !== "ready"}
                    onChange={(value) => void updateFlag(module, "enabled", value)}
                  />
                </label>
                <label>
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
                  className="secondary-button danger-button"
                  disabled={busyId === module.id}
                  onClick={() => setPendingUninstall(module)}
                  type="button"
                >
                  <Trash2 size={14} />
                  {t("settings.customModulesUninstall")}
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
                    disabled={busyId === entry.id || entry.apiVersion !== 1}
                    onClick={() => setPendingCatalogInstall(entry)}
                    type="button"
                  >
                    <Download size={14} />
                    {t("settings.customModulesInstall")}
                  </button>
                </div>
                {entry.apiVersion !== 1 ? (
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
                  <span>{entry.permissions.length ? entry.permissions.join(", ") : t("settings.customModulesNoPermissions")}</span>
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
                pendingInstall.review.manifest.permissions.length
                  ? pendingInstall.review.manifest.permissions.join(", ")
                  : t("settings.customModulesNoPermissions")
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
          confirmLabel={t("settings.customModulesInstall")}
          icon="info"
          message={
            <div>
              <p>{t("settings.customModulesInstallMessage", {
                name: pendingCatalogInstall.name,
                publisher: pendingCatalogInstall.publisher,
              })}</p>
              <p><strong>{t("settings.customModulesPermissions")}: </strong>{
                pendingCatalogInstall.permissions.length
                  ? pendingCatalogInstall.permissions.join(", ")
                  : t("settings.customModulesNoPermissions")
              }</p>
            </div>
          }
          onCancel={() => setPendingCatalogInstall(null)}
          onConfirm={() => void installCatalogModule(pendingCatalogInstall)}
          title={t("settings.customModulesInstallTitle")}
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
