import { Network } from "../../lib/reicon";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type {
  RemoteDesktopViewMode,
  VncColorLevel,
  VncPerformancePreset,
  VncPreferredEncoding,
} from "../../types";
import { SettingsSectionHeader, useSettingsSaveRegistration } from "./shared";
import { ToggleSwitch } from "./ToggleSwitch";

export function VncSettings() {
  const { t } = useTranslation();
  const vncSettings = useWorkspaceStore((state) => state.vncSettings);
  const setVncSettings = useWorkspaceStore((state) => state.setVncSettings);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [draft, setDraft] = useState(vncSettings);
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(vncSettings);

  useEffect(() => {
    setDraft(vncSettings);
  }, [vncSettings]);

  async function handleSave() {
    try {
      const saved = isTauriRuntime()
        ? await invokeCommand("update_vnc_settings", { request: draft })
        : draft;
      setVncSettings(saved);
      setDraft(saved);
      showStatusBarNotice(t("settings.vncSettingsSaved"), { tone: "success" });
    } catch (saveError) {
      showStatusBarNotice(saveError instanceof Error ? saveError.message : String(saveError), { tone: "error" });
    }
  }

  useSettingsSaveRegistration({ hasChanges, onSave: handleSave });

  return (
    <section className="settings-card settings-section">
      <SettingsSectionHeader
        icon={<Network size={18} />}
        label={t("settings.sectionVnc")}
        title={t("settings.qualityDefaults")}
      />
      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.encoding")}</legend>
        <div className="form-grid two-columns">
          <label>
            <span>{t("settings.vncPerformancePreset")}</span>
            <select
              value={draft.performancePreset}
              onChange={(event) => {
                const performancePreset = event.currentTarget.value as VncPerformancePreset;
                setDraft((settings) => ({ ...settings, performancePreset }));
              }}
            >
              <option value="auto">{t("settings.vncPresetAuto")}</option>
              <option value="lan">{t("settings.vncPresetLan")}</option>
              <option value="balanced">{t("settings.vncPresetBalanced")}</option>
              <option value="lowBandwidth">{t("settings.vncPresetLowBandwidth")}</option>
              <option value="lossless">{t("settings.vncPresetLossless")}</option>
              <option value="custom">{t("settings.vncPresetCustom")}</option>
            </select>
            <small className="field-hint">{t("settings.vncPerformancePresetHint")}</small>
          </label>
        </div>
        {draft.performancePreset === "custom" ? (
        <div className="form-grid two-columns">
          <label>
            <span>{t("settings.preferredEncoding")}</span>
            <select
              value={draft.preferredEncoding}
              onChange={(event) => {
                const preferredEncoding = event.currentTarget.value as VncPreferredEncoding;
                setDraft((settings) => ({
                  ...settings,
                  preferredEncoding,
                }));
              }}
            >
              <option value="tight">{t("settings.vncEncodingTight")}</option>
              <option value="zrle">{t("settings.vncEncodingZrle")}</option>
              <option value="raw">{t("settings.vncEncodingRaw")}</option>
            </select>
          </label>
          <label data-tutorial-id="settings.vncColorLevel">
            <span>{t("settings.colorLevel")}</span>
            <select
              value={draft.colorLevel}
              onChange={(event) => {
                const colorLevel = event.currentTarget.value as VncColorLevel;
                setDraft((settings) => ({
                  ...settings,
                  colorLevel,
                }));
              }}
            >
              <option value="full">{t("settings.vncColorFull")}</option>
              <option value="256">{t("settings.vncColor256")}</option>
              <option value="64">{t("settings.vncColor64")}</option>
              <option value="8">{t("settings.vncColor8")}</option>
            </select>
          </label>
          <label>
            <span>{t("settings.vncCompressionLevel")}</span>
            <input
              type="number"
              min="0"
              max="9"
              value={draft.compressionLevel}
              onChange={(event) => {
                const compressionLevel = Number(event.currentTarget.value);
                setDraft((settings) => ({ ...settings, compressionLevel }));
              }}
            />
            <small className="field-hint">{t("settings.vncCompressionLevelHint")}</small>
          </label>
          <label>
            <span>{t("settings.vncJpegQuality")}</span>
            <input
              type="number"
              min="0"
              max="9"
              value={draft.jpegQuality}
              onChange={(event) => {
                const jpegQuality = Number(event.currentTarget.value);
                setDraft((settings) => ({ ...settings, jpegQuality }));
              }}
              disabled={!draft.jpegEnabled}
            />
            <small className="field-hint">{t("settings.vncJpegQualityHint")}</small>
          </label>
        </div>
        ) : null}
        {draft.performancePreset === "custom" ? (
          <div className="settings-toggle-list">
            <label className="settings-toggle-row">
              <ToggleSwitch
                checked={draft.jpegEnabled}
                onChange={(checked) => setDraft((settings) => ({ ...settings, jpegEnabled: checked }))}
              />
              <span>
                <strong>{t("settings.vncJpegEnabled")}</strong>
                <small>{t("settings.vncJpegEnabledHint")}</small>
              </span>
            </label>
          </div>
        ) : null}
      </fieldset>
      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("settings.display")}</legend>
        <div className="form-grid two-columns">
          <label>
            <span>{t("settings.remoteDesktopViewMode")}</span>
            <select
              value={draft.viewMode}
              onChange={(event) => {
                const viewMode = event.currentTarget.value as RemoteDesktopViewMode;
                setDraft((settings) => ({
                  ...settings,
                  viewMode,
                }));
              }}
            >
              <option value="fit">{t("settings.remoteDesktopViewModeFit")}</option>
              <option value="stretch">{t("settings.remoteDesktopViewModeStretch")}</option>
              <option value="actualSize">{t("settings.remoteDesktopViewModeActualSize")}</option>
              <option value="fitWidth">{t("settings.remoteDesktopViewModeFitWidth")}</option>
              <option value="fitHeight">{t("settings.remoteDesktopViewModeFitHeight")}</option>
            </select>
          </label>
        </div>
        <div className="settings-toggle-list">
          <label className="settings-toggle-row">
            <ToggleSwitch
              checked={draft.sharedSession}
              onChange={(checked) => setDraft((settings) => ({ ...settings, sharedSession: checked }))}
            />
            <span>
              <strong>{t("settings.vncSharedSession")}</strong>
              <small>{t("settings.vncSharedSessionHint")}</small>
            </span>
          </label>
          <label
            className="settings-toggle-row"
            data-tutorial-id="settings.vncViewOnly"
          >
            <ToggleSwitch
              checked={draft.viewOnly}
              onChange={(checked) => setDraft((settings) => ({ ...settings, viewOnly: checked }))}
            />
            <span>
              <strong>{t("settings.vncViewOnly")}</strong>
              <small>{t("settings.vncViewOnlyHint")}</small>
            </span>
          </label>
        </div>
      </fieldset>
    </section>
  );
}
