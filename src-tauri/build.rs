const DEFAULT_CUSTOM_MODULE_CATALOG_PUBLIC_KEY: &str =
    "16e4c35d77a52dcefca62fed9f5fea8874a8790f212f9a81be9bcd04222eaabc";
const DEFAULT_CUSTOM_MODULE_CATALOG_URL: &str =
    "https://modules.kkterm.ryantsai.com/catalog/v2/catalog.json";

fn main() {
    if std::env::var_os("CARGO_FEATURE_MAC_APP_STORE").is_some() {
        assert_eq!(std::env::var("CARGO_CFG_TARGET_OS").as_deref(), Ok("macos"),
            "mac-app-store is only supported on macOS");
    }
    // The macOS SDK stubs for some frameworks (CoreMedia on the x86_64 slice
    // with a deployment target below macOS 10.14.4) re-export the framework's
    // Swift overlay as `@rpath/libswift*.dylib`, even when the binary
    // references no Swift symbol. dyld cannot substitute `@rpath` without an
    // LC_RPATH, so the universal build's Intel slice aborted at launch with
    // "Library not loaded: @rpath/libswiftCoreMedia.dylib", while the arm64
    // slice (11.0 deployment target) linked the plain framework. Point @rpath
    // lookups at the system Swift runtime directory the OS ships, matching what
    // Xcode does for any Swift-linked target. The package step verifies the
    // dependency is resolvable; see docs/RELEASE.md.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rustc-link-arg-bins=-Wl,-rpath,/usr/lib/swift");
    }
    println!("cargo:rerun-if-changed=../.env");
    let _ = dotenvy::from_path("../.env");
    println!("cargo:rerun-if-env-changed=KKTERM_CUSTOM_MODULE_CATALOG_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=KKTERM_CUSTOM_MODULE_CATALOG_URL");
    let catalog_public_key = std::env::var("KKTERM_CUSTOM_MODULE_CATALOG_PUBLIC_KEY")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_CUSTOM_MODULE_CATALOG_PUBLIC_KEY.into());
    println!("cargo:rustc-env=KKTERM_CUSTOM_MODULE_CATALOG_PUBLIC_KEY={catalog_public_key}");
    let catalog_url = std::env::var("KKTERM_CUSTOM_MODULE_CATALOG_URL")
        .unwrap_or_else(|_| DEFAULT_CUSTOM_MODULE_CATALOG_URL.into())
        .trim()
        .to_owned();
    println!("cargo:rustc-env=KKTERM_CUSTOM_MODULE_CATALOG_URL={catalog_url}");
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
