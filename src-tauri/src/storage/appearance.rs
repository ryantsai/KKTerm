//! Narrow, lock-serialized appearance writes. Never rewrite Connection credentials,
//! transport fields or an out-of-date snapshot of the other Terminal Settings.
use super::*;
use serde_json::{Value, json};

fn required<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value.get(key).and_then(Value::as_str).filter(|s| !s.trim().is_empty())
        .ok_or_else(|| format!("{key} is required"))
}

fn profiles_on(connection: &SqliteConnection) -> Result<TerminalSettings, String> {
    let value: Option<String> = connection.query_row("SELECT value FROM settings WHERE key = 'terminal'", [], |row| row.get(0))
        .optional().map_err(to_storage_error)?;
    value.map(|raw| serde_json::from_str(&raw).map_err(|e| format!("Invalid terminal settings: {e}")))
        .unwrap_or_else(|| Ok(default_terminal_settings()))
}

fn builtin_ids() -> Vec<String> {
    let profiles: Vec<TerminalSyntaxHighlightProfile> = serde_json::from_str(include_str!("../../../src/shared/builtinHighlightProfiles.json"))
        .expect("bundled highlighting profiles are valid");
    profiles.into_iter().map(|p| p.id).collect()
}

fn references(connection: &SqliteConnection) -> Result<Vec<Value>, String> {
    let mut statement = connection.prepare("SELECT id, name, terminal_syntax_highlight_profile_id FROM connections WHERE terminal_syntax_highlight_profile_id IS NOT NULL")
        .map_err(to_storage_error)?;
    statement.query_map([], |row| Ok(json!({"connectionId":row.get::<_,String>(0)?,"name":row.get::<_,String>(1)?,"profileId":row.get::<_,String>(2)?})))
        .map_err(to_storage_error)?.collect::<Result<Vec<_>,_>>().map_err(to_storage_error)
}

impl Storage {
    pub fn appearance_data(&self, request: Value) -> Result<Value, String> {
        let action = required(&request, "action")?;
        let connection = self.lock()?;
        match action {
            "get_connection" => {
                let saved = get_connection_by_id(&connection, required(&request,"connectionId")?)?;
                serde_json::to_value(saved).map_err(|e| e.to_string())
            }
            "get_profiles" => Ok(json!({"settings":profiles_on(&connection)?,"references":references(&connection)?})),
            "patch_connection" => {
                let id = required(&request, "connectionId")?;
                let saved = get_connection_by_id(&connection, id)?;
                let patch = request.get("patch").and_then(Value::as_object).filter(|p| !p.is_empty())
                    .ok_or("A non-empty appearance patch is required")?;
                let terminal = matches!(saved.connection_type.as_str(), "local"|"ssh"|"telnet"|"serial");
                for key in patch.keys() {
                    match key.as_str() {
                        "background" if terminal || saved.connection_type == "fileView" => (),
                        "opacity"|"colorScheme"|"highlightProfileId" if terminal => (),
                        "fileBrowser" if matches!(saved.connection_type.as_str(),"ssh"|"ftp"|"localFiles"|"cloudStorage") => (),
                        _ => return Err(format!("Unsupported appearance field {key} for {}", saved.connection_type)),
                    }
                }
                let background: Option<crate::dashboard_storage::DashboardBackground> =
                    serde_json::from_value(patch.get("background").cloned().unwrap_or(Value::Null)).map_err(|e| e.to_string())?;
                let background_json = terminal_background_to_json(&background)?;
                let opacity = match patch.get("opacity") {
                    Some(value) => value.as_u64().filter(|v| *v <= 100).ok_or("Opacity must be an integer from 0 to 100")? as i64,
                    None => 50,
                };
                let nullable_text = |key: &str| -> Result<Option<String>, String> {
                    match patch.get(key) {
                        None | Some(Value::Null) => Ok(None),
                        Some(Value::String(value)) if !value.trim().is_empty() && value.len() <= 200 => Ok(Some(value.clone())),
                        _ => Err(format!("{key} must be a non-empty string or null")),
                    }
                };
                let color = nullable_text("colorScheme")?;
                let profile_id = nullable_text("highlightProfileId")?;
                if let Some(id) = &profile_id {
                    if !builtin_ids().contains(id) && !profiles_on(&connection)?.syntax_highlight_profiles.iter().any(|p| &p.id == id) {
                        return Err(format!("Keyword-highlighting profile {id} was not found"));
                    }
                }
                let browser_json = if let Some(browser) = patch.get("fileBrowser") {
                    let panes = browser.as_object().filter(|p| !p.is_empty()).ok_or("fileBrowser must contain a pane patch")?;
                    let mut current = serde_json::to_value(saved.file_browser_view_options.unwrap_or_default()).map_err(|e| e.to_string())?;
                    for (pane, update) in panes {
                        if !matches!(pane.as_str(),"local"|"remote") {return Err(format!("Unknown browser pane {pane}"));}
                        let update = update.as_object().filter(|p| !p.is_empty()).ok_or("Browser pane patch must not be empty")?;
                        if !current[pane].is_object() {current[pane] = json!({});}
                        for (key,value) in update {
                            match key.as_str() {
                                "background" => {
                                    let bg: Option<crate::dashboard_storage::DashboardBackground> = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
                                    terminal_background_to_json(&bg)?;
                                    current[pane][key] = serde_json::to_value(bg).map_err(|e| e.to_string())?;
                                }
                                "zoom" if value.as_f64().is_some_and(|v| (0.5..=2.0).contains(&v)) => {current[pane][key] = value.clone();}
                                _ => return Err(format!("Invalid browser appearance field {key}")),
                            }
                        }
                    }
                    let options: FileBrowserViewOptions = serde_json::from_value(current).map_err(|e| e.to_string())?;
                    file_browser_view_options_to_json(&Some(options))?
                } else {None};
                // All fields validate before the single atomic UPDATE. Omitted columns
                // are preserved byte-for-byte, including other browser-pane settings.
                connection.execute("UPDATE connections SET
                    terminal_background_json=CASE WHEN ?1 THEN ?2 ELSE terminal_background_json END,
                    terminal_opacity=CASE WHEN ?3 THEN ?4 ELSE terminal_opacity END,
                    terminal_color_scheme=CASE WHEN ?5 THEN ?6 ELSE terminal_color_scheme END,
                    terminal_syntax_highlight_profile_id=CASE WHEN ?7 THEN ?8 ELSE terminal_syntax_highlight_profile_id END,
                    file_browser_view_options_json=CASE WHEN ?9 THEN ?10 ELSE file_browser_view_options_json END
                    WHERE id=?11",
                    params![patch.contains_key("background"),background_json,patch.contains_key("opacity"),opacity,
                        patch.contains_key("colorScheme"),color,patch.contains_key("highlightProfileId"),profile_id,
                        patch.contains_key("fileBrowser"),browser_json,id]).map_err(to_storage_error)?;
                serde_json::to_value(get_connection_by_id(&connection,id)?).map_err(|e| e.to_string())
            }
            "create_profile" | "update_profile" | "delete_profile" => {
                let mut settings = profiles_on(&connection)?;
                let id = required(&request,"id")?;
                if id.starts_with("builtin:") {return Err("Built-in keyword-highlighting profiles are immutable; copy one first".into());}
                let index = settings.syntax_highlight_profiles.iter().position(|p| p.id == id);
                if action == "create_profile" {
                    if index.is_some() {return Err("Profile ID already exists".into());}
                } else {
                    let index = index.ok_or("Keyword-highlighting profile was not found")?;
                    let current = serde_json::to_value(&settings.syntax_highlight_profiles[index]).map_err(|e| e.to_string())?;
                    if request.get("expectedProfile") != Some(&current) {return Err("Profile changed since it was read; read it again before updating".into());}
                }
                if action == "delete_profile" {
                    let uses = references(&connection)?.into_iter().filter(|r| r["profileId"] == id).collect::<Vec<_>>();
                    if !uses.is_empty() {return Err(format!("Profile is still in use: {}", json!(uses)));}
                    settings.syntax_highlight_profiles.remove(index.unwrap());
                } else {
                    let profile: TerminalSyntaxHighlightProfile = serde_json::from_value(request.get("profile").cloned().ok_or("profile is required")?).map_err(|e| e.to_string())?;
                    if profile.id != id {return Err("Profile IDs do not match".into());}
                    if settings.syntax_highlight_profiles.iter().any(|p| p.id != id && p.name.to_lowercase() == profile.name.to_lowercase()) {
                        return Err("A custom profile with this name already exists".into());
                    }
                    if let Some(index) = index { settings.syntax_highlight_profiles[index] = profile; }
                    else {settings.syntax_highlight_profiles.push(profile);}
                }
                let settings = validate_terminal_settings(settings)?;
                let value = serde_json::to_string(&settings).map_err(|e| e.to_string())?;
                connection.execute("INSERT INTO settings(key,value,updated_at) VALUES('terminal',?1,CURRENT_TIMESTAMP)
                    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP", params![value]).map_err(to_storage_error)?;
                Ok(json!({"settings":settings}))
            }
            _ => Err(format!("Unknown appearance data operation: {action}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Storage {
        let path = std::env::temp_dir().join(format!("kkterm-appearance-{}-{}.db",std::process::id(),SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap().as_nanos()));
        Storage::open(path).unwrap()
    }
    fn create_connection(storage: &Storage, kind: &str) -> SavedConnection {
        storage.create_connection(serde_json::from_value(json!({"name":"Keep my server","type":kind,"host":"example.invalid","user":"operator","port":22})).unwrap()).unwrap()
    }
    fn profile(id: &str, name: &str) -> Value {
        json!({"id":id,"name":name,"caseSensitive":false,"rules":[{"id":"rule1","name":"Error","pattern":"ERROR","enabled":true,"style":{"fontFamily":null,"foreground":"#FF0000","background":null,"bold":false,"italic":false}}]})
    }
    #[test]
    fn connection_patch_is_atomic_preserves_transport_and_supports_names_and_null() {
        let storage = fixture(); let saved = create_connection(&storage,"ssh");
        let id = saved.id;
        let result = storage.appearance_data(json!({"action":"patch_connection","connectionId":id,"patch":{"background":{"kind":"dynamic","dynamic":"Misty Sea"},"opacity":72}})).unwrap();
        assert_eq!(result["terminalBackground"]["dynamic"],"mistySea");
        assert_eq!(result["host"],"example.invalid"); assert_eq!(result["user"],"operator");
        assert!(storage.appearance_data(json!({"action":"patch_connection","connectionId":id,"patch":{"opacity":10,"background":{"kind":"dynamic","dynamic":"not a scene"}}})).is_err());
        assert_eq!(storage.get_connection(&id).unwrap().terminal_opacity,Some(72));
        let cleared = storage.appearance_data(json!({"action":"patch_connection","connectionId":id,"patch":{"background":null}})).unwrap();
        assert!(cleared["terminalBackground"].is_null()); assert_eq!(cleared["terminalOpacity"],72);
        assert!(storage.appearance_data(json!({"action":"patch_connection","connectionId":id,"patch":{"host":"replacement"}})).is_err());
    }
    #[test]
    fn browser_patch_keeps_other_pane_and_zoom() {
        let storage = fixture(); let saved = create_connection(&storage,"ssh");
        storage.appearance_data(json!({"action":"patch_connection","connectionId":saved.id,"patch":{"fileBrowser":{"local":{"zoom":1.2},"remote":{"background":{"kind":"dynamic","dynamic":"Misty Sea"}}}}})).unwrap();
        let result = storage.appearance_data(json!({"action":"patch_connection","connectionId":saved.id,"patch":{"fileBrowser":{"remote":{"background":null}}}})).unwrap();
        assert_eq!(result["fileBrowserViewOptions"]["local"]["zoom"],1.2);
        assert!(result["fileBrowserViewOptions"]["remote"]["background"].is_null());
    }
    #[test]
    fn profiles_merge_latest_settings_use_compare_and_swap_and_refuse_in_use_deletion() {
        let storage = fixture(); let original = profile("custom:one","Mine");
        storage.appearance_data(json!({"action":"create_profile","id":"custom:one","profile":original})).unwrap();
        let mut settings = storage.terminal_settings().unwrap(); settings.font_size = 21;
        storage.update_terminal_settings(settings).unwrap();
        let updated = profile("custom:one","Mine edited");
        storage.appearance_data(json!({"action":"update_profile","id":"custom:one","expectedProfile":original,"profile":updated})).unwrap();
        assert_eq!(storage.terminal_settings().unwrap().font_size,21);
        assert!(storage.appearance_data(json!({"action":"update_profile","id":"custom:one","expectedProfile":original,"profile":profile("custom:one","stale")})).is_err());
        let saved = create_connection(&storage,"ssh");
        storage.appearance_data(json!({"action":"patch_connection","connectionId":saved.id,"patch":{"highlightProfileId":"custom:one"}})).unwrap();
        assert!(storage.appearance_data(json!({"action":"delete_profile","id":"custom:one","expectedProfile":updated})).is_err());
        storage.appearance_data(json!({"action":"patch_connection","connectionId":saved.id,"patch":{"highlightProfileId":null}})).unwrap();
        storage.appearance_data(json!({"action":"delete_profile","id":"custom:one","expectedProfile":updated})).unwrap();
        assert!(storage.terminal_settings().unwrap().syntax_highlight_profiles.is_empty());
        assert!(storage.appearance_data(json!({"action":"create_profile","id":"builtin:cisco-ios","profile":profile("builtin:cisco-ios","Replacement")})).is_err());
    }
    #[test]
    fn validates_profile_ids_connection_types_and_patch_bounds_before_writing() {
        let storage = fixture(); let saved = create_connection(&storage,"ssh");
        for patch in [json!({"highlightProfileId":"missing"}),json!({"opacity":101}),json!({"opacity":10.5}),json!({})] {
            assert!(storage.appearance_data(json!({"action":"patch_connection","connectionId":saved.id,"patch":patch})).is_err());
        }
        storage.appearance_data(json!({"action":"patch_connection","connectionId":saved.id,"patch":{"highlightProfileId":"builtin:cisco-ios"}})).unwrap();
        let document = create_connection(&storage,"fileView");
        assert!(storage.appearance_data(json!({"action":"patch_connection","connectionId":document.id,"patch":{"opacity":30}})).is_err());
    }
}
