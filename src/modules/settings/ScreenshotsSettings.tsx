import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { ScreenshotsModuleIcon } from "../../app/moduleIdentityIcons";
import { technicalInputProps } from "../../lib/inputBehavior";
import { useMacAppStoreBuild } from "../../lib/macAppStoreBuild";
import { isWindowsPlatform } from "../../lib/platform";
import { selectScreenshotFolder } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import { SettingsSectionHeader, useSettingsSaveRegistration } from "./shared";
import { ToggleSwitch } from "./ToggleSwitch";
import { ScreenshotShortcutRows } from "./ScreenshotShortcutRows";
import {
  screenshotSettingsHaveChanges,
  useScreenshotSettingsDraft,
} from "./screenshotSettingsDraft";

export function ScreenshotsSettings() {
  const { t } = useTranslation();
  // Video recording is hidden in the sandboxed Mac App Store build (no reachable
  // FFmpeg), so its output-format setting has nothing to act on there.
  const macAppStoreBuild = useMacAppStoreBuild();
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const saved = useScreenshotSettingsDraft((state) => state.saved);
  const draft = useScreenshotSettingsDraft((state) => state.draft);
  const useDirectxSaved = useScreenshotSettingsDraft((state) => state.useDirectxSaved);
  const useDirectxDraft = useScreenshotSettingsDraft((state) => state.useDirectxDraft);
  const load = useScreenshotSettingsDraft((state) => state.load);
  const update = useScreenshotSettingsDraft((state) => state.update);
  const updateUseDirectx = useScreenshotSettingsDraft((state) => state.updateUseDirectx);
  const save = useScreenshotSettingsDraft((state) => state.save);
  const hasChanges = screenshotSettingsHaveChanges({
    saved,
    draft,
    useDirectxSaved,
    useDirectxDraft,
  });

  useEffect(() => {
    void load()
      .catch((error) => {
        showStatusBarNotice(error instanceof Error ? error.message : String(error), {
          tone: "error",
        });
      });
  }, [load, showStatusBarNotice]);

  async function browseFolder() {
    try {
      // Goes through the shared selector so the Mac App Store build picks the
      // folder with the panel that stores a lasting grant; other builds get the
      // same native dialog as before.
      const selection = await selectScreenshotFolder({
        defaultPath: draft?.folderPath?.trim() || undefined,
        title: t("settings.screenshotsFolder"),
      });
      if (selection) {
        update({ folderPath: selection });
      }
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    }
  }

  async function handleSave() {
    try {
      if (await save()) {
        showStatusBarNotice(t("settings.screenshotsSaved"), { tone: "success" });
      }
    } catch (error) {
      showStatusBarNotice(error instanceof Error ? error.message : String(error), {
        tone: "error",
      });
    }
  }

  useSettingsSaveRegistration({ hasChanges, onSave: handleSave });

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

      {macAppStoreBuild ? null : (
      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.screenshotsVideoFormat")}</legend>
        <div>
          <p className="field-hint">{t("settings.screenshotsVideoFormatHint")}</p>
        </div>
        <div className="form-grid one-column">
          <label>
            <span>{t("settings.screenshotsVideoFormat")}</span>
            <select
              value={draft?.videoFormat ?? "mp4"}
              onChange={(event) => {
                const value = event.currentTarget.value;
                update({ videoFormat: value === "webm" || value === "gif" ? value : "mp4" });
              }}
            >
              <option value="mp4">{t("settings.screenshotsVideoFormatMp4")}</option>
              <option value="webm">{t("settings.screenshotsVideoFormatWebm")}</option>
              <option value="gif">{t("settings.screenshotsVideoFormatGif")}</option>
            </select>
          </label>
        </div>
      </fieldset>
      )}

      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.screenshotsCaptureMode")}</legend>
        <div>
          <p className="field-hint">{t("settings.screenshotsCaptureModeHint")}</p>
        </div>
        <div className="form-grid one-column">
          <label>
            <span>{t("settings.screenshotsCaptureMode")}</span>
            <select
              value={draft?.captureMode ?? "both"}
              onChange={(event) => {
                const value = event.currentTarget.value;
                update({
                  captureMode:
                    value === "folder" || value === "clipboard" ? value : "both",
                });
              }}
            >
              <option value="folder">{t("settings.screenshotsCaptureModeFolder")}</option>
              <option value="clipboard">
                {t("settings.screenshotsCaptureModeClipboard")}
              </option>
              <option value="both">{t("settings.screenshotsCaptureModeBoth")}</option>
            </select>
          </label>
        </div>
        {isWindowsPlatform() ? (
          <div className="settings-toggle-list">
            <label className="settings-toggle-row">
              <ToggleSwitch
                checked={draft?.includeCursor ?? false}
                onChange={(value) => update({ includeCursor: value })}
              />
              <span>
                <strong>{t("settings.screenshotsIncludeCursor")}</strong>
                <small>{t("settings.screenshotsIncludeCursorHint")}</small>
              </span>
            </label>
          </div>
        ) : null}
        <div className="settings-toggle-list">
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft?.openInEditorAfterCapture ?? false}
              disabled={draft?.captureMode === "clipboard"}
              onChange={(value) => update({ openInEditorAfterCapture: value })}
            />
            <span>
              <strong>{t("settings.screenshotsOpenInEditorAfterCapture")}</strong>
              <small>{t("settings.screenshotsOpenInEditorAfterCaptureHint")}</small>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.screenshotsBorder")}</legend>
        <div>
          <p className="field-hint">{t("settings.screenshotsBorderHint")}</p>
        </div>
        <div className="settings-toggle-list">
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft?.borderEnabled ?? true}
              onChange={(value) => update({ borderEnabled: value })}
            />
            <span>
              <strong>{t("settings.screenshotsBorderEnabled")}</strong>
              <small>{t("settings.screenshotsBorderEnabledHint")}</small>
            </span>
          </label>
        </div>
        {draft?.borderEnabled ? (
          <div className="form-grid two-columns">
            <label>
              <span>{t("settings.screenshotsBorderWidth")}</span>
              <input
                min={1}
                max={64}
                type="number"
                value={draft?.borderWidth ?? 1}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.currentTarget.value, 10);
                  update({
                    borderWidth: Number.isFinite(parsed)
                      ? Math.min(64, Math.max(1, parsed))
                      : 1,
                  });
                }}
              />
            </label>
            <label>
              <span>{t("settings.screenshotsBorderStyle")}</span>
              <select
                value={draft?.borderStyle ?? "solid"}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  update({
                    borderStyle:
                      value === "dashed" || value === "dotted" ? value : "solid",
                  });
                }}
              >
                <option value="solid">{t("settings.screenshotsBorderStyleSolid")}</option>
                <option value="dashed">{t("settings.screenshotsBorderStyleDashed")}</option>
                <option value="dotted">{t("settings.screenshotsBorderStyleDotted")}</option>
              </select>
            </label>
            <label>
              <span>{t("settings.screenshotsBorderColor")}</span>
              <input
                type="color"
                value={draft?.borderColor ?? "#000000"}
                onChange={(event) => update({ borderColor: event.currentTarget.value })}
              />
            </label>
          </div>
        ) : null}
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
          <label>
            <span>{t("settings.screenshotsQuality")}</span>
            <div className="screenshots-quality-row">
              <input
                min={1}
                max={100}
                type="range"
                disabled={draft?.format !== "jpeg"}
                value={draft?.quality ?? 90}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.currentTarget.value, 10);
                  update({
                    quality: Number.isFinite(parsed)
                      ? Math.min(100, Math.max(1, parsed))
                      : 90,
                  });
                }}
              />
              <output>{draft?.quality ?? 90}</output>
            </div>
            <small>{t("settings.screenshotsQualityHint")}</small>
          </label>
        </div>
      </fieldset>

      {isWindowsPlatform() ? (
        <fieldset
          className="settings-subsection settings-fieldset"
          data-tutorial-id="settings.useDirectxScreenCapture"
        >
          <legend>{t("settings.performance")}</legend>
          <div>
            <p className="field-hint">{t("settings.performanceHint")}</p>
          </div>
          <div className="settings-toggle-list">
            <label className="settings-toggle-row">
              <ToggleSwitch checked={useDirectxDraft} onChange={updateUseDirectx} />
              <span>
                <strong>{t("settings.useDirectxScreenCapture")}</strong>
                <small>{t("settings.useDirectxScreenCaptureHint")}</small>
              </span>
            </label>
          </div>
        </fieldset>
      ) : null}

      <fieldset className="settings-subsection settings-fieldset">
        <legend data-tutorial-id="settings.screenshotsShortcuts">
          {t("settings.screenshotsShortcuts")}
        </legend>
        <div>
          <p className="field-hint">{t("settings.screenshotsShortcutsHint")}</p>
        </div>
        <div className="shortcut-list" aria-label={t("settings.screenshotsShortcuts")}>
          <ScreenshotShortcutRows />
        </div>
      </fieldset>
    </section>
  );
}
