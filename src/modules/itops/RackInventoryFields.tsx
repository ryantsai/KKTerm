import { useTranslation } from "react-i18next";
import { Btn, Field, TextArea, TextInput } from "../../app/ui/dialog";
import type { RackDeviceInventory, RackMaintenanceEntry } from "../../types";
import {
  HARDWARE_SPEC_FIELDS, MAX_MAINTENANCE_ENTRIES, isDeviceInventoryValid, localInventoryDate,
} from "./rackDeviceInventory";

export function RackInventoryFields({ value, onChange, disabled }: {
  value: RackDeviceInventory;
  onChange: (value: RackDeviceInventory) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const entries = value.maintenance ?? [];
  function changeEntry(id: string, patch: Partial<RackMaintenanceEntry>) {
    onChange({ ...value, maintenance: entries.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) });
  }
  return (
    <section className="rack-device-inventory kk-surface" data-tutorial-id="itops.rackInventory">
      <h3>{t("itops.racks.inventory.title")}</h3>
      <div className="rack-form-grid two">
        {HARDWARE_SPEC_FIELDS.map((field) => (
          <Field key={field} label={t(`itops.racks.inventory.${field}`)}>
            <TextArea rows={2} maxLength={500} value={value[field] ?? ""} disabled={disabled}
              onChange={(event) => onChange({ ...value, [field]: event.currentTarget.value })} />
          </Field>
        ))}
      </div>
      <div className="rack-maintenance-heading">
        <h3>{t("itops.racks.inventory.maintenance")}</h3>
        <Btn disabled={disabled || entries.length >= MAX_MAINTENANCE_ENTRIES} onClick={() => onChange({
          ...value, maintenance: [...entries, { id: crypto.randomUUID(), date: localInventoryDate(), notes: "" }],
        })}>{t("itops.racks.inventory.addMaintenance")}</Btn>
      </div>
      {entries.map((entry) => (
        <div key={entry.id} className="rack-maintenance-entry">
          <div className="rack-maintenance-date">
            <Field label={t("itops.racks.inventory.date")} req>
              <TextInput type="date" min="0001-01-01" max="9999-12-31" value={entry.date} disabled={disabled}
                onChange={(event) => changeEntry(entry.id, { date: event.currentTarget.value })} />
            </Field>
            <Btn kind="danger" disabled={disabled} onClick={() => onChange({
              ...value, maintenance: entries.filter((candidate) => candidate.id !== entry.id),
            })}>{t("itops.racks.inventory.removeMaintenance")}</Btn>
          </div>
          <Field label={t("itops.racks.inventory.details")} req>
            <TextArea rows={2} maxLength={2000} value={entry.notes} disabled={disabled}
              onChange={(event) => changeEntry(entry.id, { notes: event.currentTarget.value })} />
          </Field>
        </div>
      ))}
      {!isDeviceInventoryValid(value) ? (
        <p className="rack-inventory-validation" role="alert">{t("itops.racks.inventory.invalid")}</p>
      ) : null}
    </section>
  );
}
