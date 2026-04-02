fn main() {
    // In debug builds, swap the app icon with the dev icon.
    // PROFILE env var reflects the target profile (debug/release),
    // unlike #[cfg(debug_assertions)] which checks the build script's profile.
    let profile = std::env::var("PROFILE").unwrap_or_default();
    let dev_icon = std::path::Path::new("icons/icon-dev.icns");
    let prod_icon = std::path::Path::new("icons/icon-prod.icns");
    let active_icon = std::path::Path::new("icons/icon.icns");

    if profile == "debug" && dev_icon.exists() && prod_icon.exists() {
        let _ = std::fs::copy(dev_icon, active_icon);
    } else if profile == "release" && prod_icon.exists() {
        let _ = std::fs::copy(prod_icon, active_icon);
    }

    tauri_build::build();
}
