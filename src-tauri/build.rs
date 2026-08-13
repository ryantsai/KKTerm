fn main() {
    println!("cargo:rerun-if-env-changed=KKTERM_CUSTOM_MODULE_CATALOG_PUBLIC_KEY");
    let catalog_public_key = std::env::var("KKTERM_CUSTOM_MODULE_CATALOG_PUBLIC_KEY")
        .unwrap_or_else(|_| {
            "0000000000000000000000000000000000000000000000000000000000000000".into()
        });
    println!("cargo:rustc-env=KKTERM_CUSTOM_MODULE_CATALOG_PUBLIC_KEY={catalog_public_key}");
    let permission_source = include_str!("permissions/main.toml");
    let mut in_commands = false;
    let commands = permission_source
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            if line == "commands.allow = [" {
                in_commands = true;
                return None;
            }
            if in_commands && line == "]" {
                in_commands = false;
                return None;
            }
            in_commands
                .then(|| line.trim_end_matches(',').trim_matches('"'))
                .filter(|command| !command.is_empty())
        })
        .collect::<Vec<_>>();
    let commands: &'static [&'static str] = Box::leak(commands.into_boxed_slice());
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("failed to build Tauri application manifest");
}
