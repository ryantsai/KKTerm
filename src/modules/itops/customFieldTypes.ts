/** Operator-defined metadata on the three durable IPAM record kinds. */
export type CustomFieldRecordKind = "prefix" | "address" | "vlan";
export type CustomFieldType =
  | "text" | "multiline" | "number" | "boolean" | "date" | "select"
  | "url" | "credential" | "link";

export interface CustomFieldDefinition {
  id: string;
  name: string;
  recordKind: CustomFieldRecordKind;
  type: CustomFieldType;
  options: string[];
}

export type CustomFieldLink =
  | { kind: "connection"; connectionId: string }
  | { kind: "rack"; siteId: string; rackId: string }
  | { kind: "rackItem"; siteId: string; rackId: string; rackItemId: string }
  | { kind: "networkNode"; mapId: string; nodeId: string };

export type CustomFieldValue = string | number | boolean | CustomFieldLink
  | { kind: "credential"; credentialId: string };
/** Null removes a value; omission preserves it when an older caller edits a record. */
export type CustomFieldValues = Record<string, CustomFieldValue | null>;

export interface CustomFieldSnapshot {
  fields: CustomFieldDefinition[];
  values: {
    fieldId: string;
    recordKind: CustomFieldRecordKind;
    recordId: string;
    value: CustomFieldValue;
  }[];
}
