//! Shared appearance contracts for native AI, the MCP bridge, and offline CLI discovery.
//! No Tauri dependency: this module is also compiled into kkterm-cli.
use serde_json::{Value, json};

pub struct Tool {
    pub native: &'static str,
    pub mcp: &'static str,
    pub description: &'static str,
    pub group: &'static str,
    pub mutating: bool,
    pub schema: Value,
}

fn object(properties: Value, required: &[&str]) -> Value {
    json!({"type":"object", "properties":properties, "required":required, "additionalProperties":false})
}

pub fn background_schema() -> Value {
    json!({"anyOf":[
        {"type":"null"},
        {"type":"object","properties":{"kind":{"const":"dynamic"},"dynamic":{"type":"string","description":"Canonical ID or exact display name in any supported UI language; case and punctuation insensitive. Discover with appearance_list_backgrounds."}},"required":["kind","dynamic"],"additionalProperties":false},
        {"type":"object","properties":{"kind":{"const":"preset"},"preset":{"type":"string"}},"required":["kind","preset"],"additionalProperties":false},
        {"type":"object","properties":{"kind":{"enum":["image","video"]},"file":{"type":"string","description":"Previously imported background media filename, never a path or URL."},"fit":{"enum":["fill","fit","stretch","tile","center"]},"dim":{"type":"integer","minimum":-100,"maximum":100}},"required":["kind","file","fit","dim"],"additionalProperties":false},
        {"type":"object","properties":{"kind":{"const":"customGradient"},"angle":{"type":"number","minimum":0,"maximum":360},"stops":{"type":"array","minItems":2,"maxItems":8,"items":{"type":"object","properties":{"color":{"type":"string"},"offset":{"type":"number","minimum":0,"maximum":100}},"required":["color","offset"],"additionalProperties":false}}},"required":["kind","stops","angle"],"additionalProperties":false}
    ]})
}

pub fn dashboard_patch_schema() -> Value {
    object(json!({"id":{"type":"string"},"patch": object(json!({
        "title":{"type":"string"},"gridDensity":{"enum":["compact","default","roomy"]},
        "sortOrder":{"type":"integer"},"background":background_schema(),"tabColor":{"type":["string","null"]}
    }), &[])}), &["id","patch"])
}

pub fn background_target_schema(targets: &[&str]) -> Value {
    let mut properties = json!({"background":background_schema()});
    for key in targets { properties[*key] = json!({"type":"string","minLength":1}); }
    let mut required = targets.to_vec(); required.push("background");
    object(properties, &required)
}

fn appearance_patch() -> Value {
    let pane = object(json!({"background":background_schema(),"zoom":{"type":"number","minimum":0.5,"maximum":2}}), &[]);
    object(json!({
        "background":background_schema(), "opacity":{"type":"integer","minimum":0,"maximum":100},
        "colorScheme":{"type":["string","null"],"description":"Color scheme ID or name; null restores global default."},
        "highlightProfile":{"type":["string","null"],"description":"Existing keyword profile ID or name; null disables highlighting."},
        "fileBrowser":object(json!({"local":pane,"remote":pane}), &[])
    }), &[])
}

fn profile_schema() -> Value {
    let color = json!({"type":["string","null"],"pattern":"^#[0-9A-Fa-f]{6}$"});
    object(json!({
        "name":{"type":"string","minLength":1,"maxLength":80},
        "rules":{"type":"array","maxItems":200,"items":object(json!({
            "id":{"type":"string"}, "name":{"type":"string","minLength":1,"maxLength":80},
            "pattern":{"type":"string","minLength":1,"maxLength":2000,"description":"JavaScript regex source, without / delimiters. Always case-insensitive."},
            "enabled":{"type":"boolean"},
            "style":object(json!({"foreground":color,"background":color}), &[])
        }), &["name","pattern","style"])}
    }), &["name","rules"])
}

pub fn tools() -> Vec<Tool> {
    let mut result = Vec::new();
    macro_rules! tool { ($native:expr,$mcp:expr,$group:expr,$write:expr,$description:expr,$schema:expr) => {
        result.push(Tool{native:$native,mcp:$mcp,group:$group,mutating:$write,description:$description,schema:$schema});
    }; }
    tool!("appearance_list_backgrounds","kkterm.appearance.backgrounds.list","catalog",false,
        "List dynamic backgrounds by canonical ID and translated display names, solid/gradient presets, and terminal color schemes. Use names or IDs returned here; never invent scene IDs.",
        object(json!({"query":{"type":"string"}}), &[]));
    tool!("terminal_list_color_schemes","kkterm.appearance.color_schemes.list","catalog",false,
        "List terminal color scheme IDs and names; optional query filters results. Returns at most 100 entries with nextOffset for pagination.",
        object(json!({"query":{"type":"string"},"offset":{"type":"integer","minimum":0}}), &[]));
    tool!("connection_get_appearance","kkterm.workspace.connections.get_appearance","connections",false,
        "Read one saved Connection's background, opacity, color scheme, keyword-highlighting selection and file-browser appearance without credentials or terminal output.",
        object(json!({"connectionId":{"type":"string"}}), &["connectionId"]));
    tool!("connection_update_appearance","kkterm.workspace.connections.dangerous.update_appearance","connections",true,
        "Patch only saved Connection appearance and update its open panes without reconnecting. Omitted fields stay unchanged; background null clears, highlightProfile null disables, colorScheme null inherits. background.dynamic accepts a display name. fileBrowser patches preserve the other pane. Read appearance first.",
        object(json!({"connectionId":{"type":"string"},"patch":appearance_patch()}), &["connectionId","patch"]));
    let mut pane_patch = appearance_patch(); pane_patch["properties"].as_object_mut().unwrap().remove("fileBrowser");
    tool!("session_update_terminal_appearance","kkterm.workspace.sessions.dangerous.update_terminal_appearance","sessions",true,
        "Change only one live terminal pane, including transient local sessions. Does not save to its Connection. Resolve paneId with session_state. Supports background, opacity, colorScheme and highlightProfile; omitted fields are preserved.",
        object(json!({"paneId":{"type":"string"},"patch":pane_patch}), &["paneId","patch"]));
    tool!("terminal_highlight_list","kkterm.workspace.highlighting.list","connections",false,
        "List immutable built-in and user-owned keyword-highlighting profile metadata and saved Connection usage counts.",object(json!({}), &[]));
    tool!("terminal_highlight_read","kkterm.workspace.highlighting.read","connections",false,
        "Read one keyword-highlighting profile's rules by exact ID or unique name. Matching is case-insensitive.",object(json!({"profile":{"type":"string"}}), &["profile"]));
    tool!("terminal_highlight_create","kkterm.workspace.highlighting.dangerous.create","connections",true,
        "Create a custom keyword-highlighting profile. Validates JavaScript regex syntax and colors; does not apply it. Built-ins cannot be overwritten. IDs are generated.",object(json!({"profile":profile_schema()}), &["profile"]));
    tool!("terminal_highlight_update","kkterm.workspace.highlighting.dangerous.update","connections",true,
        "Update a custom keyword-highlighting profile by ID/name. Omitted name/rules stay unchanged; supplied rules replace the full list. Read first to preserve rules. Built-ins must be copied before editing.",object(json!({"profile":{"type":"string"},"patch":object(json!({"name":{"type":"string","maxLength":80},"rules":profile_schema()["properties"]["rules"].clone()}), &[])}), &["profile","patch"]));
    tool!("terminal_highlight_copy","kkterm.workspace.highlighting.dangerous.copy","connections",true,
        "Copy a built-in or custom keyword-highlighting profile into a new custom profile with new IDs. Does not apply it.",object(json!({"profile":{"type":"string"},"name":{"type":"string","maxLength":80}}), &["profile","name"]));
    tool!("terminal_highlight_delete","kkterm.workspace.highlighting.dangerous.delete","connections",true,
        "Delete an unused custom keyword-highlighting profile. Refuses built-ins and profiles still selected by saved Connections or live panes. Disable/replace those selections first.",object(json!({"profile":{"type":"string"}}), &["profile"]));
    tool!("terminal_highlight_import","kkterm.workspace.highlighting.dangerous.import","connections",true,
        "Import supplied SecureCRT keyword INI text as a new custom profile. Reads no local file. Regexes and colors are validated before saving; does not apply it.",object(json!({"text":{"type":"string","maxLength":500000},"name":{"type":"string","maxLength":80}}), &["text"]));
    result
}

pub fn is_mutating(name: &str) -> bool { tools().iter().any(|tool| tool.native == name && tool.mutating) }

/// Existing MCP visual inspection capabilities also needed by the assistant to
/// verify appearance changes. Schemas are reused from their published MCP entries.
pub fn visual_tool_bindings() -> [(&'static str, &'static str, &'static str, bool); 5] {
    [
        ("workspace_connection_screenshot","kkterm.workspace.connections.screenshot","sessions",true),
        ("dashboard_view_screenshot","kkterm.dashboard.screenshot_view","dashboard",true),
        ("dashboard_widget_screenshot","kkterm.dashboard.screenshot_widget","dashboard",true),
        ("app_list_windows","kkterm.app.list_windows","screenshots",false),
        ("app_capture_window","kkterm.app.dangerous.capture_window","screenshots",true),
    ]
}
