import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmSheet } from "../../app/ui/dialog";
import { ItIcon } from "../itops/icons";
import { CUSTOM_FIELD_RECORD_KINDS, CUSTOM_FIELD_TYPES } from "../itops/customFieldModel";
import type { CustomFieldDefinition, CustomFieldRecordKind, CustomFieldType } from "../itops/customFieldTypes";

export function ItOpsCustomFieldSettings({ fields, savedFields, onChange, disabled }: {
  fields: CustomFieldDefinition[]; savedFields: CustomFieldDefinition[];
  onChange: (fields: CustomFieldDefinition[]) => void; disabled: boolean;
}) {
  const { t } = useTranslation();
  const [removing, setRemoving] = useState<CustomFieldDefinition | null>(null);
  const pendingFocus = useRef<string | null>(null);
  function update(id: string, patch: Partial<CustomFieldDefinition>) {
    onChange(fields.map((field) => field.id === id ? { ...field, ...patch } : field));
  }
  return <fieldset className="settings-subsection settings-fieldset" data-tutorial-id="settings.itopsCustomFields" disabled={disabled}>
    <legend>{t("itops.customFields.heading")}</legend>
    <p className="field-hint">{t("itops.customFields.settingsHint")}</p>
    <div className="it-custom-field-definitions">
      {fields.length > 0 ? <div className="it-custom-field-heading" aria-hidden="true"><span>{t("itops.customFields.name")}</span><span>{t("itops.customFields.recordKind")}</span><span>{t("itops.customFields.type")}</span><span /></div> : null}
      {fields.map((field) => {
      const saved = savedFields.some((entry) => entry.id === field.id);
      return <div className="it-custom-field-definition" key={field.id} role="group" aria-label={field.name || t("itops.customFields.add")}>
        <div className="it-custom-field-row">
          <label className="it-custom-field-name"><span className="it-custom-field-label">{t("itops.customFields.name")}</span><input placeholder={t("itops.customFields.name")} value={field.name} maxLength={120}
            ref={(input) => { if (input && pendingFocus.current === field.id) { input.focus(); pendingFocus.current = null; } }}
            onChange={(event) => update(field.id, { name: event.currentTarget.value })} /></label>
          {saved ? <div className="it-custom-field-readonly"><span className="it-custom-field-label">{t("itops.customFields.recordKind")}</span><span>{t(`itops.customFields.recordType.${field.recordKind}`)}</span></div>
            : <label><span className="it-custom-field-label">{t("itops.customFields.recordKind")}</span><select value={field.recordKind} onChange={(event) => update(field.id, { recordKind: event.currentTarget.value as CustomFieldRecordKind })}>
            {CUSTOM_FIELD_RECORD_KINDS.map((kind) => <option key={kind} value={kind}>{t(`itops.customFields.recordType.${kind}`)}</option>)}
          </select></label>}
          {saved ? <div className="it-custom-field-readonly"><span className="it-custom-field-label">{t("itops.customFields.type")}</span><span>{t(`itops.customFields.types.${field.type}`)}</span></div>
            : <label><span className="it-custom-field-label">{t("itops.customFields.type")}</span><select value={field.type} onChange={(event) => update(field.id, { type: event.currentTarget.value as CustomFieldType, options: [] })}>
            {CUSTOM_FIELD_TYPES.map((type) => <option key={type} value={type}>{t(`itops.customFields.types.${type}`)}</option>)}
          </select></label>}
          <button type="button" className="toolbar-button danger it-custom-field-remove" data-preserve-content-focus="true" aria-label={t("common.delete")} title={t("common.delete")} onClick={() => saved ? setRemoving(field) : onChange(fields.filter((entry) => entry.id !== field.id))}>
            <ItIcon name="trash" size={14} />
          </button>
        </div>
        {field.type === "select" ? <details className="it-custom-field-options" open={!saved}>
          <summary>{t("itops.customFields.options")}</summary>
          <textarea aria-label={t("itops.customFields.options")} rows={2} value={field.options.join("\n")} onChange={(event) => update(field.id, { options: event.currentTarget.value.split(/\r?\n/) })} />
          <small className="field-hint">{t("itops.customFields.optionsHint")}</small>
        </details> : null}
      </div>;
    })}</div>
    <div className="it-custom-field-actions">
      <button type="button" className="toolbar-button" data-preserve-content-focus="true" disabled={fields.length >= 128} onClick={() => {
        const id = `cf-${crypto.randomUUID()}`;
        pendingFocus.current = id;
        onChange([...fields, { id, name: "", recordKind: "prefix", type: "text", options: [] }]);
      }}>
        <ItIcon name="plus" size={14} />{t("itops.customFields.add")}
      </button>
      {savedFields.length > 0 ? <small className="field-hint">{t("itops.customFields.immutableHint")}</small> : null}
    </div>
    {removing ? <ConfirmSheet tone="danger" title={t("itops.customFields.removeTitle")} message={t("itops.customFields.removeBody", { name: removing.name })} confirmLabel={t("common.delete")} confirmIcon="trash"
      onCancel={() => setRemoving(null)} onConfirm={() => { onChange(fields.filter((entry) => entry.id !== removing.id)); setRemoving(null); }} /> : null}
  </fieldset>;
}
