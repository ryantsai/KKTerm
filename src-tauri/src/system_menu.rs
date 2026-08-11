use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(not(any(target_os = "macos", target_os = "linux")), allow(dead_code))]
pub struct SystemFileMenuLabels {
    file_menu: String,
    open: String,
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
const OPEN_ITEM_ID: &str = "kkterm-system-open";

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn install_handler(app: &tauri::App) {
    app.on_menu_event(|app, event| match event.id().as_ref() {
        OPEN_ITEM_ID => crate::launch_paths::open_file_picker(app),
        _ => {}
    });
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn install_handler(_app: &tauri::App) {}

#[cfg(any(target_os = "macos", target_os = "linux"))]
pub fn update(app: &tauri::AppHandle, labels: SystemFileMenuLabels) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};

    let menu = Menu::default(app).map_err(|error| error.to_string())?;
    let file_menu = Submenu::new(app, labels.file_menu, true).map_err(|error| error.to_string())?;
    let open = MenuItem::with_id(app, OPEN_ITEM_ID, labels.open, true, None::<&str>)
        .map_err(|error| error.to_string())?;

    file_menu
        .append_items(&[
            &open,
            &PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?,
            &PredefinedMenuItem::close_window(app, None).map_err(|error| error.to_string())?,
        ])
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "linux")]
    {
        file_menu
            .append(&PredefinedMenuItem::separator(app).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
        file_menu
            .append(&PredefinedMenuItem::quit(app, None).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
        menu.prepend(&file_menu)
            .map_err(|error| error.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        // Tauri's default macOS menu always places File after the application
        // menu. Replace it so the remaining native application/Edit/View/
        // Window/Help menus retain their standard behavior.
        menu.remove_at(1).map_err(|error| error.to_string())?;
        menu.insert(&file_menu, 1)
            .map_err(|error| error.to_string())?;
    }

    app.set_menu(menu)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub fn update(_app: &tauri::AppHandle, _labels: SystemFileMenuLabels) -> Result<(), String> {
    Ok(())
}
