use std::path::PathBuf;

#[cfg(all(target_os = "macos", feature = "mac-app-store"))]
pub const APP_GROUP_IDENTIFIER: &str = "group.com.kkterm.app";

/// Resolve the shared container used by the sandboxed Mac App Store app and
/// its separately provisioned CLI helper. Developer ID and non-macOS builds do
/// not carry the App Group entitlement, so callers fall back to app data.
/// Gate the lookup by build flavor: Foundation can return a group path even
/// without the entitlement, making the app and CLI disagree on fresh installs.
#[cfg(all(target_os = "macos", feature = "mac-app-store"))]
pub fn shared_container_dir() -> Option<PathBuf> {
    use objc2_foundation::{NSFileManager, NSString};

    let identifier = NSString::from_str(APP_GROUP_IDENTIFIER);
    let url = NSFileManager::defaultManager()
        .containerURLForSecurityApplicationGroupIdentifier(&identifier)?;
    let path = url.path()?;
    Some(PathBuf::from(path.to_string()))
}

#[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
pub fn shared_container_dir() -> Option<PathBuf> {
    None
}

#[cfg(test)]
mod tests {
    #[test]
    #[cfg(not(all(target_os = "macos", feature = "mac-app-store")))]
    fn non_store_builds_always_use_app_data() {
        assert_eq!(super::shared_container_dir(), None);
    }
}
