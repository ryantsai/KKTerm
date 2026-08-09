import { useEffect, useState } from "react";
import { Network } from "../../lib/reicon";
import { useTranslation } from "react-i18next";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { GeneralSettings, NetworkMapAnimationMode } from "../../types";
import { SettingsSectionHeader, useSettingsSaveRegistration } from "./shared";

export function ItOpsSettings() {
  const { t } = useTranslation();
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const setGeneralSettings = useWorkspaceStore((state) => state.setGeneralSettings);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [draft, setDraft] = useState<GeneralSettings>(generalSettings);
  const hasChanges =
    draft.networkMapAnimations !== generalSettings.networkMapAnimations;

  useEffect(() => {
    setDraft(generalSettings);
  }, [generalSettings]);

  async function handleSave() {
    try {
      const currentSettings = useWorkspaceStore.getState().generalSettings;
      const request = {
        ...currentSettings,
        networkMapAnimations: draft.networkMapAnimations,
      };
      const saved = isTauriRuntime()
        ? await invokeCommand("update_general_settings", { request })
        : request;
      setGeneralSettings(saved);
      setDraft(saved);
      showStatusBarNotice(t("settings.itOpsSaved"), { tone: "success" });
    } catch (saveError) {
      showStatusBarNotice(
        saveError instanceof Error ? saveError.message : String(saveError),
        { tone: "error" },
      );
    }
  }

  useSettingsSaveRegistration({ hasChanges, onSave: handleSave });

  return (
    <section className="settings-card settings-section">
      <SettingsSectionHeader
        icon={<Network size={18} />}
        label={t("settings.sectionItOps")}
        title={t("settings.sectionItOps")}
      />
      <fieldset className="settings-subsection settings-fieldset">
        <legend>{t("itops.networkMap.heading")}</legend>
        <div className="form-grid">
          <label>
            <span>{t("settings.networkMapAnimations")}</span>
            <select
              value={draft.networkMapAnimations}
              onChange={(event) =>
                setDraft((state) => ({
                  ...state,
                  networkMapAnimations: event.currentTarget
                    .value as NetworkMapAnimationMode,
                }))
              }
            >
              <option value="onHover">
                {t("settings.networkMapAnimationsOnHover")}
              </option>
              <option value="always">
                {t("settings.networkMapAnimationsAlways")}
              </option>
            </select>
            <small className="field-hint">
              {t("settings.networkMapAnimationsHint")}
            </small>
          </label>
        </div>
      </fieldset>
    </section>
  );
}
