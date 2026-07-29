import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import type { IpAddressRecord, IpamPrefixNode, Site, Vlan } from "../src/types";
import {
  buildIpamExportRows,
  ipamDelimitedBytes,
  ipamExportBytes,
  ipamExportFilename,
  ipamXlsxBytes,
} from "../src/modules/itops/ipamExportModel";
import { parseIpamImportRows } from "../src/modules/itops/ipamImportModel";

const site = {
  id: "site-hq",
  name: "Taipei HQ",
  sortOrder: 0,
  memberIds: [],
  transport: "auto",
} satisfies Site;

const vlan = {
  id: "vlan-30",
  vid: 30,
  name: "Management",
  description: "Switches, routers",
  siteId: site.id,
  accent: 4,
} satisfies Vlan;

const prefix = {
  id: "prefix-1",
  cidr: "10.20.30.0/24",
  vrf: "corp",
  role: "Management",
  status: "active",
  description: "Primary <management> subnet",
  siteId: site.id,
  vlanId: vlan.id,
  parentId: null,
  depth: 0,
  network: "10.20.30.0",
  broadcast: "10.20.30.255",
  firstUsable: "10.20.30.1",
  lastUsable: "10.20.30.254",
  usable: 254,
  used: 1,
  utilization: 1 / 254,
  childCount: 0,
  addressCount: 1,
} satisfies IpamPrefixNode;

const address = {
  id: "address-1",
  address: "10.20.30.10",
  vrf: "corp",
  status: "active",
  dnsName: "core-sw-01.example.com",
  deviceType: "switch",
  deviceModel: 'Model "9300"',
  description: "核心交換器",
  siteId: site.id,
  siteInherited: false,
} satisfies IpAddressRecord;

test("IPAM exports all record types in the canonical import schema", () => {
  const rows = buildIpamExportRows({
    ipam: { prefixes: [prefix], addresses: [address] },
    sites: [site],
    vlans: [vlan],
  });

  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], [
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
  ]);
  assert.equal(rows[1]?.[0], "vlan");
  assert.equal(rows[1]?.[9], "30");
  assert.equal(rows[2]?.[0], "prefix");
  assert.equal(rows[2]?.[9], "30");
  assert.equal(rows[3]?.[0], "address");
  assert.equal(rows[3]?.[11], "Taipei HQ");

  const parsed = parseIpamImportRows(rows, {
    sites: [site],
    vlans: [],
    prefixes: [],
    addresses: [],
  });
  assert.equal(parsed.ready, 3);
  assert.equal(parsed.errors, 0);
  assert.equal(parsed.batch.prefixes[0]?.vlanVid, 30);
});

test("derived Site labels remain inherited after a round-trip", () => {
  const rows = buildIpamExportRows({
    ipam: { prefixes: [prefix], addresses: [{ ...address, siteInherited: true }] },
    sites: [site],
    vlans: [vlan],
  });

  assert.equal(rows[3]?.[11], "");
});

test("CSV and TSV exports quote delimiters, quotes, and newlines and include a UTF-8 BOM", () => {
  const rows = [
    ["plain", "comma,value", "tab\tvalue", 'say "hello"', "line\nbreak"],
  ];
  const csv = ipamDelimitedBytes(rows, ",");
  const tsv = ipamDelimitedBytes(rows, "\t");

  assert.deepEqual([...csv.slice(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.match(new TextDecoder().decode(csv), /"comma,value"/);
  assert.match(new TextDecoder().decode(csv), /"say ""hello"""/);
  assert.match(new TextDecoder().decode(csv), /"line\nbreak"/);
  assert.match(new TextDecoder().decode(tsv), /"tab\tvalue"/);
});

test("XLSX export is a real workbook with one frozen, filterable IPAM sheet", () => {
  const rows = buildIpamExportRows({
    ipam: { prefixes: [prefix], addresses: [address] },
    sites: [site],
    vlans: [vlan],
  });
  const bytes = ipamXlsxBytes(rows);
  const archive = unzipSync(bytes);
  const workbook = strFromU8(archive["xl/workbook.xml"]);
  const worksheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);

  assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);
  assert.match(workbook, /sheet name="IPAM"/);
  assert.match(worksheet, /state="frozen"/);
  assert.match(worksheet, /<autoFilter ref="A1:N4"\/>/);
  assert.match(worksheet, /Primary &lt;management&gt; subnet/);
  assert.match(worksheet, /核心交換器/);
  assert.equal(ipamExportFilename("xlsx"), "kkterm-ipam.xlsx");
  assert.deepEqual(ipamExportBytes("xlsx", rows), bytes);
});

test("IPAM exposes one Export menu with CSV, TSV, and XLSX and documents it", async () => {
  const [panel, manual] = await Promise.all([
    readFile(new URL("../src/modules/itops/IpamPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../docs/manual/12-it-ops.md", import.meta.url), "utf8"),
  ]);

  assert.match(panel, /t\("itops\.actions\.export"\)/);
  assert.match(panel, /\(\["csv", "tsv", "xlsx"\] as const\)/);
  assert.match(panel, /aria-haspopup="menu"/);
  assert.match(manual, /itops\.export\.csv/);
  assert.match(manual, /itops\.export\.tsv/);
  assert.match(manual, /itops\.export\.xlsx/);
});
