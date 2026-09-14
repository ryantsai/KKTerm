import { ExternalLink, FolderOpen, PackageOpen } from "../../lib/reicon";
import type { MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { openExternalUrl, openFilesystemPath } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import { ABOUT_PRODUCT } from "./aboutData";
import { SettingsSectionHeader, SettingsSummary } from "./shared";

export function AboutSettings() {
  const { t } = useTranslation();
  const appModeInfo = useWorkspaceStore((state) => state.appModeInfo);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const portable = appModeInfo.mode === "portable";
  const storeManaged = appModeInfo.updatesManagedByPlatformStore;
  const storeLinks = [
    {
      href: ABOUT_PRODUCT.homepageUrl,
      label: t("settings.homePage"),
      value: ABOUT_PRODUCT.homepageUrl,
    },
    {
      href: ABOUT_PRODUCT.privacyUrl,
      label: t("settings.privacy"),
      value: ABOUT_PRODUCT.privacyUrl,
    },
    {
      href: ABOUT_PRODUCT.legalNoticesUrl,
      label: t("settings.legalNotices"),
      value: ABOUT_PRODUCT.legalNoticesUrl,
    },
    {
      href: `mailto:${ABOUT_PRODUCT.supportEmail}`,
      label: t("settings.supportEmail"),
      value: ABOUT_PRODUCT.supportEmail,
    },
  ];

  async function openPortableDataFolder() {
    try {
      await openFilesystemPath(appModeInfo.dataDir);
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    }
  }

  function openStoreLink(event: MouseEvent<HTMLAnchorElement>, href: string) {
    event.preventDefault();
    void openExternalUrl(href).catch((error) => {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    });
  }

  return (
    <section className="settings-card settings-section">
      <SettingsSectionHeader
        actions={
          storeManaged ? null : (
            <a
              className="toolbar-button"
              href={ABOUT_PRODUCT.repositoryUrl}
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink size={15} />
              {t("settings.github")}
            </a>
          )
        }
        icon={<PackageOpen size={18} />}
        label={t("settings.sectionAbout")}
        title={ABOUT_PRODUCT.name}
      />

      <div className="about-hero">
        <div>
          <strong>
            {ABOUT_PRODUCT.name}
            {portable ? (
              <span className="settings-mode-badge">{t("settings.portableMode")}</span>
            ) : null}
          </strong>
          <span>{t("settings.appSlogan")}</span>
        </div>
        <PackageOpen size={34} />
      </div>

      <div
        className="settings-summary-grid"
        data-tutorial-id="settings.aboutVersion"
      >
        <SettingsSummary label={t("settings.developer")} value={ABOUT_PRODUCT.developer} />
        <SettingsSummary label={t("settings.version")} value={ABOUT_PRODUCT.version} />
        {storeManaged ? (
          storeLinks.map((link) => (
            <div className="settings-summary-item" key={link.href}>
              <span>{link.label}</span>
              <strong>
                <a
                  href={link.href}
                  onClick={(event) => openStoreLink(event, link.href)}
                  rel={link.href.startsWith("https:") ? "noreferrer" : undefined}
                  target={link.href.startsWith("https:") ? "_blank" : undefined}
                >
                  {link.value}
                </a>
              </strong>
            </div>
          ))
        ) : (
          <>
            <SettingsSummary label={t("settings.license")} value={ABOUT_PRODUCT.license} />
            <SettingsSummary label={t("settings.repository")} value={ABOUT_PRODUCT.repositoryUrl} />
          </>
        )}
        {portable ? (
          <SettingsSummary label={t("settings.portableDataFolder")} value={appModeInfo.dataDir} />
        ) : null}
      </div>
      {portable ? (
        <div className="settings-inline-actions">
          <button
            className="secondary-button"
            onClick={() => void openPortableDataFolder()}
            type="button"
          >
            <FolderOpen size={15} />
            {t("settings.openPortableDataFolder")}
          </button>
        </div>
      ) : null}
    </section>
  );
}
