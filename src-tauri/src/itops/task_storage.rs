// Durable global Task Library storage (docs/ITOPS.md). A Task defines what to
// execute; Sites and Hosts remain launch-time targets.

use rusqlite::{Connection as SqliteConnection, OptionalExtension, params};

use super::types::{BatchTask, ItopsTask, TaskOperatingSystem};

#[derive(Debug)]
pub enum TaskStorageError {
    Validation(String),
    NotFound,
    Sqlite(rusqlite::Error),
}

impl std::fmt::Display for TaskStorageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Validation(reason) => write!(f, "{reason}"),
            Self::NotFound => write!(f, "task not found"),
            Self::Sqlite(error) => write!(f, "{error}"),
        }
    }
}

impl From<rusqlite::Error> for TaskStorageError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sqlite(value)
    }
}

type Result<T> = std::result::Result<T, TaskStorageError>;
type TaskRow = (String, String, String, i64, String, Option<String>, String);

fn validate_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(TaskStorageError::Validation(
            "task name must not be empty".to_string(),
        ));
    }
    Ok(name.to_string())
}

fn task_to_json(task: &BatchTask) -> Result<String> {
    serde_json::to_string(task).map_err(|error| TaskStorageError::Validation(error.to_string()))
}

fn normalize_applicable_os(values: &[TaskOperatingSystem]) -> Vec<TaskOperatingSystem> {
    if values.is_empty() || values.contains(&TaskOperatingSystem::Any) {
        return vec![TaskOperatingSystem::Any];
    }
    let mut normalized = Vec::new();
    for value in values {
        if !normalized.contains(value) {
            normalized.push(*value);
        }
    }
    normalized
}

fn os_to_json(values: &[TaskOperatingSystem]) -> Result<(Vec<TaskOperatingSystem>, String)> {
    let normalized = normalize_applicable_os(values);
    let json = serde_json::to_string(&normalized)
        .map_err(|error| TaskStorageError::Validation(error.to_string()))?;
    Ok((normalized, json))
}

fn row_to_task(row: TaskRow) -> Result<ItopsTask> {
    let (id, name, description, sort_order, applicable_os_json, built_in_key, task_json) = row;
    let task = serde_json::from_str(&task_json)
        .map_err(|error| TaskStorageError::Validation(error.to_string()))?;
    let applicable_os = serde_json::from_str(&applicable_os_json)
        .unwrap_or_else(|_| vec![TaskOperatingSystem::Any]);
    Ok(ItopsTask {
        id,
        name,
        description,
        sort_order,
        applicable_os,
        built_in_key,
        task,
    })
}

fn read_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TaskRow> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
    ))
}

const SELECT_COLUMNS: &str =
    "id, name, description, sort_order, applicable_os_json, built_in_key, task_json";

pub fn list_tasks(conn: &SqliteConnection) -> Result<Vec<ItopsTask>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLUMNS} FROM itops_tasks ORDER BY sort_order"
    ))?;
    let rows = stmt
        .query_map([], read_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter().map(row_to_task).collect()
}

pub fn get_task(conn: &SqliteConnection, id: &str) -> Result<Option<ItopsTask>> {
    let row = conn
        .query_row(
            &format!("SELECT {SELECT_COLUMNS} FROM itops_tasks WHERE id = ?"),
            params![id],
            read_row,
        )
        .optional()?;
    row.map(row_to_task).transpose()
}

pub fn create_task(
    conn: &SqliteConnection,
    id: &str,
    name: &str,
    description: &str,
    applicable_os: &[TaskOperatingSystem],
    task: &BatchTask,
) -> Result<ItopsTask> {
    let name = validate_name(name)?;
    let description = description.trim().to_string();
    let (applicable_os, applicable_os_json) = os_to_json(applicable_os)?;
    let sort_order = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM itops_tasks",
        [],
        |row| row.get(0),
    )?;
    let task_json = task_to_json(task)?;
    conn.execute(
        "INSERT INTO itops_tasks
            (id, name, description, sort_order, applicable_os_json, built_in_key, task_json)
         VALUES (?, ?, ?, ?, ?, NULL, ?)",
        params![
            id,
            name,
            description,
            sort_order,
            applicable_os_json,
            task_json
        ],
    )?;
    Ok(ItopsTask {
        id: id.to_string(),
        name,
        description,
        sort_order,
        applicable_os,
        built_in_key: None,
        task: task.clone(),
    })
}

pub fn update_task(
    conn: &SqliteConnection,
    id: &str,
    name: &str,
    description: &str,
    applicable_os: &[TaskOperatingSystem],
    task: &BatchTask,
) -> Result<ItopsTask> {
    let existing = get_task(conn, id)?.ok_or(TaskStorageError::NotFound)?;
    let name = validate_name(name)?;
    let description = description.trim().to_string();
    let (applicable_os, applicable_os_json) = os_to_json(applicable_os)?;
    let task_json = task_to_json(task)?;
    conn.execute(
        "UPDATE itops_tasks
         SET name = ?, description = ?, applicable_os_json = ?, task_json = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?",
        params![name, description, applicable_os_json, task_json, id],
    )?;
    Ok(ItopsTask {
        id: id.to_string(),
        name,
        description,
        sort_order: existing.sort_order,
        applicable_os,
        built_in_key: existing.built_in_key,
        task: task.clone(),
    })
}

struct BuiltinTaskSpec {
    key: &'static str,
    name: &'static str,
    os: TaskOperatingSystem,
    body: &'static str,
}

macro_rules! builtin {
    ($key:literal, $name:literal, $os:ident, $body:expr) => {
        BuiltinTaskSpec {
            key: $key,
            name: $name,
            os: TaskOperatingSystem::$os,
            body: $body,
        }
    };
}

const BUILTIN_TASKS: &[BuiltinTaskSpec] = &[
    builtin!(
        "linux.identity",
        "Linux · System identity",
        Linux,
        "uname -a\ncat /etc/os-release 2>/dev/null || true"
    ),
    builtin!("linux.uptime", "Linux · Uptime", Linux, "uptime"),
    builtin!(
        "linux.resources",
        "Linux · Resource usage",
        Linux,
        "df -h\nfree -h 2>/dev/null || vmstat"
    ),
    builtin!(
        "linux.interfaces",
        "Linux · Network interfaces",
        Linux,
        "ip -brief address 2>/dev/null || ifconfig -a"
    ),
    builtin!(
        "linux.routing",
        "Linux · Routing and DNS",
        Linux,
        "ip route 2>/dev/null || route -n\nprintf '\\n--- DNS ---\\n'\ncat /etc/resolv.conf"
    ),
    builtin!(
        "linux.logs",
        "Linux · Recent logs",
        Linux,
        "journalctl -n 100 --no-pager 2>/dev/null || tail -n 100 /var/log/syslog 2>/dev/null || tail -n 100 /var/log/messages"
    ),
    builtin!(
        "macos.identity",
        "macOS · System identity",
        Macos,
        "sw_vers\nuname -a"
    ),
    builtin!("macos.uptime", "macOS · Uptime", Macos, "uptime"),
    builtin!(
        "macos.resources",
        "macOS · Resource usage",
        Macos,
        "df -h\nvm_stat"
    ),
    builtin!(
        "macos.interfaces",
        "macOS · Network interfaces",
        Macos,
        "ifconfig -a"
    ),
    builtin!(
        "macos.routing",
        "macOS · Routing and DNS",
        Macos,
        "netstat -rn\nprintf '\\n--- DNS ---\\n'\nscutil --dns"
    ),
    builtin!(
        "macos.logs",
        "macOS · Recent logs",
        Macos,
        "log show --last 15m --style compact | tail -n 100"
    ),
    builtin!(
        "windows.identity",
        "Windows · System identity",
        Windows,
        r#"powershell -NoProfile -Command "$PSVersionTable; Get-ComputerInfo | Select-Object WindowsProductName,WindowsVersion,OsBuildNumber,CsName""#
    ),
    builtin!(
        "windows.uptime",
        "Windows · Uptime",
        Windows,
        r#"powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object LastBootUpTime,@{N='Uptime';E={(Get-Date)-$_.LastBootUpTime}}""#
    ),
    builtin!(
        "windows.resources",
        "Windows · Resource usage",
        Windows,
        r#"powershell -NoProfile -Command "Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory; Get-Volume | Select-Object DriveLetter,FileSystemLabel,Size,SizeRemaining""#
    ),
    builtin!(
        "windows.interfaces",
        "Windows · Network interfaces",
        Windows,
        r#"powershell -NoProfile -Command "Get-NetIPConfiguration | Format-List InterfaceAlias,IPv4Address,IPv6Address,DNSServer""#
    ),
    builtin!(
        "windows.routing",
        "Windows · Routing and DNS",
        Windows,
        r#"powershell -NoProfile -Command "Get-NetRoute | Sort-Object DestinationPrefix | Format-Table -AutoSize; Get-DnsClientServerAddress | Format-Table -AutoSize""#
    ),
    builtin!(
        "windows.logs",
        "Windows · Recent logs",
        Windows,
        r#"powershell -NoProfile -Command "Get-WinEvent -LogName System -MaxEvents 100 | Select-Object TimeCreated,LevelDisplayName,ProviderName,Id,Message""#
    ),
    builtin!(
        "ciscoIos.identity",
        "Cisco IOS · System identity",
        CiscoIos,
        "show version"
    ),
    builtin!(
        "ciscoIos.uptime",
        "Cisco IOS · Uptime",
        CiscoIos,
        "show version | include uptime"
    ),
    builtin!(
        "ciscoIos.resources",
        "Cisco IOS · Resource usage",
        CiscoIos,
        "show processes cpu\nshow processes memory"
    ),
    builtin!(
        "ciscoIos.interfaces",
        "Cisco IOS · Network interfaces",
        CiscoIos,
        "show ip interface brief"
    ),
    builtin!(
        "ciscoIos.routing",
        "Cisco IOS · Routing and DNS",
        CiscoIos,
        "show ip route\nshow hosts"
    ),
    builtin!(
        "ciscoIos.logs",
        "Cisco IOS · Recent logs",
        CiscoIos,
        "show logging"
    ),
    builtin!(
        "ciscoNxos.identity",
        "Cisco NX-OS · System identity",
        CiscoNxos,
        "show version"
    ),
    builtin!(
        "ciscoNxos.uptime",
        "Cisco NX-OS · Uptime",
        CiscoNxos,
        "show system uptime"
    ),
    builtin!(
        "ciscoNxos.resources",
        "Cisco NX-OS · Resource usage",
        CiscoNxos,
        "show system resources"
    ),
    builtin!(
        "ciscoNxos.interfaces",
        "Cisco NX-OS · Network interfaces",
        CiscoNxos,
        "show interface brief"
    ),
    builtin!(
        "ciscoNxos.routing",
        "Cisco NX-OS · Routing and DNS",
        CiscoNxos,
        "show ip route\nshow hosts"
    ),
    builtin!(
        "ciscoNxos.logs",
        "Cisco NX-OS · Recent logs",
        CiscoNxos,
        "show logging last 100"
    ),
    builtin!(
        "fortiOs.identity",
        "FortiOS · System identity",
        FortiOs,
        "get system status"
    ),
    builtin!(
        "fortiOs.uptime",
        "FortiOS · Uptime",
        FortiOs,
        "get system performance status"
    ),
    builtin!(
        "fortiOs.resources",
        "FortiOS · Resource usage",
        FortiOs,
        "get system performance status"
    ),
    builtin!(
        "fortiOs.interfaces",
        "FortiOS · Network interfaces",
        FortiOs,
        "get system interface physical"
    ),
    builtin!(
        "fortiOs.routing",
        "FortiOS · Routing and DNS",
        FortiOs,
        "get router info routing-table all\nget system dns"
    ),
    builtin!(
        "fortiOs.logs",
        "FortiOS · Recent logs",
        FortiOs,
        "execute log filter category event\nexecute log display"
    ),
    builtin!(
        "junos.identity",
        "Juniper Junos · System identity",
        Junos,
        "show version"
    ),
    builtin!(
        "junos.uptime",
        "Juniper Junos · Uptime",
        Junos,
        "show system uptime"
    ),
    builtin!(
        "junos.resources",
        "Juniper Junos · Resource usage",
        Junos,
        "show chassis routing-engine"
    ),
    builtin!(
        "junos.interfaces",
        "Juniper Junos · Network interfaces",
        Junos,
        "show interfaces terse"
    ),
    builtin!(
        "junos.routing",
        "Juniper Junos · Routing and DNS",
        Junos,
        "show route summary\nshow system name-server"
    ),
    builtin!(
        "junos.logs",
        "Juniper Junos · Recent logs",
        Junos,
        "show log messages | last 100"
    ),
    builtin!(
        "aristaEos.identity",
        "Arista EOS · System identity",
        AristaEos,
        "show version"
    ),
    builtin!(
        "aristaEos.uptime",
        "Arista EOS · Uptime",
        AristaEos,
        "show uptime"
    ),
    builtin!(
        "aristaEos.resources",
        "Arista EOS · Resource usage",
        AristaEos,
        "show processes top once"
    ),
    builtin!(
        "aristaEos.interfaces",
        "Arista EOS · Network interfaces",
        AristaEos,
        "show interfaces status"
    ),
    builtin!(
        "aristaEos.routing",
        "Arista EOS · Routing and DNS",
        AristaEos,
        "show ip route summary\nshow hosts"
    ),
    builtin!(
        "aristaEos.logs",
        "Arista EOS · Recent logs",
        AristaEos,
        "show logging last 100"
    ),
];

pub fn sync_builtin_catalog(conn: &SqliteConnection) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let mut upsert = tx.prepare(
        "INSERT INTO itops_tasks
            (id, name, description, sort_order, applicable_os_json, built_in_key, task_json)
         VALUES (?, ?, '', ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            description = excluded.description,
            sort_order = excluded.sort_order,
            applicable_os_json = excluded.applicable_os_json,
            built_in_key = excluded.built_in_key,
            task_json = excluded.task_json,
            updated_at = CURRENT_TIMESTAMP
         WHERE itops_tasks.name IS NOT excluded.name
            OR itops_tasks.description IS NOT excluded.description
            OR itops_tasks.sort_order IS NOT excluded.sort_order
            OR itops_tasks.applicable_os_json IS NOT excluded.applicable_os_json
            OR itops_tasks.built_in_key IS NOT excluded.built_in_key
            OR itops_tasks.task_json IS NOT excluded.task_json",
    )?;
    for (index, spec) in BUILTIN_TASKS.iter().enumerate() {
        let id = format!("builtin-task-{}", spec.key);
        let task = BatchTask::Script {
            body: spec.body.to_string(),
            shell: None,
        };
        let task_json = task_to_json(&task)?;
        let (_, applicable_os_json) = os_to_json(&[spec.os])?;
        upsert.execute(params![
            id,
            spec.name,
            -10_000_i64 + index as i64,
            applicable_os_json,
            spec.key,
            task_json
        ])?;
    }
    drop(upsert);
    tx.commit()?;
    Ok(())
}

pub fn remove_task(conn: &SqliteConnection, id: &str) -> Result<()> {
    let affected = conn.execute("DELETE FROM itops_tasks WHERE id = ?", params![id])?;
    if affected == 0 {
        return Err(TaskStorageError::NotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn open_test_db() -> SqliteConnection {
        let conn = SqliteConnection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE itops_tasks (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                sort_order INTEGER NOT NULL,
                applicable_os_json TEXT NOT NULL DEFAULT '[\"any\"]',
                built_in_key TEXT,
                task_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn creates_updates_and_removes_a_task() {
        let conn = open_test_db();
        let script = BatchTask::Script {
            body: "uptime".into(),
            shell: None,
        };
        let created = create_task(
            &conn,
            "task-1",
            " Check uptime ",
            " Basic health ",
            &[TaskOperatingSystem::Linux],
            &script,
        )
        .unwrap();
        assert_eq!(created.name, "Check uptime");
        assert_eq!(created.applicable_os, vec![TaskOperatingSystem::Linux]);
        assert_eq!(list_tasks(&conn).unwrap().len(), 1);

        let updated = update_task(
            &conn,
            "task-1",
            "Check load",
            "",
            &[TaskOperatingSystem::Any, TaskOperatingSystem::Linux],
            &script,
        )
        .unwrap();
        assert_eq!(updated.name, "Check load");
        assert_eq!(updated.applicable_os, vec![TaskOperatingSystem::Any]);
        remove_task(&conn, "task-1").unwrap();
        assert!(list_tasks(&conn).unwrap().is_empty());
    }

    #[test]
    fn syncs_read_only_builtin_catalog_with_stable_ids() {
        let conn = open_test_db();
        sync_builtin_catalog(&conn).unwrap();
        let first = list_tasks(&conn).unwrap();
        assert!(first.len() >= 40);
        assert!(first.iter().all(|task| task.built_in_key.is_some()));
        let changes_before_resync = conn.total_changes();
        sync_builtin_catalog(&conn).unwrap();
        assert_eq!(conn.total_changes(), changes_before_resync);
        assert_eq!(list_tasks(&conn).unwrap().len(), first.len());
        let linux = get_task(&conn, "builtin-task-linux.identity")
            .unwrap()
            .unwrap();
        assert_eq!(linux.applicable_os, vec![TaskOperatingSystem::Linux]);
    }
}
