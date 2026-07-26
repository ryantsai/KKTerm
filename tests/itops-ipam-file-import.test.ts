import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { IpAddressRecord, IpamPrefixNode, Site, Vlan } from "../src/types";
import {
  IPAM_IMPORT_SAMPLE_CSV,
  parseIpamImportRows,
} from "../src/modules/itops/ipamImportModel";

const EMPTY_CONTEXT = {
  sites: [] as Site[],
  vlans: [] as Vlan[],
  prefixes: [] as IpamPrefixNode[],
  addresses: [] as IpAddressRecord[],
};

test("Excel import stays out of the web bundle and enforces import limits", async () => {
  const [packageJson, cargoToml, dialog, backend] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8"),
    readFile(new URL("../src/modules/itops/IpamImportDialog.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src-tauri/src/itops/ipam_import.rs", import.meta.url), "utf8"),
  ]);
  const dependencies = JSON.parse(packageJson).dependencies as Record<string, string>;
  assert.equal(dependencies.xlsx, undefined);
  assert.equal(dependencies["sheetjs"], undefined);
  assert.match(cargoToml, /calamine = \{ version = "0\.36", default-features = false \}/);
  assert.match(dialog, /from "papaparse"/);
  assert.match(dialog, /> 50 \* 1024 \* 1024/);
  assert.match(backend, /const MAX_IMPORT_RECORDS: usize = 100_000;/);
  assert.match(backend, /const MAX_XLSX_BYTES: u64 = 50 \* 1024 \* 1024;/);
});

test("the downloadable sample is directly importable and links its Prefix by VLAN id", () => {
  const matrix = IPAM_IMPORT_SAMPLE_CSV.split(/\r?\n/).map((line) => line.split(","));
  const parsed = parseIpamImportRows(matrix, EMPTY_CONTEXT);

  assert.equal(parsed.ready, 3);
  assert.equal(parsed.skipped, 0);
  assert.equal(parsed.errors, 0);
  assert.deepEqual(parsed.batch.vlans[0], {
    vid: 30,
    name: "Management",
    description: "Management network",
    siteId: null,
    accent: 0,
  });
  assert.equal(parsed.batch.prefixes[0]?.cidr, "10.20.30.0/24");
  assert.equal(parsed.batch.prefixes[0]?.vlanVid, 30);
  assert.equal(parsed.batch.addresses[0]?.deviceType, "switch");
});

test("existing records and later file duplicates are skipped without update rows", () => {
  const matrix = [
    ["record_type", "cidr", "address", "vrf", "vlan_id", "name"],
    ["vlan", "", "", "", "30", "Replacement name"],
    ["prefix", "10.20.30.9/24", "", "corp", "30", ""],
    ["prefix", "10.20.30.0/24", "", "corp", "30", ""],
    ["address", "", "10.20.30.10", "corp", "", ""],
  ];
  const context = {
    ...EMPTY_CONTEXT,
    vlans: [
      { id: "vlan-30", vid: 30, name: "Original", description: "", accent: 0 },
    ] satisfies Vlan[],
    addresses: [
      {
        id: "address-1",
        address: "10.20.30.10",
        vrf: "corp",
        status: "active",
        dnsName: "",
        deviceType: null,
        deviceModel: "",
        description: "",
      },
    ] satisfies IpAddressRecord[],
  };
  const parsed = parseIpamImportRows(matrix, context);

  assert.equal(parsed.ready, 1);
  assert.equal(parsed.skipped, 3);
  assert.equal(parsed.errors, 0);
  assert.equal(parsed.batch.vlans.length, 0);
  assert.equal(parsed.batch.prefixes.length, 1);
  assert.equal(parsed.batch.addresses.length, 0);
});

test("invalid references stay out of the command batch with specific issues", () => {
  const matrix = [
    ["record_type", "cidr", "address", "site", "vlan_id", "status"],
    ["prefix", "10.0.0.0/24", "", "Unknown office", "99", "active"],
    ["address", "", "10.0.0.1", "", "", "invented"],
    ["mystery", "", "", "", "", ""],
  ];
  const parsed = parseIpamImportRows(matrix, EMPTY_CONTEXT);

  assert.equal(parsed.ready, 0);
  assert.equal(parsed.errors, 3);
  assert.deepEqual(
    parsed.rows.map((row) => row.issue?.code),
    ["unknownVlan", "invalidField", "unsupportedType"],
  );
  assert.deepEqual(parsed.batch, { vlans: [], prefixes: [], addresses: [] });
});

test("Site names resolve case-insensitively only when the match is unique", () => {
  const matrix = [
    ["record_type", "address", "site"],
    ["address", "10.0.0.1", "hq"],
  ];
  const site = {
    id: "site-hq",
    name: "HQ",
    sortOrder: 0,
    memberIds: [],
    transport: "auto",
  } satisfies Site;
  const parsed = parseIpamImportRows(matrix, { ...EMPTY_CONTEXT, sites: [site] });
  assert.equal(parsed.batch.addresses[0]?.siteId, "site-hq");

  const ambiguous = parseIpamImportRows(matrix, {
    ...EMPTY_CONTEXT,
    sites: [site, { ...site, id: "site-hq-2" }],
  });
  assert.equal(ambiguous.rows[0]?.issue?.code, "ambiguousSite");
});
