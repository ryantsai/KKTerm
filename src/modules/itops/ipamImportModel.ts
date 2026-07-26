import type {
  AddressStatus,
  IpamDeviceType,
  IpamImportBatch,
  IpamPrefixNode,
  IpAddressRecord,
  PrefixStatus,
  Site,
  Vlan,
} from "../../types";
import { formatIpv4, parseIpv4, previewCidr } from "./ipamModel";

export const IPAM_IMPORT_HEADERS = [
  "record_type",
  "cidr",
  "address",
  "vrf",
  "role",
  "status",
  "hostname",
  "device_type",
  "device_model",
  "vlan_id",
  "name",
  "site",
  "description",
  "accent",
] as const;

export const IPAM_IMPORT_SAMPLE_CSV = [
  IPAM_IMPORT_HEADERS.join(","),
  "vlan,,,,,,,,,30,Management,,Management network,0",
  "prefix,10.20.30.0/24,,corp,Management,active,,,,30,,,Management subnet,",
  "address,,10.20.30.10,corp,,active,core-sw-01.example.com,switch,Model 9300,,,,Core switch,",
].join("\r\n");

export type IpamImportRowKind = "vlan" | "prefix" | "address";
export type IpamImportRowState = "ready" | "skipped" | "error";
export type IpamImportIssueCode =
  | "missingHeader"
  | "unsupportedType"
  | "requiredField"
  | "invalidField"
  | "unknownSite"
  | "ambiguousSite"
  | "unknownVlan"
  | "duplicateFile"
  | "existingRecord";

export interface IpamImportIssue {
  code: IpamImportIssueCode;
  values?: Record<string, string | number>;
}

export interface IpamImportPreviewRow {
  rowNumber: number;
  kind: IpamImportRowKind | null;
  label: string;
  state: IpamImportRowState;
  issue?: IpamImportIssue;
}

export interface ParsedIpamImport {
  batch: IpamImportBatch;
  rows: IpamImportPreviewRow[];
  fileIssue?: IpamImportIssue;
  ready: number;
  skipped: number;
  errors: number;
}

interface ParseContext {
  sites: readonly Site[];
  vlans: readonly Vlan[];
  prefixes: readonly IpamPrefixNode[];
  addresses: readonly IpAddressRecord[];
}

const PREFIX_STATUSES = new Set<PrefixStatus>([
  "container",
  "active",
  "reserved",
  "deprecated",
]);
const ADDRESS_STATUSES = new Set<AddressStatus>(["active", "reserved", "deprecated"]);
const DEVICE_TYPES = new Map<string, IpamDeviceType>(
  [
    "router",
    "switch",
    "firewall",
    "server",
    "storage",
    "accessPoint",
    "desktop",
    "printer",
    "camera",
    "voip",
    "iot",
  ].map((value) => [value.toLowerCase(), value as IpamDeviceType]),
);

function emptyBatch(): IpamImportBatch {
  return { vlans: [], prefixes: [], addresses: [] };
}

function issue(
  rowNumber: number,
  kind: IpamImportRowKind | null,
  label: string,
  code: IpamImportIssueCode,
  values?: Record<string, string | number>,
  state: IpamImportRowState = "error",
): IpamImportPreviewRow {
  return { rowNumber, kind, label, state, issue: { code, values } };
}

function required(
  rowNumber: number,
  kind: IpamImportRowKind,
  field: string,
): IpamImportPreviewRow {
  return issue(rowNumber, kind, "", "requiredField", { field, type: kind });
}

function strictInteger(value: string): number | null {
  return /^\d+$/.test(value) ? Number(value) : null;
}

function summarize(result: Omit<ParsedIpamImport, "ready" | "skipped" | "errors">): ParsedIpamImport {
  return {
    ...result,
    ready: result.rows.filter((row) => row.state === "ready").length,
    skipped: result.rows.filter((row) => row.state === "skipped").length,
    errors: result.rows.filter((row) => row.state === "error").length,
  };
}

/**
 * Turns the canonical sample columns into one create-only batch. Existing
 * records and duplicates inside the file are explicitly previewed as skipped;
 * malformed rows never cross the command boundary.
 */
export function parseIpamImportRows(
  matrix: readonly (readonly string[])[],
  context: ParseContext,
): ParsedIpamImport {
  const nonEmptyRows = matrix
    .map((row, index) => ({ row, rowNumber: index + 1 }))
    .filter(({ row }) => row.some((cell) => String(cell).trim()));
  if (nonEmptyRows.length === 0) {
    return summarize({ batch: emptyBatch(), rows: [] });
  }

  const headers = nonEmptyRows[0].row.map((value) =>
    String(value).replace(/^\uFEFF/, "").trim().toLowerCase(),
  );
  const recordTypeIndex = headers.indexOf("record_type");
  if (recordTypeIndex < 0) {
    return summarize({
      batch: emptyBatch(),
      rows: [],
      fileIssue: { code: "missingHeader", values: { field: "record_type" } },
    });
  }
  const column = new Map(headers.map((header, index) => [header, index]));
  const valueAt = (row: readonly string[], name: string) =>
    String(row[column.get(name) ?? -1] ?? "").trim();

  const siteMatches = new Map<string, Site[]>();
  for (const site of context.sites) {
    const key = site.name.trim().toLowerCase();
    siteMatches.set(key, [...(siteMatches.get(key) ?? []), site]);
  }
  const resolveSite = (
    rowNumber: number,
    kind: IpamImportRowKind,
    label: string,
    raw: string,
  ): { siteId: string | null; error?: IpamImportPreviewRow } => {
    if (!raw) return { siteId: null };
    const matches = siteMatches.get(raw.toLowerCase()) ?? [];
    if (matches.length === 0) {
      return {
        siteId: null,
        error: issue(rowNumber, kind, label, "unknownSite", { site: raw }),
      };
    }
    if (matches.length > 1) {
      return {
        siteId: null,
        error: issue(rowNumber, kind, label, "ambiguousSite", { site: raw }),
      };
    }
    return { siteId: matches[0].id };
  };

  const rows: IpamImportPreviewRow[] = [];
  const batch = emptyBatch();
  const existingVids = new Set(context.vlans.map((vlan) => vlan.vid));
  const availableVids = new Set(existingVids);
  const seenVids = new Set<number>();
  const seenPrefixes = new Set<string>();
  const seenAddresses = new Set<string>();
  const existingPrefixes = new Set(
    context.prefixes.map((prefix) => `${prefix.vrf.trim()}\u0000${prefix.cidr}`),
  );
  const existingAddresses = new Set(
    context.addresses.map((record) => `${record.vrf.trim()}\u0000${record.address}`),
  );

  const inputRows = nonEmptyRows.slice(1).map(({ row, rowNumber }) => ({
    row,
    rowNumber,
    type: valueAt(row, "record_type").toLowerCase(),
  }));

  // VLANs are resolved first even when their rows appear below a Prefix.
  for (const entry of inputRows.filter((entry) => entry.type === "vlan")) {
    const rawVid = valueAt(entry.row, "vlan_id");
    if (!rawVid) {
      rows.push(required(entry.rowNumber, "vlan", "vlan_id"));
      continue;
    }
    const vid = strictInteger(rawVid);
    if (vid === null || vid < 1 || vid > 4094) {
      rows.push(
        issue(entry.rowNumber, "vlan", rawVid, "invalidField", {
          field: "vlan_id",
          value: rawVid,
        }),
      );
      continue;
    }
    const label = `VLAN ${vid}`;
    const site = resolveSite(entry.rowNumber, "vlan", label, valueAt(entry.row, "site"));
    if (site.error) {
      rows.push(site.error);
      continue;
    }
    const rawAccent = valueAt(entry.row, "accent");
    const accent = rawAccent ? strictInteger(rawAccent) : 0;
    if (accent === null || accent < 0 || accent > 255) {
      rows.push(
        issue(entry.rowNumber, "vlan", label, "invalidField", {
          field: "accent",
          value: rawAccent,
        }),
      );
      continue;
    }
    availableVids.add(vid);
    if (seenVids.has(vid)) {
      rows.push(issue(entry.rowNumber, "vlan", label, "duplicateFile", { type: "VLAN" }, "skipped"));
      continue;
    }
    seenVids.add(vid);
    if (existingVids.has(vid)) {
      rows.push(issue(entry.rowNumber, "vlan", label, "existingRecord", undefined, "skipped"));
      continue;
    }
    batch.vlans.push({
      vid,
      name: valueAt(entry.row, "name"),
      description: valueAt(entry.row, "description"),
      siteId: site.siteId,
      accent,
    });
    rows.push({ rowNumber: entry.rowNumber, kind: "vlan", label, state: "ready" });
  }

  for (const entry of inputRows.filter((entry) => entry.type === "prefix")) {
    const rawCidr = valueAt(entry.row, "cidr");
    if (!rawCidr) {
      rows.push(required(entry.rowNumber, "prefix", "cidr"));
      continue;
    }
    const cidr = previewCidr(rawCidr)?.cidr;
    if (!cidr) {
      rows.push(
        issue(entry.rowNumber, "prefix", rawCidr, "invalidField", {
          field: "cidr",
          value: rawCidr,
        }),
      );
      continue;
    }
    const vrf = valueAt(entry.row, "vrf");
    const statusText = valueAt(entry.row, "status") || "active";
    if (!PREFIX_STATUSES.has(statusText as PrefixStatus)) {
      rows.push(
        issue(entry.rowNumber, "prefix", cidr, "invalidField", {
          field: "status",
          value: statusText,
        }),
      );
      continue;
    }
    const rawVid = valueAt(entry.row, "vlan_id");
    const vlanVid = rawVid ? strictInteger(rawVid) : null;
    if (rawVid && (vlanVid === null || vlanVid < 1 || vlanVid > 4094)) {
      rows.push(
        issue(entry.rowNumber, "prefix", cidr, "invalidField", {
          field: "vlan_id",
          value: rawVid,
        }),
      );
      continue;
    }
    if (vlanVid !== null && !availableVids.has(vlanVid)) {
      rows.push(issue(entry.rowNumber, "prefix", cidr, "unknownVlan", { vid: vlanVid }));
      continue;
    }
    const site = resolveSite(entry.rowNumber, "prefix", cidr, valueAt(entry.row, "site"));
    if (site.error) {
      rows.push(site.error);
      continue;
    }
    const key = `${vrf}\u0000${cidr}`;
    if (seenPrefixes.has(key)) {
      rows.push(
        issue(entry.rowNumber, "prefix", cidr, "duplicateFile", { type: "IP Prefix" }, "skipped"),
      );
      continue;
    }
    seenPrefixes.add(key);
    if (existingPrefixes.has(key)) {
      rows.push(issue(entry.rowNumber, "prefix", cidr, "existingRecord", undefined, "skipped"));
      continue;
    }
    batch.prefixes.push({
      cidr,
      vrf,
      role: valueAt(entry.row, "role"),
      status: statusText as PrefixStatus,
      description: valueAt(entry.row, "description"),
      siteId: site.siteId,
      vlanVid,
    });
    rows.push({ rowNumber: entry.rowNumber, kind: "prefix", label: cidr, state: "ready" });
  }

  for (const entry of inputRows.filter((entry) => entry.type === "address")) {
    const rawAddress = valueAt(entry.row, "address");
    if (!rawAddress) {
      rows.push(required(entry.rowNumber, "address", "address"));
      continue;
    }
    const addressValue = parseIpv4(rawAddress);
    if (addressValue === null) {
      rows.push(
        issue(entry.rowNumber, "address", rawAddress, "invalidField", {
          field: "address",
          value: rawAddress,
        }),
      );
      continue;
    }
    const address = formatIpv4(addressValue);
    const vrf = valueAt(entry.row, "vrf");
    const statusText = valueAt(entry.row, "status") || "active";
    if (!ADDRESS_STATUSES.has(statusText as AddressStatus)) {
      rows.push(
        issue(entry.rowNumber, "address", address, "invalidField", {
          field: "status",
          value: statusText,
        }),
      );
      continue;
    }
    const rawDeviceType = valueAt(entry.row, "device_type");
    const deviceType = rawDeviceType ? DEVICE_TYPES.get(rawDeviceType.toLowerCase()) ?? null : null;
    if (rawDeviceType && !deviceType) {
      rows.push(
        issue(entry.rowNumber, "address", address, "invalidField", {
          field: "device_type",
          value: rawDeviceType,
        }),
      );
      continue;
    }
    const site = resolveSite(entry.rowNumber, "address", address, valueAt(entry.row, "site"));
    if (site.error) {
      rows.push(site.error);
      continue;
    }
    const key = `${vrf}\u0000${address}`;
    if (seenAddresses.has(key)) {
      rows.push(
        issue(entry.rowNumber, "address", address, "duplicateFile", { type: "Address" }, "skipped"),
      );
      continue;
    }
    seenAddresses.add(key);
    if (existingAddresses.has(key)) {
      rows.push(issue(entry.rowNumber, "address", address, "existingRecord", undefined, "skipped"));
      continue;
    }
    batch.addresses.push({
      address,
      vrf,
      status: statusText as AddressStatus,
      dnsName: valueAt(entry.row, "hostname"),
      deviceType,
      deviceModel: valueAt(entry.row, "device_model"),
      description: valueAt(entry.row, "description"),
      siteId: site.siteId,
    });
    rows.push({ rowNumber: entry.rowNumber, kind: "address", label: address, state: "ready" });
  }

  for (const entry of inputRows.filter(
    (entry) => !["vlan", "prefix", "address"].includes(entry.type),
  )) {
    rows.push(
      issue(entry.rowNumber, null, entry.type || "—", "unsupportedType", {
        type: entry.type || "—",
      }),
    );
  }

  rows.sort((left, right) => left.rowNumber - right.rowNumber);
  return summarize({ batch, rows });
}
