import type { RackDeviceInventory } from "../../types";

export const HARDWARE_SPEC_FIELDS = ["cpu", "memory", "storage", "network", "raid"] as const;
export const MAX_MAINTENANCE_ENTRIES = 100;

export function normalizeDeviceInventory(value: RackDeviceInventory): RackDeviceInventory | null {
  const result: RackDeviceInventory = {};
  for (const field of HARDWARE_SPEC_FIELDS) {
    const text = value[field]?.trim();
    if (text) result[field] = text;
  }
  if (value.maintenance?.length) {
    result.maintenance = value.maintenance.map((entry) => ({
      ...entry, date: entry.date.trim(), notes: entry.notes.trim(),
    }));
  }
  return Object.keys(result).length ? result : null;
}

export function isDeviceInventoryValid(value: RackDeviceInventory): boolean {
  if (HARDWARE_SPEC_FIELDS.some((field) => Array.from(value[field]?.trim() ?? "").length > 500)) return false;
  const entries = value.maintenance ?? [];
  if (entries.length > MAX_MAINTENANCE_ENTRIES) return false;
  const ids = new Set<string>();
  return entries.every((entry) => {
    if (!entry.id.trim() || Array.from(entry.id).length > 128 || ids.has(entry.id)) return false;
    ids.add(entry.id);
    const date = entry.date.trim();
    const parsed = new Date(`${date}T00:00:00Z`);
    const notesLength = Array.from(entry.notes.trim()).length;
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && !date.startsWith("0000-") && !Number.isNaN(parsed.getTime())
      && parsed.toISOString().slice(0, 10) === date && notesLength > 0 && notesLength <= 2000;
  });
}

export function localInventoryDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
