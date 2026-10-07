import { useEffect, useState } from "react";
import { Network } from "../../lib/reicon";
import { useTranslation } from "react-i18next";
import { invokeCommand, isTauriRuntime } from "../../lib/tauri";
import { useWorkspaceStore } from "../../store";
import type { GeneralSettings, NetworkMapAnimationMode } from "../../types";
import { SettingsSectionHeader, useSettingsSaveRegistration } from "./shared";
import { ItOpsCustomFieldSettings } from "./ItOpsCustomFieldSettings";
import { useItOpsStore } from "../itops/state";
import type { CustomFieldDefinition } from "../itops/customFieldTypes";

export function ItOpsSettings() {
  const { t } = useTranslation();
  const generalSettings = useWorkspaceStore((state) => state.generalSettings);
  const setGeneralSettings = useWorkspaceStore((state) => state.setGeneralSettings);
  const showStatusBarNotice = useWorkspaceStore((state) => state.showStatusBarNotice);
  const [draft, setDraft] = useState<GeneralSettings>(generalSettings);
  const customFields = useItOpsStore((state) => state.customFields.fields);
  const customFieldsLoaded = useItOpsStore((state) => state.customFieldsLoaded);
  const loadCustomFields = useItOpsStore((state) => state.loadCustomFields);
  const saveCustomFields = useItOpsStore((state) => state.saveCustomFields);
  const [fieldDraft, setFieldDraft] = useState<CustomFieldDefinition[]>(customFields);
  const [saving, setSaving] = useState(false);
  const fieldChanges = JSON.stringify(fieldDraft) !== JSON.stringify(customFields);
  const hasChanges =
    draft.networkMapAnimations !== generalSettings.networkMapAnimations || fieldChanges;

  useEffect(() => {
    void loadCustomFields().catch((error: unknown) => showStatusBarNotice(String(error), { tone: "error" }));
  }, [loadCustomFields, showStatusBarNotice]);
  useEffect(() => setFieldDraft(customFields), [customFields]);

  useEffect(() => {
    setDraft(generalSettings);
  }, [generalSettings]);

  async function handleSave() {
    if (saving || !customFieldsLoaded) return;
    setSaving(true);
    try {
      if (fieldChanges) await saveCustomFields(fieldDraft);
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
    } finally {
      setSaving(false);
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
              onChange={(event) => {
                const networkMapAnimations = event.currentTarget.value as NetworkMapAnimationMode;
                setDraft((state) => ({
                  ...state,
                  networkMapAnimations,
                }));
              }}
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
      <ItOpsCustomFieldSettings fields={fieldDraft} savedFields={customFields} onChange={setFieldDraft} disabled={!customFieldsLoaded || saving} />
    </section>
  );
}
