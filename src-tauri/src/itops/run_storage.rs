// IT Ops run-history storage (docs/ITOPS.md Phase 2). Append-only audit log of
// completed Batch Runs; the consolidated report is a JSON blob. Live run state
// never lands here.

use rusqlite::{Connection as SqliteConnection, params};

use super::types::{RunHistoryEntry, RunReport};

#[derive(Debug)]
pub enum RunStorageError {
    Serialize(String),
    Sqlite(rusqlite::Error),
}

impl std::fmt::Display for RunStorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Serialize(reason) => write!(f, "{reason}"),
            Self::Sqlite(error) => write!(f, "{error}"),
        }
    }
}

impl From<rusqlite::Error> for RunStorageError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

type Result<T> = std::result::Result<T, RunStorageError>;

#[allow(clippy::too_many_arguments)]
pub fn insert_run_report(
    conn: &SqliteConnection,
    id: &str,
    source: &str,
    site_id: Option<&str>,
    task_id: Option<&str>,
    task_summary: &str,
    started_at: &str,
    finished_at: Option<&str>,
    report: &RunReport,
) -> Result<RunHistoryEntry> {
    let report_json = serde_json::to_string(report)
        .map_err(|error| RunStorageError::Serialize(error.to_string()))?;
    conn.execute(
        "INSERT INTO itops_run_history
            (id, source, site_id, task_id, task_summary, started_at, finished_at, report_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        params![
            id,
            source,
            site_id,
            task_id,
            task_summary,
            started_at,
            finished_at,
            report_json
        ],
    )?;
    Ok(RunHistoryEntry {
        id: id.to_string(),
        source: source.to_string(),
        site_id: site_id.map(str::to_string),
        task_id: task_id.map(str::to_string),
        task_summary: task_summary.to_string(),
        started_at: started_at.to_string(),
        finished_at: finished_at.map(str::to_string),
        report: report.clone(),
    })
}

pub fn list_run_history(conn: &SqliteConnection, limit: i64) -> Result<Vec<RunHistoryEntry>> {
    let mut stmt = conn.prepare(
        "SELECT id, source, site_id, task_id, task_summary, started_at, finished_at, report_json
         FROM itops_run_history
         ORDER BY started_at DESC, id DESC
         LIMIT ?",
    )?;
    let rows = stmt
        .query_map(params![limit], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows
        .into_iter()
        .map(
            |(id, source, site_id, task_id, task_summary, started_at, finished_at, report_json)| {
                RunHistoryEntry {
                    id,
                    source,
                    site_id,
                    task_id,
                    task_summary,
                    started_at,
                    finished_at,
                    report: serde_json::from_str::<RunReport>(&report_json).unwrap_or_default(),
                }
            },
        )
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::itops::types::{HostReport, Transport};

    fn open_test_db() -> SqliteConnection {
        let conn = SqliteConnection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE itops_run_history (
                id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                site_id TEXT,
                task_id TEXT,
                task_summary TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                report_json TEXT NOT NULL DEFAULT '{}'
            );
            "#,
        )
        .unwrap();
        conn
    }

    fn sample_report() -> RunReport {
        RunReport {
            ok: 1,
            failed: 1,
            total: 2,
            hosts: vec![
                HostReport {
                    host_id: None,
                    connection_id: "c1".into(),
                    name: "web-01".into(),
                    host: "10.0.0.1".into(),
                    transport: Transport::Ssh,
                    ok: true,
                    exit_code: Some(0),
                    bytes_out: 42,
                    duration_ms: 1200,
                    output: "ready".into(),
                    error: None,
                },
                HostReport {
                    host_id: None,
                    connection_id: "c2".into(),
                    name: "web-02".into(),
                    host: "10.0.0.2".into(),
                    transport: Transport::Ssh,
                    ok: false,
                    exit_code: Some(100),
                    bytes_out: 10,
                    duration_ms: 300,
                    output: "boom".into(),
                    error: None,
                },
            ],
        }
    }

    #[test]
    fn insert_and_list_roundtrip() {
        let conn = open_test_db();
        let report = sample_report();
        insert_run_report(
            &conn,
            "run-1",
            "manual",
            Some("hg-1"),
            Some("task-1"),
            "apt upgrade",
            "2026-01-01T00:00:00Z",
            Some("2026-01-01T00:01:00Z"),
            &report,
        )
        .unwrap();

        let history = list_run_history(&conn, 50).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "run-1");
        assert_eq!(history[0].site_id.as_deref(), Some("hg-1"));
        assert_eq!(history[0].report, report);
    }

    #[test]
    fn list_is_newest_first_and_limited() {
        let conn = open_test_db();
        for (id, started) in [("a", "2026-01-01T00:00:00Z"), ("b", "2026-01-02T00:00:00Z")] {
            insert_run_report(
                &conn,
                id,
                "manual",
                None,
                None,
                "t",
                started,
                None,
                &RunReport::default(),
            )
            .unwrap();
        }
        let history = list_run_history(&conn, 1).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].id, "b"); // newest started_at first
    }
}
