use super::*;
use rusqlite::params;

fn find_folder<'a>(
    folders: &'a [ConnectionFolder],
    folder_id: &str,
) -> Option<&'a ConnectionFolder> {
    folders.iter().find_map(|folder| {
        if folder.id == folder_id {
            Some(folder)
        } else {
            find_folder(&folder.folders, folder_id)
        }
    })
}

fn all_connections(tree: &ConnectionTree) -> impl Iterator<Item = &SavedConnection> {
    tree.connections
        .iter()
        .chain(tree.folders.iter().flat_map(folder_connections))
}

fn folder_connections(
    folder: &ConnectionFolder,
) -> Box<dyn Iterator<Item = &SavedConnection> + '_> {
    Box::new(
        folder
            .connections
            .iter()
            .chain(folder.folders.iter().flat_map(folder_connections)),
    )
}

fn create_test_ssh_connection(
    storage: &Storage,
    name: &str,
    host: &str,
    folder_id: Option<String>,
) -> SavedConnection {
    storage
        .create_connection(CreateConnectionRequest {
            name: name.to_string(),
            host: host.to_string(),
            user: "admin".to_string(),
            connection_type: "ssh".to_string(),
            folder_id,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: Some("agent".to_string()),
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("SSH connection is created")
}

fn create_test_ssh_connection_in_workspace(
    storage: &Storage,
    name: &str,
    host: &str,
    workspace_id: String,
) -> SavedConnection {
    storage
        .create_connection(CreateConnectionRequest {
            name: name.to_string(),
            host: host.to_string(),
            user: "admin".to_string(),
            connection_type: "ssh".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: Some("agent".to_string()),
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: Some(workspace_id),
        })
        .expect("SSH connection is created in workspace")
}

fn root_connection_sort_orders(storage: &Storage, workspace_id: &str) -> Vec<(String, i64)> {
    let connection = storage.lock().expect("storage locks");
    let mut statement = connection
        .prepare(
            "SELECT name, sort_order
                 FROM connections
                 WHERE folder_id IS NULL AND workspace_id = ?1
                 ORDER BY sort_order, name",
        )
        .expect("sort order statement prepares");
    statement
        .query_map(params![workspace_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .expect("sort order query runs")
        .collect::<Result<Vec<_>, _>>()
        .expect("sort order rows load")
}

fn create_test_local_connection(storage: &Storage, name: &str, shell: &str) -> SavedConnection {
    storage
        .create_connection(CreateConnectionRequest {
            name: name.to_string(),
            host: "localhost".to_string(),
            user: "local".to_string(),
            connection_type: "local".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: Some("keyFile".to_string()),
            local_shell: Some(shell.to_string()),
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("local connection is created")
}

#[test]
fn local_connection_accepts_custom_shell_command_line() {
    let storage = Storage::open(temp_db_path("custom-local-shell")).expect("storage opens");

    let connection = create_test_local_connection(
        &storage,
        "Git Bash",
        r#""C:\Program Files\Git\git-bash.exe" --cd=~"#,
    );

    assert_eq!(
        connection.local_shell.as_deref(),
        Some(r#""C:\Program Files\Git\git-bash.exe" --cd=~"#),
    );
}

fn backup_filename_has_serial(filename: &str) -> bool {
    let stem = filename.strip_suffix(".zip").unwrap_or(filename);
    stem.rsplit_once('-')
        .map(|(_, serial)| serial.len() == 3 && serial.chars().all(|ch| ch.is_ascii_digit()))
        .unwrap_or(false)
}

#[test]
fn schema_initializes_an_empty_connection_tree() {
    let storage = Storage::open(temp_db_path("empty")).expect("storage opens");

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");

    assert!(tree.connections.is_empty());
    assert!(tree.folders.is_empty());
}

#[test]
fn schema_initialization_is_idempotent_without_initial_data() {
    let db_path = temp_db_path("idempotent");
    let storage = Storage::open(db_path.clone()).expect("first open succeeds");
    drop(storage);

    let reopened_storage = Storage::open(db_path).expect("second open succeeds");
    let tree = reopened_storage
        .list_connection_tree()
        .expect("connection tree loads");
    let connection_count = all_connections(&tree).count();

    assert_eq!(connection_count, 0);
    assert!(tree.folders.is_empty());
}

#[test]
fn create_connection_can_persist_root_ssh_connection() {
    let storage = Storage::open(temp_db_path("create")).expect("storage opens");

    let created = storage
        .create_connection(CreateConnectionRequest {
            name: "Lab Host".to_string(),
            host: "lab.internal".to_string(),
            user: "admin".to_string(),
            connection_type: "ssh".to_string(),
            folder_id: None,
            port: Some(2222),
            key_path: Some("C:\\Users\\example\\.ssh\\id_ed25519".to_string()),
            proxy_jump: Some("jump.internal".to_string()),
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: Some("keyFile".to_string()),
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("connection is created");

    assert_eq!(created.name, "Lab Host");
    assert_eq!(created.port, Some(2222));
    assert_eq!(created.proxy_jump.as_deref(), Some("jump.internal"));

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    let root_connection = tree
        .connections
        .iter()
        .find(|connection| connection.host == "lab.internal")
        .expect("root connection exists");

    assert_eq!(root_connection.name, "Lab Host");
    assert_eq!(root_connection.tags, Vec::<String>::new());
}

#[test]
fn ssh_compression_override_round_trips_and_validates() {
    let storage = Storage::open(temp_db_path("ssh-compression")).expect("storage opens");

    // Default (no override) persists as NULL so the connection inherits the
    // global SSH compression default at launch.
    let inheriting = create_test_ssh_connection(&storage, "Inherits", "inherit.internal", None);
    assert_eq!(inheriting.ssh_compression, None);

    // An explicit override is stored verbatim and survives a reload.
    let overridden = storage
        .create_connection(CreateConnectionRequest {
            name: "No Compression".to_string(),
            host: "raw.internal".to_string(),
            user: "admin".to_string(),
            connection_type: "ssh".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: Some("off".to_string()),
            auth_method: Some("agent".to_string()),
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("connection is created");
    assert_eq!(overridden.ssh_compression.as_deref(), Some("off"));

    let reloaded = storage
        .list_connection_tree()
        .expect("connection tree loads");
    let reloaded = reloaded
        .connections
        .iter()
        .find(|connection| connection.host == "raw.internal")
        .expect("override connection exists");
    assert_eq!(reloaded.ssh_compression.as_deref(), Some("off"));

    // Only 'off' and 'fast' are accepted.
    let invalid = storage.create_connection(CreateConnectionRequest {
        name: "Bad".to_string(),
        host: "bad.internal".to_string(),
        user: "admin".to_string(),
        connection_type: "ssh".to_string(),
        folder_id: None,
        port: None,
        key_path: None,
        proxy_jump: None,
        ssh_socks_proxy: None,
        ssh_socks_proxy_username: None,
        ssh_socks_proxy_inherit_defaults: None,
        ssh_compression: Some("turbo".to_string()),
        auth_method: Some("agent".to_string()),
        local_shell: None,
        local_startup_directory: None,
        local_startup_script: None,
        url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
        use_psmux_sessions: None,
        serial_line: None,
        serial_speed: None,
        rdp_options: None,
        vnc_options: None,
        ftp_options: None,
        file_view_open_external: false,
        ssh_port_forwardings: None,
        workspace_id: None,
    });
    assert!(invalid.is_err(), "invalid compression value must be rejected");
}

#[test]
fn ssh_socks_proxy_username_round_trips_without_storing_passwords_in_sqlite() {
    let storage =
        Storage::open(temp_db_path("ssh-socks-proxy-credentials")).expect("storage opens");

    let created = storage
        .create_connection(CreateConnectionRequest {
            name: "Proxy Lab".to_string(),
            host: "lab.internal".to_string(),
            user: "admin".to_string(),
            connection_type: "ssh".to_string(),
            folder_id: None,
            port: Some(22),
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: Some("  127.0.0.1:1080  ".to_string()),
            ssh_socks_proxy_username: Some("  proxy-user  ".to_string()),
            ssh_socks_proxy_inherit_defaults: Some(false),
            ssh_compression: None,
            auth_method: Some("agent".to_string()),
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("connection is created");

    assert_eq!(created.ssh_socks_proxy.as_deref(), Some("127.0.0.1:1080"));
    assert_eq!(
        created.ssh_socks_proxy_username.as_deref(),
        Some("proxy-user")
    );

    let reloaded = storage
        .list_connection_tree()
        .expect("connection tree loads")
        .connections
        .into_iter()
        .find(|connection| connection.id == created.id)
        .expect("connection reloads");
    assert_eq!(reloaded.ssh_socks_proxy.as_deref(), Some("127.0.0.1:1080"));
    assert_eq!(
        reloaded.ssh_socks_proxy_username.as_deref(),
        Some("proxy-user")
    );

    let sqlite_bytes = fs::read(&storage.db_path).expect("database is readable");
    let sqlite_text = String::from_utf8_lossy(&sqlite_bytes);
    assert!(!sqlite_text.contains("proxy-login-password"));
}

#[test]
fn ssh_settings_store_socks_proxy_username_without_password() {
    let storage = Storage::open(temp_db_path("ssh-socks-proxy-settings")).expect("storage opens");
    let mut settings = storage.ssh_settings().expect("SSH settings load");
    settings.default_ssh_socks_proxy = Some("  10.0.0.119:1080  ".to_string());
    settings.default_ssh_socks_proxy_username = Some("  proxy-user  ".to_string());

    let saved = storage
        .update_ssh_settings(settings)
        .expect("SSH settings update");
    assert_eq!(
        saved.default_ssh_socks_proxy.as_deref(),
        Some("10.0.0.119:1080")
    );
    assert_eq!(
        saved.default_ssh_socks_proxy_username.as_deref(),
        Some("proxy-user")
    );

    let sqlite_bytes = fs::read(&storage.db_path).expect("database is readable");
    let sqlite_text = String::from_utf8_lossy(&sqlite_bytes);
    assert!(!sqlite_text.contains("proxy-login-password"));
}

#[test]
fn local_connection_persists_startup_directory_and_script() {
    let storage = Storage::open(temp_db_path("local-startup-options")).expect("storage opens");

    let created = storage
        .create_connection(CreateConnectionRequest {
            name: "Project Shell".to_string(),
            host: "localhost".to_string(),
            user: "local".to_string(),
            connection_type: "local".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: None,
            local_shell: Some("powershell.exe".to_string()),
            local_startup_directory: Some("  C:\\Work\\KKTerm  ".to_string()),
            local_startup_script: Some("  npm run check  ".to_string()),
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("local connection is created");

    assert_eq!(
        created.local_startup_directory.as_deref(),
        Some("C:\\Work\\KKTerm")
    );
    assert_eq!(
        created.local_startup_script.as_deref(),
        Some("npm run check")
    );

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    let reloaded = tree
        .connections
        .iter()
        .find(|connection| connection.id == created.id)
        .expect("local connection reloads");
    assert_eq!(
        reloaded.local_startup_directory.as_deref(),
        Some("C:\\Work\\KKTerm")
    );
    assert_eq!(
        reloaded.local_startup_script.as_deref(),
        Some("npm run check")
    );
}

#[test]
fn ssh_connection_persists_startup_script() {
    let storage = Storage::open(temp_db_path("ssh-startup-script")).expect("storage opens");

    let created = storage
        .create_connection(CreateConnectionRequest {
            name: "Project SSH".to_string(),
            host: "server.internal".to_string(),
            user: "admin".to_string(),
            connection_type: "ssh".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: None,
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: Some("  cd /srv/app\nsource .venv/bin/activate  ".to_string()),
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("SSH connection is created");

    assert_eq!(
        created.local_startup_script.as_deref(),
        Some("cd /srv/app\nsource .venv/bin/activate")
    );

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    let reloaded = tree
        .connections
        .iter()
        .find(|connection| connection.id == created.id)
        .expect("SSH connection reloads");
    assert_eq!(
        reloaded.local_startup_script.as_deref(),
        Some("cd /srv/app\nsource .venv/bin/activate")
    );
}

#[test]
fn local_connection_persists_psmux_preference() {
    let storage = Storage::open(temp_db_path("local-psmux-preference")).expect("storage opens");

    let created = storage
        .create_connection(CreateConnectionRequest {
            name: "psmux Shell".to_string(),
            host: "localhost".to_string(),
            user: "local".to_string(),
            connection_type: "local".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: None,
            local_shell: Some("pwsh.exe".to_string()),
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: Some(true),
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("local psmux connection is created");
    assert!(created.use_psmux_sessions);

    let reloaded = storage
        .list_connection_tree()
        .expect("connection tree loads")
        .connections
        .into_iter()
        .find(|connection| connection.id == created.id)
        .expect("local psmux connection reloads");
    assert!(reloaded.use_psmux_sessions);

    // psmux is local-only: an SSH Connection ignores the flag even when set.
    let ssh = storage
        .create_connection(CreateConnectionRequest {
            name: "Remote".to_string(),
            host: "remote.internal".to_string(),
            user: "admin".to_string(),
            connection_type: "ssh".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: Some("agent".to_string()),
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: Some(true),
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("ssh connection is created");
    assert!(!ssh.use_psmux_sessions);
}

#[test]
fn local_files_connection_can_be_created_with_starting_directory() {
    let storage = Storage::open(temp_db_path("local-files-connection")).expect("storage opens");

    let created = storage
        .create_connection(CreateConnectionRequest {
            name: "Project Files".to_string(),
            host: String::new(),
            user: String::new(),
            connection_type: "localFiles".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: None,
            local_shell: None,
            local_startup_directory: Some("  C:\\Users\\user\\.claude  ".to_string()),
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("local File Explorer connection is created");

    assert_eq!(created.connection_type, "localFiles");
    assert_eq!(created.host, "localhost");
    assert_eq!(created.user, "");
    assert_eq!(
        created.local_startup_directory.as_deref(),
        Some("C:\\Users\\user\\.claude")
    );
}

#[test]
fn file_view_connection_persists_file_path_and_no_host() {
    let storage = Storage::open(temp_db_path("file-view-connection")).expect("storage opens");

    let created = storage
        .create_connection(CreateConnectionRequest {
            name: "syslog".to_string(),
            host: String::new(),
            user: String::new(),
            connection_type: "fileView".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: None,
            local_shell: None,
            // The Document reuses the local-path slot to store the target
            // file path.
            local_startup_directory: Some("  /var/log/syslog  ".to_string()),
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: true,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("Document connection is created");

    assert_eq!(created.connection_type, "fileView");
    assert_eq!(created.host, "localhost");
    assert_eq!(created.user, "");
    assert_eq!(
        created.local_startup_directory.as_deref(),
        Some("/var/log/syslog")
    );
    assert!(created.file_view_open_external);

    // The new kind must round-trip through the connection tree listing,
    // which exercises the CHECK constraint and row deserialization.
    let listed = storage
        .list_connection_tree()
        .expect("connection tree lists");
    assert!(
        listed
            .connections
            .iter()
            .any(|connection| connection.id == created.id
                && connection.connection_type == "fileView"
                && connection.file_view_open_external),
        "Document connection should appear in the tree"
    );
}

#[test]
fn create_connection_can_persist_remote_desktop_connections() {
    let storage = Storage::open(temp_db_path("remote-desktop-create")).expect("storage opens");

    let rdp = storage
        .create_connection(CreateConnectionRequest {
            name: "Jump Box".to_string(),
            host: "jumpbox.internal".to_string(),
            user: "DOMAIN\\admin".to_string(),
            connection_type: "rdp".to_string(),
            folder_id: None,
            port: Some(3389),
            key_path: Some("C:\\ignored\\id_ed25519".to_string()),
            proxy_jump: Some("ignored.internal".to_string()),
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: Some("password".to_string()),
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: Some(true),
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("RDP connection is created");

    assert_eq!(rdp.connection_type, "rdp");
    assert_eq!(rdp.host, "jumpbox.internal");
    assert_eq!(rdp.user, "DOMAIN\\admin");
    assert_eq!(rdp.port, Some(3389));
    assert!(rdp.key_path.is_none());
    assert!(rdp.proxy_jump.is_none());
    assert!(!rdp.use_tmux_sessions);

    let vnc = storage
        .create_connection(CreateConnectionRequest {
            name: "Console VNC".to_string(),
            host: "console.internal".to_string(),
            user: "   ".to_string(),
            connection_type: "vnc".to_string(),
            folder_id: None,
            port: Some(5900),
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: None,
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("VNC connection is created");

    assert_eq!(vnc.connection_type, "vnc");
    assert_eq!(vnc.user, "");
    assert_eq!(vnc.port, Some(5900));
}

#[test]
fn create_connection_can_persist_telnet_and_serial_connections() {
    let storage = Storage::open(temp_db_path("telnet-serial-create")).expect("storage opens");

    let telnet = storage
        .create_connection(CreateConnectionRequest {
            name: "Legacy Router".to_string(),
            host: "router.internal".to_string(),
            user: "admin".to_string(),
            connection_type: "telnet".to_string(),
            folder_id: None,
            port: Some(23),
            key_path: Some("C:\\ignored\\id_ed25519".to_string()),
            proxy_jump: Some("ignored.internal".to_string()),
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: Some("agent".to_string()),
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: Some(true),
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("Telnet connection is created");

    assert_eq!(telnet.connection_type, "telnet");
    assert_eq!(telnet.auth_method, "password");
    assert!(telnet.key_path.is_none());
    assert!(telnet.proxy_jump.is_none());
    assert!(!telnet.use_tmux_sessions);

    let serial = storage
        .create_connection(CreateConnectionRequest {
            name: "Console Cable".to_string(),
            host: String::new(),
            user: "ignored".to_string(),
            connection_type: "serial".to_string(),
            folder_id: None,
            port: Some(22),
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: None,
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: Some("COM7".to_string()),
            serial_speed: Some(115200),
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("Serial connection is created");

    assert_eq!(serial.connection_type, "serial");
    assert_eq!(serial.host, "COM7");
    assert_eq!(serial.user, "");
    assert_eq!(serial.port, None);
    assert_eq!(serial.serial_line.as_deref(), Some("COM7"));
    assert_eq!(serial.serial_speed, Some(115200));
}

#[test]
fn url_credentials_round_trip_without_storing_passwords_in_sqlite() {
    let storage = Storage::open(temp_db_path("url-credentials")).expect("storage opens");
    let created = storage
        .create_connection(CreateConnectionRequest {
            name: "Router UI".to_string(),
            host: String::new(),
            user: String::new(),
            connection_type: "url".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: None,
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: Some("router.internal".to_string()),
            data_partition: Some("ops".to_string()),
            url_proxy: Some(" socks5://127.0.0.1:1080 ".to_string()),
            url_proxy_inherit_defaults: Some(false),
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("URL connection is created");

    assert_eq!(created.url.as_deref(), Some("https://router.internal/"));
    assert_eq!(created.url_proxy.as_deref(), Some("socks5://127.0.0.1:1080"));
    assert!(!created.url_proxy_inherit_defaults);
    assert!(!created.has_url_credential);

    let updated = storage
        .upsert_url_credential(UpsertUrlCredentialRequest {
            connection_id: created.id.clone(),
            username: "admin".to_string(),
            page_url: None,
            username_selector: None,
            password_selector: None,
            field_values: None,
        })
        .expect("URL credential metadata is stored");
    assert!(updated.has_url_credential);
    assert_eq!(updated.url_credential_username.as_deref(), Some("admin"));

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    let reloaded = tree
        .connections
        .iter()
        .find(|connection| connection.id == created.id)
        .expect("URL connection exists");
    assert!(reloaded.has_url_credential);
    assert_eq!(reloaded.url_credential_username.as_deref(), Some("admin"));
    assert_eq!(reloaded.url_proxy.as_deref(), Some("socks5://127.0.0.1:1080"));
    assert!(!reloaded.url_proxy_inherit_defaults);

    let duplicated = storage
        .duplicate_connection(DuplicateConnectionRequest {
            id: created.id,
            name: Some("Router UI copy".to_string()),
        })
        .expect("URL connection is duplicated");
    assert_eq!(
        duplicated.url_proxy.as_deref(),
        Some("socks5://127.0.0.1:1080")
    );
    assert!(!duplicated.url_proxy_inherit_defaults);
}

#[test]
fn connection_icon_data_url_updates_for_any_connection_type() {
    let storage = Storage::open(temp_db_path("connection-icon-data-url")).expect("storage opens");
    let created = create_test_ssh_connection(&storage, "Bastion", "bastion.internal", None);
    let icon_data_url = " data:image/png;base64,customicon ".to_string();

    let updated = storage
        .update_connection_icon_data_url(created.id.clone(), Some(icon_data_url))
        .expect("connection icon is updated")
        .expect("changed icon returns the updated connection");

    assert_eq!(
        updated.icon_data_url.as_deref(),
        Some("data:image/png;base64,customicon")
    );

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    let reloaded = tree
        .connections
        .iter()
        .find(|connection| connection.id == created.id)
        .expect("connection exists");
    assert_eq!(
        reloaded.icon_data_url.as_deref(),
        Some("data:image/png;base64,customicon")
    );

    let cleared = storage
        .update_connection_icon_data_url(created.id.clone(), None)
        .expect("connection icon is cleared")
        .expect("cleared icon returns the updated connection");
    assert!(cleared.icon_data_url.is_none());
}

#[test]
fn connection_brand_icon_ref_updates_for_any_connection_type() {
    let storage =
        Storage::open(temp_db_path("connection-brand-icon-ref")).expect("storage opens");
    let created = create_test_ssh_connection(&storage, "Claude", "claude.internal", None);

    let updated = storage
        .update_connection_icon_data_url(created.id.clone(), Some("brand:claude-code".to_string()))
        .expect("brand icon ref is updated")
        .expect("changed icon returns the updated connection");

    assert_eq!(updated.icon_data_url.as_deref(), Some("brand:claude-code"));
}

#[test]
fn connection_icon_background_color_updates_for_any_connection_type() {
    let storage = Storage::open(temp_db_path("connection-icon-background")).expect("storage opens");
    let created = create_test_ssh_connection(&storage, "Bastion", "bastion.internal", None);

    let updated = storage
        .update_connection_icon_background_color(created.id.clone(), Some(" #2563eb ".to_string()))
        .expect("connection icon background is updated")
        .expect("changed background returns the updated connection");

    assert_eq!(updated.icon_background_color.as_deref(), Some("#2563eb"));

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    let reloaded = tree
        .connections
        .iter()
        .find(|connection| connection.id == created.id)
        .expect("connection exists");
    assert_eq!(reloaded.icon_background_color.as_deref(), Some("#2563eb"));

    let cleared = storage
        .update_connection_icon_background_color(created.id.clone(), None)
        .expect("connection icon background is cleared")
        .expect("cleared background returns the updated connection");
    assert!(cleared.icon_background_color.is_none());
}

#[test]
fn connection_terminal_appearance_updates_and_persists() {
    let storage =
        Storage::open(temp_db_path("connection-terminal-appearance")).expect("storage opens");
    let created = create_test_ssh_connection(&storage, "Bastion", "bastion.internal", None);
    assert_eq!(created.terminal_opacity, Some(DEFAULT_TERMINAL_OPACITY));
    assert!(created.terminal_background.is_none());

    let background = crate::dashboard_storage::DashboardBackground::Preset {
        preset: "midnight".to_string(),
    };
    let updated = storage
        .update_connection_terminal_appearance(
            created.id.clone(),
            Some(82),
            Some(background.clone()),
        )
        .expect("terminal appearance is updated")
        .expect("changed appearance returns the updated connection");

    assert_eq!(updated.terminal_opacity, Some(82));
    assert_eq!(updated.terminal_background, Some(background.clone()));

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    let reloaded = tree
        .connections
        .iter()
        .find(|connection| connection.id == created.id)
        .expect("connection exists");
    assert_eq!(reloaded.terminal_opacity, Some(82));
    assert_eq!(reloaded.terminal_background, Some(background));

    let cleared = storage
        .update_connection_terminal_appearance(
            created.id.clone(),
            Some(DEFAULT_TERMINAL_OPACITY),
            None,
        )
        .expect("terminal appearance is cleared")
        .expect("cleared appearance returns the updated connection");
    assert_eq!(cleared.terminal_opacity, Some(DEFAULT_TERMINAL_OPACITY));
    assert!(cleared.terminal_background.is_none());
}

#[test]
fn connection_tab_title_updates_without_renaming_connection() {
    let storage = Storage::open(temp_db_path("connection-tab-title")).expect("storage opens");
    let created = create_test_ssh_connection(&storage, "pb60", "pb60.internal", None);

    let updated = storage
        .update_connection_tab_title(created.id.clone(), Some(" My Terminal ".to_string()))
        .expect("tab title updates")
        .expect("changed connection is returned");

    assert_eq!(updated.name, "pb60");
    assert_eq!(updated.tab_title.as_deref(), Some("My Terminal"));

    let reloaded = storage
        .list_connection_tree()
        .expect("connection tree reloads")
        .connections
        .into_iter()
        .find(|connection| connection.id == created.id)
        .expect("connection remains listed");

    assert_eq!(reloaded.name, "pb60");
    assert_eq!(reloaded.tab_title.as_deref(), Some("My Terminal"));
}

#[test]
fn stored_credential_candidates_include_connection_url_and_widget_metadata() {
    let storage =
        Storage::open(temp_db_path("stored-credential-candidates")).expect("storage opens");

    let ssh = storage
        .create_connection(CreateConnectionRequest {
            name: "Password Host".to_string(),
            host: "password.internal".to_string(),
            user: "admin".to_string(),
            connection_type: "ssh".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: Some("password".to_string()),
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("SSH connection is created");
    let url = storage
        .create_connection(CreateConnectionRequest {
            name: "Portal".to_string(),
            host: String::new(),
            user: String::new(),
            connection_type: "url".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: None,
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: Some("https://portal.example".to_string()),
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("URL connection is created");
    storage
        .upsert_url_credential(UpsertUrlCredentialRequest {
            connection_id: url.id.clone(),
            username: "web-user".to_string(),
            page_url: None,
            username_selector: None,
            password_selector: None,
            field_values: None,
        })
        .expect("URL credential metadata is stored");

    storage.with_connection(|connection| {
            connection.execute(
                "INSERT INTO dashboard_views (id, title, sort_order, grid_density)
                 VALUES ('view-1', 'Default', 0, 'default')",
                [],
            ).map_err(to_storage_error)?;
            connection.execute(
                "INSERT INTO dashboard_custom_widgets
                    (id, title, summary, category, body_json, settings_schema_json, created_by)
                 VALUES
                    ('cw-1', 'API Widget', '', 'custom',
                     '{\"source\":\"console.log(1)\",\"permissions\":{\"network\":false}}',
                     '{\"fields\":[{\"type\":\"secret\",\"key\":\"apiKey\",\"label\":\"API key\"}]}',
                     'agent')",
                [],
            ).map_err(to_storage_error)?;
            connection.execute(
                "INSERT INTO dashboard_widget_instances
                    (id, view_id, kind, source_id, preset, accent_name, icon_name, custom_title,
                     glass, action_direction, settings_values_json, body_opacity,
                     grid_x, grid_y, grid_w, grid_h, sort_order)
                 VALUES
                    ('inst-1', 'view-1', 'script', 'cw-1', 'panel', 'blue', 'Key', NULL,
                     0, NULL,
                     '{\"apiKey\":{\"type\":\"secretRef\",\"ownerId\":\"dashboard-widget-secret:inst-1:apiKey\",\"hasSecret\":true}}',
                     NULL, 0, 0, 4, 3, 0)",
                [],
            ).map_err(to_storage_error)?;
            Ok(())
        }).expect("dashboard widget metadata is inserted");

    let candidates = storage
        .list_stored_credential_candidates()
        .expect("credential candidates load");

    assert!(candidates.iter().any(|candidate| {
        candidate.kind == "connectionPassword" && candidate.owner_id == ssh.id
    }));
    assert!(
        candidates
            .iter()
            .any(|candidate| { candidate.kind == "urlPassword" && candidate.owner_id == url.id })
    );
    assert!(candidates.iter().any(|candidate| {
        candidate.kind == "widgetSecret"
            && candidate.owner_id == "dashboard-widget-secret:inst-1:apiKey"
    }));
}

#[test]
fn connection_password_credentials_use_type_host_metadata_and_suffixes() {
    let storage =
        Storage::open(temp_db_path("connection-password-credentials")).expect("storage opens");
    let first = create_test_ssh_connection(&storage, "Bastion One", "bastion.internal", None);
    let second = create_test_ssh_connection(&storage, "Bastion Two", "bastion.internal", None);

    let first_credential = storage
        .create_connection_password_credential_metadata(first.id.clone())
        .expect("first credential metadata is created");
    let second_credential = storage
        .create_connection_password_credential_metadata(second.id.clone())
        .expect("second credential metadata is created");

    assert_eq!(first_credential.connection_type, "ssh");
    assert_eq!(first_credential.host, "bastion.internal");
    assert_eq!(first_credential.username, "admin");
    assert_eq!(first_credential.label, "admin @ bastion.internal");
    assert_eq!(second_credential.label, "admin @ bastion.internal #2");
}

#[test]
fn assigning_connection_password_credential_requires_matching_type() {
    let storage = Storage::open(temp_db_path("connection-password-credential-assign"))
        .expect("storage opens");
    let ssh = create_test_ssh_connection(&storage, "SSH", "ssh.internal", None);
    let rdp = storage
        .create_connection(CreateConnectionRequest {
            name: "RDP".to_string(),
            host: "rdp.internal".to_string(),
            user: "admin".to_string(),
            connection_type: "rdp".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: None,
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("RDP connection is created");
    let credential = storage
        .create_connection_password_credential_metadata(ssh.id.clone())
        .expect("SSH credential metadata is created");

    let assigned = storage
        .assign_connection_password_credential(ssh.id.clone(), credential.id.clone())
        .expect("matching credential can be assigned");
    assert_eq!(
        assigned.password_credential_id.as_deref(),
        Some(credential.id.as_str())
    );

    let error = match storage.assign_connection_password_credential(rdp.id, credential.id) {
        Ok(_) => panic!("mismatched credential is rejected"),
        Err(error) => error,
    };
    assert_eq!(
        error,
        "password credential type must match the connection type"
    );
}

#[test]
fn url_credentials_reject_non_url_connections() {
    let storage = Storage::open(temp_db_path("url-credential-type")).expect("storage opens");
    let connection = create_test_ssh_connection(&storage, "Bastion", "bastion.internal", None);

    let error = match storage.upsert_url_credential(UpsertUrlCredentialRequest {
        connection_id: connection.id,
        username: "admin".to_string(),
        page_url: None,
        username_selector: None,
        password_selector: None,
        field_values: None,
    }) {
        Ok(_) => panic!("SSH connections cannot store URL credentials"),
        Err(error) => error,
    };
    assert_eq!(
        error,
        "URL credentials can only be stored for URL connections"
    );
}

#[test]
fn url_credentials_keep_multiple_page_steps_and_ignore_ephemeral_url_parts() {
    let storage = Storage::open(temp_db_path("url-credential-pages")).expect("storage opens");
    let created = storage
        .create_connection(CreateConnectionRequest {
            name: "Portal".to_string(),
            host: String::new(),
            user: String::new(),
            connection_type: "url".to_string(),
            folder_id: None,
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: None,
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: Some("https://portal.example".to_string()),
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("URL connection is created");

    storage
        .upsert_url_credential(UpsertUrlCredentialRequest {
            connection_id: created.id.clone(),
            username: "alice".to_string(),
            page_url: Some("https://portal.example/login?state=one#fragment".to_string()),
            username_selector: Some("input[name=\"user\"]".to_string()),
            password_selector: None,
            field_values: Some("[{\"selector\":\"input[name=\\\"user\\\"]\",\"kind\":\"value\",\"value\":\"alice\"}]".to_string()),
        })
        .expect("username step is stored");
    storage
        .upsert_url_credential(UpsertUrlCredentialRequest {
            connection_id: created.id.clone(),
            username: "password-step".to_string(),
            page_url: Some("https://portal.example/password?nonce=two".to_string()),
            username_selector: None,
            password_selector: Some("input[type=\"password\"]".to_string()),
            field_values: None,
        })
        .expect("password step is stored");
    storage
        .upsert_url_credential(UpsertUrlCredentialRequest {
            connection_id: created.id.clone(),
            username: "alice-updated".to_string(),
            page_url: Some("https://portal.example/login?state=three".to_string()),
            username_selector: Some("input[name=\"username\"]".to_string()),
            password_selector: None,
            field_values: None,
        })
        .expect("same page key updates the username step");

    let credentials = storage.list_url_credentials().expect("credentials list");
    let portal_credentials: Vec<_> = credentials
        .iter()
        .filter(|credential| credential.connection_id == created.id)
        .collect();
    assert_eq!(portal_credentials.len(), 2);

    let username_step = storage
        .url_credential_fill(&created.id, Some("https://portal.example/login?state=four"))
        .expect("username step lookup succeeds")
        .expect("username step exists");
    let password_step = storage
        .url_credential_fill(&created.id, Some("https://portal.example/password?nonce=five#ignored"))
        .expect("password step lookup succeeds")
        .expect("password step exists");

    assert_eq!(username_step.username, "alice-updated");
    assert_eq!(
        username_step.username_selector.as_deref(),
        Some("input[name=\"username\"]")
    );
    assert_eq!(password_step.username, "password-step");
    assert_ne!(username_step.secret_owner_id, password_step.secret_owner_id);
    assert!(username_step.secret_owner_id.len() <= 128);
    assert!(
        storage
            .url_credential_fill(&created.id, Some("https://portal.example/unknown"))
            .expect("unknown lookup succeeds")
            .is_none()
    );
}

#[test]
fn rename_connection_updates_durable_connection_name() {
    let storage = Storage::open(temp_db_path("rename")).expect("storage opens");
    let staging = storage
        .create_connection_folder(CreateConnectionFolderRequest {
            name: "Staging".to_string(),
            parent_folder_id: None,
            workspace_id: None,
            icon_data_url: None,
        })
        .expect("staging folder is created");
    let connection = create_test_ssh_connection(
        &storage,
        "API Stage",
        "api-stage.internal",
        Some(staging.id.clone()),
    );

    let renamed = storage
        .rename_connection(RenameConnectionRequest {
            id: connection.id.clone(),
            name: "API Stage Blue".to_string(),
        })
        .expect("connection is renamed");

    assert_eq!(renamed.id, connection.id);
    assert_eq!(renamed.name, "API Stage Blue");

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    let staging = find_folder(&tree.folders, &staging.id).expect("staging folder exists");

    assert_eq!(staging.connections[0].name, "API Stage Blue");
}

#[test]
fn update_connection_edits_fields_and_moves_folder() {
    let storage = Storage::open(temp_db_path("update")).expect("storage opens");
    let staging = storage
        .create_connection_folder(CreateConnectionFolderRequest {
            name: "Staging".to_string(),
            parent_folder_id: None,
            workspace_id: None,
            icon_data_url: None,
        })
        .expect("staging folder is created");
    let production = storage
        .create_connection_folder(CreateConnectionFolderRequest {
            name: "Production".to_string(),
            parent_folder_id: None,
            workspace_id: None,
            icon_data_url: None,
        })
        .expect("production folder is created");
    let connection = create_test_ssh_connection(
        &storage,
        "API Stage",
        "api-stage.internal",
        Some(staging.id.clone()),
    );

    let updated = storage
        .update_connection(UpdateConnectionRequest {
            id: connection.id.clone(),
            name: "API Production".to_string(),
            host: "api-prod.internal".to_string(),
            user: "deploy".to_string(),
            connection_type: "ssh".to_string(),
            folder_id: Some(production.id.clone()),
            port: Some(2222),
            key_path: Some("C:\\Users\\example\\.ssh\\prod".to_string()),
            proxy_jump: Some("jump.internal".to_string()),
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: Some("keyFile".to_string()),
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: Some(false),
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
        })
        .expect("connection is updated");

    assert_eq!(updated.id, connection.id);
    assert_eq!(updated.name, "API Production");
    assert_eq!(updated.host, "api-prod.internal");
    assert_eq!(updated.user, "deploy");
    assert_eq!(updated.port, Some(2222));
    assert_eq!(
        updated.key_path.as_deref(),
        Some("C:\\Users\\example\\.ssh\\prod")
    );
    assert_eq!(updated.proxy_jump.as_deref(), Some("jump.internal"));
    assert_eq!(updated.auth_method, "keyFile");
    assert!(!updated.use_tmux_sessions);
    assert!(updated.tmux_connection_id.is_none());

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    let staging = find_folder(&tree.folders, &staging.id).expect("staging folder exists");
    let production = find_folder(&tree.folders, &production.id).expect("production folder exists");

    assert!(staging.connections.is_empty());
    assert_eq!(production.connections[0].id, connection.id);
    assert_eq!(production.connections[0].name, "API Production");
}

#[test]
fn update_connection_preserves_existing_tmux_preference_when_omitted() {
    let storage = Storage::open(temp_db_path("update_preserve_tmux")).expect("storage opens");
    let connection = create_test_ssh_connection(&storage, "API Stage", "api-stage.internal", None);
    let disabled = storage
        .update_connection(UpdateConnectionRequest {
            id: connection.id.clone(),
            name: connection.name.clone(),
            host: connection.host.clone(),
            user: connection.user.clone(),
            connection_type: "ssh".to_string(),
            folder_id: None,
            port: connection.port,
            key_path: connection.key_path.clone(),
            proxy_jump: connection.proxy_jump.clone(),
            ssh_socks_proxy: connection.ssh_socks_proxy.clone(),
            ssh_socks_proxy_username: connection.ssh_socks_proxy_username.clone(),
            ssh_socks_proxy_inherit_defaults: Some(connection.ssh_socks_proxy_inherit_defaults),
            ssh_compression: None,
            auth_method: Some(connection.auth_method.clone()),
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: Some(false),
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
        })
        .expect("tmux preference is disabled");

    let updated = storage
        .update_connection(UpdateConnectionRequest {
            id: disabled.id.clone(),
            name: "API Stage Renamed".to_string(),
            host: disabled.host.clone(),
            user: disabled.user.clone(),
            connection_type: "ssh".to_string(),
            folder_id: None,
            port: disabled.port,
            key_path: disabled.key_path.clone(),
            proxy_jump: disabled.proxy_jump.clone(),
            ssh_socks_proxy: disabled.ssh_socks_proxy.clone(),
            ssh_socks_proxy_username: disabled.ssh_socks_proxy_username.clone(),
            ssh_socks_proxy_inherit_defaults: Some(disabled.ssh_socks_proxy_inherit_defaults),
            ssh_compression: None,
            auth_method: Some(disabled.auth_method.clone()),
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
        })
        .expect("connection is updated without tmux preference");

    assert_eq!(updated.name, "API Stage Renamed");
    assert!(!updated.use_tmux_sessions);
    assert!(updated.tmux_connection_id.is_none());
}

#[test]
fn delete_connection_removes_connection_and_tags() {
    let storage = Storage::open(temp_db_path("delete")).expect("storage opens");
    let production = storage
        .create_connection_folder(CreateConnectionFolderRequest {
            name: "Production".to_string(),
            parent_folder_id: None,
            workspace_id: None,
            icon_data_url: None,
        })
        .expect("production folder is created");
    let connection = create_test_ssh_connection(
        &storage,
        "Bastion East",
        "bastion-east.internal",
        Some(production.id.clone()),
    );

    storage
        .delete_connection(connection.id)
        .expect("connection is deleted");

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    let production = find_folder(&tree.folders, &production.id).expect("production folder exists");

    assert!(production.connections.is_empty());
}

#[test]
fn duplicate_connection_copies_non_secret_connection_data() {
    let storage = Storage::open(temp_db_path("duplicate")).expect("storage opens");
    let production = storage
        .create_connection_folder(CreateConnectionFolderRequest {
            name: "Production".to_string(),
            parent_folder_id: None,
            workspace_id: None,
            icon_data_url: None,
        })
        .expect("production folder is created");
    let connection = create_test_ssh_connection(
        &storage,
        "Bastion East",
        "bastion-east.internal",
        Some(production.id.clone()),
    );

    let duplicated = storage
        .duplicate_connection(DuplicateConnectionRequest {
            id: connection.id.clone(),
            name: Some("Bastion East Copy".to_string()),
        })
        .expect("connection is duplicated");

    assert_ne!(duplicated.id, connection.id);
    assert_eq!(duplicated.name, "Bastion East Copy");
    assert_eq!(duplicated.host, "bastion-east.internal");
    assert_eq!(duplicated.user, "admin");
    assert_eq!(duplicated.tags, Vec::<String>::new());
    assert_eq!(duplicated.status, "idle");

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    let production = find_folder(&tree.folders, &production.id).expect("production folder exists");

    assert_eq!(production.connections.len(), 2);
    assert_eq!(production.connections[1].id, duplicated.id);
}

#[test]
fn ssh_port_forwardings_persist_update_and_duplicate() {
    let storage = Storage::open(temp_db_path("ssh-forwardings")).expect("storage opens");
    let connection = create_test_ssh_connection(&storage, "Bastion", "bastion.internal", None);
    let forwardings = vec![
        SshPortForwarding {
            id: "forward-local-web".to_string(),
            mode: "L".to_string(),
            enabled: true,
            bind: "127.0.0.1".to_string(),
            listen_port: 8080,
            dest_host: Some("localhost".to_string()),
            dest_port: Some(3000),
        },
        SshPortForwarding {
            id: "forward-socks".to_string(),
            mode: "D".to_string(),
            enabled: false,
            bind: "127.0.0.1".to_string(),
            listen_port: 1080,
            dest_host: Some("ignored.example".to_string()),
            dest_port: Some(9999),
        },
    ];

    let updated = storage
        .update_connection_ssh_port_forwardings(connection.id.clone(), Some(forwardings.clone()))
        .expect("forwardings update succeeds")
        .expect("connection changes");
    let stored = updated
        .ssh_port_forwardings
        .as_ref()
        .expect("forwardings are persisted");
    assert_eq!(stored.len(), 2);
    assert!(stored[0] == forwardings[0]);
    assert_eq!(stored[1].mode, "D");
    assert!(stored[1].dest_host.is_none());
    assert!(stored[1].dest_port.is_none());

    let duplicated = storage
        .duplicate_connection(DuplicateConnectionRequest {
            id: connection.id.clone(),
            name: Some("Bastion Copy".to_string()),
        })
        .expect("connection is duplicated");
    assert!(duplicated.ssh_port_forwardings == updated.ssh_port_forwardings);

    let cleared = storage
        .update_connection_ssh_port_forwardings(connection.id.clone(), None)
        .expect("forwardings clear succeeds")
        .expect("connection changes");
    assert!(cleared.ssh_port_forwardings.is_none());
}

#[test]
fn create_rename_and_delete_connection_folder() {
    let storage = Storage::open(temp_db_path("folder-crud")).expect("storage opens");

    let created = storage
        .create_connection_folder(CreateConnectionFolderRequest {
            name: "Customer A".to_string(),
            parent_folder_id: None,
            workspace_id: None,
            icon_data_url: Some("material:folder-server".to_string()),
        })
        .expect("folder is created");
    assert_eq!(created.name, "Customer A");
    assert_eq!(
        created.icon_data_url.as_deref(),
        Some("material:folder-server")
    );
    assert!(created.connections.is_empty());

    let renamed = storage
        .rename_connection_folder(RenameConnectionFolderRequest {
            id: created.id.clone(),
            name: "Customer A Production".to_string(),
            icon_data_url: None,
        })
        .expect("folder is renamed");
    assert_eq!(renamed.name, "Customer A Production");
    assert_eq!(
        renamed.icon_data_url.as_deref(),
        Some("material:folder-server")
    );

    let icon_changed = storage
        .rename_connection_folder(RenameConnectionFolderRequest {
            id: created.id.clone(),
            name: "Customer A Production".to_string(),
            icon_data_url: Some(Some("material:folder-open".to_string())),
        })
        .expect("folder icon is changed");
    assert_eq!(
        icon_changed.icon_data_url.as_deref(),
        Some("material:folder-open")
    );

    storage
        .delete_connection_folder(created.id.clone())
        .expect("folder is deleted");

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    assert!(find_folder(&tree.folders, &created.id).is_none());
}

#[test]
fn folders_can_contain_subfolders() {
    let storage = Storage::open(temp_db_path("folder-nesting")).expect("storage opens");
    let parent = storage
        .create_connection_folder(CreateConnectionFolderRequest {
            name: "Customer A".to_string(),
            parent_folder_id: None,
            workspace_id: None,
            icon_data_url: None,
        })
        .expect("parent folder is created");
    let child = storage
        .create_connection_folder(CreateConnectionFolderRequest {
            name: "Production".to_string(),
            parent_folder_id: Some(parent.id.clone()),
            workspace_id: None,
            icon_data_url: None,
        })
        .expect("child folder is created");

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    let parent = find_folder(&tree.folders, &parent.id).expect("parent folder exists");

    assert_eq!(parent.folders[0].id, child.id);
    assert_eq!(parent.folders[0].name, "Production");
}

#[test]
fn deleting_folder_removes_connections_in_that_folder() {
    let storage = Storage::open(temp_db_path("folder-delete-cascade")).expect("storage opens");
    let folder = storage
        .create_connection_folder(CreateConnectionFolderRequest {
            name: "Ephemeral".to_string(),
            parent_folder_id: None,
            workspace_id: None,
            icon_data_url: None,
        })
        .expect("folder is created");

    storage
        .create_connection(CreateConnectionRequest {
            name: "Throwaway SSH".to_string(),
            host: "throwaway.internal".to_string(),
            user: "admin".to_string(),
            connection_type: "ssh".to_string(),
            folder_id: Some(folder.id.clone()),
            port: None,
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: Some("agent".to_string()),
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: None,
            vnc_options: None,
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("connection is created in folder");

    storage
        .delete_connection_folder(folder.id)
        .expect("folder is deleted");

    let tree = storage
        .list_connection_tree()
        .expect("connection tree loads");
    assert!(!all_connections(&tree).any(|connection| connection.host == "throwaway.internal"));
}

#[test]
fn move_connection_folder_updates_durable_root_folder_order() {
    let storage = Storage::open(temp_db_path("folder-move")).expect("storage opens");
    let production = storage
        .create_connection_folder(CreateConnectionFolderRequest {
            name: "Production".to_string(),
            parent_folder_id: None,
            workspace_id: None,
            icon_data_url: None,
        })
        .expect("production folder is created");
    let staging = storage
        .create_connection_folder(CreateConnectionFolderRequest {
            name: "Staging".to_string(),
            parent_folder_id: None,
            workspace_id: None,
            icon_data_url: None,
        })
        .expect("staging folder is created");

    let tree = storage
        .move_connection_folder(MoveConnectionFolderRequest {
            id: staging.id.clone(),
            parent_folder_id: None,
            target_index: 0,
        })
        .expect("folder is moved");

    assert_eq!(tree.folders[0].id, staging.id);
    assert_eq!(tree.folders[1].id, production.id);

    let reloaded = storage
        .list_connection_tree()
        .expect("connection tree reloads");
    assert_eq!(reloaded.folders[0].id, staging.id);
}

#[test]
fn move_connection_reorders_within_target_folder() {
    let storage = Storage::open(temp_db_path("connection-move")).expect("storage opens");
    let production = storage
        .create_connection_folder(CreateConnectionFolderRequest {
            name: "Production".to_string(),
            parent_folder_id: None,
            workspace_id: None,
            icon_data_url: None,
        })
        .expect("production folder is created");
    let staging = storage
        .create_connection_folder(CreateConnectionFolderRequest {
            name: "Staging".to_string(),
            parent_folder_id: None,
            workspace_id: None,
            icon_data_url: None,
        })
        .expect("staging folder is created");
    create_test_ssh_connection(
        &storage,
        "Bastion East",
        "bastion-east.internal",
        Some(production.id.clone()),
    );
    let api_stage = create_test_ssh_connection(
        &storage,
        "API Stage",
        "api-stage.internal",
        Some(staging.id.clone()),
    );

    let tree = storage
        .move_connection(MoveConnectionRequest {
            id: api_stage.id.clone(),
            folder_id: Some(production.id.clone()),
            target_index: 1,
        })
        .expect("connection is moved");

    let production = find_folder(&tree.folders, &production.id).expect("production folder exists");
    assert_eq!(production.connections[1].id, api_stage.id);
    assert_eq!(production.connections.len(), 2);

    let staging = find_folder(&tree.folders, &staging.id).expect("staging folder exists");
    assert!(staging.connections.is_empty());
}

#[test]
fn move_connection_before_later_connection_in_root() {
    let storage =
        Storage::open(temp_db_path("connection-move-same-folder")).expect("storage opens");
    let powershell = create_test_local_connection(&storage, "PowerShell", "powershell.exe");
    let wsl = create_test_local_connection(&storage, "WSL", "wsl.exe");

    let tree = storage
        .move_connection(MoveConnectionRequest {
            id: wsl.id.clone(),
            folder_id: None,
            target_index: 0,
        })
        .expect("connection order is normalized");

    assert_eq!(tree.connections[0].id, wsl.id);
    assert_eq!(tree.connections[1].id, powershell.id);
}

#[test]
fn general_settings_round_trip_through_settings_table() {
    let storage = Storage::open(temp_db_path("general-settings")).expect("storage opens");

    let defaults = storage
        .general_settings()
        .expect("default general settings load");
    assert!(defaults.auto_backup_enabled);
    assert!(defaults.auto_update_checks_enabled);
    assert!(defaults.show_connected_connections_in_rail);
    assert!(defaults.show_workspace_on_rail);
    assert!(defaults.show_dashboard_on_rail);
    assert!(!defaults.show_all_connections_in_tree);
    assert!(!defaults.hide_top_tab_buttons);
    assert!(defaults.submit_ai_attachments_directly);
    assert!(!defaults.separate_split_terminal_backgrounds);
    assert!(defaults.show_installer_on_rail);
    assert!(!defaults.show_it_ops);
    assert!(defaults.show_dont_sleep_on_rail);
    assert_eq!(
        defaults.activity_rail_order,
        ["workspace", "dashboard", "installer", "itops", "dontSleep"]
    );
    assert_eq!(defaults.installer_check_interval_seconds, 86_400);
    assert!(defaults.pinned_connection_ids.is_empty());
    assert!(defaults.allow_clipboard_read);
    assert!(!defaults.auto_start_with_windows);
    assert!(!defaults.minimize_to_tray);
    assert!(!defaults.dont_sleep_enabled);
    assert!(defaults.dont_sleep_foreground_only);
    assert!(defaults.use_directx_screen_capture);
    assert!(defaults.status_bar_enabled);
    assert!(defaults.status_bar_monitor_enabled);
    assert_eq!(defaults.status_bar_monitor_interval_seconds, 5);
    assert!(!defaults.advanced_debugging_enabled);
    assert!(!defaults.rdp_webview_stability);
    assert!(defaults.last_backup_at.is_none());

    let updated = storage
        .update_general_settings(GeneralSettings {
            auto_backup_enabled: false,
            auto_update_checks_enabled: false,
            show_connected_connections_in_rail: true,
            show_workspace_on_rail: false,
            show_dashboard_on_rail: false,
            show_all_connections_in_tree: true,
            hide_top_tab_buttons: true,
            double_click_opens_connection: true,
            submit_ai_attachments_directly: false,
            separate_split_terminal_backgrounds: true,
            show_installer_on_rail: false,
            show_it_ops: false,
            show_dont_sleep_on_rail: false,
            activity_rail_order: vec![
                "dontSleep".to_string(),
                "workspace".to_string(),
                "dashboard".to_string(),
                "installer".to_string(),
                "itops".to_string(),
            ],
            installer_check_interval_seconds: 604_800,
            pinned_connection_ids: vec![
                " connection-a ".to_string(),
                "connection-a".to_string(),
                "".to_string(),
                "connection-b".to_string(),
            ],
            allow_clipboard_read: false,
            auto_start_with_windows: true,
            minimize_to_tray: true,
            dont_sleep_enabled: true,
            dont_sleep_foreground_only: false,
            use_directx_screen_capture: false,
            status_bar_enabled: false,
            status_bar_monitor_enabled: false,
            status_bar_monitor_interval_seconds: 30,
            advanced_debugging_enabled: true,
            rdp_webview_stability: true,
            last_backup_at: None,
        })
        .expect("general settings update");
    assert!(!updated.auto_backup_enabled);
    assert!(!updated.auto_update_checks_enabled);
    assert!(updated.show_connected_connections_in_rail);
    assert!(!updated.show_workspace_on_rail);
    assert!(!updated.show_dashboard_on_rail);
    assert!(updated.show_all_connections_in_tree);
    assert!(updated.hide_top_tab_buttons);
    assert!(updated.double_click_opens_connection);
    assert!(!updated.submit_ai_attachments_directly);
    assert!(updated.separate_split_terminal_backgrounds);
    assert!(!updated.show_installer_on_rail);
    assert!(!updated.show_it_ops);
    assert!(!updated.show_dont_sleep_on_rail);
    assert_eq!(updated.activity_rail_order[0], "dontSleep");
    assert_eq!(updated.installer_check_interval_seconds, 604_800);
    assert_eq!(
        updated.pinned_connection_ids,
        vec!["connection-a".to_string(), "connection-b".to_string()]
    );
    assert!(!updated.allow_clipboard_read);
    assert!(updated.auto_start_with_windows);
    assert!(updated.minimize_to_tray);
    assert!(updated.dont_sleep_enabled);
    assert!(!updated.dont_sleep_foreground_only);
    assert!(!updated.use_directx_screen_capture);
    assert!(!updated.status_bar_enabled);
    assert!(!updated.status_bar_monitor_enabled);
    assert_eq!(updated.status_bar_monitor_interval_seconds, 30);
    assert!(updated.advanced_debugging_enabled);
    assert!(updated.rdp_webview_stability);

    let reloaded = storage.general_settings().expect("general settings reload");
    assert!(!reloaded.auto_backup_enabled);
    assert!(!reloaded.auto_update_checks_enabled);
    assert!(reloaded.show_connected_connections_in_rail);
    assert!(reloaded.show_all_connections_in_tree);
    assert_eq!(
        reloaded.pinned_connection_ids,
        vec!["connection-a".to_string(), "connection-b".to_string()]
    );
    assert!(!reloaded.allow_clipboard_read);
    assert!(reloaded.auto_start_with_windows);
    assert!(reloaded.minimize_to_tray);
    assert!(reloaded.dont_sleep_enabled);
    assert!(!reloaded.dont_sleep_foreground_only);
    assert!(!reloaded.use_directx_screen_capture);
    assert!(!reloaded.status_bar_enabled);
    assert!(!reloaded.status_bar_monitor_enabled);
    assert_eq!(reloaded.status_bar_monitor_interval_seconds, 30);
    assert!(reloaded.advanced_debugging_enabled);
    assert!(reloaded.rdp_webview_stability);
    assert!(reloaded.last_backup_at.is_none());
}

#[test]
fn credential_settings_round_trip_and_platform_defaults() {
    let storage = Storage::open(temp_db_path("credential-settings")).expect("storage opens");

    let defaults = storage
        .credential_settings()
        .expect("default credential settings load");
    if cfg!(target_os = "linux") {
        assert_eq!(defaults.secret_store, "file");
    } else {
        assert_eq!(defaults.secret_store, "os");
    }

    let file_settings = storage
        .update_credential_settings(CredentialSettings {
            secret_store: " file ".to_string(),
        })
        .expect("credential settings update");
    assert_eq!(file_settings.secret_store, "file");

    let invalid_settings = storage
        .update_credential_settings(CredentialSettings {
            secret_store: "external".to_string(),
        })
        .expect("invalid credential settings normalize");
    assert_eq!(invalid_settings.secret_store, default_secret_store());

    let reloaded = storage
        .credential_settings()
        .expect("credential settings reload");
    assert_eq!(reloaded.secret_store, default_secret_store());
}

#[test]
fn app_launcher_settings_round_trip_and_validation() {
    let storage = Storage::open(temp_db_path("app-launcher-settings")).expect("storage opens");

    let defaults = storage
        .app_launcher_settings()
        .expect("default app launcher settings load");
    assert!(defaults.entries.is_empty());

    let updated = storage
        .update_app_launcher_settings(AppLauncherSettings {
            entries: vec![
                AppLauncherEntry {
                    id: " app-a ".to_string(),
                    name: " Windows Terminal ".to_string(),
                    path: " C:\\Program Files\\WindowsApps\\wt.exe ".to_string(),
                    arguments: Some(" -p PowerShell ".to_string()),
                    working_directory: Some(" C:\\Users ".to_string()),
                    icon_data_url: Some(" data:image/png;base64,abc ".to_string()),
                    rail_pinned: true,
                    created_at: "2026-05-11T00:00:00Z".to_string(),
                    updated_at: "2026-05-11T00:00:00Z".to_string(),
                },
                AppLauncherEntry {
                    id: "app-a".to_string(),
                    name: "Duplicate".to_string(),
                    path: "C:\\Duplicate.exe".to_string(),
                    arguments: None,
                    working_directory: None,
                    icon_data_url: None,
                    rail_pinned: false,
                    created_at: "2026-05-11T00:00:00Z".to_string(),
                    updated_at: "2026-05-11T00:00:00Z".to_string(),
                },
                AppLauncherEntry {
                    id: "app-b".to_string(),
                    name: "  ".to_string(),
                    path: " C:\\Tools\\tool.exe ".to_string(),
                    arguments: Some("".to_string()),
                    working_directory: Some("".to_string()),
                    icon_data_url: Some("".to_string()),
                    rail_pinned: false,
                    created_at: "2026-05-11T00:00:00Z".to_string(),
                    updated_at: "2026-05-11T00:00:00Z".to_string(),
                },
                AppLauncherEntry {
                    id: "".to_string(),
                    name: "Missing id".to_string(),
                    path: "C:\\Missing.exe".to_string(),
                    arguments: None,
                    working_directory: None,
                    icon_data_url: None,
                    rail_pinned: false,
                    created_at: "2026-05-11T00:00:00Z".to_string(),
                    updated_at: "2026-05-11T00:00:00Z".to_string(),
                },
            ],
            view_mode: "details".to_string(),
            list_sort: AppLauncherSortState {
                field: "type".to_string(),
                direction: "desc".to_string(),
            },
            details_sort: AppLauncherSortState {
                field: "modified".to_string(),
                direction: "desc".to_string(),
            },
        })
        .expect("app launcher settings update");

    assert_eq!(updated.entries.len(), 2);
    assert_eq!(updated.entries[0].id, "app-a");
    assert_eq!(updated.entries[0].name, "Windows Terminal");
    assert_eq!(
        updated.entries[0].path,
        "C:\\Program Files\\WindowsApps\\wt.exe"
    );
    assert_eq!(
        updated.entries[0].arguments.as_deref(),
        Some("-p PowerShell")
    );
    assert_eq!(
        updated.entries[0].working_directory.as_deref(),
        Some("C:\\Users")
    );
    assert_eq!(
        updated.entries[0].icon_data_url.as_deref(),
        Some("data:image/png;base64,abc")
    );
    assert!(updated.entries[0].rail_pinned);
    assert_eq!(updated.entries[1].name, "tool");
    assert_eq!(updated.entries[1].path, "C:\\Tools\\tool.exe");
    assert!(updated.entries[1].arguments.is_none());
    assert!(updated.entries[1].working_directory.is_none());
    assert!(updated.entries[1].icon_data_url.is_none());
    assert_eq!(updated.view_mode, "details");
    assert_eq!(updated.list_sort.field, "type");
    assert_eq!(updated.list_sort.direction, "desc");
    assert_eq!(updated.details_sort.field, "modified");
    assert_eq!(updated.details_sort.direction, "desc");

    let reloaded = storage
        .app_launcher_settings()
        .expect("app launcher settings reload");
    assert_eq!(reloaded.entries.len(), 2);
    assert_eq!(reloaded.entries[0].id, "app-a");
    assert_eq!(reloaded.entries[1].id, "app-b");
}

#[test]
fn dashboard_settings_round_trip_through_settings_table() {
    let storage = Storage::open(temp_db_path("dashboard-settings")).expect("storage opens");

    let defaults = storage
        .dashboard_settings()
        .expect("default dashboard settings load");
    assert!(defaults.confirm_remove);
    assert_eq!(defaults.default_landing_view, "lastActive");
    assert_eq!(defaults.max_active_script_widgets, 8);
    assert!(defaults.allow_widget_network_tools);
    assert!(!defaults.use_random_dynamic_background);
    assert_eq!(defaults.widget_layout_enforcement, "strict");

    let updated = storage
        .update_dashboard_settings(DashboardSettings {
            confirm_remove: false,
            default_landing_view: " view-default ".to_string(),
            max_active_script_widgets: 20,
            allow_widget_network_tools: false,
            use_random_dynamic_background: true,
            widget_layout_enforcement: "low".to_string(),
        })
        .expect("dashboard settings update");
    assert!(!updated.confirm_remove);
    assert_eq!(updated.default_landing_view, "view-default");
    assert_eq!(updated.max_active_script_widgets, 20);
    assert!(updated.allow_widget_network_tools);
    assert!(updated.use_random_dynamic_background);
    assert_eq!(updated.widget_layout_enforcement, "low");

    let reloaded = storage
        .dashboard_settings()
        .expect("dashboard settings reload");
    assert!(!reloaded.confirm_remove);
    assert_eq!(reloaded.default_landing_view, "view-default");
    assert_eq!(reloaded.max_active_script_widgets, 20);
    assert!(reloaded.allow_widget_network_tools);
    assert!(reloaded.use_random_dynamic_background);
    assert_eq!(reloaded.widget_layout_enforcement, "low");

    // Unknown enforcement levels normalize back to the strict default.
    let normalized = storage
        .update_dashboard_settings(DashboardSettings {
            confirm_remove: true,
            default_landing_view: "lastActive".to_string(),
            max_active_script_widgets: 8,
            allow_widget_network_tools: true,
            use_random_dynamic_background: false,
            widget_layout_enforcement: "bogus".to_string(),
        })
        .expect("dashboard settings update normalizes enforcement");
    assert_eq!(normalized.widget_layout_enforcement, "strict");

    // Out-of-range values are rejected at the storage boundary.
    let too_low = storage.update_dashboard_settings(DashboardSettings {
        confirm_remove: true,
        default_landing_view: "lastActive".to_string(),
        max_active_script_widgets: 0,
        allow_widget_network_tools: true,
        use_random_dynamic_background: false,
        widget_layout_enforcement: "strict".to_string(),
    });
    assert!(too_low.is_err(), "0 must be rejected");
    let too_high = storage.update_dashboard_settings(DashboardSettings {
        confirm_remove: true,
        default_landing_view: "lastActive".to_string(),
        max_active_script_widgets: 101,
        allow_widget_network_tools: true,
        use_random_dynamic_background: false,
        widget_layout_enforcement: "strict".to_string(),
    });
    assert!(too_high.is_err(), "101 must be rejected");
}

#[test]
fn database_backup_import_restores_app_launcher_settings() {
    let db_path = temp_db_path("database-export-import-app-launcher");
    let storage = Storage::open(db_path).expect("storage opens");
    storage
        .update_app_launcher_settings(AppLauncherSettings {
            entries: vec![AppLauncherEntry {
                id: "launcher-entry".to_string(),
                name: "Portable Tool".to_string(),
                path: "Z:\\missing\\tool.exe".to_string(),
                arguments: None,
                working_directory: None,
                icon_data_url: None,
                rail_pinned: true,
                created_at: "2026-05-11T00:00:00Z".to_string(),
                updated_at: "2026-05-11T00:00:00Z".to_string(),
            }],
            view_mode: "list".to_string(),
            list_sort: AppLauncherSortState {
                field: "name".to_string(),
                direction: "desc".to_string(),
            },
            details_sort: default_app_launcher_details_sort(),
        })
        .expect("app launcher settings update");

    let backup = storage.backup_database().expect("database backup succeeds");
    storage
        .update_app_launcher_settings(AppLauncherSettings {
            entries: Vec::new(),
            view_mode: "icons".to_string(),
            list_sort: default_app_launcher_list_sort(),
            details_sort: default_app_launcher_details_sort(),
        })
        .expect("app launcher settings changes after export");

    let imported = storage
        .import_database_zip(PathBuf::from(&backup.path))
        .expect("database imports");

    assert_eq!(imported.app_launcher_settings.entries.len(), 1);
    assert_eq!(
        imported.app_launcher_settings.entries[0].id,
        "launcher-entry"
    );
    assert_eq!(
        imported.app_launcher_settings.entries[0].path,
        "Z:\\missing\\tool.exe"
    );
    assert!(imported.app_launcher_settings.entries[0].rail_pinned);
}

#[test]
fn database_backup_import_restores_settings_and_connections() {
    let db_path = temp_db_path("database-export-import");
    let storage = Storage::open(db_path).expect("storage opens");
    storage
        .update_general_settings(GeneralSettings {
            auto_backup_enabled: false,
            auto_update_checks_enabled: true,
            show_connected_connections_in_rail: true,
            show_workspace_on_rail: false,
            show_dashboard_on_rail: false,
            show_all_connections_in_tree: true,
            hide_top_tab_buttons: true,
            double_click_opens_connection: true,
            submit_ai_attachments_directly: true,
            separate_split_terminal_backgrounds: true,
            show_installer_on_rail: false,
            show_it_ops: false,
            show_dont_sleep_on_rail: false,
            activity_rail_order: vec![
                "dontSleep".to_string(),
                "workspace".to_string(),
                "dashboard".to_string(),
                "installer".to_string(),
                "itops".to_string(),
            ],
            installer_check_interval_seconds: 86_400,
            pinned_connection_ids: vec!["connection-pinned".to_string()],
            allow_clipboard_read: true,
            auto_start_with_windows: true,
            minimize_to_tray: true,
            dont_sleep_enabled: true,
            dont_sleep_foreground_only: false,
            use_directx_screen_capture: false,
            status_bar_enabled: false,
            status_bar_monitor_enabled: false,
            status_bar_monitor_interval_seconds: 15,
            advanced_debugging_enabled: true,
            rdp_webview_stability: false,
            last_backup_at: None,
        })
        .expect("general settings update");
    let connection = create_test_ssh_connection(&storage, "Prod SSH", "prod.internal", None);

    let backup = storage.backup_database().expect("database backup succeeds");
    storage
        .update_general_settings(GeneralSettings {
            auto_backup_enabled: true,
            auto_update_checks_enabled: true,
            show_connected_connections_in_rail: false,
            show_workspace_on_rail: true,
            show_dashboard_on_rail: true,
            show_all_connections_in_tree: false,
            hide_top_tab_buttons: false,
            double_click_opens_connection: false,
            submit_ai_attachments_directly: false,
            separate_split_terminal_backgrounds: false,
            show_installer_on_rail: true,
            show_it_ops: false,
            show_dont_sleep_on_rail: true,
            activity_rail_order: default_activity_rail_order(),
            installer_check_interval_seconds: 86_400,
            pinned_connection_ids: Vec::new(),
            allow_clipboard_read: false,
            auto_start_with_windows: false,
            minimize_to_tray: false,
            dont_sleep_enabled: false,
            dont_sleep_foreground_only: true,
            use_directx_screen_capture: true,
            status_bar_enabled: true,
            status_bar_monitor_enabled: true,
            status_bar_monitor_interval_seconds: 5,
            advanced_debugging_enabled: false,
            rdp_webview_stability: false,
            last_backup_at: None,
        })
        .expect("general settings changes after export");
    storage
        .delete_connection(connection.id.clone())
        .expect("connection can be removed before import");

    let imported = storage
        .import_database_zip(PathBuf::from(&backup.path))
        .expect("database imports");

    assert!(!imported.general_settings.auto_backup_enabled);
    assert!(imported.general_settings.show_connected_connections_in_rail);
    assert!(!imported.general_settings.show_workspace_on_rail);
    assert!(!imported.general_settings.show_dashboard_on_rail);
    assert!(imported.general_settings.show_all_connections_in_tree);
    assert!(imported.general_settings.hide_top_tab_buttons);
    assert!(imported.general_settings.double_click_opens_connection);
    assert!(imported.general_settings.submit_ai_attachments_directly);
    assert!(
        imported
            .general_settings
            .separate_split_terminal_backgrounds
    );
    assert!(!imported.general_settings.show_installer_on_rail);
    assert!(!imported.general_settings.show_it_ops);
    assert!(!imported.general_settings.show_dont_sleep_on_rail);
    assert_eq!(imported.general_settings.activity_rail_order[0], "dontSleep");
    assert_eq!(
        imported.general_settings.pinned_connection_ids,
        vec!["connection-pinned".to_string()]
    );
    assert!(imported.general_settings.minimize_to_tray);
    assert!(imported.general_settings.dont_sleep_enabled);
    assert!(!imported.general_settings.dont_sleep_foreground_only);
    assert!(!imported.general_settings.use_directx_screen_capture);
    assert!(!imported.general_settings.status_bar_enabled);
    assert!(!imported.general_settings.status_bar_monitor_enabled);
    assert_eq!(
        imported
            .general_settings
            .status_bar_monitor_interval_seconds,
        15
    );
    assert!(imported.general_settings.advanced_debugging_enabled);
    assert_eq!(
        imported.general_settings.last_backup_at.as_deref(),
        Some(imported.backup.created_at.as_str())
    );
    assert_eq!(imported.connection_tree.connections.len(), 1);
    assert_eq!(imported.connection_tree.connections[0].id, connection.id);
    assert!(Path::new(&imported.backup.path).exists());
    assert!(imported.backup.filename.ends_with(".zip"));
}

#[test]
fn database_backup_zip_is_serialized_and_importable() {
    let db_path = temp_db_path("database-backup-importable");
    let storage = Storage::open(db_path).expect("storage opens");
    let connection = create_test_ssh_connection(&storage, "Prod SSH", "prod.internal", None);

    let first_backup = storage.backup_database().expect("database backup succeeds");
    let second_backup = storage
        .backup_database()
        .expect("second database backup succeeds");

    assert_ne!(first_backup.filename, second_backup.filename);
    assert!(backup_filename_has_serial(&first_backup.filename));
    assert!(backup_filename_has_serial(&second_backup.filename));
    assert!(Path::new(&first_backup.path).exists());
    assert!(Path::new(&second_backup.path).exists());
    let settings = storage
        .general_settings()
        .expect("general settings reloads after backup");
    assert_eq!(
        settings.last_backup_at.as_deref(),
        Some(second_backup.created_at.as_str())
    );

    storage
        .delete_connection(connection.id.clone())
        .expect("connection can be removed before import");

    let imported = storage
        .import_database_zip(PathBuf::from(&first_backup.path))
        .expect("backup imports");

    assert_eq!(imported.connection_tree.connections.len(), 1);
    assert_eq!(imported.connection_tree.connections[0].id, connection.id);
}

#[test]
fn terminal_settings_round_trip_through_settings_table() {
    let storage = Storage::open(temp_db_path("terminal-settings")).expect("storage opens");

    let defaults = storage
        .terminal_settings()
        .expect("default terminal settings load");
    assert_eq!(defaults.font_size, 12);
    assert_eq!(defaults.scrollback_lines, 5_000);
    assert_eq!(defaults.default_transparency, 50);
    assert!(!defaults.use_random_dynamic_background);
    assert!(defaults.confirm_multiline_paste);

    let updated = storage
        .update_terminal_settings(TerminalSettings {
            font_family: "Cascadia Mono".to_string(),
            font_size: 14,
            line_height: 1.35,
            cursor_style: "bar".to_string(),
            scrollback_lines: 5_000,
            default_transparency: 35,
            use_random_dynamic_background: true,
            copy_on_select: true,
            allow_osc52_clipboard: true,
            confirm_multiline_paste: false,
            default_shell: "pwsh.exe".to_string(),
            custom_shells: vec![TerminalCustomShell {
                id: "git-bash".to_string(),
                name: " Git Bash ".to_string(),
                command_line: r#" "C:\Program Files\Git\bin\bash.exe" --login -i "#.to_string(),
            }],
        })
        .expect("terminal settings update");

    assert_eq!(updated.cursor_style, "bar");
    assert_eq!(updated.default_transparency, 35);
    assert!(updated.use_random_dynamic_background);
    assert!(updated.copy_on_select);

    let reloaded = storage
        .terminal_settings()
        .expect("terminal settings reload");
    assert_eq!(reloaded.font_family, "Cascadia Mono");
    assert_eq!(reloaded.default_shell, "pwsh.exe");
    assert_eq!(reloaded.custom_shells.len(), 1);
    assert_eq!(reloaded.custom_shells[0].name, "Git Bash");
    assert_eq!(
        reloaded.custom_shells[0].command_line,
        r#""C:\Program Files\Git\bin\bash.exe" --login -i"#
    );
}

#[test]
fn appearance_settings_round_trip_through_settings_table() {
    let db_path = temp_db_path("appearance-settings");
    let storage = Storage::open(db_path.clone()).expect("storage opens");

    let defaults = storage
        .appearance_settings()
        .expect("default appearance settings load");
    assert!(defaults.app_font_family.contains("Inter"));
    assert!(defaults.use_custom_title_bar);

    let updated = storage
        .update_appearance_settings(AppearanceSettings {
            app_font_family: "  \"Custom UI Font\", \"Segoe UI\", sans-serif  ".to_string(),
            color_scheme: "dark".to_string(),
            custom_font_path: Some("  C:/KKTerm/fonts/custom.ttf  ".to_string()),
            use_custom_title_bar: false,
        })
        .expect("appearance settings update");

    assert_eq!(
        updated.app_font_family,
        "\"Custom UI Font\", \"Segoe UI\", sans-serif"
    );
    assert_eq!(
        updated.custom_font_path.as_deref(),
        Some("C:/KKTerm/fonts/custom.ttf")
    );
    assert!(updated.use_custom_title_bar);

    drop(storage);

    let reopened = Storage::open(db_path).expect("storage reopens after app restart");
    let reloaded = reopened
        .appearance_settings()
        .expect("appearance settings reload after restart");
    assert_eq!(reloaded.app_font_family, updated.app_font_family);
}

#[test]
fn appearance_settings_accept_match_os_color_scheme() {
    let storage = Storage::open(temp_db_path("appearance-match-os")).expect("storage opens");

    let updated = storage
        .update_appearance_settings(AppearanceSettings {
            app_font_family: "Inter".to_string(),
            color_scheme: "MATCH-OS".to_string(),
            custom_font_path: None,
            use_custom_title_bar: true,
        })
        .expect("match-os color scheme is accepted");

    assert_eq!(updated.color_scheme, "match-os");
}

#[test]
fn appearance_settings_accept_world_cup_color_scheme() {
    let storage = Storage::open(temp_db_path("appearance-world-cup")).expect("storage opens");

    let updated = storage
        .update_appearance_settings(AppearanceSettings {
            app_font_family: "Inter".to_string(),
            color_scheme: "STARS-AND-STRIPES".to_string(),
            custom_font_path: None,
            use_custom_title_bar: true,
        })
        .expect("World Cup color scheme is accepted");

    assert_eq!(updated.color_scheme, "stars-and-stripes");
}

#[test]
fn ssh_settings_round_trip_through_settings_table() {
    let storage = Storage::open(temp_db_path("ssh-settings")).expect("storage opens");

    let defaults = storage.ssh_settings().expect("default SSH settings load");
    assert_eq!(defaults.default_port, 22);
    assert_eq!(defaults.buffer_lines, 5_000);
    assert_eq!(defaults.default_transparency, 50);
    assert!(defaults.default_use_tmux_sessions);
    assert!(!defaults.use_random_dynamic_background);
    assert!(defaults.hide_common_port_redirects);
    assert!(defaults.allow_osc52_clipboard);
    assert!(!defaults.managed_x_server_enabled);
    assert_eq!(defaults.x_server_display, 0);
    assert_eq!(defaults.x_server_args, "-multiwindow -clipboard -wgl");
    assert!(defaults.default_key_path.is_some());

    let updated = storage
        .update_ssh_settings(SshSettings {
            default_user: "deploy".to_string(),
            default_port: 2200,
            default_key_path: Some("  C:\\Users\\example\\.ssh\\deploy_ed25519  ".to_string()),
            default_proxy_jump: Some("  bastion.internal  ".to_string()),
            default_ssh_socks_proxy: Some("  127.0.0.1:1080  ".to_string()),
            default_ssh_socks_proxy_username: None,
            buffer_lines: 12_000,
            default_transparency: 40,
            default_use_tmux_sessions: false,
            use_random_dynamic_background: true,
            hide_common_port_redirects: false,
            allow_osc52_clipboard: false,
            managed_x_server_enabled: true,
            x_server_path: Some("  C:\\Program Files\\VcXsrv\\vcxsrv.exe  ".to_string()),
            x_server_display: 120,
            x_server_args: "  -multiwindow -clipboard -nowgl  ".to_string(),
        })
        .expect("SSH settings update");

    assert_eq!(updated.default_user, "deploy");
    assert_eq!(
        updated.default_key_path.as_deref(),
        Some("C:\\Users\\example\\.ssh\\deploy_ed25519")
    );

    let reloaded = storage.ssh_settings().expect("SSH settings reload");
    assert_eq!(reloaded.default_port, 2200);
    assert_eq!(reloaded.buffer_lines, 12_000);
    assert_eq!(reloaded.default_transparency, 40);
    assert!(!reloaded.default_use_tmux_sessions);
    assert!(reloaded.use_random_dynamic_background);
    assert!(!reloaded.hide_common_port_redirects);
    assert!(!reloaded.allow_osc52_clipboard);
    assert!(reloaded.managed_x_server_enabled);
    assert_eq!(
        reloaded.x_server_path.as_deref(),
        Some("C:\\Program Files\\VcXsrv\\vcxsrv.exe")
    );
    assert_eq!(reloaded.x_server_display, 99);
    assert_eq!(reloaded.x_server_args, "-multiwindow -clipboard -nowgl");
    assert_eq!(
        reloaded.default_proxy_jump.as_deref(),
        Some("bastion.internal")
    );
    assert_eq!(
        reloaded.default_ssh_socks_proxy.as_deref(),
        Some("127.0.0.1:1080")
    );
}

#[test]
fn sftp_settings_round_trip_through_settings_table() {
    let storage = Storage::open(temp_db_path("sftp-settings")).expect("storage opens");

    let defaults = storage.sftp_settings().expect("default SFTP settings load");
    assert_eq!(defaults.overwrite_behavior, "fail");
    assert_eq!(defaults.file_explorer_open_mode, "external");
    assert_eq!(defaults.file_explorer_terminal_shell, default_file_explorer_terminal_shell());
    assert!(!defaults.file_explorer_terminal_elevated);

    let updated = storage
        .update_sftp_settings(SftpSettings {
            overwrite_behavior: "  REPLACE  ".to_string(),
            file_explorer_open_mode: "inline-editor".to_string(),
            file_explorer_terminal_shell: "powershell.exe".to_string(),
            file_explorer_terminal_elevated: cfg!(target_os = "windows"),
        })
        .expect("SFTP settings update");

    assert_eq!(updated.overwrite_behavior, "overwrite");
    assert_eq!(updated.file_explorer_open_mode, "inlineEditor");
    assert_eq!(updated.file_explorer_terminal_shell, "powershell.exe");
    assert_eq!(updated.file_explorer_terminal_elevated, cfg!(target_os = "windows"));

    let reloaded = storage.sftp_settings().expect("SFTP settings reload");
    assert_eq!(reloaded.overwrite_behavior, "overwrite");
    assert_eq!(reloaded.file_explorer_open_mode, "inlineEditor");
    assert_eq!(reloaded.file_explorer_terminal_shell, "powershell.exe");
    assert_eq!(reloaded.file_explorer_terminal_elevated, cfg!(target_os = "windows"));
}

#[test]
fn url_settings_round_trip_through_settings_table() {
    let storage = Storage::open(temp_db_path("url-settings")).expect("storage opens");

    let defaults = storage.url_settings().expect("default URL settings load");
    assert!(!defaults.ignore_certificate_errors);
    assert_eq!(defaults.default_proxy_url, None);
    assert_eq!(defaults.default_data_partition, None);

    let updated = storage
        .update_url_settings(UrlSettings {
            ignore_certificate_errors: true,
            default_proxy_url: Some(" socks5://127.0.0.1:1080 ".to_string()),
            default_data_partition: Some(" ops ".to_string()),
        })
        .expect("URL settings update");

    assert!(updated.ignore_certificate_errors);
    assert_eq!(
        updated.default_proxy_url.as_deref(),
        Some("socks5://127.0.0.1:1080")
    );
    assert_eq!(updated.default_data_partition.as_deref(), Some("ops"));

    let reloaded = storage.url_settings().expect("URL settings reload");
    assert!(reloaded.ignore_certificate_errors);
    assert_eq!(
        reloaded.default_proxy_url.as_deref(),
        Some("socks5://127.0.0.1:1080")
    );
    assert_eq!(reloaded.default_data_partition.as_deref(), Some("ops"));

    for invalid in [
        "https://proxy.example:443",
        "http://user:password@proxy.example:3128",
        "http://proxy.example",
        "socks5://proxy.example:0",
        "http://proxy.example:3128/path",
    ] {
        assert!(
            storage
                .update_url_settings(UrlSettings {
                    ignore_certificate_errors: false,
                    default_proxy_url: Some(invalid.to_string()),
                    default_data_partition: None,
                })
                .is_err(),
            "{invalid} must be rejected"
        );
    }
}

#[test]
fn rdp_and_vnc_settings_round_trip_through_settings_table() {
    let storage = Storage::open(temp_db_path("remote-desktop-settings")).expect("storage opens");

    let rdp_defaults = storage.rdp_settings().expect("default RDP settings load");
    assert_eq!(rdp_defaults.color_depth, 32);
    assert!(rdp_defaults.redirect_clipboard);
    assert!(!rdp_defaults.redirect_drives);

    storage
        .update_rdp_settings(RdpSettings {
            color_depth: 24,
            redirect_clipboard: false,
            redirect_drives: true,
            bitmap_cache: true,
            performance_profile: "quality".to_string(),
            remote_resolution: "automatic".to_string(),
            view_mode: "actualSize".to_string(),
        })
        .expect("RDP settings update");

    let rdp_reloaded = storage.rdp_settings().expect("RDP settings reload");
    assert_eq!(rdp_reloaded.color_depth, 24);
    assert!(!rdp_reloaded.redirect_clipboard);
    assert!(rdp_reloaded.redirect_drives);
    assert_eq!(rdp_reloaded.performance_profile, "quality");
    assert_eq!(rdp_reloaded.view_mode, "actualSize");

    let vnc_defaults = storage.vnc_settings().expect("default VNC settings load");
    assert!(vnc_defaults.shared_session);
    assert_eq!(vnc_defaults.color_level, "full");

    storage
        .update_vnc_settings(VncSettings {
            shared_session: false,
            view_only: true,
            color_level: "256".to_string(),
            preferred_encoding: "raw".to_string(),
            view_mode: "fitWidth".to_string(),
        })
        .expect("VNC settings update");

    let vnc_reloaded = storage.vnc_settings().expect("VNC settings reload");
    assert!(!vnc_reloaded.shared_session);
    assert!(vnc_reloaded.view_only);
    assert_eq!(vnc_reloaded.color_level, "256");
    assert_eq!(vnc_reloaded.preferred_encoding, "raw");
    assert_eq!(vnc_reloaded.view_mode, "fitWidth");
}

#[test]
fn remote_desktop_connection_options_are_optional_protocol_overrides() {
    let storage =
        Storage::open(temp_db_path("remote-desktop-connection-options")).expect("storage opens");

    let rdp = storage
        .create_connection(CreateConnectionRequest {
            name: "Jumpbox".to_string(),
            host: "jumpbox.internal".to_string(),
            user: "DOMAIN\\admin".to_string(),
            connection_type: "rdp".to_string(),
            folder_id: None,
            port: Some(3389),
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: None,
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: Some(RdpConnectionOptions {
                inherit_defaults: false,
                color_depth: Some(24),
                redirect_clipboard: Some(false),
                redirect_drives: Some(true),
                bitmap_cache: Some(true),
                performance_profile: Some("quality".to_string()),
                remote_resolution: None,
                view_mode: Some("actualSize".to_string()),
            }),
            vnc_options: Some(VncConnectionOptions {
                inherit_defaults: false,
                shared_session: Some(false),
                view_only: Some(true),
                color_level: Some("256".to_string()),
                preferred_encoding: Some("raw".to_string()),
                view_mode: Some("fitWidth".to_string()),
            }),
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("RDP connection with options is created");

    assert_eq!(rdp.connection_type, "rdp");
    assert!(rdp.rdp_options.is_some());
    assert!(rdp.vnc_options.is_none());

    let vnc = storage
        .create_connection(CreateConnectionRequest {
            name: "Console".to_string(),
            host: "console.internal".to_string(),
            user: "".to_string(),
            connection_type: "vnc".to_string(),
            folder_id: None,
            port: Some(5900),
            key_path: None,
            proxy_jump: None,
            ssh_socks_proxy: None,
            ssh_socks_proxy_username: None,
            ssh_socks_proxy_inherit_defaults: None,
            ssh_compression: None,
            auth_method: None,
            local_shell: None,
            local_startup_directory: None,
            local_startup_script: None,
            url: None,
            data_partition: None,
            url_proxy: None,
            url_proxy_inherit_defaults: None,
            use_tmux_sessions: None,
            use_psmux_sessions: None,
            serial_line: None,
            serial_speed: None,
            rdp_options: Some(RdpConnectionOptions {
                inherit_defaults: false,
                color_depth: Some(24),
                redirect_clipboard: Some(false),
                redirect_drives: Some(true),
                bitmap_cache: Some(true),
                performance_profile: Some("quality".to_string()),
                remote_resolution: None,
                view_mode: Some("actualSize".to_string()),
            }),
            vnc_options: Some(VncConnectionOptions {
                inherit_defaults: false,
                shared_session: Some(false),
                view_only: Some(true),
                color_level: Some("256".to_string()),
                preferred_encoding: Some("raw".to_string()),
                view_mode: Some("fitWidth".to_string()),
            }),
            ftp_options: None,
            file_view_open_external: false,
            ssh_port_forwardings: None,
            workspace_id: None,
        })
        .expect("VNC connection with options is created");

    assert_eq!(vnc.connection_type, "vnc");
    assert!(vnc.rdp_options.is_none());
    assert!(vnc.vnc_options.is_some());

    let tree = storage.list_connection_tree().expect("tree reloads");
    let saved_rdp = tree
        .connections
        .iter()
        .find(|connection| connection.id == rdp.id)
        .expect("RDP connection is listed");
    assert_eq!(
        saved_rdp
            .rdp_options
            .as_ref()
            .and_then(|options| options.color_depth),
        Some(24)
    );
    assert_eq!(
        saved_rdp
            .rdp_options
            .as_ref()
            .and_then(|options| options.view_mode.as_deref()),
        Some("actualSize")
    );
}

#[test]
fn ai_provider_settings_round_trip_through_settings_table() {
    let storage = Storage::open(temp_db_path("ai-provider-settings")).expect("storage opens");

    let defaults = storage
        .ai_provider_settings()
        .expect("default AI provider settings load");
    assert!(!defaults.enabled);
    assert_eq!(defaults.provider_kind, "openai");
    assert_eq!(defaults.base_url, "https://api.openai.com/v1");
    assert_eq!(defaults.model, "gpt-5.4-mini");
    assert_eq!(defaults.reasoning_effort, "medium");
    assert_eq!(defaults.custom_instructions, "");
    assert_eq!(defaults.api_mode, "chatCompletions");
    assert_eq!(defaults.extra_headers, "");
    assert_eq!(defaults.cli_execution_policy, "suggestOnly");
    assert_eq!(defaults.tool_permission_mode, "prompt");
    assert!(!defaults.allow_insecure_tls);
    assert!(!defaults.show_all_models);
    assert!(defaults.tools.web_search());
    assert!(defaults.tools.web_fetch());
    assert!(defaults.tools.shell_command());
    assert!(defaults.tools.app_data_file_search());
    assert!(defaults.tools.app_data_file_read());
    assert!(defaults.tools.current_time());
    assert!(defaults.tools.performance_counters());
    assert!(defaults.tools.dashboard());
    assert!(defaults.tools.connections());
    assert!(defaults.tools.sessions());
    assert!(defaults.tools.tutorial());
    assert!(defaults.tools.manual());
    assert!(!defaults.tools.email());
    assert!(defaults.tools.network());

    let updated = storage
        .update_ai_provider_settings(AiProviderSettings {
            enabled: true,
            provider_kind: "  OpenRouter  ".to_string(),
            base_url: "  https://llm-gateway.internal/v1/  ".to_string(),
            model: " openai/gpt-5.5 ".to_string(),
            reasoning_effort: " XHIGH ".to_string(),
            output_language: String::new(),
            custom_instructions: String::new(),
            api_mode: " responses ".to_string(),
            extra_headers: "  sid=1, \"env\"=\"3\"  ".to_string(),
            allow_insecure_tls: true,
            allow_insecure_mcp_http: true,
            show_all_models: true,
            cli_execution_policy: "suggest-only".to_string(),
            tool_permission_mode: " Allow All ".to_string(),
            built_in_mcp_server_enabled: true,
            built_in_mcp_allow_all_dangerous: false,
            use_codex_cli: false,
            use_claude_cli: false,
            claude_cli_path: Some("  C:\\Tools\\claude.exe  ".to_string()),
            codex_cli_path: Some("  codex  ".to_string()),
            disabled_skill_names: vec!["ssh-helper".to_string(), "bad name".to_string()],
            custom_skills_enabled: true,
            tools: default_ai_assistant_tool_settings(),
            search_provider: default_search_provider(),
            searxng_url: String::new(),
            email_provider: default_email_provider(),
            email_from: String::new(),
            mailgun_domain: String::new(),
            smtp_host: String::new(),
            smtp_port: default_smtp_port(),
            smtp_username: String::new(),
            smtp_security: default_smtp_security(),
            search_provider_api_key: None,
            email_secret: None,
        })
        .expect("AI provider settings update");

    assert!(updated.enabled);
    assert_eq!(updated.provider_kind, "openrouter");
    assert_eq!(updated.base_url, "https://llm-gateway.internal/v1");
    assert_eq!(updated.model, "openai/gpt-5.5");
    assert_eq!(updated.reasoning_effort, "max");
    assert_eq!(updated.api_mode, "responses");
    assert_eq!(updated.extra_headers, "sid=1, \"env\"=\"3\"");
    assert_eq!(updated.cli_execution_policy, "suggestOnly");
    assert_eq!(updated.tool_permission_mode, "allowAll");
    assert!(updated.allow_insecure_tls);
    assert!(updated.allow_insecure_mcp_http);
    assert!(updated.show_all_models);
    assert_eq!(
        updated.claude_cli_path.as_deref(),
        Some("C:\\Tools\\claude.exe")
    );
    assert_eq!(updated.codex_cli_path.as_deref(), Some("codex"));
    assert_eq!(updated.disabled_skill_names, vec!["ssh-helper".to_string()]);

    let reloaded = storage
        .ai_provider_settings()
        .expect("AI provider settings reload");
    assert_eq!(reloaded.base_url, "https://llm-gateway.internal/v1");
    assert_eq!(reloaded.model, "openai/gpt-5.5");
    assert_eq!(reloaded.reasoning_effort, "max");
    assert_eq!(reloaded.api_mode, "responses");
    assert_eq!(reloaded.extra_headers, "sid=1, \"env\"=\"3\"");
    assert_eq!(reloaded.tool_permission_mode, "allowAll");
    assert!(reloaded.allow_insecure_tls);
    assert!(reloaded.allow_insecure_mcp_http);
    assert!(reloaded.show_all_models);
}

#[test]
fn stored_credential_candidates_include_one_ai_key_owner_per_provider() {
    let storage =
        Storage::open(temp_db_path("ai-provider-credential-candidates")).expect("storage opens");

    let candidates = storage
        .list_stored_credential_candidates()
        .expect("credential candidates load");
    let ai_candidates = candidates
        .iter()
        .filter(|candidate| candidate.kind == "aiApiKey")
        .collect::<Vec<_>>();

    for provider_kind in [
        "openai",
        "anthropic",
        "openrouter",
        "deepseek",
        "gemini",
        "grok",
        "azure-openai",
        "litellm",
        "github-copilot",
        "ollama",
        "nvidia",
        "opencode",
        "openai-compatible",
    ] {
        let owner_id = format!("ai-provider:{provider_kind}");
        assert!(
            ai_candidates
                .iter()
                .any(|candidate| candidate.owner_id == owner_id),
            "{provider_kind} should expose a stored credential candidate"
        );
    }
}

#[test]
fn ai_provider_settings_accept_every_registered_provider() {
    let storage = Storage::open(temp_db_path("ai-provider-all-registered")).expect("storage opens");

    for provider_kind in [
        "openai",
        "anthropic",
        "openrouter",
        "deepseek",
        "gemini",
        "grok",
        "azure-openai",
        "litellm",
        "github-copilot",
        "ollama",
        "nvidia",
        "opencode",
        "openai-compatible",
    ] {
        let mut settings = storage
            .ai_provider_settings()
            .expect("default AI provider settings load");
        settings.provider_kind = provider_kind.to_string();
        settings.base_url = format!("https://{provider_kind}.example.com/v1");

        let updated = storage
            .update_ai_provider_settings(settings)
            .unwrap_or_else(|error| panic!("{provider_kind} should validate: {error}"));
        assert_eq!(updated.provider_kind, provider_kind);
    }
}

#[test]
fn ai_provider_settings_reject_invalid_tool_permission_mode() {
    let storage =
        Storage::open(temp_db_path("ai-provider-tool-permission-mode")).expect("storage opens");

    let error = storage
        .update_ai_provider_settings(AiProviderSettings {
            enabled: true,
            provider_kind: "openai".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-5.5".to_string(),
            reasoning_effort: "medium".to_string(),
            output_language: String::new(),
            custom_instructions: String::new(),
            api_mode: default_ai_api_mode(),
            extra_headers: String::new(),
            allow_insecure_tls: false,
            allow_insecure_mcp_http: false,
            show_all_models: false,
            cli_execution_policy: "suggestOnly".to_string(),
            tool_permission_mode: "autoDeleteEverything".to_string(),
            built_in_mcp_server_enabled: true,
            built_in_mcp_allow_all_dangerous: false,
            use_codex_cli: false,
            use_claude_cli: false,
            claude_cli_path: None,
            codex_cli_path: None,
            disabled_skill_names: Vec::new(),
            custom_skills_enabled: true,
            tools: default_ai_assistant_tool_settings(),
            search_provider: default_search_provider(),
            searxng_url: String::new(),
            email_provider: default_email_provider(),
            email_from: String::new(),
            mailgun_domain: String::new(),
            smtp_host: String::new(),
            smtp_port: default_smtp_port(),
            smtp_username: String::new(),
            smtp_security: default_smtp_security(),
            search_provider_api_key: None,
            email_secret: None,
        })
        .expect_err("unknown tool permission mode is rejected");

    assert_eq!(error, "AI tool permission mode must be prompt or allowAll");
}

#[test]
fn ai_provider_settings_reject_invalid_base_url() {
    let storage = Storage::open(temp_db_path("ai-provider-invalid")).expect("storage opens");

    let error = storage
        .update_ai_provider_settings(AiProviderSettings {
            enabled: true,
            provider_kind: "openai".to_string(),
            base_url: "api.openai.com/v1".to_string(),
            model: "gpt-5.5".to_string(),
            reasoning_effort: "medium".to_string(),
            output_language: String::new(),
            custom_instructions: String::new(),
            api_mode: default_ai_api_mode(),
            extra_headers: String::new(),
            allow_insecure_tls: false,
            allow_insecure_mcp_http: false,
            show_all_models: false,
            cli_execution_policy: "suggestOnly".to_string(),
            tool_permission_mode: "prompt".to_string(),
            built_in_mcp_server_enabled: true,
            built_in_mcp_allow_all_dangerous: false,
            use_codex_cli: false,
            use_claude_cli: false,
            claude_cli_path: None,
            codex_cli_path: None,
            disabled_skill_names: Vec::new(),
            custom_skills_enabled: true,
            tools: default_ai_assistant_tool_settings(),
            search_provider: default_search_provider(),
            searxng_url: String::new(),
            email_provider: default_email_provider(),
            email_from: String::new(),
            mailgun_domain: String::new(),
            smtp_host: String::new(),
            smtp_port: default_smtp_port(),
            smtp_username: String::new(),
            smtp_security: default_smtp_security(),
            search_provider_api_key: None,
            email_secret: None,
        })
        .expect_err("scheme-less endpoint is rejected");

    assert_eq!(
        error,
        "AI provider endpoint must start with https:// or http://"
    );
}

#[test]
fn ai_provider_settings_reject_blank_model() {
    let storage = Storage::open(temp_db_path("ai-provider-blank-model")).expect("storage opens");

    let error = storage
        .update_ai_provider_settings(AiProviderSettings {
            enabled: true,
            provider_kind: "openai".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            model: "   ".to_string(),
            reasoning_effort: "medium".to_string(),
            output_language: String::new(),
            custom_instructions: String::new(),
            api_mode: default_ai_api_mode(),
            extra_headers: String::new(),
            allow_insecure_tls: false,
            allow_insecure_mcp_http: false,
            show_all_models: false,
            cli_execution_policy: "suggestOnly".to_string(),
            tool_permission_mode: "prompt".to_string(),
            built_in_mcp_server_enabled: true,
            built_in_mcp_allow_all_dangerous: false,
            use_codex_cli: false,
            use_claude_cli: false,
            claude_cli_path: None,
            codex_cli_path: None,
            disabled_skill_names: Vec::new(),
            custom_skills_enabled: true,
            tools: default_ai_assistant_tool_settings(),
            search_provider: default_search_provider(),
            searxng_url: String::new(),
            email_provider: default_email_provider(),
            email_from: String::new(),
            mailgun_domain: String::new(),
            smtp_host: String::new(),
            smtp_port: default_smtp_port(),
            smtp_username: String::new(),
            smtp_security: default_smtp_security(),
            search_provider_api_key: None,
            email_secret: None,
        })
        .expect_err("blank model is rejected");

    assert_eq!(error, "AI model is required");
}

#[test]
fn ai_provider_settings_trim_and_limit_custom_instructions() {
    let storage =
        Storage::open(temp_db_path("ai-provider-custom-instructions")).expect("storage opens");

    let updated = storage
        .update_ai_provider_settings(AiProviderSettings {
            enabled: true,
            provider_kind: "openai".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-5.5".to_string(),
            reasoning_effort: "medium".to_string(),
            output_language: String::new(),
            custom_instructions: "  Prefer concise PowerShell examples.  ".to_string(),
            api_mode: default_ai_api_mode(),
            extra_headers: String::new(),
            allow_insecure_tls: false,
            allow_insecure_mcp_http: false,
            show_all_models: false,
            cli_execution_policy: "suggestOnly".to_string(),
            tool_permission_mode: "prompt".to_string(),
            built_in_mcp_server_enabled: true,
            built_in_mcp_allow_all_dangerous: false,
            use_codex_cli: false,
            use_claude_cli: false,
            claude_cli_path: None,
            codex_cli_path: None,
            disabled_skill_names: Vec::new(),
            custom_skills_enabled: true,
            tools: default_ai_assistant_tool_settings(),
            search_provider: default_search_provider(),
            searxng_url: String::new(),
            email_provider: default_email_provider(),
            email_from: String::new(),
            mailgun_domain: String::new(),
            smtp_host: String::new(),
            smtp_port: default_smtp_port(),
            smtp_username: String::new(),
            smtp_security: default_smtp_security(),
            search_provider_api_key: None,
            email_secret: None,
        })
        .expect("custom instructions update");

    assert_eq!(
        updated.custom_instructions,
        "Prefer concise PowerShell examples."
    );

    let error = storage
        .update_ai_provider_settings(AiProviderSettings {
            custom_instructions: "x".repeat(1001),
            ..updated
        })
        .expect_err("overlong custom instructions are rejected");

    assert_eq!(
        error,
        "AI Assistant custom instructions must be 1000 characters or fewer"
    );
}

#[test]
fn ai_provider_settings_keep_cli_policy_suggest_only() {
    let storage = Storage::open(temp_db_path("ai-provider-cli-policy")).expect("storage opens");

    let error = storage
        .update_ai_provider_settings(AiProviderSettings {
            enabled: true,
            provider_kind: "openai".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-5.5".to_string(),
            reasoning_effort: "medium".to_string(),
            output_language: String::new(),
            custom_instructions: String::new(),
            api_mode: default_ai_api_mode(),
            extra_headers: String::new(),
            allow_insecure_tls: false,
            allow_insecure_mcp_http: false,
            show_all_models: false,
            cli_execution_policy: "executeAutomatically".to_string(),
            tool_permission_mode: "prompt".to_string(),
            built_in_mcp_server_enabled: true,
            built_in_mcp_allow_all_dangerous: false,
            use_codex_cli: false,
            use_claude_cli: false,
            claude_cli_path: Some("claude".to_string()),
            codex_cli_path: Some("codex".to_string()),
            disabled_skill_names: Vec::new(),
            custom_skills_enabled: true,
            tools: default_ai_assistant_tool_settings(),
            search_provider: default_search_provider(),
            searxng_url: String::new(),
            email_provider: default_email_provider(),
            email_from: String::new(),
            mailgun_domain: String::new(),
            smtp_host: String::new(),
            smtp_port: default_smtp_port(),
            smtp_username: String::new(),
            smtp_security: default_smtp_security(),
            search_provider_api_key: None,
            email_secret: None,
        })
        .expect_err("auto-execution policy is rejected");

    assert_eq!(
        error,
        "CLI adapter policy must remain suggest-only for approval-based execution"
    );
}

#[test]
fn main_window_settings_round_trip_through_settings_table() {
    let storage = Storage::open(temp_db_path("main-window-settings")).expect("storage opens");

    assert_eq!(
        storage
            .main_window_settings()
            .expect("missing main window settings load"),
        None
    );

    let updated = storage
        .update_main_window_settings(MainWindowSettings {
            width: 1440,
            height: 900,
            maximized: true,
        })
        .expect("main window settings update");

    assert_eq!(
        updated,
        MainWindowSettings {
            width: 1440,
            height: 900,
            maximized: true,
        }
    );
    assert_eq!(
        storage
            .main_window_settings()
            .expect("main window settings reload"),
        Some(updated)
    );
}

#[test]
fn assistant_chat_history_round_trips_from_sqlite_by_recent_update() {
    let storage = Storage::open(temp_db_path("assistant-chat-history")).expect("storage opens");
    let older = AssistantChatThreadRecord {
        id: "thread-older".to_string(),
        title: "Older".to_string(),
        context_label: "Workspace".to_string(),
        messages_json: r#"[{"role":"user","content":"first"}]"#.to_string(),
        created_at: "2026-05-01T00:00:00Z".to_string(),
        updated_at: "2026-05-01T00:00:00Z".to_string(),
    };
    let newer = AssistantChatThreadRecord {
        id: "thread-newer".to_string(),
        title: "Newer".to_string(),
        context_label: "Dashboard".to_string(),
        messages_json: r#"[{"role":"user","content":"second"}]"#.to_string(),
        created_at: "2026-05-02T00:00:00Z".to_string(),
        updated_at: "2026-05-03T00:00:00Z".to_string(),
    };

    storage
        .upsert_assistant_chat_thread(older.clone())
        .expect("older thread saved");
    storage
        .upsert_assistant_chat_thread(newer.clone())
        .expect("newer thread saved");

    let threads = storage
        .list_assistant_chat_threads()
        .expect("assistant chat history loads");
    assert_eq!(threads.len(), 2);
    assert_eq!(threads[0].id, newer.id);
    assert_eq!(threads[1].id, older.id);

    storage
        .delete_assistant_chat_thread(newer.id.clone())
        .expect("newer thread deleted");
    let threads = storage
        .list_assistant_chat_threads()
        .expect("assistant chat history reloads");
    assert_eq!(threads.len(), 1);
    assert_eq!(threads[0].id, older.id);
}

#[test]
fn assistant_chat_history_schema_has_list_indexes() {
    let storage = Storage::open(temp_db_path("assistant-chat-indexes")).expect("storage opens");
    let connection = storage.lock().expect("storage lock");
    let indexes = connection
        .prepare(
            "SELECT name FROM sqlite_master
                 WHERE type = 'index' AND tbl_name = 'assistant_chat_threads'
                 ORDER BY name",
        )
        .expect("index query prepares")
        .query_map([], |row| row.get::<_, String>(0))
        .expect("index query runs")
        .collect::<Result<Vec<_>, _>>()
        .expect("indexes collect");

    assert!(indexes.contains(&"idx_assistant_chat_threads_created_at".to_string()));
    assert!(indexes.contains(&"idx_assistant_chat_threads_updated_at".to_string()));
}

#[test]
fn assistant_memories_scope_and_round_trip() {
    let storage = Storage::open(temp_db_path("assistant-memory")).expect("storage opens");
    let now = "2026-06-12T00:00:00Z".to_string();
    storage
        .upsert_assistant_memory(AssistantMemoryRecord {
            id: "m-global".to_string(),
            scope: "global".to_string(),
            content: "Prefers concise answers".to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
        })
        .expect("global memory saves");
    storage
        .upsert_assistant_memory(AssistantMemoryRecord {
            id: "m-conn".to_string(),
            scope: "connection:web01".to_string(),
            content: "nginx under systemd".to_string(),
            created_at: now.clone(),
            updated_at: now.clone(),
        })
        .expect("connection memory saves");

    // Only the requested scopes come back.
    let global_only = storage
        .list_assistant_memories(&["global".to_string()])
        .expect("list global");
    assert_eq!(global_only.len(), 1);
    assert_eq!(global_only[0].id, "m-global");

    let both = storage
        .list_assistant_memories(&["global".to_string(), "connection:web01".to_string()])
        .expect("list both");
    assert_eq!(both.len(), 2);

    // A different connection scope never sees web01's note.
    let other = storage
        .list_assistant_memories(&["global".to_string(), "connection:db02".to_string()])
        .expect("list other");
    assert_eq!(other.len(), 1);

    // Update in place keeps the id.
    storage
        .upsert_assistant_memory(AssistantMemoryRecord {
            id: "m-conn".to_string(),
            scope: "connection:web01".to_string(),
            content: "nginx under systemd; logs in /var/log/nginx".to_string(),
            created_at: now.clone(),
            updated_at: "2026-06-12T00:01:00Z".to_string(),
        })
        .expect("update saves");
    let updated = storage
        .list_assistant_memories(&["connection:web01".to_string()])
        .expect("list updated");
    assert_eq!(updated.len(), 1);
    assert!(updated[0].content.contains("/var/log/nginx"));

    assert!(
        storage
            .delete_assistant_memory("m-conn".to_string())
            .expect("delete")
    );
    assert!(
        !storage
            .delete_assistant_memory("m-conn".to_string())
            .expect("second delete is a no-op")
    );
}

#[test]
fn assistant_memory_validation_rejects_bad_scope_and_oversize() {
    let storage = Storage::open(temp_db_path("assistant-memory-validate")).expect("opens");
    let now = "2026-06-12T00:00:00Z".to_string();
    let bad_scope = storage.upsert_assistant_memory(AssistantMemoryRecord {
        id: "x".to_string(),
        scope: "wildcard".to_string(),
        content: "nope".to_string(),
        created_at: now.clone(),
        updated_at: now.clone(),
    });
    assert!(bad_scope.is_err());

    let oversize = storage.upsert_assistant_memory(AssistantMemoryRecord {
        id: "y".to_string(),
        scope: "global".to_string(),
        content: "z".repeat(2_001),
        created_at: now.clone(),
        updated_at: now,
    });
    assert!(oversize.is_err());
}

#[test]
fn default_workspace_is_seeded_and_scopes_the_connection_tree() {
    let storage = Storage::open(temp_db_path("workspace-seed")).expect("storage opens");

    let workspaces = storage.list_workspaces().expect("workspaces load");
    assert_eq!(workspaces.len(), 1, "the Default Workspace is seeded");
    let default = &workspaces[0];
    assert!(default.is_default);

    // A Connection created without an explicit Workspace lands in Default.
    create_test_ssh_connection(&storage, "Bastion", "bastion.internal", None);
    let default_tree = storage
        .list_connection_tree_for_workspace(default.id.clone())
        .expect("default tree loads");
    assert_eq!(default_tree.connections.len(), 1);

    // A fresh Workspace starts empty and isolated from Default.
    let other = storage
        .create_workspace(CreateWorkspaceRequest {
            name: "Staging".to_string(),
            icon: Some("Server".to_string()),
            icon_color: None,
            import_connection_ids: None,
        })
        .expect("workspace is created");
    assert!(!other.is_default);
    let other_tree = storage
        .list_connection_tree_for_workspace(other.id.clone())
        .expect("other tree loads");
    assert!(other_tree.connections.is_empty());
}

#[test]
fn v20_workspace_migration_keeps_connection_foreign_keys_pointing_at_connections() {
    let db_path = temp_db_path("workspace-migration-fks");
    {
        let connection = rusqlite::Connection::open(&db_path).expect("old database opens");
        connection
                .execute_batch(
                    r#"
                    PRAGMA foreign_keys = OFF;
                    CREATE TABLE connection_folders (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        parent_folder_id TEXT REFERENCES connection_folders(id) ON DELETE CASCADE,
                        sort_order INTEGER NOT NULL
                    );
                    CREATE TABLE connection_password_credentials (
                        id TEXT PRIMARY KEY,
                        connection_type TEXT NOT NULL CHECK (connection_type IN ('ssh', 'telnet', 'rdp', 'vnc', 'ftp')),
                        host TEXT NOT NULL,
                        username TEXT NOT NULL,
                        label TEXT NOT NULL,
                        created_from_connection_id TEXT REFERENCES connections(id) ON DELETE SET NULL,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE connections (
                        id TEXT PRIMARY KEY,
                        folder_id TEXT REFERENCES connection_folders(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        tab_title TEXT,
                        host TEXT NOT NULL,
                        username TEXT NOT NULL,
                        port INTEGER,
                        key_path TEXT,
                        proxy_jump TEXT,
                        auth_method TEXT NOT NULL DEFAULT 'keyFile',
                        local_shell TEXT,
                        local_startup_directory TEXT,
                        local_startup_script TEXT,
                        url TEXT,
                        data_partition TEXT,
                        use_tmux_sessions INTEGER NOT NULL DEFAULT 1,
                        tmux_connection_id TEXT,
                        serial_line TEXT,
                        serial_speed INTEGER,
                        rdp_options TEXT,
                        vnc_options TEXT,
                        ftp_options TEXT,
                        password_credential_id TEXT REFERENCES connection_password_credentials(id) ON DELETE SET NULL,
                        icon_data_url TEXT,
                        icon_background_color TEXT,
                        terminal_opacity INTEGER,
                        terminal_background_json TEXT,
                        connection_type TEXT NOT NULL CHECK (connection_type IN ('local', 'ssh', 'telnet', 'serial', 'url', 'rdp', 'vnc', 'ftp')),
                        status TEXT NOT NULL CHECK (status IN ('connected', 'idle', 'offline')),
                        sort_order INTEGER NOT NULL
                    );
                    CREATE TABLE connection_tags (
                        connection_id TEXT NOT NULL REFERENCES connections(id) ON DELETE CASCADE,
                        tag TEXT NOT NULL,
                        sort_order INTEGER NOT NULL,
                        PRIMARY KEY (connection_id, tag)
                    );
                    INSERT INTO connections (
                        id, folder_id, name, tab_title, host, username, port, key_path,
                        proxy_jump, auth_method, local_shell, local_startup_directory,
                        local_startup_script, url, data_partition, use_tmux_sessions,
                        tmux_connection_id, serial_line, serial_speed, rdp_options, vnc_options,
                        ftp_options, password_credential_id, icon_data_url, icon_background_color,
                        terminal_opacity, terminal_background_json, connection_type, status, sort_order
                    )
                    VALUES (
                        'existing', NULL, 'Existing', NULL, 'existing.internal', 'admin',
                        NULL, NULL, NULL, 'agent', NULL, NULL, NULL, NULL, NULL, 1,
                        'tmux-existing', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                        NULL, NULL, 'ssh', 'idle', 0
                    );
                    INSERT INTO connection_tags (connection_id, tag, sort_order)
                    VALUES ('existing', 'ops', 0);
                    PRAGMA user_version = 19;
                    "#,
                )
                .expect("old schema is created");
    }

    let storage = Storage::open(db_path).expect("storage migrates");
    create_test_ssh_connection(&storage, "New Host", "new.internal", None);

    let schema_sql = storage
            .with_connection(|connection| {
                connection
                    .query_row(
                        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'connection_tags'",
                        [],
                        |row| row.get::<_, String>(0),
                    )
                    .map_err(to_storage_error)
            })
            .expect("connection_tags schema loads");
    assert!(
        !schema_sql.contains("connections_pre_v20"),
        "connection_tags must not retain the migration scratch table name"
    );
}

#[test]
fn schema_initialization_repairs_v20_connections_pre_table_foreign_keys() {
    let db_path = temp_db_path("workspace-repair-fks");
    {
        let connection = rusqlite::Connection::open(&db_path).expect("corrupt database opens");
        connection
                .execute_batch(
                    r#"
                    PRAGMA foreign_keys = OFF;
                    CREATE TABLE workspaces (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        icon TEXT,
                        is_default INTEGER NOT NULL DEFAULT 0,
                        sort_order INTEGER NOT NULL
                    );
                    CREATE TABLE connection_folders (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        parent_folder_id TEXT REFERENCES connection_folders(id) ON DELETE CASCADE,
                        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
                        sort_order INTEGER NOT NULL
                    );
                    CREATE TABLE connection_password_credentials (
                        id TEXT PRIMARY KEY,
                        connection_type TEXT NOT NULL CHECK (connection_type IN ('ssh', 'telnet', 'rdp', 'vnc', 'ftp')),
                        host TEXT NOT NULL,
                        username TEXT NOT NULL,
                        label TEXT NOT NULL,
                        created_from_connection_id TEXT REFERENCES connections_pre_v20(id) ON DELETE SET NULL,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    CREATE TABLE connections (
                        id TEXT PRIMARY KEY,
                        folder_id TEXT REFERENCES connection_folders(id) ON DELETE CASCADE,
                        workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
                        name TEXT NOT NULL,
                        tab_title TEXT,
                        host TEXT NOT NULL,
                        username TEXT NOT NULL,
                        port INTEGER,
                        key_path TEXT,
                        proxy_jump TEXT,
                        auth_method TEXT NOT NULL DEFAULT 'keyFile',
                        local_shell TEXT,
                        local_startup_directory TEXT,
                        local_startup_script TEXT,
                        url TEXT,
                        data_partition TEXT,
                        use_tmux_sessions INTEGER NOT NULL DEFAULT 1,
                        tmux_connection_id TEXT,
                        serial_line TEXT,
                        serial_speed INTEGER,
                        rdp_options TEXT,
                        vnc_options TEXT,
                        ftp_options TEXT,
                        password_credential_id TEXT REFERENCES connection_password_credentials(id) ON DELETE SET NULL,
                        icon_data_url TEXT,
                        icon_background_color TEXT,
                        terminal_opacity INTEGER,
                        terminal_background_json TEXT,
                        connection_type TEXT NOT NULL CHECK (connection_type IN ('local', 'ssh', 'telnet', 'serial', 'url', 'rdp', 'vnc', 'ftp', 'localFiles')),
                        status TEXT NOT NULL CHECK (status IN ('connected', 'idle', 'offline')),
                        sort_order INTEGER NOT NULL
                    );
                    CREATE TABLE connection_tags (
                        connection_id TEXT NOT NULL REFERENCES connections_pre_v20(id) ON DELETE CASCADE,
                        tag TEXT NOT NULL,
                        sort_order INTEGER NOT NULL,
                        PRIMARY KEY (connection_id, tag)
                    );
                    CREATE TABLE url_credentials (
                        connection_id TEXT PRIMARY KEY REFERENCES connections_pre_v20(id) ON DELETE CASCADE,
                        username TEXT NOT NULL,
                        page_url TEXT,
                        username_selector TEXT,
                        password_selector TEXT,
                        field_values TEXT,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    INSERT INTO workspaces (id, name, icon, is_default, sort_order)
                    VALUES ('default', 'Default', NULL, 1, 0);
                    INSERT INTO connections (
                        id, folder_id, workspace_id, name, tab_title, host, username, port,
                        key_path, proxy_jump, auth_method, local_shell, local_startup_directory,
                        local_startup_script, url, data_partition, use_tmux_sessions,
                        tmux_connection_id, serial_line, serial_speed, rdp_options, vnc_options,
                        ftp_options, password_credential_id, icon_data_url, icon_background_color,
                        terminal_opacity, terminal_background_json, connection_type, status, sort_order
                    )
                    VALUES (
                        'existing', NULL, 'default', 'Existing', NULL, 'existing.internal',
                        'admin', NULL, NULL, NULL, 'agent', NULL, NULL, NULL, NULL, NULL, 1,
                        'tmux-existing', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                        NULL, NULL, 'ssh', 'idle', 0
                    );
                    INSERT INTO connection_tags (connection_id, tag, sort_order)
                    VALUES ('existing', 'ops', 0);
                    PRAGMA user_version = 20;
                    "#,
                )
                .expect("stale v20 schema is created");
    }

    let storage = Storage::open(db_path).expect("storage repairs stale fks");
    let created = create_test_ssh_connection(&storage, "New Host", "new.internal", None);
    storage
        .create_connection_password_credential_metadata(created.id)
        .expect("password credential metadata can point at the new connection");

    let stale_reference_count: i64 = storage
        .with_connection(|connection| {
            connection
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_master
                         WHERE type = 'table' AND sql LIKE '%connections_pre_v20%'",
                    [],
                    |row| row.get(0),
                )
                .map_err(to_storage_error)
        })
        .expect("schema scan runs");
    assert_eq!(stale_reference_count, 0);
}

#[test]
fn create_workspace_copy_imports_connections_independently() {
    let storage = Storage::open(temp_db_path("workspace-import")).expect("storage opens");
    let source = create_test_ssh_connection(&storage, "Bastion", "bastion.internal", None);

    let imported = storage
        .create_workspace(CreateWorkspaceRequest {
            name: "Ops".to_string(),
            icon: None,
            icon_color: None,
            import_connection_ids: Some(vec![source.id.clone()]),
        })
        .expect("workspace with import is created");

    let imported_tree = storage
        .list_connection_tree_for_workspace(imported.id.clone())
        .expect("imported tree loads");
    assert_eq!(imported_tree.connections.len(), 1);
    let copy = &imported_tree.connections[0];
    assert_ne!(copy.id, source.id, "the import is an independent copy");
    assert_eq!(copy.host, source.host);
}

#[test]
fn root_connection_sorting_is_scoped_per_workspace() {
    let storage = Storage::open(temp_db_path("workspace-root-sort")).expect("storage opens");
    create_test_ssh_connection(&storage, "Default A", "default-a.internal", None);
    create_test_ssh_connection(&storage, "Default B", "default-b.internal", None);

    let other = storage
        .create_workspace(CreateWorkspaceRequest {
            name: "Ops".to_string(),
            icon: None,
            icon_color: None,
            import_connection_ids: None,
        })
        .expect("workspace is created");
    let ops_a = create_test_ssh_connection_in_workspace(
        &storage,
        "Ops A",
        "ops-a.internal",
        other.id.clone(),
    );
    let ops_b = create_test_ssh_connection_in_workspace(
        &storage,
        "Ops B",
        "ops-b.internal",
        other.id.clone(),
    );

    assert_eq!(
        root_connection_sort_orders(&storage, &other.id),
        vec![("Ops A".to_string(), 0), ("Ops B".to_string(), 1)]
    );

    storage
        .move_connection(MoveConnectionRequest {
            id: ops_b.id.clone(),
            folder_id: None,
            target_index: 0,
        })
        .expect("connection moves within workspace");

    assert_eq!(
        root_connection_sort_orders(&storage, DEFAULT_WORKSPACE_ID),
        vec![("Default A".to_string(), 0), ("Default B".to_string(), 1)]
    );
    assert_eq!(
        root_connection_sort_orders(&storage, &other.id),
        vec![("Ops B".to_string(), 0), ("Ops A".to_string(), 1)]
    );
    assert_ne!(ops_a.id, ops_b.id);
}

#[test]
fn delete_workspace_rejects_the_default_workspace() {
    let storage = Storage::open(temp_db_path("workspace-delete")).expect("storage opens");
    assert!(
        storage
            .delete_workspace(DEFAULT_WORKSPACE_ID.to_string())
            .is_err(),
        "the Default Workspace cannot be deleted"
    );

    let other = storage
        .create_workspace(CreateWorkspaceRequest {
            name: "Temp".to_string(),
            icon: None,
            icon_color: None,
            import_connection_ids: None,
        })
        .expect("workspace is created");
    storage
        .delete_workspace(other.id.clone())
        .expect("non-default workspace deletes");
    assert_eq!(storage.list_workspaces().expect("workspaces load").len(), 1);
}

#[test]
fn create_workspace_persists_icon_color() {
    let storage = Storage::open(temp_db_path("workspace-icon-color")).expect("storage opens");

    let workspace = storage
        .create_workspace(CreateWorkspaceRequest {
            name: "Blue Ops".to_string(),
            icon: Some("Server".to_string()),
            icon_color: Some("#2563eb".to_string()),
            import_connection_ids: None,
        })
        .expect("workspace is created");
    assert_eq!(workspace.icon_color.as_deref(), Some("#2563eb"));

    let persisted = storage
        .list_workspaces()
        .expect("workspaces load")
        .into_iter()
        .find(|entry| entry.id == workspace.id)
        .expect("new workspace is listed");
    assert_eq!(persisted.icon_color.as_deref(), Some("#2563eb"));
}

#[test]
fn rename_workspace_updates_icon_properties() {
    let storage = Storage::open(temp_db_path("workspace-edit-properties")).expect("storage opens");

    let workspace = storage
        .create_workspace(CreateWorkspaceRequest {
            name: "Blue Ops".to_string(),
            icon: Some("Server".to_string()),
            icon_color: Some("#2563eb".to_string()),
            import_connection_ids: None,
        })
        .expect("workspace is created");
    let updated = storage
        .rename_workspace(RenameWorkspaceRequest {
            id: workspace.id.clone(),
            name: "Green Ops".to_string(),
            icon: Some("Folder".to_string()),
            icon_color: Some("#16a34a".to_string()),
        })
        .expect("workspace is updated");

    assert_eq!(updated.name, "Green Ops");
    assert_eq!(updated.icon.as_deref(), Some("Folder"));
    assert_eq!(updated.icon_color.as_deref(), Some("#16a34a"));

    let persisted = storage
        .list_workspaces()
        .expect("workspaces load")
        .into_iter()
        .find(|entry| entry.id == workspace.id)
        .expect("workspace is listed");
    assert_eq!(persisted.name, "Green Ops");
    assert_eq!(persisted.icon.as_deref(), Some("Folder"));
    assert_eq!(persisted.icon_color.as_deref(), Some("#16a34a"));
}

fn temp_db_path(name: &str) -> PathBuf {
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock is after Unix epoch")
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("kkterm-storage-{name}-{unique}"));
    fs::create_dir_all(&dir).expect("temp directory is created");
    dir.join("kkterm.sqlite3")
}
