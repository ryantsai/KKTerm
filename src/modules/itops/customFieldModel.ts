import type { Connection, ConnectionPasswordCredentialEntry, NetworkMap, Rack, Site } from "../../types";
import type { CustomFieldDefinition, CustomFieldLink, CustomFieldRecordKind, CustomFieldSnapshot, CustomFieldValue, CustomFieldValues } from "./customFieldTypes";
import type { ItOpsNavigationRequest } from "./state";

export const CUSTOM_FIELD_TYPES = ["text", "multiline", "number", "boolean", "date", "select", "url", "credential", "link"] as const;
export const CUSTOM_FIELD_RECORD_KINDS = ["prefix", "address", "vlan"] as const;
export const CUSTOM_FIELD_LINK_KINDS = ["connection", "rack", "rackItem", "networkNode"] as const;

/** Retain incomplete/invalid input as text so it cannot silently clear a value. */
export function parseCustomFieldNumber(text: string): number | string | null {
  if (text === "") return null;
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return text;
  const number = Number(text);
  return Number.isFinite(number) ? number : text;
}

export function prepareCustomFieldDefinitions(fields: CustomFieldDefinition[]): CustomFieldDefinition[] {
  return fields.map((field) => ({ ...field, options: field.options.map((option) => option.trim()).filter(Boolean) }));
}

/** Translate the custom-field validation errors without hiding other command failures. */
export function customFieldErrorTranslation(error: unknown): { key: string; name?: string } | null {
  const message = error instanceof Error ? error.message : String(error);
  const keys: Record<string, string> = {
    "At most 128 custom fields are supported": "definitionLimit",
    "Unknown custom field record kind": "definitionInvalid",
    "Custom fields need unique names per record kind and a supported type": "definitionInvalid",
    "Choice options must be non-empty and unique": "choiceOptions",
    "A choice field needs 1–100 options": "choiceCount",
    "The type and record kind of a saved custom field cannot change": "immutable",
    "Custom field no longer exists": "fieldMissing",
    "Custom field belongs to a different record kind": "kindMismatch",
    "Custom field record no longer exists": "recordMissing",
  };
  if (keys[message]) return { key: `itops.customFields.errors.${keys[message]}` };
  const choice = /^Choices in use cannot be removed from custom field '(.*)'$/s.exec(message);
  if (choice) return { key: "itops.customFields.errors.choiceInUse", name: choice[1] };
  const invalid = /^Invalid value for custom field '(.*)'$/s.exec(message);
  return invalid ? { key: "itops.customFields.errors.invalidValue", name: invalid[1] } : null;
}

export interface CustomFieldCatalog {
  connections: Connection[];
  sites: Site[];
  racksBySite: Record<string, Rack[]>;
  maps: NetworkMap[];
  credentials: ConnectionPasswordCredentialEntry[];
}

export function customFieldRecordValues(snapshot: CustomFieldSnapshot, kind: CustomFieldRecordKind, id?: string): CustomFieldValues {
  return Object.fromEntries(snapshot.values.filter((entry) => entry.recordKind === kind && entry.recordId === id)
    .map((entry) => [entry.fieldId, entry.value]));
}

export function customFieldValueValid(field: CustomFieldDefinition, value: CustomFieldValue | null | undefined): boolean {
  if (value == null) return true;
  switch (field.type) {
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "text": case "multiline": return typeof value === "string" && Array.from(value).length <= 16384;
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }
    case "select": return typeof value === "string" && field.options.includes(value);
    case "url": {
      if (typeof value !== "string" || Array.from(value).length > 2048) return false;
      try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) && !!url.hostname; }
      catch { return false; }
    }
    case "credential": return validReference(value, "credential", ["credentialId"]);
    case "link": return validReference(value, "connection", ["connectionId"])
      || validReference(value, "rack", ["siteId", "rackId"])
      || validReference(value, "rackItem", ["siteId", "rackId", "rackItemId"])
      || validReference(value, "networkNode", ["mapId", "nodeId"]);
  }
}

function validReference(value: CustomFieldValue, kind: string, keys: string[]): boolean {
  if (typeof value !== "object" || value.kind !== kind || Object.keys(value).length !== keys.length + 1) return false;
  const object = value as unknown as Record<string, unknown>;
  return keys.every((key) => typeof object[key] === "string" && !!object[key] && Array.from(object[key]).length <= 256 && object[key] === object[key].trim());
}

export function customFieldLinkChoices(catalog: CustomFieldCatalog): { value: CustomFieldLink; label: string }[] {
  return [
    ...catalog.connections.map((connection) => ({ value: { kind: "connection" as const, connectionId: connection.id }, label: [connection.name, connection.host].filter(Boolean).join(" · ") })),
    ...catalog.sites.flatMap((site) => (catalog.racksBySite[site.id] ?? []).flatMap((rack) => [
      { value: { kind: "rack" as const, siteId: site.id, rackId: rack.id }, label: `${site.name} · ${rack.name}` },
      ...rack.items.map((item) => ({ value: { kind: "rackItem" as const, siteId: site.id, rackId: rack.id, rackItemId: item.id }, label: `${site.name} · ${rack.name} · ${item.label || item.id}` })),
    ])),
    ...catalog.maps.flatMap((map) => map.graph.nodes.map((node) => ({ value: { kind: "networkNode" as const, mapId: map.id, nodeId: node.id }, label: `${map.name} · ${node.label || node.id}` }))),
  ];
}

export function customFieldLinkKey(link: CustomFieldLink): string {
  switch (link.kind) {
    case "connection": return JSON.stringify([link.kind, link.connectionId]);
    case "rack": return JSON.stringify([link.kind, link.siteId, link.rackId]);
    case "rackItem": return JSON.stringify([link.kind, link.siteId, link.rackId, link.rackItemId]);
    case "networkNode": return JSON.stringify([link.kind, link.mapId, link.nodeId]);
  }
}

export function customFieldNavigationRequest(link: Exclude<CustomFieldLink, { kind: "connection" }>): ItOpsNavigationRequest {
  if (link.kind === "networkNode") {
    return { destination: "networkMaps", networkMapId: link.mapId, networkNodeId: link.nodeId };
  }
  return { destination: "serverRooms", siteId: link.siteId, rackId: link.rackId,
    ...(link.kind === "rackItem" ? { rackItemId: link.rackItemId } : {}) };
}
