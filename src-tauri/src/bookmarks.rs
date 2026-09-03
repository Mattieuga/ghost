//! macOS bookmarks identify a mirrored root by more than its path. Finder
//! aliases use the same mechanism, so a renamed or moved folder on the same
//! volume keeps resolving. Data travels to the frontend as base64.

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct ResolvedBookmark {
    pub path: String,
    /// The system suggests refreshing the bookmark data.
    pub stale: bool,
}

#[cfg(target_os = "macos")]
pub fn create_bookmark(path: &str) -> Result<Vec<u8>, String> {
    use objc2_foundation::{NSString, NSURL, NSURLBookmarkCreationOptions};

    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::empty(),
            None,
            None,
        )
        .map_err(|error| error.localizedDescription().to_string())?;
    Ok(data.to_vec())
}

#[cfg(target_os = "macos")]
pub fn resolve_bookmark(bytes: &[u8]) -> Result<ResolvedBookmark, String> {
    use objc2::runtime::Bool;
    use objc2_foundation::{NSData, NSURL, NSURLBookmarkResolutionOptions};

    let data = NSData::with_bytes(bytes);
    let mut stale = Bool::NO;
    // SAFETY: `stale` is a valid pointer for the duration of the call.
    let url = unsafe {
        NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            &data,
            NSURLBookmarkResolutionOptions::WithoutUI,
            None,
            &mut stale,
        )
    }
    .map_err(|error| error.localizedDescription().to_string())?;
    let path = url
        .path()
        .map(|path| path.to_string())
        .ok_or_else(|| "The bookmark did not resolve to a file path".to_string())?;
    Ok(ResolvedBookmark { path, stale: stale.as_bool() })
}

#[cfg(not(target_os = "macos"))]
pub fn create_bookmark(_path: &str) -> Result<Vec<u8>, String> {
    Err("Folder bookmarks are only available on macOS".to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn resolve_bookmark(_bytes: &[u8]) -> Result<ResolvedBookmark, String> {
    Err("Folder bookmarks are only available on macOS".to_string())
}

#[tauri::command]
pub fn create_folder_bookmark(path: String) -> Result<String, String> {
    Ok(STANDARD.encode(create_bookmark(&path)?))
}

#[tauri::command]
pub fn resolve_folder_bookmark(bookmark: String) -> Result<ResolvedBookmark, String> {
    let bytes = STANDARD
        .decode(bookmark.as_bytes())
        .map_err(|error| format!("The bookmark is not valid base64: {error}"))?;
    resolve_bookmark(&bytes)
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn a_bookmark_survives_renaming_the_folder() {
        let base = std::env::temp_dir().join(format!("ghost-bookmark-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let original = base.join("Notes");
        fs::create_dir_all(&original).unwrap();

        let bookmark = create_bookmark(original.to_str().unwrap()).unwrap();
        let renamed = base.join("Renamed Notes");
        fs::rename(&original, &renamed).unwrap();

        let resolved = resolve_bookmark(&bookmark).unwrap();
        let expected = fs::canonicalize(&renamed).unwrap();
        assert_eq!(fs::canonicalize(&resolved.path).unwrap(), expected);

        let encoded = STANDARD.encode(&bookmark);
        assert_eq!(resolve_folder_bookmark(encoded).unwrap().path, resolved.path);

        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn a_deleted_folder_fails_to_resolve() {
        let base = std::env::temp_dir().join(format!("ghost-bookmark-gone-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let folder = base.join("Gone");
        fs::create_dir_all(&folder).unwrap();
        let bookmark = create_bookmark(folder.to_str().unwrap()).unwrap();
        fs::remove_dir_all(&base).unwrap();

        assert!(resolve_bookmark(&bookmark).is_err());
    }
}
