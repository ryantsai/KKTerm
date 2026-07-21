// Built-in MCP tool catalog (single source of truth).
//
// Both sides of the MCP transport publish the *same* `tools/list` surface:
//
//   * `mcp_bridge.rs` (inside kkterm.exe) answers `tools/list` when the app is
//     running and dispatches `tools/call` into the in-process AI tools.
//   * `bin/kkterm-cli.rs` (the stdio forwarder launched by external MCP
//     clients) answers `initialize` / `tools/list` locally so clients can
//     introspect the surface even when kkterm.exe is not running.
//
// Historically each side hand-maintained its own copy of the descriptor list,
// which drifted: the CLI mirror fell behind the bridge's enriched schemas and
// descriptions. This module is the one place the catalog lives. The bridge
// uses it via `crate::mcp_tool_catalog`; the CLI binary includes this exact
// source file with `#[path = "../mcp_tool_catalog.rs"]` so it shares the
// catalog without linking the whole `kkterm_lib` crate (keeping the forwarder
// thin). It depends only on `serde_json`, so it builds on every platform.

use serde_json::{Value, json};

/// The complete published MCP tool surface, in stable order. Adding a tool
/// here updates both the live bridge and the offline CLI introspection at
/// once — see the feature-growth contract in `docs/MCP.md`.
pub fn tool_descriptors() -> Vec<Value> {
    vec![
        json!({
            "name": "kkterm.workspace.workspaces.list",
            "description": "List KKTerm Workspaces. A Workspace is a durable container for saved Connections; it is not a live Session or Tab.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.workspace.workspaces.create",
            "description": "Create a Workspace. importConnectionIds optionally copies saved Connections from any existing Workspace into the new Workspace as independent durable Connections.",
            "inputSchema": workspace_create_input_schema(),
        }),
        json!({
            "name": "kkterm.workspace.workspaces.rename",
            "description": "Rename or restyle one Workspace by id. Submit the full icon fields you want to retain.",
            "inputSchema": workspace_rename_input_schema(),
        }),
        json!({
            "name": "kkterm.workspace.workspaces.reorder",
            "description": "Reorder Workspaces by supplying every Workspace id in the desired order.",
            "inputSchema": {
                "type": "object",
                "properties": {"orderedIds": {"type": "array", "items": {"type": "string"}}},
                "required": ["orderedIds"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.workspaces.dangerous.delete",
            "description": "DANGEROUS: delete one non-default Workspace and all saved Connections and Connection folders it owns. The frontend closes Tabs and live Sessions owned by the removed Workspace when it reloads the Workspace list. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.workspace.connections.list",
            "description": "List saved Connections (folders + connections) from KKTerm storage.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.workspace.connections.create",
            "description": "Create a saved Connection in KKTerm storage. Does not accept or store passwords or other secrets.",
            "inputSchema": connection_input_schema(None),
        }),
        json!({
            "name": "kkterm.workspace.connections.update",
            "description": "Update one saved Connection in KKTerm storage. Submit the full updated Connection fields. Does not accept or store passwords or other secrets.",
            "inputSchema": connection_input_schema(Some("connectionId")),
        }),
        json!({
            "name": "kkterm.workspace.connections.rename",
            "description": "Rename one saved Connection by id.",
            "inputSchema": id_name_input_schema("connectionId"),
        }),
        json!({
            "name": "kkterm.workspace.connections.delete",
            "description": "Delete one saved Connection by id.",
            "inputSchema": id_input_schema("connectionId"),
        }),
        json!({
            "name": "kkterm.workspace.connections.move",
            "description": "Move one saved Connection to a folder and position. Use folderId null for the root list.",
            "inputSchema": move_connection_input_schema(),
        }),
        json!({
            "name": "kkterm.workspace.connection_folders.create",
            "description": "Create a Connection folder. Use parentFolderId null for a root folder.",
            "inputSchema": folder_create_input_schema(),
        }),
        json!({
            "name": "kkterm.workspace.connection_folders.rename",
            "description": "Rename one Connection folder by id.",
            "inputSchema": id_name_input_schema("folderId"),
        }),
        json!({
            "name": "kkterm.workspace.connection_folders.delete",
            "description": "Delete one Connection folder by id, including contained saved Connections and nested folders.",
            "inputSchema": id_input_schema("folderId"),
        }),
        json!({
            "name": "kkterm.workspace.connection_folders.move",
            "description": "Move one Connection folder to a parent folder and position. Use parentFolderId null for the root list.",
            "inputSchema": move_folder_input_schema(),
        }),
        json!({
            "name": "kkterm.workspace.connections.open",
            "description": "Open a saved Connection by its id. Starts the appropriate session (terminal, SSH, URL, RDP, VNC) inside the running KKTerm app.",
            "inputSchema": {
                "type": "object",
                "properties": {"connectionId": {"type": "string"}},
                "required": ["connectionId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.connections.screenshot",
            "description": "Capture the visible Workspace surface for an open Connection by id. The app activates the Connection tab before capturing and returns a JPEG data URL plus dimensions.",
            "inputSchema": {
                "type": "object",
                "properties": {"connectionId": {"type": "string"}},
                "required": ["connectionId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.sessions.list",
            "description": "List live Sessions (terminal Panes, remote desktop targets, file browsers).",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.workspace.sessions.dangerous.send_input",
            "description": "DANGEROUS: send text/keystrokes to a live terminal Pane. Submitted text can execute commands in the live Session. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paneId": {"type": "string"},
                    "text": {"type": "string"},
                    "submit": {"type": "boolean", "description": "Append a terminal Enter key (carriage return) after the text."},
                },
                "required": ["paneId", "text"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.sessions.read_buffer",
            "description": "Read a snapshot of the visible terminal buffer for a live Pane.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paneId": {"type": "string"},
                },
                "required": ["paneId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.quick_commands.list",
            "description": "List saved Quick Commands for one Connection's Quick Command Bar.",
            "inputSchema": {
                "type": "object",
                "properties": {"connectionId": {"type": "string"}},
                "required": ["connectionId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.quick_commands.read",
            "description": "Read one saved Quick Command from a Connection's Quick Command Bar by id.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connectionId": {"type": "string"},
                    "id": {"type": "string"},
                },
                "required": ["connectionId", "id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.quick_commands.dangerous.create",
            "description": "DANGEROUS: create a saved Quick Command for one Connection's Quick Command Bar. This saves a runnable shortcut but does not execute it. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connectionId": {"type": "string"},
                    "label": {"type": "string"},
                    "command": {"type": "string"},
                    "iconName": {"type": "string"},
                    "accentName": {"type": "string"},
                    "sendEnter": {"type": "boolean"},
                    "confirm": {"type": "boolean"},
                },
                "required": ["connectionId", "label", "command"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.quick_commands.dangerous.edit",
            "description": "DANGEROUS: edit one saved Quick Command for a Connection's Quick Command Bar. This updates a runnable shortcut but does not execute it. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "connectionId": {"type": "string"},
                    "id": {"type": "string"},
                    "label": {"type": "string"},
                    "command": {"type": "string"},
                    "iconName": {"type": "string"},
                    "accentName": {"type": "string"},
                    "sendEnter": {"type": "boolean"},
                    "confirm": {"type": "boolean"},
                },
                "required": ["connectionId", "id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.dangerous.pointer_click",
            "description": "DANGEROUS: send a mouse click to a live RDP/VNC remote desktop surface. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paneId": {"type": "string"},
                    "x": {"type": "integer"},
                    "y": {"type": "integer"},
                    "button": {"type": "string", "enum": ["left", "right", "middle"]},
                },
                "required": ["paneId", "x", "y"],
                "additionalProperties": false,
            },
        }),
        // -- Workspace: SFTP/FTP file browser ------------------------------
        json!({
            "name": "kkterm.workspace.file_browser.list",
            "description": "List entries in an active SFTP/FTP file browser Session. Defaults to the browser's current remote path. Use sessions.list to discover the tabId.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tabId": {"type": "string", "description": "File browser Tab id. Defaults to the active file browser when omitted."},
                    "path": {"type": "string", "description": "Remote directory to list. Defaults to the browser's current path when omitted."},
                },
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.file_browser.dangerous.create_folder",
            "description": "DANGEROUS: create a folder in an active SFTP/FTP file browser Session. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tabId": {"type": "string"},
                    "parentPath": {"type": "string"},
                    "name": {"type": "string"},
                },
                "required": ["parentPath", "name"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.file_browser.dangerous.rename",
            "description": "DANGEROUS: rename a path in an active SFTP/FTP file browser Session. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tabId": {"type": "string"},
                    "path": {"type": "string"},
                    "newName": {"type": "string"},
                },
                "required": ["path", "newName"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.file_browser.dangerous.delete",
            "description": "DANGEROUS: delete a path in an active SFTP/FTP file browser Session. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tabId": {"type": "string"},
                    "path": {"type": "string"},
                },
                "required": ["path"],
                "additionalProperties": false,
            },
        }),
        // -- Workspace: remote desktop (RDP/VNC) capture and input ----------
        json!({
            "name": "kkterm.workspace.sessions.remote_desktop_screenshot",
            "description": "Capture the active RDP/VNC remote desktop surface as a PNG data URL for visual inspection. Defaults to the active remote desktop Pane.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paneId": {"type": "string", "description": "Remote desktop Pane id. Defaults to the active remote desktop when omitted."},
                },
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.dangerous.remote_desktop_send_text",
            "description": "DANGEROUS: type text into a live RDP/VNC remote desktop Session. Set pressEnter true to submit. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paneId": {"type": "string"},
                    "text": {"type": "string"},
                    "pressEnter": {"type": "boolean"},
                },
                "required": ["text"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.workspace.dangerous.remote_desktop_keypress",
            "description": "DANGEROUS: send a named key press to a live RDP/VNC remote desktop Session. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paneId": {"type": "string"},
                    "key": {"type": "string", "enum": ["enter", "tab", "escape", "backspace", "delete", "arrowUp", "arrowDown", "arrowLeft", "arrowRight", "home", "end", "pageUp", "pageDown", "space", "ctrlAltDelete"]},
                },
                "required": ["key"],
                "additionalProperties": false,
            },
        }),
        // -- Dashboard: views, instances, layout --------------------------
        json!({
            "name": "kkterm.dashboard.load_state",
            "description": "Load full Dashboard state: views, instances, and AI-Created Widget metadata. Widget bodies are returned as `bodyMeta` (size, library hints); call read_widget_source to fetch the actual script.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.dashboard.screenshot_view",
            "description": "Capture an entire Dashboard View. If viewId is omitted, captures the active Dashboard View. Returns a JPEG data URL plus dimensions.",
            "inputSchema": {
                "type": "object",
                "properties": {"viewId": {"type": "string"}},
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.screenshot_widget",
            "description": "Capture a single Dashboard Widget Instance region by id. The app activates the owning Dashboard View before capturing and returns a JPEG data URL plus dimensions.",
            "inputSchema": {
                "type": "object",
                "properties": {"instanceId": {"type": "string"}},
                "required": ["instanceId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.read_widget_source",
            "description": "Fetch the script body of a single AI-Created Widget by id.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.check_widget_health",
            "description": "Read the live runtime health of one Dashboard Widget Instance, waiting briefly for its frontend smoke test to report ready, error, timeout, stalled, or pending.",
            "inputSchema": {
                "type": "object",
                "properties": {"instanceId": {"type": "string"}},
                "required": ["instanceId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.create_view",
            "description": "Add a new Dashboard view (tab). `gridDensity` is optional ('compact' | 'default' | 'roomy'); defaults to 'default'.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "gridDensity": {"type": "string", "enum": ["compact", "default", "roomy"]},
                },
                "required": ["title"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.update_view",
            "description": "Edit an existing Dashboard view. `patch` may include title, gridDensity ('compact' | 'default' | 'roomy'), sortOrder, background, and tabColor.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "patch": {"type": "object"},
                },
                "required": ["id", "patch"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.remove_view",
            "description": "Delete a Dashboard view and all its instances.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.reorder_views",
            "description": "Reorder Dashboard views by supplying their ids in the desired order.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "orderedIds": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["orderedIds"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.add_instance",
            "description": "Place a new widget instance on a view. `kind` is 'builtIn' for a stock widget or 'script' for an AI-Created Widget. `sourceId` selects which one: for built-in widgets it is the registry id ('appLauncher', 'connectionPane', 'notes', 'pcInfo', 'networkTools', 'generatorTools', 'converters', or 'aiCodingUsage'); for 'script' it is the AI-Created Widget's id. `preset`, `accentName`, and `iconName` are required. Grid coordinates are 0-11 columns wide; gridX/Y/W/H are optional and auto-placed when omitted.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "viewId": {"type": "string"},
                    "kind": {"type": "string", "enum": ["builtIn", "script"]},
                    "sourceId": {"type": "string"},
                    "preset": {"type": "string", "enum": ["panel", "ambient", "hero"]},
                    "accentName": {"type": "string"},
                    "iconName": {"type": "string"},
                    "gridX": {"type": "integer", "minimum": 0, "maximum": 11},
                    "gridY": {"type": "integer", "minimum": 0},
                    "gridW": {"type": "integer", "minimum": 1, "maximum": 12},
                    "gridH": {"type": "integer", "minimum": 1},
                },
                "required": ["viewId", "kind", "sourceId", "preset", "accentName", "iconName"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.update_instance",
            "description": "Change a widget instance's size, position, preset, accent, icon, custom title, or title visibility. Use `patch` with any subset of: gridX, gridY, gridW, gridH, preset, accentName, iconName, customTitle, hideTitle.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "patch": {"type": "object"},
                },
                "required": ["id", "patch"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.remove_instance",
            "description": "Remove a widget instance from its view.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.apply_layout",
            "description": "Bulk update of multiple instance positions on a single view. `layout` is an array of {id, gridX, gridY, gridW, gridH} entries.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "viewId": {"type": "string"},
                    "layout": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string"},
                                "gridX": {"type": "integer"},
                                "gridY": {"type": "integer"},
                                "gridW": {"type": "integer"},
                                "gridH": {"type": "integer"},
                            },
                            "required": ["id"],
                        },
                    },
                },
                "required": ["viewId", "layout"],
                "additionalProperties": false,
            },
        }),
        // -- Dashboard: AI-Created Widget management (executes user scripts) --
        json!({
            "name": "kkterm.dashboard.dangerous.create_widget",
            "description": "DANGEROUS: create an AI-Created (script) Widget AND place it on a view in one call. `widgetArchetype` selects the generation scaffold (dataMonitor, metricChart, utilityInstrument, desktopObject, canvasToyGame, or generalWorkbench). `body` is the structured widget body (libraries, source, permissions, etc.). Requires built_in_mcp_allow_all_dangerous = true because the body runs as a sandboxed script widget.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "viewId": {"type": "string"},
                    "widgetArchetype": {"type": "string", "enum": ["dataMonitor", "metricChart", "utilityInstrument", "desktopObject", "canvasToyGame", "generalWorkbench"]},
                    "title": {"type": "string"},
                    "summary": {"type": "string"},
                    "category": {"type": "string"},
                    "body": {"type": "object"},
                    "settingsSchema": {"type": "object"},
                    "preset": {"type": "string"},
                    "accentName": {"type": "string"},
                    "iconName": {"type": "string"},
                    "gridX": {"type": "integer"},
                    "gridY": {"type": "integer"},
                    "gridW": {"type": "integer"},
                    "gridH": {"type": "integer"},
                },
                "required": ["viewId", "widgetArchetype", "title", "body"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.dangerous.create_custom_widget",
            "description": "DANGEROUS: create a reusable AI-Created Widget definition without placing it. Pass `bodyJson` as a UTF-8 JSON string matching the script body schema. Requires Allow-all.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "summary": {"type": "string"},
                    "category": {"type": "string"},
                    "bodyJson": {"type": "string"},
                    "settingsSchemaJson": {"type": "string"},
                    "createdBy": {"type": "string"},
                },
                "required": ["title", "bodyJson"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.dangerous.update_custom_widget",
            "description": "DANGEROUS: edit an existing AI-Created Widget. `patch` may include title, summary, category, and a structured `body` (preferred) or `bodyJson`. Requires Allow-all because changes alter executable widget code.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "patch": {"type": "object"},
                },
                "required": ["id", "patch"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.dangerous.remove_custom_widget",
            "description": "DANGEROUS: delete an AI-Created Widget definition. `forceDeleteInstances` removes existing instances too; otherwise the call fails if any instance still references it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "forceDeleteInstances": {"type": "boolean"},
                },
                "required": ["id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.dashboard.dangerous.reset",
            "description": "DANGEROUS: wipe the entire Dashboard — all views, instances, and AI-Created Widgets. Irreversible. Requires Allow-all.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.screenshots.list",
            "description": "List the Screenshots Module library with paginated thumbnails and metadata. sortBy is date, name, or type; sortDirection is asc or desc.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "offset": {"type": "integer", "minimum": 0},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 200},
                    "sortBy": {"type": "string", "enum": ["date", "name", "type"]},
                    "sortDirection": {"type": "string", "enum": ["asc", "desc"]},
                },
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.screenshots.dangerous.read",
            "description": "DANGEROUS: read one library screenshot by id, returning the full image as a base64 data URL. Screenshots may contain sensitive screen content. Requires Allow-all.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.screenshots.rename",
            "description": "Rename one library screenshot by id while preserving its image extension.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}, "newName": {"type": "string", "minLength": 1}},
                "required": ["id", "newName"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.screenshots.copy_to_clipboard",
            "description": "Copy one library screenshot by id to the operating-system clipboard.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.screenshots.resize",
            "description": "Resize one or more library screenshots into new files; originals are preserved. mode is exact or percentage.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ids": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                    "mode": {"type": "string", "enum": ["exact", "percentage"]},
                    "width": {"type": "integer", "minimum": 1},
                    "height": {"type": "integer", "minimum": 1},
                    "percentage": {"type": "integer", "minimum": 1},
                    "preserveAspectRatio": {"type": "boolean"},
                },
                "required": ["ids", "mode", "preserveAspectRatio"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.screenshots.convert",
            "description": "Convert one or more library screenshots into new files; originals are preserved.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ids": {"type": "array", "items": {"type": "string"}, "minItems": 1},
                    "format": {"type": "string", "enum": ["png", "jpeg", "webp", "gif"]},
                    "quality": {"type": "integer", "minimum": 1, "maximum": 100},
                },
                "required": ["ids", "format", "quality"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.screenshots.dangerous.save_edited",
            "description": "DANGEROUS: save edited image data over a library screenshot or as a copy. Overwrite mode replaces the original file. Requires Allow-all.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "dataUrl": {"type": "string"},
                    "saveAsCopy": {"type": "boolean"},
                },
                "required": ["id", "dataUrl", "saveAsCopy"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.screenshots.dangerous.delete",
            "description": "DANGEROUS: permanently delete one library screenshot by id. Requires Allow-all.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.screenshots.dangerous.delete_batch",
            "description": "DANGEROUS: permanently delete multiple library screenshots by id. Requires Allow-all.",
            "inputSchema": {
                "type": "object",
                "properties": {"ids": {"type": "array", "items": {"type": "string"}, "minItems": 1}},
                "required": ["ids"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.screenshots.dangerous.clear",
            "description": "DANGEROUS: permanently delete every screenshot in the configured library folder. Requires Allow-all.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.screenshots.open_folder",
            "description": "Open the configured screenshot library folder in the operating-system file manager.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.screenshots.reveal",
            "description": "Reveal one library screenshot by id in the operating-system file manager.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.screenshots.open_file",
            "description": "Open one library screenshot by id in the operating system's default image application.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.screenshots.dangerous.capture_rect",
            "description": "DANGEROUS: capture an exact screen rectangle using monitor coordinates and the persisted Screenshots settings. Screen content may be sensitive. Requires Allow-all.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": {"type": "number"}, "y": {"type": "number"},
                    "width": {"type": "number", "exclusiveMinimum": 0},
                    "height": {"type": "number", "exclusiveMinimum": 0},
                },
                "required": ["x", "y", "width", "height"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.screenshots.dangerous.capture_region",
            "description": "DANGEROUS: open the interactive region selector and capture the chosen screen area using the persisted Screenshots settings. Screen content may be sensitive. Requires Allow-all.",
            "inputSchema": capture_library_input_schema(),
        }),
        json!({
            "name": "kkterm.screenshots.dangerous.capture_window",
            "description": "DANGEROUS: interactively select and capture a window using the persisted Screenshots settings. Screen content may be sensitive. Requires Allow-all.",
            "inputSchema": capture_library_input_schema(),
        }),
        json!({
            "name": "kkterm.screenshots.dangerous.capture_fullscreen",
            "description": "DANGEROUS: capture the full virtual screen across all monitors using the persisted Screenshots settings. Screen content may be sensitive. Requires Allow-all.",
            "inputSchema": capture_library_input_schema(),
        }),
        // -- IT Ops: Site topology + Rack Devices (kkterm.itops.*) ---------
        json!({
            "name": "kkterm.itops.sites.list",
            "description": "List IT Ops Sites (id, name, memberIds, filter, transport). A Site is a durable named selection of saved Connections and the top-level parent of Server Rooms, Racks, and Hosts; the topology is Site → Server Room → Rack → Rack Device. Presentation-heavy fields (backgrounds, icon images) are omitted.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.itops.sites.create",
            "description": "Create an IT Ops Site. Optional memberIds reference existing saved Connection ids (see kkterm.workspace.connections.list); transport picks the default Batch Run transport and defaults to auto.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "minLength": 1},
                    "memberIds": {"type": "array", "items": {"type": "string"}},
                    "transport": {"type": "string", "enum": ["ssh", "winrm", "psexec", "auto"]},
                },
                "required": ["name"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.server_rooms.list",
            "description": "List the Server Rooms of one IT Ops Site by siteId. Every Rack must belong to a Server Room in the same Site.",
            "inputSchema": site_id_input_schema(),
        }),
        json!({
            "name": "kkterm.itops.server_rooms.create",
            "description": "Create a Server Room in an IT Ops Site. floorColor is optional and defaults to 'default'.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "siteId": {"type": "string"},
                    "name": {"type": "string", "minLength": 1},
                    "floorColor": {"type": "string", "enum": ["default", "concrete", "graphite", "green", "blue"]},
                },
                "required": ["siteId", "name"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.racks.list",
            "description": "List the Racks of one IT Ops Site by siteId, each with its placed Rack Devices (items) in U order. Use this to inspect the topology and find free U spans before placing a device.",
            "inputSchema": site_id_input_schema(),
        }),
        json!({
            "name": "kkterm.itops.racks.create",
            "description": "Create a Rack in an IT Ops Site. serverRoom is the name of an existing Server Room in the same Site (create it first with kkterm.itops.server_rooms.create). heightU defaults to 42 and depthMm to 1000; rackGroup is an optional grouping tag within the room.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "siteId": {"type": "string"},
                    "name": {"type": "string", "minLength": 1},
                    "serverRoom": {"type": "string", "minLength": 1},
                    "rackGroup": {"type": "string"},
                    "shell": {"type": "string", "enum": ["black", "white", "grey"]},
                    "heightU": {"type": "integer", "minimum": 1, "maximum": 100},
                    "depthMm": {"type": "integer", "minimum": 1, "maximum": 5000},
                    "powerCapacityW": {"type": "integer", "minimum": 0},
                },
                "required": ["siteId", "name", "serverRoom"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.rack_items.place",
            "description": "Place one Rack Device into a Rack. Call kkterm.itops.racks.list first. For an in-cabinet device, startU is its lowest occupied U (1 = bottom) and its span must fit without overlap. To place a standing Kuai Kuai package on the rack top, use kind 'kuaiguai', startU = rack.heightU + 1, heightU 4, and metadata.kuaiguaiStyle 'full'; a laid-down package uses heightU 1 and 'laidDown'. metadata.expiry is an ISO date (YYYY-MM-DD). Only one Kuai Kuai may occupy a rack top. kind 'connection' requires connectionId; metadata never contains secrets.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "rackId": {"type": "string"},
                    "kind": {"type": "string", "enum": ["connection", "server", "storage", "switch", "router", "firewall", "pdu", "ups", "kvm", "patchPanel", "genericDevice", "kuaiguai"]},
                    "label": {"type": "string"},
                    "startU": {"type": "integer", "minimum": 1},
                    "heightU": {"type": "integer", "minimum": 1},
                    "mountFace": {"type": "string", "enum": ["front", "rear"]},
                    "connectionId": {"type": "string"},
                    "metadata": {"type": "object", "properties": {
                        "expiry": {"type": "string", "description": "ISO date in YYYY-MM-DD form"},
                        "kuaiguaiStyle": {"type": "string", "enum": ["full", "laidDown"]},
                        "kuaiguaiSize": {"type": "string", "enum": ["small", "regular", "large"]},
                        "rotation": {"type": "integer"},
                    }},
                },
                "required": ["rackId", "kind", "label", "startU", "heightU"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.rack_items.update",
            "description": "Update one Rack Device's kind, label, Connection binding, or metadata by id (position changes go through kkterm.itops.rack_items.move). kind includes 'kuaiguai'; its metadata may include expiry (YYYY-MM-DD), kuaiguaiStyle ('full'|'laidDown'), kuaiguaiSize, and rotation. Submit full new values: omitted metadata clears previously stored metadata, so read the device from kkterm.itops.racks.list first and resend the fields you want to keep.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "kind": {"type": "string", "enum": ["connection", "server", "storage", "switch", "router", "firewall", "pdu", "ups", "kvm", "patchPanel", "genericDevice", "kuaiguai"]},
                    "label": {"type": "string"},
                    "connectionId": {"type": "string"},
                    "mountFace": {"type": "string", "enum": ["front", "rear"]},
                    "metadata": {"type": "object", "properties": {
                        "expiry": {"type": "string", "description": "ISO date in YYYY-MM-DD form"},
                        "kuaiguaiStyle": {"type": "string", "enum": ["full", "laidDown"]},
                        "kuaiguaiSize": {"type": "string", "enum": ["small", "regular", "large"]},
                        "rotation": {"type": "integer"},
                    }},
                },
                "required": ["id", "kind", "label"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.rack_items.move",
            "description": "Move and/or resize one Rack Device by id — possibly into a different Rack. The new U span is validated against the target rack (bounds and overlaps).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "rackId": {"type": "string"},
                    "startU": {"type": "integer", "minimum": 1},
                    "heightU": {"type": "integer", "minimum": 1},
                    "mountFace": {"type": "string", "enum": ["front", "rear"]},
                },
                "required": ["id", "rackId", "startU", "heightU"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.rack_items.remove",
            "description": "Remove one Rack Device from its Rack by id. This deletes the placement only; any bound saved Connection is untouched.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.itops.hosts.list",
            "description": "List the Hosts of one IT Ops Site by siteId: durable inventory entries addressed by hostname, with kind (physical|vm|container|other), optional parentHostId (the device Host carrying a VM/container), bound Connection ids, and the last connectivity-scan snapshot.",
            "inputSchema": site_id_input_schema(),
        }),
        json!({
            "name": "kkterm.itops.sites.update",
            "description": "Update one IT Ops Site by id. Omitted fields keep their current values; presentation fields (icons, backgrounds) are always preserved. memberIds and filter use full-value semantics when supplied.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string", "minLength": 1},
                    "memberIds": {"type": "array", "items": {"type": "string"}},
                    "filter": {"type": "object", "properties": {
                        "types": {"type": "array", "items": {"type": "string"}},
                        "folderId": {"type": ["string", "null"]},
                    }},
                    "transport": {"type": "string", "enum": ["ssh", "winrm", "psexec", "auto"]},
                },
                "required": ["id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.sites.remove",
            "description": "Delete one IT Ops Site by id, including its Server Rooms, Racks, Rack Devices, and Hosts. Saved Connections and Run History are untouched. The seeded Default Site cannot be deleted.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.itops.server_rooms.update",
            "description": "Update one Server Room by id. Full-value semantics: read the room via kkterm.itops.server_rooms.list first and resend both name and floorColor.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string", "minLength": 1},
                    "floorColor": {"type": "string", "enum": ["default", "concrete", "graphite", "green", "blue"]},
                },
                "required": ["id", "name", "floorColor"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.server_rooms.remove",
            "description": "Delete one Server Room by id, including its Racks and their Rack Device placements. Bound saved Connections are untouched.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.itops.racks.update",
            "description": "Update one Rack by id. Full-value semantics: read the rack via kkterm.itops.racks.list first and resend every field you want to keep (omitted rackGroup/shell/powerCapacityW are cleared). Shrinking heightU is rejected while placed devices would no longer fit.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string", "minLength": 1},
                    "serverRoom": {"type": "string", "minLength": 1},
                    "rackGroup": {"type": "string"},
                    "shell": {"type": "string", "enum": ["black", "white", "grey"]},
                    "heightU": {"type": "integer", "minimum": 1, "maximum": 100},
                    "depthMm": {"type": "integer", "minimum": 1, "maximum": 5000},
                    "powerCapacityW": {"type": "integer", "minimum": 0},
                },
                "required": ["id", "name", "serverRoom", "heightU", "depthMm"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.racks.remove",
            "description": "Delete one Rack by id, including its Rack Device placements. Bound saved Connections are untouched.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.itops.hosts.create",
            "description": "Create one Host in an IT Ops Site: a durable inventory entry addressed by hostname. parentHostId nests it as a VM/container guest under a device Host. Bind Connections with kkterm.itops.hosts.update.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "siteId": {"type": "string"},
                    "hostname": {"type": "string", "minLength": 1},
                    "label": {"type": "string"},
                    "kind": {"type": "string", "enum": ["physical", "vm", "container", "other"]},
                    "parentHostId": {"type": "string"},
                    "notes": {"type": "string"},
                },
                "required": ["siteId", "hostname"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.hosts.update",
            "description": "Update one Host by id. Full-value semantics: read the Host via kkterm.itops.hosts.list first and resend every field you want to keep — omitted label/kind/parentHostId/connectionIds/notes are cleared or reset. connectionIds are ordered saved Connection ids; the first bound SSH Connection makes the Host runnable in Batch Runs.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "hostname": {"type": "string", "minLength": 1},
                    "label": {"type": "string"},
                    "kind": {"type": "string", "enum": ["physical", "vm", "container", "other"]},
                    "parentHostId": {"type": "string"},
                    "connectionIds": {"type": "array", "items": {"type": "string"}},
                    "notes": {"type": "string"},
                },
                "required": ["id", "hostname"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.hosts.remove",
            "description": "Delete one Host by id. Its child Hosts (VMs/containers) are re-parented one level up rather than deleted. Bound saved Connections are untouched.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.itops.hosts.import",
            "description": "Bulk-import a hostname list into an IT Ops Site's Host inventory. Blank entries and case-insensitive duplicates (within the list or against existing Hosts) are skipped, not errors. Returns the created Hosts plus the skipped count.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "siteId": {"type": "string"},
                    "hostnames": {"type": "array", "items": {"type": "string"}, "minItems": 1, "maxItems": 500},
                },
                "required": ["siteId", "hostnames"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.hosts.scan",
            "description": "Scan a Site's Hosts (all of them, or only hostIds) for remote-access endpoints with bounded TCP probes: SSH (22), WinRM (5985/5986), and HTTPS (443). Waits for the scan to finish and returns the updated Host list; each Host's scan snapshot is persisted.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "siteId": {"type": "string"},
                    "hostIds": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["siteId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.sites.reorder",
            "description": "Reorder IT Ops Sites by supplying every Site id in the desired order.",
            "inputSchema": ordered_ids_input_schema(false),
        }),
        json!({
            "name": "kkterm.itops.sites.resolve",
            "description": "Resolve one Site by id to its runnable Connection-backed hosts.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.itops.server_rooms.duplicate",
            "description": "Duplicate a Server Room and all of its Racks, Rack Device placements, and Room Objects under a new name and floor color.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}, "name": {"type": "string"}, "floorColor": {"type": "string"}},
                "required": ["id", "name", "floorColor"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.racks.duplicate",
            "description": "Duplicate a Rack and its Rack Device placements with full Rack values and optional grid placement/facing.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"}, "name": {"type": "string"}, "serverRoom": {"type": "string"},
                    "rackGroup": {"type": "string"}, "shell": {"type": "string"},
                    "heightU": {"type": "integer", "minimum": 1}, "depthMm": {"type": "integer", "minimum": 1},
                    "powerCapacityW": {"type": "integer", "minimum": 0}, "gridX": {"type": "integer"},
                    "gridY": {"type": "integer"}, "facing": {"type": "integer", "minimum": 0, "maximum": 3}
                },
                "required": ["id", "name", "serverRoom", "heightU", "depthMm"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.racks.reorder",
            "description": "Reorder the Racks of one Site by supplying every Rack id in the desired order.",
            "inputSchema": ordered_ids_input_schema(true),
        }),
        json!({
            "name": "kkterm.itops.racks.set_placements",
            "description": "Batch-set Server Room View placements for Racks. kind is floor for pixel coordinates or grid for 2.5D cells.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "kind": {"type": "string", "enum": ["floor", "grid"]},
                    "entries": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}, "x": {"type": "number"}, "y": {"type": "number"}}, "required": ["id", "x", "y"], "additionalProperties": false}}
                },
                "required": ["kind", "entries"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.racks.set_facings",
            "description": "Batch-set Rack quarter-turn facings in Server Room View.",
            "inputSchema": {
                "type": "object",
                "properties": {"entries": {"type": "array", "items": {"type": "object", "properties": {"id": {"type": "string"}, "facing": {"type": "integer", "minimum": 0, "maximum": 3}}, "required": ["id", "facing"], "additionalProperties": false}}},
                "required": ["entries"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.room_objects.list",
            "description": "List all non-Rack Room Objects in one Server Room.",
            "inputSchema": site_room_input_schema(false),
        }),
        json!({
            "name": "kkterm.itops.room_objects.set",
            "description": "Replace one Server Room's complete Room Object set.",
            "inputSchema": site_room_input_schema(true),
        }),
        json!({
            "name": "kkterm.itops.sites.set_background",
            "description": "Set or clear one Site's presentation background. Pass background null to clear it.",
            "inputSchema": background_input_schema("siteId"),
        }),
        json!({
            "name": "kkterm.itops.server_rooms.set_background",
            "description": "Set or clear one Server Room's presentation background within a Site.",
            "inputSchema": site_room_value_input_schema("background"),
        }),
        json!({
            "name": "kkterm.itops.server_rooms.set_icon",
            "description": "Set or clear one Server Room's icon metadata within a Site.",
            "inputSchema": site_room_value_input_schema("icon"),
        }),
        json!({
            "name": "kkterm.itops.racks.set_background",
            "description": "Set or clear one Rack's presentation background. Pass background null to clear it.",
            "inputSchema": background_input_schema("id"),
        }),
        json!({
            "name": "kkterm.itops.rack_items.refresh_snmp",
            "description": "Refresh one Rack Device's SNMP telemetry using its existing Connection and SNMP metadata.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.itops.connections.get",
            "description": "Read one saved Connection by id for an IT Ops Rack Device binding. Secret values are never returned.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.itops.tasks.list",
            "description": "List the global IT Ops Task Library: reusable script/playbook definitions with id, name, description, applicableOs, kind, a redacted one-line summary, and builtInKey for app-owned read-only built-ins. Use kkterm.itops.tasks.get for a full definition.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.itops.tasks.get",
            "description": "Read one IT Ops Task's full definition by id, including the script body or playbook steps.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.itops.tasks.dangerous.create",
            "description": "DANGEROUS: create a reusable IT Ops Task in the global Task Library — a script or interactive playbook definition an operator can later run across many hosts. It only saves the definition; nothing executes. task is {kind:'script', body, shell?} or {kind:'playbook', name, steps:[{kind?:'command'|'ai', name, send, expect?, timeoutSeconds?, aiInstruction?}]}; sudo steps and secret references are rejected (configure them in the Task Library editor). applicableOs defaults to ['any']. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "minLength": 1},
                    "description": {"type": "string"},
                    "applicableOs": {"type": "array", "items": {"type": "string", "enum": ["any", "linux", "macos", "windows", "ciscoIos", "ciscoNxos", "fortiOs", "junos", "aristaEos"]}},
                    "task": {"type": "object"},
                },
                "required": ["name", "task"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.tasks.dangerous.update",
            "description": "DANGEROUS: update one IT Ops Task by id. Full-value semantics: read the Task via kkterm.itops.tasks.get first and resend name, description, applicableOs, and the full task definition. Built-in catalog Tasks are read-only. New sudo steps or secret references are rejected. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string", "minLength": 1},
                    "description": {"type": "string"},
                    "applicableOs": {"type": "array", "items": {"type": "string", "enum": ["any", "linux", "macos", "windows", "ciscoIos", "ciscoNxos", "fortiOs", "junos", "aristaEos"]}},
                    "task": {"type": "object"},
                },
                "required": ["id", "name", "task"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.tasks.remove",
            "description": "Delete one user IT Ops Task by id (built-ins cannot be deleted). Completed Run History keeps its redacted task summary; any orphaned task credentials are removed from the vault.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.itops.automations.list",
            "description": "List durable IT Ops Automations: id, name, enabled, the trigger/condition config, the ordered action list, and the optional Site binding (siteId). Enabled rows are armed as live Watchdogs.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.itops.automations.dangerous.create",
            "description": "DANGEROUS: create a durable IT Ops Automation — one trigger + condition (config, a WatchdogConfig whose action must be {kind:'notify'}) and an ordered action list run when it fires (notify, popup, email, webhook, runBatch). enabled defaults to true and arms the rule immediately; runBatch actions later execute scripts on site hosts. RunBatch tasks may not carry sudo steps or secret references. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "minLength": 1},
                    "config": {"type": "object"},
                    "actions": {"type": "array", "items": {"type": "object"}},
                    "enabled": {"type": "boolean"},
                    "siteId": {"type": "string"},
                },
                "required": ["name", "config", "actions"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.automations.dangerous.update",
            "description": "DANGEROUS: update one IT Ops Automation by id. Full-value semantics: read the rule via kkterm.itops.automations.list first and resend name, config, actions, and siteId. An enabled rule is re-armed with the new definition. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "name": {"type": "string", "minLength": 1},
                    "config": {"type": "object"},
                    "actions": {"type": "array", "items": {"type": "object"}},
                    "siteId": {"type": "string"},
                },
                "required": ["id", "name", "config", "actions"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.automations.dangerous.set_enabled",
            "description": "DANGEROUS: enable (arm) or disable (disarm) one IT Ops Automation by id. An armed rule polls its trigger and runs its actions unattended. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "enabled": {"type": "boolean"},
                },
                "required": ["id", "enabled"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.automations.remove",
            "description": "Delete one IT Ops Automation by id, disarming its live Watchdog first. Run History produced by the rule is kept.",
            "inputSchema": id_input_schema("id"),
        }),
        json!({
            "name": "kkterm.itops.automations.test",
            "description": "Dry-run an Automation trigger: sample the config's target once and report the sampled value plus whether the condition would fire right now. No actions are executed and nothing is stored.",
            "inputSchema": {
                "type": "object",
                "properties": {"config": {"type": "object"}},
                "required": ["config"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.runs.dangerous.start",
            "description": "DANGEROUS: start a Batch Run against an IT Ops Site — this executes a script or playbook on every resolved host over SSH. Pass exactly one of taskId (a Task Library definition) or script {body, shell?}. Optional scope narrows targets to one serverRoom, one rackId, or selected hostIds. Returns the runId immediately; read results later with kkterm.itops.runs.get_report. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "siteId": {"type": "string"},
                    "taskId": {"type": "string"},
                    "script": {"type": "object", "properties": {
                        "body": {"type": "string", "minLength": 1},
                        "shell": {"type": "string"},
                    }, "required": ["body"]},
                    "scope": {"type": "object", "properties": {
                        "serverRoom": {"type": "string"},
                        "rackId": {"type": "string"},
                        "hostIds": {"type": "array", "items": {"type": "string"}},
                    }},
                },
                "required": ["siteId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.runs.cancel",
            "description": "Cancel a live Batch Run by runId. Hosts already finished keep their results; the partial report is still written to Run History.",
            "inputSchema": id_input_schema("runId"),
        }),
        json!({
            "name": "kkterm.itops.runs.list",
            "description": "List completed Batch Run reports, newest first: id, source (manual or automation:<id>), siteId, taskId, redacted task summary, timestamps, and per-host outcome rows (ok, exitCode, durationMs, error) without output text.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "siteId": {"type": "string"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 100},
                },
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.itops.runs.get_report",
            "description": "Read one Batch Run's consolidated report by runId, including each host's captured output (tail-capped per host by maxOutputChars, default 4000). The output may include sensitive remote command results.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "runId": {"type": "string"},
                    "maxOutputChars": {"type": "integer", "minimum": 100, "maximum": 20000},
                },
                "required": ["runId"],
                "additionalProperties": false,
            },
        }),
        // -- Network: read-only diagnostics (kkterm.network.*) -------------
        json!({
            "name": "kkterm.network.ping",
            "description": "Ping a host (ICMP with TCP fallback). Returns per-packet RTT replies and availability.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": {"type": "string"},
                    "count": {"type": "integer", "minimum": 1, "maximum": 256},
                    "intervalMs": {"type": "integer", "minimum": 100},
                    "timeoutMs": {"type": "integer", "minimum": 100},
                    "fallbackTcpPort": {"type": "integer", "minimum": 1, "maximum": 65535},
                },
                "required": ["host"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.network.dns",
            "description": "Resolve a hostname via DNS. Returns records and resolver RTT.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": {"type": "string"},
                    "recordType": {"type": "string", "enum": ["A", "AAAA", "MX", "TXT", "CNAME", "NS", "SOA", "PTR"]},
                },
                "required": ["host"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.network.tcp_check",
            "description": "Check whether a TCP port is open on a host. Returns open/closed status and RTT.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": {"type": "string"},
                    "port": {"type": "integer", "minimum": 1, "maximum": 65535},
                    "timeoutMs": {"type": "integer", "minimum": 100},
                },
                "required": ["host", "port"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.network.port_scan",
            "description": "Scan a list of TCP ports on a host. Returns open/closed status per port.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "host": {"type": "string"},
                    "ports": {"type": "array", "items": {"type": "integer", "minimum": 1, "maximum": 65535}, "minItems": 1, "maxItems": 1024},
                    "concurrency": {"type": "integer", "minimum": 1, "maximum": 64},
                    "timeoutMs": {"type": "integer", "minimum": 100},
                    "jitterMs": {"type": "integer", "minimum": 0},
                },
                "required": ["host", "ports"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.network.interfaces",
            "description": "List all local network interfaces with their IP addresses and MAC addresses.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.network.wol",
            "description": "Send a Wake-on-LAN magic packet to wake a sleeping machine by its MAC address.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "mac": {"type": "string"},
                    "broadcast": {"type": "string"},
                    "port": {"type": "integer", "minimum": 1, "maximum": 65535},
                },
                "required": ["mac"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.network.whois",
            "description": "Run a WHOIS lookup for a domain name or IP address.",
            "inputSchema": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
                "additionalProperties": false,
            },
        }),
        // -- Watchdog: background monitors (kkterm.watchdog.*) -------------
        json!({
            "name": "kkterm.watchdog.list",
            "description": "List all background watchdogs known to this app session: id, name, state, lastValue, triggerCount, pollCount.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.watchdog.get_report",
            "description": "Fetch the full report for one watchdog by id: config, current state, recent tick history, and the trigger event log.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.watchdog.cancel",
            "description": "Cancel a running watchdog by id. Stops polling and transitions it to a canceled state.",
            "inputSchema": {
                "type": "object",
                "properties": {"id": {"type": "string"}},
                "required": ["id"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.watchdog.dangerous.create",
            "description": "DANGEROUS: create a background watchdog that polls a target and fires when a predicate is met. `config` is the structured watchdog config (name, target, trigger, pollMs, stop, notification, action); the full target/predicate shape is validated server-side. An aiIntervene action additionally prompts for in-app approval at the KKTerm window before the watchdog is created. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "config": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string"},
                            "target": {"type": "object"},
                            "trigger": {"type": "object"},
                            "pollMs": {"type": "integer", "minimum": 500, "maximum": 3600000},
                            "stop": {"type": "object"},
                            "notification": {"type": "string", "enum": ["inAppOnly", "inAppPlusToast", "inAppPlusSound"]},
                            "action": {"type": "object"},
                        },
                        "required": ["name", "target", "trigger"],
                    },
                },
                "required": ["config"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.app.list_windows",
            "description": "List KKTerm's own UI windows (the main window plus owned overlays such as the URL WebView2, RDP, and VNC surfaces). Returns each window's id (stable Tauri label), title, kind, bounds, and visibility. Safe (read-only). Use the returned id with kkterm.app.dangerous.capture_window.",
            "inputSchema": {"type": "object", "properties": {}, "additionalProperties": false},
        }),
        json!({
            "name": "kkterm.app.dangerous.capture_window",
            "description": "DANGEROUS: capture any KKTerm UI window by `windowId` (a label from kkterm.app.list_windows) as a JPEG data URL plus dimensions. Captures whatever the window currently renders, which may include sensitive terminal, remote-desktop, URL, or file content. On macOS the app needs the Screen Recording permission. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "windowId": {"type": "string", "description": "KKTerm window label from kkterm.app.list_windows (e.g. \"main\")."},
                },
                "required": ["windowId"],
                "additionalProperties": false,
            },
        }),
        json!({
            "name": "kkterm.app.dangerous.tutorial_highlight",
            "description": "DANGEROUS: navigate the KKTerm UI and show a one-step Tutorial overlay — highlight one app-owned target, dim the rest of the window, and place a short help balloon beside it. This moves the user's UI: navigation may switch the active Module (workspace, dashboard, itops, installer, screenshots, settings), a Settings section, or an IT Ops Site destination (navigation.itopsSiteId + navigation.itopsDestination: site|serverRooms|hosts|automations|runHistory|taskLibrary). targetId must be a registered tutorial target (see docs/manual chapters) or an IT Ops entity target such as itops.host:<hostId>. The overlay disappears when the user clicks or presses any key. Requires built_in_mcp_allow_all_dangerous = true.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "targetId": {"type": "string"},
                    "title": {"type": "string", "maxLength": 80},
                    "body": {"type": "string", "maxLength": 240},
                    "navigation": {
                        "type": "object",
                        "properties": {
                            "page": {"type": "string", "enum": ["workspace", "dashboard", "itops", "installer", "screenshots", "settings"]},
                            "settingsSectionId": {"type": "string"},
                            "itopsSiteId": {"type": "string"},
                            "itopsDestination": {"type": "string", "enum": ["site", "serverRooms", "hosts", "automations", "runHistory", "taskLibrary"]},
                        },
                        "additionalProperties": false,
                    },
                },
                "required": ["targetId", "title", "body"],
                "additionalProperties": false,
            },
        }),
    ]
}

pub fn connection_input_schema(id_name: Option<&str>) -> Value {
    let rdp_options_schema = json!({"type": ["object", "null"], "properties": {
        "inheritDefaults": {"type": "boolean"},
        "colorDepth": {"type": ["integer", "null"], "enum": [15, 16, 24, 32, null]},
        "administrativeSession": {"type": ["boolean", "null"]},
        "redirectClipboard": {"type": ["boolean", "null"]},
        "redirectDrives": {"type": ["boolean", "null"]},
        "driveSelection": {"type": ["object", "null"]},
        "sharedLocalFolders": {"type": ["array", "null"], "items": {"type": "string"}},
        "sharedLocalFolder": {"type": ["string", "null"]},
        "bitmapCache": {"type": ["boolean", "null"]},
        "performanceProfile": {"type": ["string", "null"], "enum": ["balanced", "quality", "speed", null]},
        "remoteResolution": {"type": ["string", "null"]},
        "viewMode": {"type": ["string", "null"], "enum": ["fit", "stretch", "actualSize", "fitWidth", "fitHeight", null]}
    }});
    let vnc_options_schema = json!({"type": ["object", "null"], "properties": {
        "inheritDefaults": {"type": "boolean"},
        "sharedSession": {"type": ["boolean", "null"]},
        "viewOnly": {"type": ["boolean", "null"]},
        "colorLevel": {"type": ["string", "null"], "enum": ["full", "256", "64", "8", null]},
        "preferredEncoding": {"type": ["string", "null"], "enum": ["tight", "zrle", "raw", null]},
        "viewMode": {"type": ["string", "null"], "enum": ["fit", "stretch", "actualSize", "fitWidth", "fitHeight", null]}
    }});
    let ftp_options_schema = json!({"type": ["object", "null"], "properties": {
        "protocol": {"type": "string", "enum": ["sftp", "ftp", "ftps"]},
        "mode": {"type": "string", "enum": ["passive", "active"]},
        "tlsMode": {"type": ["string", "null"], "enum": ["explicit", "implicit", null]},
        "transferType": {"type": "string", "enum": ["binary", "ascii"]},
        "utf8": {"type": "boolean"},
        "showHidden": {"type": "boolean"},
        "connectTimeoutSecs": {"type": ["integer", "null"], "minimum": 1},
        "ignoreCertErrors": {"type": "boolean"},
        "keepaliveSecs": {"type": ["integer", "null"], "minimum": 1},
        "localPath": {"type": ["string", "null"]},
        "remotePath": {"type": ["string", "null"]}
    }, "required": ["protocol"]});
    let ssh_port_forwardings_schema = json!({"type": ["array", "null"], "items": {"type": "object", "properties": {
        "id": {"type": "string"},
        "mode": {"type": "string", "enum": ["L", "R", "D"]},
        "enabled": {"type": "boolean"},
        "bind": {"type": "string"},
        "listenPort": {"type": "integer", "minimum": 1, "maximum": 65535},
        "destHost": {"type": ["string", "null"]},
        "destPort": {"type": ["integer", "null"], "minimum": 1, "maximum": 65535}
    }, "required": ["id", "mode", "enabled", "bind", "listenPort"]}});
    let mut schema = json!({
        "type": "object",
        "properties": {
            "name": {"type": "string", "minLength": 1},
            "type": {"type": "string", "enum": ["local", "ssh", "telnet", "serial", "url", "rdp", "vnc", "ftp", "localFiles", "fileView"]},
            "folderId": {"type": ["string", "null"]},
            "workspaceId": {"type": ["string", "null"]},
            "host": {"type": "string"},
            "user": {"type": "string"},
            "port": {"type": ["integer", "null"], "minimum": 1, "maximum": 65535},
            "keyPath": {"type": ["string", "null"]},
            "proxyJump": {"type": ["string", "null"]},
            "sshSocksProxy": {"type": ["string", "null"]},
            "sshSocksProxyUsername": {"type": ["string", "null"]},
            "sshSocksProxyInheritDefaults": {"type": ["boolean", "null"]},
            "sshCompression": {"type": ["string", "null"], "enum": ["off", "fast", null]},
            "sshOldProtocols": {"type": ["string", "null"], "enum": ["off", "legacy", null]},
            "authMethod": {"type": ["string", "null"], "enum": ["keyFile", "password", "agent", null]},
            "localShell": {"type": ["string", "null"]},
            "localStartupDirectory": {"type": ["string", "null"]},
            "localStartupScript": {"type": ["string", "null"]},
            "url": {"type": ["string", "null"]},
            "dataPartition": {"type": ["string", "null"]},
            "urlUserAgent": {"type": ["string", "null"]},
            "urlProxy": {"type": ["string", "null"]},
            "urlProxyInheritDefaults": {"type": ["boolean", "null"]},
            "useTmuxSessions": {"type": ["boolean", "null"]},
            "usePsmuxSessions": {"type": ["boolean", "null"]},
            "serialLine": {"type": ["string", "null"]},
            "serialSpeed": {"type": ["integer", "null"], "minimum": 1},
            "rdpOptions": rdp_options_schema,
            "vncOptions": vnc_options_schema,
            "ftpOptions": ftp_options_schema,
            "sshPortForwardings": ssh_port_forwardings_schema,
            "fileViewOpenExternal": {"type": "boolean"},
        },
        "required": ["name", "type"],
        "additionalProperties": true,
    });
    if let Some(id_name) = id_name {
        let properties = schema
            .get_mut("properties")
            .and_then(Value::as_object_mut)
            .expect("Connection schema properties");
        properties.remove("workspaceId");
        properties.insert(
            id_name.to_string(),
            json!({"type": "string", "description": "The id of the saved Connection to update."}),
        );
        schema
            .get_mut("required")
            .and_then(Value::as_array_mut)
            .expect("Connection schema required fields")
            .insert(0, json!(id_name));
    }
    schema
}

fn ordered_ids_input_schema(include_site_id: bool) -> Value {
    let mut properties = serde_json::Map::from_iter([(
        "orderedIds".to_string(),
        json!({"type": "array", "items": {"type": "string"}}),
    )]);
    let mut required = vec![json!("orderedIds")];
    if include_site_id {
        properties.insert("siteId".to_string(), json!({"type": "string"}));
        required.insert(0, json!("siteId"));
    }
    json!({"type": "object", "properties": properties, "required": required, "additionalProperties": false})
}

fn background_input_schema(id_name: &str) -> Value {
    json!({
        "type": "object",
        "properties": {(id_name): {"type": "string"}, "background": {"type": ["object", "null"]}},
        "required": [id_name, "background"],
        "additionalProperties": false,
    })
}

fn site_room_value_input_schema(value_name: &str) -> Value {
    json!({
        "type": "object",
        "properties": {
            "siteId": {"type": "string"},
            "serverRoom": {"type": "string"},
            (value_name): {"type": ["object", "null"]},
        },
        "required": ["siteId", "serverRoom", value_name],
        "additionalProperties": false,
    })
}

fn site_room_input_schema(include_objects: bool) -> Value {
    let mut properties = serde_json::Map::from_iter([
        ("siteId".to_string(), json!({"type": "string"})),
        ("serverRoom".to_string(), json!({"type": "string"})),
    ]);
    let mut required = vec![json!("siteId"), json!("serverRoom")];
    if include_objects {
        properties.insert(
            "objects".to_string(),
            json!({
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"}, "kind": {"type": "string"},
                        "x": {"type": "integer"}, "y": {"type": "integer"},
                        "z": {"type": "integer"}, "rot": {"type": "integer"},
                        "corner": {"type": ["integer", "null"]},
                    },
                    "required": ["id", "kind", "x", "y", "z", "rot"],
                    "additionalProperties": false,
                }
            }),
        );
        required.push(json!("objects"));
    }
    json!({"type": "object", "properties": properties, "required": required, "additionalProperties": false})
}

fn capture_library_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {"minimizeWindow": {"type": "boolean"}},
        "additionalProperties": false,
    })
}

fn site_id_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {"siteId": {"type": "string"}},
        "required": ["siteId"],
        "additionalProperties": false,
    })
}

fn id_input_schema(id_name: &str) -> Value {
    json!({
        "type": "object",
        "properties": {(id_name): {"type": "string"}},
        "required": [id_name],
        "additionalProperties": false,
    })
}

fn id_name_input_schema(id_name: &str) -> Value {
    json!({
        "type": "object",
        "properties": {
            (id_name): {"type": "string"},
            "name": {"type": "string", "minLength": 1},
        },
        "required": [id_name, "name"],
        "additionalProperties": false,
    })
}

fn move_connection_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "connectionId": {"type": "string"},
            "folderId": {"type": ["string", "null"]},
            "targetIndex": {"type": "integer", "minimum": 0},
        },
        "required": ["connectionId", "folderId", "targetIndex"],
        "additionalProperties": false,
    })
}

fn folder_create_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "name": {"type": "string", "minLength": 1},
            "parentFolderId": {"type": ["string", "null"]},
            "workspaceId": {"type": ["string", "null"]},
        },
        "required": ["name", "parentFolderId"],
        "additionalProperties": false,
    })
}

fn workspace_create_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "name": {"type": "string", "minLength": 1},
            "icon": {"type": ["string", "null"]},
            "iconColor": {"type": ["string", "null"]},
            "iconBackgroundColor": {"type": ["string", "null"]},
            "importConnectionIds": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["name"],
        "additionalProperties": false,
    })
}

fn workspace_rename_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "name": {"type": "string", "minLength": 1},
            "icon": {"type": ["string", "null"]},
            "iconColor": {"type": ["string", "null"]},
            "iconBackgroundColor": {"type": ["string", "null"]},
        },
        "required": ["id", "name"],
        "additionalProperties": false,
    })
}

fn move_folder_input_schema() -> Value {
    json!({
        "type": "object",
        "properties": {
            "folderId": {"type": "string"},
            "parentFolderId": {"type": ["string", "null"]},
            "targetIndex": {"type": "integer", "minimum": 0},
        },
        "required": ["folderId", "parentFolderId", "targetIndex"],
        "additionalProperties": false,
    })
}
