import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScreenshotsModuleIcon } from "../../app/moduleIdentityIcons";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { technicalInputProps } from "../../lib/inputBehavior";
import { useWorkspaceStore } from "../../store";
import type { ScreenshotSettings as ScreenshotSettingsModel } from "../../types";
import { SettingsSectionHeader, useSettingsSaveRegistration } from "./shared";
import { ToggleSwitch } from "./ToggleSwitch";

export function ScreenshotsSettings() {
  const { t } = useTranslation();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [saved, setSaved] = useState<ScreenshotSettingsModel | null>(null);
  const [draft, setDraft] = useState<ScreenshotSettingsModel | null>(null);
  const hasChanges =
    Boolean(saved && draft) && JSON.stringify(draft) !== JSON.stringify(saved);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }
    let disposed = false;
    invokeCommand("get_screenshot_settings", undefined)
      .then((settings) => {
        if (!disposed) {
          setSaved(settings);
          setDraft(settings);
        }
      })
      .catch((error) => {
        showStatusBarNotice(error instanceof Error ? error.message : String(error), {
          tone: "error",
        });
      });
    return () => {
      disposed = true;
    };
    // Load once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(patch: Partial<ScreenshotSettingsModel>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function browseFolder() {
    try {
      const selection = await openDialog({ directory: true, multiple: false });
      if (typeof selection === "string" && selection) {
        update({ folderPath: selection });
      }
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    }
  }

  async function handleSave() {
    if (!draft) {
      return;
    }
    try {
      const savedSettings = await invokeCommand("update_screenshot_settings", {
        request: draft,
      });
      setSaved(savedSettings);
      setDraft(savedSettings);
      showStatusBarNotice(t("settings.screenshotsSaved"), { tone: "success" });
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    }
  }

  useSettingsSaveRegistration({ hasChanges, onSave: handleSave });

  function shortcutRow(
    label: string,
    shortcutKey: "regionShortcut" | "windowShortcut" | "fullscreenShortcut",
    enabledKey:
      | "regionShortcutEnabled"
      | "windowShortcutEnabled"
      | "fullscreenShortcutEnabled",
  ) {
    if (!draft) {
      return null;
    }
    return (
      <div className="settings-list-row">
        <div>
          <strong>{label}</strong>
        </div>
        <div className="screenshots-shortcut-controls">
          <input
            {...technicalInputProps}
            value={draft[shortcutKey]}
            placeholder={t("settings.screenshotsShortcutPlaceholder")}
            disabled={!draft[enabledKey]}
            onChange={(event) => update({ [shortcutKey]: event.currentTarget.value })}
            aria-label={label}
          />
          <ToggleSwitch
            checked={draft[enabledKey]}
            onChange={(checked) => update({ [enabledKey]: checked })}
          />
        </div>
      </div>
    );
  }

  return (
    <section className="settings-card settings-section">
      <SettingsSectionHeader
        icon={<ScreenshotsModuleIcon size={18} />}
        label={t("settings.sectionScreenshots")}
        title={t("settings.screenshotsDefaults")}
      />

      <fieldset className="settings-subsection settings-fieldset">
        <legend data-tutorial-id="settings.screenshotsFolder">
          {t("settings.screenshotsFolder")}
        </legend>
        <div>
          <p className="field-hint">{t("settings.screenshotsFolderHint")}</p>
        </div>
        <div className="form-grid one-column">
          <label>
            <span>{t("settings.screenshotsFolder")}</span>
            <div className="screenshots-folder-row">
              <input
                {...technicalInputProps}
                value={draft?.folderPath ?? ""}
                onChange={(event) => update({ folderPath: event.currentTarget.value })}
              />
              <button
                className="secondary-button"
                type="button"
                onClick={() => void browseFolder()}
              >
                {t("settings.screenshotsBrowse")}
              </button>
            </div>
          </label>
        </div>
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend data-tutorial-id="settings.screenshotsFormat">
          {t("settings.screenshotsFormat")}
        </legend>
        <div>
          <p className="field-hint">{t("settings.screenshotsFormatHint")}</p>
        </div>
        <div className="form-grid two-columns">
          <label>
            <span>{t("settings.screenshotsFormat")}</span>
            <select
              value={draft?.format ?? "png"}
              onChange={(event) =>
                update({ format: event.currentTarget.value === "jpeg" ? "jpeg" : "png" })
              }
            >
              <option value="png">{t("settings.screenshotsFormatPng")}</option>
              <option value="jpeg">{t("settings.screenshotsFormatJpeg")}</option>
            </select>
          </label>
          {draft?.format === "jpeg" ? (
            <label>
              <span>{t("settings.screenshotsJpegQuality")}</span>
              <input
                type="number"
                min={1}
                max={100}
                value={draft.jpegQuality}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.currentTarget.value, 10);
                  update({
                    jpegQuality: Number.isFinite(parsed)
                      ? Math.min(100, Math.max(1, parsed))
                      : 90,
                  });
                }}
              />
            </label>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend data-tutorial-id="settings.screenshotsShortcuts">
          {t("settings.screenshotsShortcuts")}
        </legend>
        <div>
          <p className="field-hint">{t("settings.screenshotsShortcutsHint")}</p>
        </div>
        <div className="settings-list" aria-label={t("settings.screenshotsShortcuts")}>
          {shortcutRow(
            t("screenshots.captureRegion"),
            "regionShortcut",
            "regionShortcutEnabled",
          )}
          {shortcutRow(
            t("screenshots.captureWindow"),
            "windowShortcut",
            "windowShortcutEnabled",
          )}
          {shortcutRow(
            t("screenshots.captureFullscreen"),
            "fullscreenShortcut",
            "fullscreenShortcutEnabled",
          )}
        </div>
        <p className="field-hint">{t("settings.screenshotsDirectxNote")}</p>
      </fieldset>
    </section>
  );
}
