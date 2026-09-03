//! Facts about a folder the user wants to sync. The rules that turn these
//! into refuse, warn, or exclude verdicts live in the frontend
//! (`src/lib/mirror/preflight.ts`) so they are one table, tested once.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Version-control markers. A folder with one of these above it is refused;
/// one found below it is excluded from sync.
pub const VCS_MARKERS: &[&str] = &[
    ".git", ".hg", ".svn", ".jj", ".sl", ".bzr", ".fossil", "_darcs", ".pijul",
];

/// Markers of other apps that manage a folder. Found below: excluded with a
/// notice. Found above: the folder is inside another sync service.
pub const MANAGED_MARKERS: &[&str] = &[".obsidian", ".stfolder", ".sync", ".dropbox", ".dropbox.cache"];

/// Build output nobody wants mirrored. Skipped silently during the scan.
pub const BUILD_MARKERS: &[&str] = &[
    "node_modules", ".venv", "target", "dist", "build", ".cache", "DerivedData", "Pods",
];

const SCAN_ENTRY_LIMIT: u64 = 250_000;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MarkerHit {
    pub path: String,
    pub marker: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SyncCandidate {
    pub path: String,
    pub canonical_path: String,
    pub home: String,
    pub app_data_dir: Option<String>,
    pub is_directory: bool,
    pub is_package: bool,
    pub writable: bool,
    /// The folder itself or an ancestor carries a version-control marker.
    pub ancestor_vcs: Vec<MarkerHit>,
    /// The folder itself or an ancestor is managed by another sync app.
    pub ancestor_managed: Vec<MarkerHit>,
    /// Version-control roots found below the folder.
    pub descendant_vcs: Vec<MarkerHit>,
    /// Other apps' managed folders found below the folder.
    pub descendant_managed: Vec<MarkerHit>,
    /// Sync service inferred from the path, e.g. iCloud Drive or Dropbox.
    pub sync_service: Option<String>,
    pub external_volume: bool,
    pub file_count: u64,
    pub byte_count: u64,
    pub markdown_count: u64,
    /// True when the scan stopped at its entry limit; counts are lower bounds.
    pub scan_truncated: bool,
}

fn is_markdown(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

#[cfg(target_os = "macos")]
fn is_file_package(path: &Path) -> bool {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::NSString;

    let path = NSString::from_str(&path.to_string_lossy());
    NSWorkspace::sharedWorkspace().isFilePackageAtPath(&path)
}

#[cfg(not(target_os = "macos"))]
fn is_file_package(_path: &Path) -> bool {
    false
}

fn is_writable(path: &Path) -> bool {
    let probe = path.join(format!(".ghost-probe-{}.tmp", std::process::id()));
    match fs::OpenOptions::new().write(true).create_new(true).open(&probe) {
        Ok(_) => {
            let _ = fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Markers on the folder itself and every ancestor, nearest first.
pub fn ancestor_markers(path: &Path, markers: &[&str]) -> Vec<MarkerHit> {
    let mut hits = Vec::new();
    let mut current: Option<&Path> = Some(path);
    while let Some(dir) = current {
        for marker in markers {
            if dir.join(marker).exists() {
                hits.push(MarkerHit { path: dir.to_string_lossy().to_string(), marker: (*marker).to_string() });
            }
        }
        current = dir.parent();
    }
    hits
}

pub fn sync_service_for(path: &Path, home: &Path) -> Option<String> {
    let text = path.to_string_lossy();
    let home_text = home.to_string_lossy();
    if text.starts_with(&format!("{home_text}/Library/Mobile Documents")) {
        return Some("iCloud Drive".to_string());
    }
    if let Some(rest) = text.strip_prefix(&format!("{home_text}/Library/CloudStorage/")) {
        let provider = rest.split('/').next().unwrap_or("");
        let name = provider.split('-').next().unwrap_or(provider);
        return Some(if name.is_empty() { "a cloud storage provider".to_string() } else { name.to_string() });
    }
    if text.starts_with(&format!("{home_text}/Dropbox")) {
        return Some("Dropbox".to_string());
    }
    if text.starts_with(&format!("{home_text}/Google Drive")) {
        return Some("Google Drive".to_string());
    }
    None
}

#[derive(Default)]
struct ScanTotals {
    entries: u64,
    files: u64,
    bytes: u64,
    markdown: u64,
    vcs: Vec<MarkerHit>,
    managed: Vec<MarkerHit>,
    truncated: bool,
}

fn scan(dir: &Path, totals: &mut ScanTotals) {
    if totals.truncated {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        totals.entries += 1;
        if totals.entries > SCAN_ENTRY_LIMIT {
            totals.truncated = true;
            return;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() {
            continue;
        }
        if VCS_MARKERS.contains(&name.as_str()) {
            totals.vcs.push(MarkerHit { path: dir.to_string_lossy().to_string(), marker: name });
            continue;
        }
        if MANAGED_MARKERS.contains(&name.as_str()) {
            totals.managed.push(MarkerHit { path: dir.to_string_lossy().to_string(), marker: name });
            continue;
        }
        if file_type.is_dir() {
            if BUILD_MARKERS.contains(&name.as_str()) || name == super::fs::GHOST_METADATA_DIR {
                continue;
            }
            if is_file_package(&path) {
                totals.files += 1;
                continue;
            }
            scan(&path, totals);
        } else if file_type.is_file() {
            totals.files += 1;
            totals.bytes += entry.metadata().map(|metadata| metadata.len()).unwrap_or(0);
            if is_markdown(&name) {
                totals.markdown += 1;
            }
        }
    }
}

pub fn inspect(path: &Path, home: &Path, app_data_dir: Option<PathBuf>) -> SyncCandidate {
    inspect_with_depth(path, home, app_data_dir, true)
}

/// `deep` scans below the folder for counts and markers; the resolve flow
/// only needs the ancestor facts and passes false.
pub fn inspect_with_depth(path: &Path, home: &Path, app_data_dir: Option<PathBuf>, deep: bool) -> SyncCandidate {
    let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    // macOS resolves /var and /tmp through /private; compare like with like.
    let home_owned = fs::canonicalize(home).unwrap_or_else(|_| home.to_path_buf());
    let home = home_owned.as_path();
    let is_directory = canonical.is_dir();
    let is_package = is_directory && is_file_package(&canonical);
    let mut totals = ScanTotals::default();
    if deep && is_directory && !is_package {
        scan(&canonical, &mut totals);
    }
    // Markers on the folder itself are ancestor facts, not descendants.
    let self_path = canonical.to_string_lossy().to_string();
    totals.vcs.retain(|hit| hit.path != self_path);
    totals.managed.retain(|hit| hit.path != self_path);

    #[cfg(unix)]
    let external_volume = {
        use std::os::unix::fs::MetadataExt;
        let home_device = fs::metadata(home).map(|metadata| metadata.dev()).ok();
        let path_device = fs::metadata(&canonical).map(|metadata| metadata.dev()).ok();
        canonical.starts_with("/Volumes") || (home_device.is_some() && home_device != path_device)
    };
    #[cfg(not(unix))]
    let external_volume = false;

    SyncCandidate {
        path: path.to_string_lossy().to_string(),
        canonical_path: canonical.to_string_lossy().to_string(),
        home: home.to_string_lossy().to_string(),
        app_data_dir: app_data_dir.map(|dir| dir.to_string_lossy().to_string()),
        is_directory,
        is_package,
        writable: is_directory && !is_package && is_writable(&canonical),
        ancestor_vcs: ancestor_markers(&canonical, VCS_MARKERS),
        ancestor_managed: ancestor_markers(&canonical, MANAGED_MARKERS),
        descendant_vcs: totals.vcs,
        descendant_managed: totals.managed,
        sync_service: sync_service_for(&canonical, home),
        external_volume,
        file_count: totals.files,
        byte_count: totals.bytes,
        markdown_count: totals.markdown,
        scan_truncated: totals.truncated,
    }
}

#[tauri::command]
pub async fn inspect_sync_candidate(app: AppHandle, path: String, deep: Option<bool>) -> Result<SyncCandidate, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|error| format!("Could not find the home folder: {error}"))?;
    let app_data_dir = app.path().app_data_dir().ok();
    Ok(inspect_with_depth(Path::new(&path), &home, app_data_dir, deep.unwrap_or(true)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ghost-sync-candidate-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::canonicalize(&dir).unwrap()
    }

    #[test]
    fn reports_vcs_above_and_below_plus_counts() {
        let root = scratch("vcs");
        let repo = root.join("repo");
        fs::create_dir_all(repo.join("notes").join("deep")).unwrap();
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::write(repo.join("notes").join("a.md"), "# a").unwrap();
        fs::write(repo.join("notes").join("deep").join("b.markdown"), "# b").unwrap();
        fs::write(repo.join("notes").join("c.txt"), "c").unwrap();
        fs::create_dir_all(repo.join("notes").join("vendor").join(".hg")).unwrap();
        fs::create_dir_all(repo.join("notes").join("node_modules").join("x")).unwrap();
        fs::write(repo.join("notes").join("node_modules").join("x").join("ignored.md"), "no").unwrap();

        let inside = inspect(&repo.join("notes"), &root, None);
        assert_eq!(inside.ancestor_vcs.len(), 1);
        assert_eq!(inside.ancestor_vcs[0].marker, ".git");
        assert_eq!(inside.descendant_vcs, vec![MarkerHit {
            path: repo.join("notes").join("vendor").to_string_lossy().to_string(),
            marker: ".hg".to_string(),
        }]);
        assert_eq!(inside.markdown_count, 2);
        assert_eq!(inside.file_count, 3);
        assert!(inside.writable);
        assert!(inside.is_directory);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn flags_other_sync_services_and_managed_folders() {
        let home = scratch("home");
        let icloud = home.join("Library").join("Mobile Documents").join("com~apple~CloudDocs").join("Notes");
        fs::create_dir_all(&icloud).unwrap();
        let drive = home.join("Library").join("CloudStorage").join("GoogleDrive-me@example.com").join("Docs");
        fs::create_dir_all(&drive).unwrap();
        let vault = home.join("Vault");
        fs::create_dir_all(vault.join(".obsidian")).unwrap();
        fs::create_dir_all(vault.join("sub").join(".stfolder")).unwrap();

        assert_eq!(inspect(&icloud, &home, None).sync_service.as_deref(), Some("iCloud Drive"));
        assert_eq!(inspect(&drive, &home, None).sync_service.as_deref(), Some("GoogleDrive"));
        let vault_facts = inspect(&vault, &home, None);
        assert_eq!(vault_facts.ancestor_managed[0].marker, ".obsidian");
        assert_eq!(vault_facts.descendant_managed[0].marker, ".stfolder");
        assert!(vault_facts.sync_service.is_none());

        let _ = fs::remove_dir_all(&home);
    }

    #[test]
    fn a_missing_path_is_not_a_directory() {
        let facts = inspect(Path::new("/definitely/not/here"), Path::new("/tmp"), None);
        assert!(!facts.is_directory);
        assert!(!facts.writable);
        assert_eq!(facts.file_count, 0);
    }
}
