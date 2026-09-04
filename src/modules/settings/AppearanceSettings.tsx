import { useEffect, useId, useRef, useState } from "react";
import { FolderOpen, Palette, RefreshCw, RotateCcw } from "../../lib/reicon";
import { useTranslation } from "react-i18next";
import {
  loadCustomFontOptions,
  normalizeAvailableAppearance,
} from "../../lib/customFonts";
import {
  isSystemFontAccessSupported,
  systemFontFamilies,
  systemFontsExcluding,
} from "../../lib/systemFonts";
import {
  getRecommendedFontOptions,
  loadSharedCustomFonts,
  refreshSharedFontCatalog,
  useSystemFontCatalog,
} from "../../lib/fontCatalog";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { AppearanceSettings as AppearanceSettingsType } from "../../types";
import { SettingsSectionHeader, useSettingsSaveRegistration } from "./shared";
import { ThemeSchemeGrid } from "./ThemeSchemeGrid";

/** CSS font stack for an OS font family picked from the system font list. */
function appSystemFontCssValue(family: string) {
  return `"${family}", ui-sans-serif, system-ui, sans-serif`;
}

export function AppearanceSettings({ onResetLayout }: { onResetLayout: () => void }) {
  const { t } = useTranslation();
  const fontFamilyId = useId();
  const appearanceSettings = useWorkspaceStore((state) => state.appearanceSettings);
  const setAppearanceSettings = useWorkspaceStore((state) => state.setAppearanceSettings);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const {
    customFonts,
    systemFonts,
    refreshing: refreshingFonts,
    recommendationsSynced,
  } = useSystemFontCatalog();
  const [draft, setDraft] = useState<AppearanceSettingsType>(appearanceSettings);
  // Tracks the last persisted settings so we can revert live preview on navigate-away
  const savedRef = useRef<AppearanceSettingsType>(appearanceSettings);
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(savedRef.current);

  // Revert live preview when navigating away without saving
  useEffect(() => {
    return () => {
      setAppearanceSettings(savedRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave() {
    try {
      const selectedCustomFont = customFonts.find((font) => font.cssValue === draft.appFontFamily);
      if (selectedCustomFont) {
        await loadCustomFontOptions([selectedCustomFont]);
      }
      const next: AppearanceSettingsType = {
        ...draft,
        customFontPath: selectedCustomFont?.path,
      };
      const saved = isTauriRuntime()
        ? await invokeCommand("update_appearance_settings", { request: next })
        : next;
      setAppearanceSettings(saved);
      setDraft(saved);
      savedRef.current = saved;
      showStatusBarNotice(t("settings.appearanceSaved"), { tone: "success" });
    } catch (saveError) {
      showStatusBarNotice(
        saveError instanceof Error ? saveError.message : String(saveError),
        { tone: "error" },
      );
    }
  }

  useEffect(() => {
    let disposed = false;
    if (!isTauriRuntime()) {
      return () => {
        disposed = true;
      };
    }

    void loadSharedCustomFonts()
      .then((fonts) => {
        if (disposed) return;
        const base = savedRef.current;
        const normalized = normalizeAvailableAppearance(base, fonts);
        if (JSON.stringify(normalized) !== JSON.stringify(base)) {
          savedRef.current = normalized;
          setDraft(normalized);
          setAppearanceSettings(normalized);
          invokeCommand("update_appearance_settings", { request: normalized }).catch(() => undefined);
        }
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
    };
    // Resolve available fonts once on mount; setAppearanceSettings is a stable store action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleOpenCustomFontsFolder() {
    if (!isTauriRuntime()) {
      return;
    }
    await invokeCommand("open_custom_fonts_folder");
  }

  async function handleRefreshSystemFonts() {
    if (!isSystemFontAccessSupported()) {
      showStatusBarNotice(t("settings.systemFontsUnavailable"), { tone: "error" });
      return;
    }
    try {
      await refreshSharedFontCatalog();
      showStatusBarNotice(t("settings.systemFontsRefreshed"), { tone: "success" });
    } catch (refreshError) {
      showStatusBarNotice(
        refreshError instanceof Error ? refreshError.message : String(refreshError),
        { tone: "error" },
      );
    }
  }

  // The app-UI font picker offers every family (not just monospace).
  const appSystemFonts = systemFontFamilies(systemFonts);
  const appFontOptions = getRecommendedFontOptions(
    "app-ui",
    undefined,
    recommendationsSynced ? appSystemFonts : undefined,
  );
  const curatedAppFontFamilies = appFontOptions.flatMap((option) => option.family ? [option.family] : []);
  const systemFontOptions = systemFontsExcluding(appSystemFonts, [
    ...curatedAppFontFamilies,
    ...customFonts.map((font) => font.name),
  ]).map((family) => ({ family, value: appSystemFontCssValue(family) }));
  const knownFontSelected = appFontOptions.some((option) => option.value === draft.appFontFamily);
  const customFontSelected = customFonts.some((font) => font.cssValue === draft.appFontFamily);
  const systemFontSelected = systemFontOptions.some((option) => option.value === draft.appFontFamily);

  useSettingsSaveRegistration({ hasChanges, onSave: handleSave });

  return (
    <section className="settings-card settings-section">
      <SettingsSectionHeader
        icon={<Palette size={18} />}
        label={t("settings.sectionAppearance")}
        title={t("settings.appearanceInterface")}
      />
      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.typography")}</legend>
        <div>
          <p className="field-hint">{t("settings.typographyHint")}</p>
        </div>
        <div className="form-grid appearance-font-grid">
          <label data-tutorial-id="settings.appUiFontFamily" htmlFor={fontFamilyId}>
            <span>{t("settings.appUiFontFamily")}</span>
            <div className="input-with-button font-input-with-button">
              <button
                aria-label={t("settings.refreshSystemFonts")}
                className="toolbar-button"
                disabled={refreshingFonts}
                onClick={() => void handleRefreshSystemFonts()}
                title={t("settings.refreshSystemFonts")}
                type="button"
              >
                <RefreshCw className={refreshingFonts ? "spin" : undefined} size={15} />
              </button>
              <select
                id={fontFamilyId}
                aria-label={t("settings.appUiFontFamily")}
                onChange={(event) => {
                  const selectedValue = event.currentTarget.value;
                  setDraft((s) => {
                    const next = { ...s, appFontFamily: selectedValue };
                    setAppearanceSettings(next);
                    return next;
                  });
                }}
                value={draft.appFontFamily}
              >
                {knownFontSelected || customFontSelected || systemFontSelected ? null : (
                  <option value={draft.appFontFamily}>{t("settings.customFont")}</option>
                )}
                {customFonts.length > 0 ? <optgroup label={t("settings.customFonts")}>{customFonts.map((font) => (
                  <option key={font.path} value={font.cssValue}>
                    {font.name}
                  </option>
                ))}</optgroup> : null}
                <optgroup label={t("settings.recommendedFonts")}>
                  {appFontOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.labelKey ? t(option.labelKey) : option.label}
                    </option>
                  ))}
                </optgroup>
                {systemFontOptions.length > 0 ? (
                  <optgroup label={t("settings.systemFonts")}>
                    {systemFontOptions.map((option) => (
                      <option key={option.family} value={option.value}>
                        {option.family}
                      </option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
              <button
                aria-label={t("settings.openCustomFontsFolder")}
                className="toolbar-button"
                onClick={() => void handleOpenCustomFontsFolder()}
                title={t("settings.openCustomFontsFolder")}
                type="button"
              >
                <FolderOpen size={15} />
              </button>
            </div>
            <small className="field-hint">{t("settings.customFontsHint")}</small>
          </label>
        </div>
      </fieldset>
      <fieldset
        className="settings-subsection settings-fieldset"
        data-tutorial-id="settings.appearance.colorScheme"
      >
        <legend>{t("settings.theme")}</legend>
        <div>
          <p className="field-hint">{t("settings.themeHint")}</p>
        </div>
        <ThemeSchemeGrid
          selected={draft.colorScheme}
          onSelect={(colorScheme) => {
            setDraft((s) => {
              const next = { ...s, colorScheme };
              setAppearanceSettings(next);
              return next;
            });
          }}
        />
      </fieldset>
      <div
        className="settings-reset-layout"
        data-tutorial-id="settings.resetLayout"
      >
        <div>
          <strong>{t("settings.layout")}</strong>
          <span>{t("settings.resetLayoutDescription")}</span>
        </div>
        <button className="toolbar-button" onClick={onResetLayout} type="button">
          <RotateCcw size={15} />
          {t("settings.resetLayout")}
        </button>
      </div>
    </section>
  );
}
