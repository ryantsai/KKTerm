// CSV/TSV parsing stays in the frontend because Papa Parse is already bundled
// for the Document table viewer. This module owns the two backend-only pieces:
// a small native .xlsx reader and one atomic create-only database import.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use calamine::{Data, Reader, SheetType, Xlsx, open_workbook};
use rusqlite::Connection as SqliteConnection;

use super::ipam_storage;
use super::ipv4::{self, Prefix};
use super::types::{
    IpamImportBatch, IpamImportResult, IpamWorkbookSheet, VLAN_ID_MAX, VLAN_ID_MIN,
};
use super::vlan_storage;

const MAX_IMPORT_RECORDS: usize = 100_000;
const MAX_XLSX_BYTES: u64 = 50 * 1024 * 1024;
const MAX_XLSX_ROWS: usize = MAX_IMPORT_RECORDS + 1;
const MAX_XLSX_COLUMNS: usize = 64;

fn existing_prefix_keys(conn: &SqliteConnection) -> Result<HashSet<(String, String)>, String> {
    let mut statement = conn
        .prepare("SELECT vrf, cidr FROM itops_ip_prefixes")
        .map_err(|error| error.to_string())?;
    statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<HashSet<_>>>()
        .map_err(|error| error.to_string())
}

fn existing_address_keys(conn: &SqliteConnection) -> Result<HashSet<(String, String)>, String> {
    let mut statement = conn
        .prepare("SELECT vrf, address FROM itops_ip_address_records")
        .map_err(|error| error.to_string())?;
    statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|error| error.to_string())?
        .collect::<rusqlite::Result<HashSet<_>>>()
        .map_err(|error| error.to_string())
}

/// Creates every valid row in one SQLite transaction. A duplicate already in
/// KKTerm or repeated in the submitted batch is skipped; every other failure
/// rolls the whole batch back so a file cannot be half imported.
pub fn import_batch(
    conn: &SqliteConnection,
    batch: IpamImportBatch,
    mut new_id: impl FnMut(&str) -> String,
) -> Result<IpamImportResult, String> {
    let record_count = batch.vlans.len() + batch.prefixes.len() + batch.addresses.len();
    if record_count > MAX_IMPORT_RECORDS {
        return Err(format!(
            "IPAM imports are limited to {MAX_IMPORT_RECORDS} records"
        ));
    }

    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let mut result = IpamImportResult::default();
    let mut vlans_by_vid: HashMap<u16, String> = vlan_storage::list_vlans(&transaction)
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|vlan| (vlan.vid, vlan.id))
        .collect();
    let mut prefix_keys = existing_prefix_keys(&transaction)?;
    let mut address_keys = existing_address_keys(&transaction)?;

    for input in batch.vlans {
        if !(VLAN_ID_MIN..=VLAN_ID_MAX).contains(&input.vid) {
            return Err(format!(
                "VLAN id must be between {VLAN_ID_MIN} and {VLAN_ID_MAX}"
            ));
        }
        if vlans_by_vid.contains_key(&input.vid) {
            result.skipped += 1;
            continue;
        }
        let id = new_id("vlan");
        let vlan = vlan_storage::create_vlan(
            &transaction,
            &id,
            input.vid,
            &input.name,
            &input.description,
            input.site_id.as_deref(),
            input.accent,
        )
        .map_err(|error| error.to_string())?;
        vlans_by_vid.insert(vlan.vid, vlan.id);
        result.vlans += 1;
    }

    for input in batch.prefixes {
        let prefix = Prefix::parse(&input.cidr)
            .ok_or_else(|| format!("'{}' is not a valid IPv4 prefix", input.cidr.trim()))?;
        let cidr = prefix.to_cidr();
        let vrf = input.vrf.trim().to_string();
        if !prefix_keys.insert((vrf.clone(), cidr.clone())) {
            result.skipped += 1;
            continue;
        }
        let vlan_id = input
            .vlan_vid
            .map(|vid| {
                vlans_by_vid
                    .get(&vid)
                    .cloned()
                    .ok_or_else(|| format!("VLAN {vid} does not exist"))
            })
            .transpose()?;
        ipam_storage::create_prefix(
            &transaction,
            &new_id("prefix"),
            &cidr,
            &vrf,
            &input.role,
            input.status,
            &input.description,
            input.site_id.as_deref(),
            vlan_id.as_deref(),
        )
        .map_err(|error| error.to_string())?;
        result.prefixes += 1;
    }

    for input in batch.addresses {
        let address = ipv4::parse_address(&input.address)
            .map(ipv4::format_address)
            .ok_or_else(|| format!("'{}' is not a valid IPv4 address", input.address.trim()))?;
        let vrf = input.vrf.trim().to_string();
        if !address_keys.insert((vrf.clone(), address.clone())) {
            result.skipped += 1;
            continue;
        }
        ipam_storage::create_address(
            &transaction,
            &new_id("ipaddr"),
            &address,
            &vrf,
            input.status,
            &input.dns_name,
            input.device_type,
            &input.device_model,
            &input.description,
            input.site_id.as_deref(),
            None,
            None,
            None,
        )
        .map_err(|error| error.to_string())?;
        result.addresses += 1;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(result)
}

fn cell_text(cell: &Data) -> String {
    match cell {
        Data::Empty => String::new(),
        Data::Float(value) if value.fract() == 0.0 => format!("{value:.0}"),
        _ => cell.to_string(),
    }
}

/// Reads the first non-empty worksheet from an operator-selected .xlsx file.
/// Limits are deliberately below Excel's theoretical size so a malformed or
/// accidental giant workbook cannot monopolize the desktop process.
pub fn read_xlsx(path: &Path) -> Result<IpamWorkbookSheet, String> {
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("xlsx"))
    {
        return Err("Select an .xlsx workbook".to_string());
    }
    let size = std::fs::metadata(path)
        .map_err(|error| format!("Could not read workbook metadata: {error}"))?
        .len();
    if size > MAX_XLSX_BYTES {
        return Err(format!(
            "Excel workbooks are limited to {} MB",
            MAX_XLSX_BYTES / 1024 / 1024
        ));
    }

    let mut workbook: Xlsx<_> =
        open_workbook(path).map_err(|error| format!("Could not open workbook: {error}"))?;
    let worksheet_names = workbook
        .sheets_metadata()
        .iter()
        .filter(|sheet| sheet.typ == SheetType::WorkSheet)
        .map(|sheet| sheet.name.clone())
        .collect::<Vec<_>>();
    for name in worksheet_names {
        let range = workbook
            .worksheet_range(&name)
            .map_err(|error| format!("Could not read worksheet '{name}': {error}"))?;
        if range.used_cells().next().is_none() {
            continue;
        }
        if range.height() > MAX_XLSX_ROWS || range.width() > MAX_XLSX_COLUMNS {
            return Err(format!(
                "Excel imports are limited to {MAX_XLSX_ROWS} rows and {MAX_XLSX_COLUMNS} columns"
            ));
        }
        let rows = range
            .rows()
            .map(|row| {
                let mut values = row.iter().map(cell_text).collect::<Vec<_>>();
                while values.last().is_some_and(String::is_empty) {
                    values.pop();
                }
                values
            })
            .collect();
        return Ok(IpamWorkbookSheet { name, rows });
    }
    Err("The workbook has no non-empty worksheets".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::itops::types::{
        AddressStatus, IpamImportAddressInput, IpamImportPrefixInput, IpamImportVlanInput,
        PrefixStatus,
    };
    use std::io::Write;

    fn open_test_db() -> SqliteConnection {
        let conn = SqliteConnection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE itops_vlans (
                id TEXT PRIMARY KEY,
                vid INTEGER NOT NULL UNIQUE,
                name TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                site_id TEXT,
                accent INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE itops_ip_prefixes (
                id TEXT PRIMARY KEY,
                cidr TEXT NOT NULL,
                vrf TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                description TEXT NOT NULL DEFAULT '',
                site_id TEXT,
                vlan_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(vrf, cidr)
            );
            CREATE TABLE itops_ip_address_records (
                id TEXT PRIMARY KEY,
                address TEXT NOT NULL,
                vrf TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'active',
                dns_name TEXT NOT NULL DEFAULT '',
                device_type TEXT NOT NULL DEFAULT '',
                device_model TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                site_id TEXT,
                host_id TEXT,
                connection_id TEXT,
                rack_item_id TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(vrf, address)
            );
            CREATE TABLE itops_hosts (
                id TEXT PRIMARY KEY,
                site_id TEXT NOT NULL,
                hostname TEXT NOT NULL
            );",
        )
        .unwrap();
        conn
    }

    fn sample_batch() -> IpamImportBatch {
        IpamImportBatch {
            vlans: vec![IpamImportVlanInput {
                vid: 30,
                name: "Management".into(),
                description: String::new(),
                site_id: None,
                accent: 0,
            }],
            prefixes: vec![IpamImportPrefixInput {
                cidr: "10.20.30.9/24".into(),
                vrf: "corp".into(),
                role: "Management".into(),
                status: PrefixStatus::Active,
                description: String::new(),
                site_id: None,
                vlan_vid: Some(30),
            }],
            addresses: vec![IpamImportAddressInput {
                address: "10.20.30.10".into(),
                vrf: "corp".into(),
                status: AddressStatus::Active,
                dns_name: "core-sw-01".into(),
                device_type: None,
                device_model: String::new(),
                description: String::new(),
                site_id: None,
            }],
        }
    }

    #[test]
    fn imports_vlan_prefix_and_address_atomically_and_links_by_vid() {
        let conn = open_test_db();
        let mut sequence = 0;
        let result = import_batch(&conn, sample_batch(), |kind| {
            sequence += 1;
            format!("{kind}-{sequence}")
        })
        .unwrap();
        assert_eq!(
            result,
            IpamImportResult {
                vlans: 1,
                prefixes: 1,
                addresses: 1,
                skipped: 0,
            }
        );
        let (cidr, vlan_id): (String, String) = conn
            .query_row("SELECT cidr, vlan_id FROM itops_ip_prefixes", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(cidr, "10.20.30.0/24");
        assert_eq!(vlan_id, "vlan-1");
    }

    #[test]
    fn skips_existing_records_without_overwriting_them() {
        let conn = open_test_db();
        let batch = sample_batch();
        import_batch(&conn, batch.clone(), |kind| format!("{kind}-first")).unwrap();
        let result = import_batch(&conn, batch, |kind| format!("{kind}-second")).unwrap();
        assert_eq!(result.skipped, 3);
        let vlan_name: String = conn
            .query_row("SELECT name FROM itops_vlans WHERE vid = 30", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(vlan_name, "Management");
    }

    #[test]
    fn rolls_back_earlier_rows_when_a_later_row_is_invalid() {
        let conn = open_test_db();
        let mut batch = sample_batch();
        batch.addresses[0].address = "not-an-address".into();
        assert!(import_batch(&conn, batch, |kind| format!("{kind}-1")).is_err());
        let vlan_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM itops_vlans", [], |row| row.get(0))
            .unwrap();
        assert_eq!(vlan_count, 0);
    }

    #[test]
    fn reads_values_from_the_first_non_empty_xlsx_worksheet() {
        let file = tempfile::Builder::new().suffix(".xlsx").tempfile().unwrap();
        let mut archive = zip::ZipWriter::new(file.reopen().unwrap());
        let options = zip::write::SimpleFileOptions::default();
        let entries = [
            (
                "[Content_Types].xml",
                r#"<?xml version="1.0" encoding="UTF-8"?>
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                  <Default Extension="xml" ContentType="application/xml"/>
                  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
                  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
                </Types>"#,
            ),
            (
                "_rels/.rels",
                r#"<?xml version="1.0" encoding="UTF-8"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
                </Relationships>"#,
            ),
            (
                "xl/workbook.xml",
                r#"<?xml version="1.0" encoding="UTF-8"?>
                <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                          xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
                  <sheets><sheet name="IPAM" sheetId="1" r:id="rId1"/></sheets>
                </workbook>"#,
            ),
            (
                "xl/_rels/workbook.xml.rels",
                r#"<?xml version="1.0" encoding="UTF-8"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
                </Relationships>"#,
            ),
            (
                "xl/worksheets/sheet1.xml",
                r#"<?xml version="1.0" encoding="UTF-8"?>
                <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
                  <sheetData>
                    <row r="1">
                      <c r="A1" t="inlineStr"><is><t>record_type</t></is></c>
                      <c r="B1" t="inlineStr"><is><t>vlan_id</t></is></c>
                    </row>
                    <row r="2">
                      <c r="A2" t="inlineStr"><is><t>vlan</t></is></c>
                      <c r="B2"><v>30</v></c>
                    </row>
                  </sheetData>
                </worksheet>"#,
            ),
        ];
        for (name, contents) in entries {
            archive.start_file(name, options).unwrap();
            archive.write_all(contents.as_bytes()).unwrap();
        }
        archive.finish().unwrap();

        let worksheet = read_xlsx(file.path()).unwrap();
        assert_eq!(worksheet.name, "IPAM");
        assert_eq!(
            worksheet.rows,
            vec![
                vec!["record_type".to_string(), "vlan_id".to_string()],
                vec!["vlan".to_string(), "30".to_string()],
            ]
        );
    }
}
