fn main() {
    // In debug builds, swap the app icon with the dev icon
    #[cfg(debug_assertions)]
    {
        let dev_icon = std::path::Path::new("icons/icon-dev.icns");
        let prod_icon = std::path::Path::new("icons/icon.icns");
        let backup = std::path::Path::new("icons/icon-prod.icns");

        if dev_icon.exists() && !backup.exists() {
            // Back up production icon, then swap in dev icon
            let _ = std::fs::copy(prod_icon, backup);
            let _ = std::fs::copy(dev_icon, prod_icon);
        }
    }

    tauri_build::build();
}
