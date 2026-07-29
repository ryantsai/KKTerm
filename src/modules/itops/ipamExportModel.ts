import { strToU8, zipSync } from "fflate";
import type { IpamSnapshot, Site, Vlan } from "../../types";
import { IPAM_IMPORT_HEADERS } from "./ipamImportModel";

export type IpamExportFormat = "csv" | "tsv" | "xlsx";
export type IpamExportRows = string[][];

interface IpamExportSource {
  ipam: IpamSnapshot;
  sites: readonly Site[];
  vlans: readonly Vlan[];
}

const encoder = new TextEncoder();

/**
 * Projects the durable IPAM records into the same canonical columns accepted
 * by file import. Derived tree/utilization fields and soft relationship ids do
 * not become a second, incompatible file schema.
 */
export function buildIpamExportRows({
  ipam,
  sites,
  vlans,
}: IpamExportSource): IpamExportRows {
  const siteNames = new Map(sites.map((site) => [site.id, site.name]));
  const vlansById = new Map(vlans.map((vlan) => [vlan.id, vlan]));
  const rows: IpamExportRows = [[...IPAM_IMPORT_HEADERS]];

  for (const vlan of vlans) {
    rows.push([
      "vlan",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      String(vlan.vid),
      vlan.name,
      siteNames.get(vlan.siteId ?? "") ?? "",
      vlan.description,
      String(vlan.accent),
    ]);
  }

  for (const prefix of ipam.prefixes) {
    rows.push([
      "prefix",
      prefix.cidr,
      "",
      prefix.vrf,
      prefix.role,
      prefix.status,
      "",
      "",
      "",
      prefix.vlanId ? String(vlansById.get(prefix.vlanId)?.vid ?? "") : "",
      "",
      siteNames.get(prefix.siteId ?? "") ?? "",
      prefix.description,
      "",
    ]);
  }

  for (const address of ipam.addresses) {
    rows.push([
      "address",
      "",
      address.address,
      address.vrf,
      "",
      address.status,
      address.dnsName,
      address.deviceType ?? "",
      address.deviceModel,
      "",
      "",
      address.siteInherited ? "" : siteNames.get(address.siteId ?? "") ?? "",
      address.description,
      "",
    ]);
  }

  return rows;
}

function escapeDelimitedCell(value: string, delimiter: string): string {
  if (!value.includes(delimiter) && !/["\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function ipamDelimitedBytes(rows: IpamExportRows, delimiter: "," | "\t"): Uint8Array {
  const body = rows
    .map((row) => row.map((cell) => escapeDelimitedCell(cell, delimiter)).join(delimiter))
    .join("\r\n");
  // The BOM keeps non-ASCII Site names and descriptions readable when the
  // delimited file is opened directly in desktop spreadsheet applications.
  return encoder.encode(`\uFEFF${body}\r\n`);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function excelColumn(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

/** Creates one standards-based .xlsx workbook without adding a large workbook dependency. */
export function ipamXlsxBytes(rows: IpamExportRows): Uint8Array {
  const lastColumn = excelColumn(Math.max(0, IPAM_IMPORT_HEADERS.length - 1));
  const lastRow = Math.max(1, rows.length);
  const worksheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((cell, columnIndex) => {
          const reference = `${excelColumn(columnIndex)}${rowIndex + 1}`;
          const style = rowIndex === 0 ? ' s="1"' : "";
          return `<c r="${reference}" t="inlineStr"${style}><is><t>${escapeXml(cell)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="1" width="14" customWidth="1"/>
    <col min="2" max="14" width="20" customWidth="1"/>
  </cols>
  <sheetData>${worksheetRows}</sheetData>
  <autoFilter ref="A1:${lastColumn}${lastRow}"/>
</worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  return zipSync(
    {
      "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
      "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
      "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="IPAM" sheetId="1" r:id="rId1"/></sheets>
</workbook>`),
      "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
      "xl/worksheets/sheet1.xml": strToU8(worksheet),
      "xl/styles.xml": strToU8(styles),
    },
    { level: 6 },
  );
}

export function ipamExportBytes(
  format: IpamExportFormat,
  rows: IpamExportRows,
): Uint8Array {
  if (format === "csv") return ipamDelimitedBytes(rows, ",");
  if (format === "tsv") return ipamDelimitedBytes(rows, "\t");
  return ipamXlsxBytes(rows);
}

export function ipamExportFilename(format: IpamExportFormat): string {
  return `kkterm-ipam.${format}`;
}
