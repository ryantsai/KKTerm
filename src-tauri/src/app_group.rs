use std::path::PathBuf;

pub const APP_GROUP_IDENTIFIER: &str = "group.com.kkterm.app";

/// Resolve the shared container used by the sandboxed Mac App Store app and
/// its separately provisioned CLI helper. Developer ID and non-macOS builds do
/// not carry the App Group entitlement, so callers fall back to app data.
#[cfg(target_os = "macos")]
pub fn shared_container_dir() -> Option<PathBuf> {
    use objc2_foundation::{NSFileManager, NSString};

    let identifier = NSString::from_str(APP_GROUP_IDENTIFIER);
    let url = NSFileManager::defaultManager()
        .containerURLForSecurityApplicationGroupIdentifier(&identifier)?;
    let path = url.path()?;
    Some(PathBuf::from(path.to_string()))
}

#[cfg(not(target_os = "macos"))]
pub fn shared_container_dir() -> Option<PathBuf> {
    None
}
