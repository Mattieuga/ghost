use serde::Serialize;
use std::fs;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use pulldown_cmark::{Parser, Options, html};
use tauri::{Manager, State};

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);
const TEXT_PROBE_BYTES: u64 = 64 * 1024;

#[cfg(unix)]
fn copy_extended_attributes(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    for name in xattr::list(source)? {
        if let Some(value) = xattr::get(source, &name)? {
            xattr::set(destination, &name, &value)?;
        }
    }
    Ok(())
}

#[cfg(not(unix))]
fn copy_extended_attributes(_source: &Path, _destination: &Path) -> Result<(), std::io::Error> {
    Ok(())
}

pub struct FileWriteState(pub Mutex<()>);

impl FileWriteState {
    pub fn new() -> Self {
        Self(Mutex::new(()))
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum WriteFileError {
    Conflict { message: String },
    Io { message: String },
}

impl WriteFileError {
    fn io(error: impl std::fmt::Display) -> Self {
        Self::Io { message: error.to_string() }
    }
}

/// Reject names containing path separators or traversal components
fn validate_name(name: &str) -> Result<(), String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") || name.is_empty() {
        return Err("Invalid name: must not contain path separators or be empty".to_string());
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub children: Option<Vec<FileEntry>>,
}

#[tauri::command]
pub async fn read_directory(path: String, extensions: Vec<String>, max_depth: Option<usize>) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);
    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }
    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let limit = max_depth.unwrap_or(32);
    read_dir_recursive(dir_path, &extensions, 0, limit).map_err(|e| e.to_string())
}

fn read_dir_recursive(dir: &Path, extensions: &[String], depth: usize, max_depth: usize) -> Result<Vec<FileEntry>, std::io::Error> {
    if depth >= max_depth {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();

    let mut dir_entries: Vec<_> = fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .collect();

    dir_entries.sort_by(|a, b| {
        let a_is_dir = a.file_type().map(|t| t.is_dir()).unwrap_or(false);
        let b_is_dir = b.file_type().map(|t| t.is_dir()).unwrap_or(false);
        match (a_is_dir, b_is_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.file_name().to_ascii_lowercase().cmp(&b.file_name().to_ascii_lowercase()),
        }
    });

    for entry in dir_entries {
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden files/directories
        if name.starts_with('.') {
            continue;
        }

        let path = entry.path();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);

        if is_dir {
            let children = read_dir_recursive(&path, extensions, depth + 1, max_depth)?;
            // Always show directories (even empty ones)
            entries.push(FileEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_directory: true,
                children: Some(children),
            });
        } else {
            // Filter by extension if extensions list is not empty
            if !extensions.is_empty() {
                let ext = path.extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("");
                if !extensions.iter().any(|e| e == ext) {
                    continue;
                }
            }
            entries.push(FileEntry {
                name,
                path: path.to_string_lossy().to_string(),
                is_directory: false,
                children: None,
            });
        }
    }

    Ok(entries)
}

#[tauri::command]
pub async fn is_directory(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).is_dir())
}

#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {}", e))
}

/// Read an otherwise-unknown file only when its contents look like UTF-8 text.
///
/// Returning `None` for binary data lets the frontend keep using the
/// unsupported-file viewer without treating arbitrary bytes as editable text.
#[tauri::command]
pub async fn read_file_if_text(path: String) -> Result<Option<String>, String> {
    let mut file = fs::File::open(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    let probe_limit = TEXT_PROBE_BYTES as usize;
    let mut probe = Vec::with_capacity(probe_limit + 1);
    Read::by_ref(&mut file)
        .take(TEXT_PROBE_BYTES + 1)
        .read_to_end(&mut probe)
        .map_err(|e| format!("Failed to probe file: {}", e))?;

    // Reading one byte past the sample boundary tells us whether this read
    // actually reached EOF. A metadata snapshot taken before the read cannot
    // safely answer that if a synced or externally edited file grows meanwhile.
    let sample = if probe.len() > probe_limit {
        &probe[..probe_limit]
    } else {
        &probe
    };
    let Some(probe_content) = decode_text_probe(sample) else {
        return Ok(None);
    };
    if !looks_like_text(probe_content) {
        return Ok(None);
    }

    if probe.len() <= probe_limit {
        return Ok(decode_text_bytes(&probe));
    }

    // The bounded sample looked textual. Only now load the complete file, and
    // still reject invalid UTF-8 or control-heavy content found after the probe.
    match fs::read_to_string(&path) {
        Ok(content) if looks_like_text(&content) => Ok(Some(content)),
        Ok(_) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::InvalidData => Ok(None),
        Err(error) => Err(format!("Failed to read file: {}", error)),
    }
}

fn decode_text_probe(bytes: &[u8]) -> Option<&str> {
    match std::str::from_utf8(bytes) {
        Ok(content) => Some(content),
        // A multibyte character may straddle the sample boundary. An incomplete
        // trailing sequence is safe to ignore, unlike invalid bytes in the body.
        Err(error) if error.error_len().is_none() && error.valid_up_to() > 0 => {
            std::str::from_utf8(&bytes[..error.valid_up_to()]).ok()
        }
        Err(_) => None,
    }
}

fn decode_text_bytes(bytes: &[u8]) -> Option<String> {
    let content = std::str::from_utf8(bytes).ok()?;
    if !looks_like_text(content) {
        return None;
    }
    Some(content.to_string())
}

fn looks_like_text(content: &str) -> bool {
    let mut character_count = 0usize;
    let mut suspicious_controls = 0usize;

    for character in content.chars() {
        character_count += 1;

        // NUL bytes are a particularly strong binary-file signal.
        if character == '\0' {
            return false;
        }

        if character.is_control() && !matches!(character, '\n' | '\r' | '\t' | '\u{000C}') {
            suspicious_controls += 1;
        }
    }

    // Permit an occasional control character (for example, ANSI escape codes
    // in a log) but reject control-heavy content.
    suspicious_controls == 0 || suspicious_controls.saturating_mul(100) <= character_count
}

/// List filenames in a directory (non-recursive, files only)
#[tauri::command]
pub async fn list_directory_files(path: String) -> Result<Vec<String>, String> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Ok(vec![]);
    }
    let mut files = Vec::new();
    let entries = fs::read_dir(dir).map_err(|e| format!("Failed to read directory: {}", e))?;
    for entry in entries.flatten() {
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                files.push(name.to_string());
            }
        }
    }
    Ok(files)
}

#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
pub async fn read_image_preview(path: String) -> Result<Vec<u8>, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read image: {}", e))?;
    let is_icns = Path::new(&path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("icns"));

    if is_icns {
        return render_icns_preview(&bytes);
    }

    Ok(bytes)
}

#[cfg(target_os = "macos")]
fn render_icns_preview(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use objc2::runtime::AnyObject;
    use objc2::AnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSData, NSDictionary};

    let data = NSData::with_bytes(bytes);
    let image = NSImage::initWithData(NSImage::alloc(), &data)
        .ok_or_else(|| "macOS could not decode this ICNS file".to_string())?;
    let tiff = image
        .TIFFRepresentation()
        .ok_or_else(|| "macOS could not render this ICNS file".to_string())?;
    let representations = NSBitmapImageRep::imageRepsWithData(&tiff).to_vec();
    let largest = representations
        .iter()
        .filter_map(|representation| {
            let object: &AnyObject = representation;
            object.downcast_ref::<NSBitmapImageRep>()
        })
        .max_by_key(|representation| {
            representation
                .pixelsWide()
                .saturating_mul(representation.pixelsHigh())
        })
        .ok_or_else(|| "The ICNS file does not contain a renderable image".to_string())?;

    let properties = NSDictionary::dictionary();
    let png = unsafe {
        largest.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
    }
    .ok_or_else(|| "macOS could not create an ICNS preview".to_string())?;

    Ok(png.to_vec())
}

#[cfg(not(target_os = "macos"))]
fn render_icns_preview(_bytes: &[u8]) -> Result<Vec<u8>, String> {
    Err("ICNS previews are currently supported on macOS only".to_string())
}

fn atomic_write_file(path: &Path, content: &str) -> Result<(), std::io::Error> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "File has no parent directory")
    })?;
    let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("document");
    let permissions = fs::metadata(path).ok().map(|metadata| metadata.permissions());

    let mut temporary = None;
    for _ in 0..100 {
        let suffix = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".ghost-{}-{}-{}.tmp", file_name, std::process::id(), suffix));
        match OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(file) => {
                temporary = Some((candidate, file));
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    let (temporary_path, mut temporary_file) = temporary.ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::AlreadyExists, "Could not create a temporary save file")
    })?;

    let result = (|| {
        if let Some(permissions) = permissions {
            temporary_file.set_permissions(permissions)?;
        }
        temporary_file.write_all(content.as_bytes())?;
        if path.exists() {
            // Atomic replacement creates a new inode. Copy Finder tags and
            // other extended metadata before the rename so a save does not
            // silently strip metadata from the user's file.
            copy_extended_attributes(path, &temporary_path)?;
        }
        temporary_file.sync_all()?;
        drop(temporary_file);
        fs::rename(&temporary_path, path)?;

        // Best effort: persist the directory entry as well as the file bytes.
        if let Ok(directory) = fs::File::open(parent) {
            let _ = directory.sync_all();
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

fn write_file_checked(
    path: &Path,
    content: &str,
    expected_content: Option<&str>,
    force: bool,
) -> Result<(), WriteFileError> {
    if !force {
        if let Some(expected) = expected_content {
            let current = fs::read_to_string(path).map_err(|error| {
                WriteFileError::io(format!("Failed to verify file before saving: {}", error))
            })?;
            if current != expected {
                return Err(WriteFileError::Conflict {
                    message: "The file changed on disk after Ghost opened it. Your edits have not been overwritten."
                        .to_string(),
                });
            }
        }
    }

    atomic_write_file(path, content)
        .map_err(|error| WriteFileError::io(format!("Failed to save file: {}", error)))
}

#[tauri::command]
pub fn write_file(
    state: State<'_, FileWriteState>,
    path: String,
    content: String,
    expected_content: Option<String>,
    force: Option<bool>,
) -> Result<(), WriteFileError> {
    let _write_guard = state
        .0
        .lock()
        .map_err(|_| WriteFileError::io("The save queue is unavailable"))?;
    write_file_checked(
        Path::new(&path),
        &content,
        expected_content.as_deref(),
        force.unwrap_or(false),
    )
}

#[tauri::command]
pub async fn create_file(dir: String, name: String) -> Result<String, String> {
    validate_name(&name)?;
    let file_path = Path::new(&dir).join(&name);
    if file_path.exists() {
        return Err(format!("File already exists: {}", file_path.display()));
    }
    fs::write(&file_path, "# Untitled\n").map_err(|e| format!("Failed to create file: {}", e))?;
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn create_directory(parent: String, name: String) -> Result<String, String> {
    validate_name(&name)?;
    let dir_path = Path::new(&parent).join(&name);
    if dir_path.exists() {
        return Err(format!("Directory already exists: {}", dir_path.display()));
    }
    fs::create_dir(&dir_path).map_err(|e| format!("Failed to create directory: {}", e))?;
    Ok(dir_path.to_string_lossy().to_string())
}

fn companion_assets_path_for_file_name(path: &Path) -> Option<PathBuf> {
    let stem = path.file_stem()?.to_string_lossy();
    Some(path.parent()?.join(format!("{}.assets", stem)))
}

fn companion_assets_path(path: &Path) -> Option<PathBuf> {
    path.is_file()
        .then(|| companion_assets_path_for_file_name(path))
        .flatten()
}

fn unused_backup_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path.parent().ok_or("Cannot determine backup directory")?;
    let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("item");
    for _ in 0..100 {
        let suffix = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(".ghost-backup-{}-{}-{}", name, std::process::id(), suffix));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    Err("Could not reserve a safe backup path".to_string())
}

fn restore_backup(backup: &Option<PathBuf>, destination: &Path) {
    if let Some(backup) = backup {
        if backup.exists() && !destination.exists() {
            let _ = fs::rename(backup, destination);
        }
    }
}

fn trash_backup(backup: Option<PathBuf>) {
    if let Some(backup) = backup {
        if backup.exists() {
            if let Err(error) = trash::delete(&backup) {
                // The replacement succeeded; retaining a hidden backup is safer
                // than permanently deleting it when Trash is unavailable.
                eprintln!("Warning: replacement backup retained at {}: {}", backup.display(), error);
            }
        }
    }
}

#[tauri::command]
pub async fn move_file(file_path: String, target_dir: String, force: Option<bool>) -> Result<String, String> {
    let source = Path::new(&file_path);
    if !source.exists() {
        return Err("Source no longer exists".to_string());
    }
    let file_name = source.file_name().ok_or("Cannot determine file name")?;
    let dest = Path::new(&target_dir).join(file_name);
    if source == dest {
        return Ok(dest.to_string_lossy().to_string());
    }

    let source_assets_path = companion_assets_path(source);
    let dest_assets = source_assets_path.as_ref().and_then(|assets| {
        assets.file_name().map(|name| Path::new(&target_dir).join(name))
    });
    let source_assets = source_assets_path.filter(|path| path.is_dir());
    let has_conflict = dest.exists() || dest_assets.as_ref().is_some_and(|path| path.exists());
    if has_conflict && !force.unwrap_or(false) {
        return Err("ALREADY_EXISTS".to_string());
    }

    let destination_backup = if dest.exists() {
        let backup = unused_backup_path(&dest)?;
        fs::rename(&dest, &backup).map_err(|error| format!("Failed to protect existing destination: {}", error))?;
        Some(backup)
    } else {
        None
    };

    let assets_backup = if let Some(dest_assets) = dest_assets.as_ref().filter(|path| path.exists()) {
        let backup = unused_backup_path(dest_assets)?;
        if let Err(error) = fs::rename(dest_assets, &backup) {
            restore_backup(&destination_backup, &dest);
            return Err(format!("Failed to protect existing assets: {}", error));
        }
        Some(backup)
    } else {
        None
    };

    if let Err(error) = fs::rename(source, &dest) {
        if let Some(dest_assets) = dest_assets.as_ref() {
            restore_backup(&assets_backup, dest_assets);
        }
        restore_backup(&destination_backup, &dest);
        return Err(format!("Failed to move file: {}", error));
    }

    if let (Some(source_assets), Some(dest_assets)) = (source_assets.as_ref(), dest_assets.as_ref()) {
        if let Err(error) = fs::rename(source_assets, dest_assets) {
            let _ = fs::rename(&dest, source);
            restore_backup(&assets_backup, dest_assets);
            restore_backup(&destination_backup, &dest);
            return Err(format!("Failed to move companion assets: {}", error));
        }
    }

    trash_backup(destination_backup);
    trash_backup(assets_backup);

    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn rename_file(old_path: String, new_name: String) -> Result<String, String> {
    validate_name(&new_name)?;
    let old = Path::new(&old_path);
    let old_is_file = old.is_file();
    let parent = old.parent().ok_or("Cannot determine parent directory")?;
    let new_path = parent.join(&new_name);
    if new_path.exists() {
        return Err(format!("A file with that name already exists: {}", new_path.display()));
    }
    let asset_rename = if old_is_file {
        match (old.file_stem(), Path::new(&new_name).file_stem()) {
            (Some(old_stem), Some(new_stem)) if old_stem != new_stem => {
                let old_name = format!("{}.assets", old_stem.to_string_lossy());
                let new_name = format!("{}.assets", new_stem.to_string_lossy());
                let old_assets = parent.join(&old_name);
                let new_assets = parent.join(&new_name);
                if old_assets.is_dir() {
                    if new_assets.exists() {
                        return Err(format!("Companion assets already exist: {}", new_assets.display()));
                    }
                    let content = fs::read_to_string(old)
                        .map_err(|error| format!("Failed to prepare asset references: {}", error))?;
                    Some((old_assets, new_assets, content.replace(&old_name, &new_name)))
                } else {
                    None
                }
            }
            _ => None,
        }
    } else {
        None
    };

    fs::rename(old, &new_path).map_err(|error| format!("Failed to rename: {}", error))?;

    if let Some((old_assets, new_assets, updated_content)) = asset_rename {
        if let Err(error) = fs::rename(&old_assets, &new_assets) {
            let _ = fs::rename(&new_path, old);
            return Err(format!("Failed to rename companion assets: {}", error));
        }
        if let Err(error) = atomic_write_file(&new_path, &updated_content) {
            let _ = fs::rename(&new_assets, &old_assets);
            let _ = fs::rename(&new_path, old);
            return Err(format!("Failed to update asset references: {}", error));
        }
    }

    Ok(new_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn delete_file(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    let mut items = vec![path.to_path_buf()];
    if let Some(assets) = companion_assets_path(path).filter(|assets| assets.is_dir()) {
        items.push(assets);
    }
    trash::delete_all(&items).map_err(|error| format!("Failed to move item to Trash: {}", error))
}

#[tauri::command]
pub async fn duplicate_file(path: String) -> Result<String, String> {
    let source = Path::new(&path);
    let parent = source.parent().ok_or("Cannot determine parent directory")?;

    if source.is_dir() {
        let dir_name = source.file_name().ok_or("Cannot determine folder name")?
            .to_string_lossy().to_string();
        let mut dest_name = format!("{} copy", dir_name);
        let mut counter = 1;
        let mut dest = parent.join(&dest_name);
        while dest.exists() {
            counter += 1;
            dest_name = format!("{} copy {}", dir_name, counter);
            dest = parent.join(&dest_name);
        }
        let staging = unused_backup_path(&dest)?;
        if let Err(error) = copy_dir_recursive(source, &staging) {
            remove_staging_path(&staging);
            return Err(error);
        }
        if let Err(error) = fs::rename(&staging, &dest) {
            remove_staging_path(&staging);
            return Err(format!("Failed to finish folder duplication: {}", error));
        }
        Ok(dest.to_string_lossy().to_string())
    } else {
        let stem = source.file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("file");
        let ext = source.extension()
            .and_then(|e| e.to_str())
            .map(|e| format!(".{}", e))
            .unwrap_or_default();
        let mut dest_name = format!("{} copy{}", stem, ext);
        let mut counter = 1;
        let mut dest = parent.join(&dest_name);
        let mut dest_assets = companion_assets_path_for_file_name(&dest);
        while dest.exists() || dest_assets.as_ref().is_some_and(|assets| assets.exists()) {
            counter += 1;
            dest_name = format!("{} copy {}{}", stem, counter, ext);
            dest = parent.join(&dest_name);
            dest_assets = companion_assets_path_for_file_name(&dest);
        }

        let source_assets = companion_assets_path(source).filter(|assets| assets.is_dir());
        let updated_content = if let (Some(source_assets), Some(dest_assets)) =
            (source_assets.as_ref(), dest_assets.as_ref())
        {
            let old_name = source_assets.file_name().and_then(|name| name.to_str())
                .ok_or("Cannot determine companion assets name")?;
            let new_name = dest_assets.file_name().and_then(|name| name.to_str())
                .ok_or("Cannot determine duplicated assets name")?;
            let content = fs::read_to_string(source)
                .map_err(|error| format!("Failed to prepare duplicated asset references: {}", error))?;
            Some(content.replace(old_name, new_name))
        } else {
            None
        };

        let staging_file = unused_backup_path(&dest)?;
        if let Err(error) = copy_file_with_metadata(source, &staging_file) {
            remove_staging_path(&staging_file);
            return Err(format!("Failed to duplicate file: {}", error));
        }
        if let Some(updated_content) = updated_content {
            if let Err(error) = atomic_write_file(&staging_file, &updated_content) {
                remove_staging_path(&staging_file);
                return Err(format!("Failed to update duplicated asset references: {}", error));
            }
        }

        let staging_assets = if let (Some(source_assets), Some(dest_assets)) =
            (source_assets.as_ref(), dest_assets.as_ref())
        {
            let staging = unused_backup_path(dest_assets)?;
            if let Err(error) = copy_dir_recursive(source_assets, &staging) {
                remove_staging_path(&staging_file);
                remove_staging_path(&staging);
                return Err(error);
            }
            Some(staging)
        } else {
            None
        };

        if let Err(error) = fs::rename(&staging_file, &dest) {
            remove_staging_path(&staging_file);
            if let Some(staging_assets) = staging_assets.as_ref() {
                remove_staging_path(staging_assets);
            }
            return Err(format!("Failed to finish file duplication: {}", error));
        }

        if let (Some(staging_assets), Some(dest_assets)) =
            (staging_assets.as_ref(), dest_assets.as_ref())
        {
            if let Err(error) = fs::rename(staging_assets, dest_assets) {
                let _ = fs::rename(&dest, &staging_file);
                remove_staging_path(&staging_file);
                remove_staging_path(staging_assets);
                return Err(format!("Failed to finish companion assets duplication: {}", error));
            }
        }

        Ok(dest.to_string_lossy().to_string())
    }
}

fn copy_file_with_metadata(source: &Path, destination: &Path) -> Result<(), std::io::Error> {
    fs::copy(source, destination)?;
    copy_extended_attributes(source, destination)
}

fn remove_staging_path(path: &Path) {
    let Ok(metadata) = fs::symlink_metadata(path) else { return };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        let _ = fs::remove_dir_all(path);
    } else {
        let _ = fs::remove_file(path);
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir(dst).map_err(|e| format!("Failed to create directory: {}", e))?;
    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_symlink() {
            return Err(format!(
                "Folder duplication stopped at symbolic link: {}",
                src_path.display(),
            ));
        }
        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            copy_file_with_metadata(&src_path, &dst_path)
                .map_err(|e| format!("Failed to copy: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to reveal in Finder: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn save_image(active_file: String, filename: String, data: Vec<u8>) -> Result<String, String> {
    validate_name(&filename)?;

    // Build {stem}.assets/ directory alongside the active markdown file
    let active = Path::new(&active_file);
    let dir = active.parent().ok_or("Cannot determine file directory")?;
    let file_stem = active.file_stem().ok_or("Cannot determine file stem")?.to_string_lossy();
    let assets_dir_name = format!("{}.assets", file_stem);
    let assets_dir = dir.join(&assets_dir_name);

    fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Failed to create assets directory: {}", e))?;

    // Deduplicate: if filename exists, add a numeric suffix
    let mut final_name = filename.clone();
    let path = Path::new(&filename);
    let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let mut counter = 1u32;
    while assets_dir.join(&final_name).exists() {
        final_name = format!("{}-{}{}", stem, counter, ext);
        counter += 1;
    }

    let file_path = assets_dir.join(&final_name);
    fs::write(&file_path, &data)
        .map_err(|e| format!("Failed to write image: {}", e))?;

    Ok(format!("{}/{}", assets_dir_name, final_name))
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    // Only allow http/https URLs to prevent arbitrary application launch
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Only http:// and https:// URLs are allowed".to_string());
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map_err(|e| format!("Failed to open URL: {}", e))?;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct FileMetadata {
    pub size_bytes: u64,
    pub modified_ms: u64, // epoch milliseconds
}

#[derive(Debug, Serialize)]
pub struct MediaAssetMetadata {
    pub canonical_path: String,
    pub size_bytes: u64,
    pub modified_ms: u64,
}

fn read_file_metadata(path: &Path) -> Result<FileMetadata, String> {
    let metadata = fs::metadata(path).map_err(|e| format!("Failed to read metadata: {}", e))?;
    let size_bytes = metadata.len();
    let modified = metadata
        .modified()
        .map_err(|e| format!("Failed to get modified time: {}", e))?;
    let modified_ms = modified
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    Ok(FileMetadata {
        size_bytes,
        modified_ms,
    })
}

#[tauri::command]
pub async fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    read_file_metadata(Path::new(&path))
}

/// Grant the asset protocol access to one existing file and return the stable,
/// canonical path used by the WebView. The static asset scope stays empty so
/// opening media never exposes an entire project or home directory.
#[tauri::command]
pub async fn prepare_media_asset(
    app: tauri::AppHandle,
    path: String,
) -> Result<MediaAssetMetadata, String> {
    let canonical_path =
        fs::canonicalize(&path).map_err(|e| format!("Failed to prepare media file: {}", e))?;
    if !canonical_path.is_file() {
        return Err("Media path is not a file".to_string());
    }

    app.asset_protocol_scope()
        .allow_file(&canonical_path)
        .map_err(|e| format!("Failed to allow media file: {}", e))?;

    let metadata = read_file_metadata(&canonical_path)?;
    Ok(MediaAssetMetadata {
        canonical_path: canonical_path.to_string_lossy().to_string(),
        size_bytes: metadata.size_bytes,
        modified_ms: metadata.modified_ms,
    })
}

#[tauri::command]
pub async fn markdown_to_html(markdown: String) -> Result<String, String> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(&markdown, options);
    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);
    Ok(html_output)
}

#[tauri::command]
pub async fn markdown_to_plain_text(markdown: String) -> Result<String, String> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_TASKLISTS);
    let parser = Parser::new_ext(&markdown, options);
    let mut plain = String::new();
    for event in parser {
        match event {
            pulldown_cmark::Event::Text(text) | pulldown_cmark::Event::Code(text) => {
                plain.push_str(&text);
            }
            pulldown_cmark::Event::SoftBreak | pulldown_cmark::Event::HardBreak => {
                plain.push('\n');
            }
            pulldown_cmark::Event::End(tag) => {
                match tag {
                    pulldown_cmark::TagEnd::Paragraph
                    | pulldown_cmark::TagEnd::Heading(_)
                    | pulldown_cmark::TagEnd::Item
                    | pulldown_cmark::TagEnd::BlockQuote(_) => {
                        plain.push('\n');
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    Ok(plain.trim().to_string())
}

#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<String>, String> {
    use font_kit::source::SystemSource;
    use std::collections::BTreeSet;

    let source = SystemSource::new();
    let families = source.all_families().map_err(|e| format!("Failed to list fonts: {}", e))?;

    // Deduplicate and sort via BTreeSet, filter out hidden/system fonts
    let names: Vec<String> = families
        .into_iter()
        .filter(|f| !f.starts_with('.') && !f.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    Ok(names)
}

#[tauri::command]
pub async fn open_with_default_app(path: String) -> Result<(), String> {
    let meta = fs::metadata(&path).map_err(|e| format!("File not found: {}", e))?;
    if !meta.is_file() {
        return Err("Path is not a file".to_string());
    }
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| format!("Failed to open file: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        decode_text_bytes, duplicate_file, move_file, read_file_if_text, rename_file,
        write_file_checked, WriteFileError, TEMP_FILE_COUNTER, TEXT_PROBE_BYTES,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::Ordering;

    fn test_directory(name: &str) -> PathBuf {
        let suffix = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "ghost-fs-test-{}-{}-{}",
            name,
            std::process::id(),
            suffix,
        ));
        fs::create_dir(&directory).expect("test directory should be created");
        directory
    }

    #[test]
    fn accepts_utf8_text() {
        let content = br#"{"version": 3, "pins": []}"#;
        assert_eq!(
            decode_text_bytes(content),
            Some("{\"version\": 3, \"pins\": []}".to_string())
        );
    }

    #[test]
    fn accepts_unicode_and_empty_text() {
        assert_eq!(
            decode_text_bytes("Hello, 世界".as_bytes()),
            Some("Hello, 世界".to_string())
        );
        assert_eq!(decode_text_bytes(b""), Some(String::new()));
    }

    #[test]
    fn preserves_a_utf8_bom() {
        let content = b"\xEF\xBB\xBFhello";
        assert_eq!(
            decode_text_bytes(content),
            Some("\u{FEFF}hello".to_string())
        );
    }

    #[test]
    fn rejects_invalid_utf8_and_nul_bytes() {
        assert_eq!(decode_text_bytes(&[0xFF, 0xFE, 0x00, 0x01]), None);
        assert_eq!(decode_text_bytes(b"plain\0text"), None);
    }

    #[test]
    fn rejects_control_heavy_content_but_allows_an_occasional_control() {
        assert_eq!(decode_text_bytes(b"a\x01b\x02c"), None);

        let occasional_control = format!("\u{001B}{}", "x".repeat(100));
        assert_eq!(
            decode_text_bytes(occasional_control.as_bytes()),
            Some(occasional_control)
        );
    }

    #[test]
    fn bounded_probe_accepts_text_with_a_multibyte_character_across_the_boundary() {
        let directory = test_directory("text-probe-unicode-boundary");
        let path = directory.join("unknown.data");
        let content = format!("{}é", "a".repeat(TEXT_PROBE_BYTES as usize - 1));
        fs::write(&path, &content).expect("fixture should be written");

        let detected =
            tauri::async_runtime::block_on(read_file_if_text(path.to_string_lossy().to_string()))
                .expect("probe should succeed");

        assert_eq!(detected.as_deref(), Some(content.as_str()));
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn bounded_probe_rejects_binary_content_after_a_textual_prefix() {
        let directory = test_directory("text-probe-binary-suffix");
        let path = directory.join("unknown.data");
        let mut content = vec![b'a'; TEXT_PROBE_BYTES as usize];
        content.extend_from_slice(b"binary\0suffix");
        fs::write(&path, content).expect("fixture should be written");

        let detected =
            tauri::async_runtime::block_on(read_file_if_text(path.to_string_lossy().to_string()))
                .expect("probe should succeed");

        assert_eq!(detected, None);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn checked_write_atomically_replaces_the_file_without_leaving_a_temp_file() {
        let directory = test_directory("atomic-write");
        let path = directory.join("notes.md");
        fs::write(&path, "before").expect("fixture should be written");

        write_file_checked(&path, "after", Some("before"), false)
            .expect("matching content should save");

        assert_eq!(fs::read_to_string(&path).unwrap(), "after");
        let entries = fs::read_dir(&directory).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path(), path);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn checked_write_detects_an_external_change_without_overwriting_it() {
        let directory = test_directory("write-conflict");
        let path = directory.join("notes.md");
        fs::write(&path, "changed elsewhere").expect("fixture should be written");

        let error = write_file_checked(&path, "my edit", Some("original"), false)
            .expect_err("external change should conflict");

        assert!(matches!(error, WriteFileError::Conflict { .. }));
        assert_eq!(fs::read_to_string(&path).unwrap(), "changed elsewhere");
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn forced_checked_write_explicitly_overwrites_a_conflict() {
        let directory = test_directory("force-write");
        let path = directory.join("notes.md");
        fs::write(&path, "changed elsewhere").expect("fixture should be written");

        write_file_checked(&path, "my edit", Some("original"), true)
            .expect("forced save should overwrite");

        assert_eq!(fs::read_to_string(&path).unwrap(), "my edit");
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn atomic_write_preserves_extended_file_metadata() {
        let directory = test_directory("write-xattr");
        let path = directory.join("notes.md");
        fs::write(&path, "before").expect("fixture should be written");
        xattr::set(&path, "com.ghost.test", b"preserve me")
            .expect("fixture attribute should be written");

        write_file_checked(&path, "after", Some("before"), false)
            .expect("file should save");

        assert_eq!(
            xattr::get(&path, "com.ghost.test").unwrap(),
            Some(b"preserve me".to_vec()),
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn rename_moves_companion_assets_and_updates_their_references() {
        let directory = test_directory("rename-assets");
        let old_path = directory.join("notes.md");
        let old_assets = directory.join("notes.assets");
        fs::write(&old_path, "![Diagram](notes.assets/diagram.png)")
            .expect("fixture should be written");
        fs::create_dir(&old_assets).expect("assets directory should be created");
        fs::write(old_assets.join("diagram.png"), b"image")
            .expect("asset should be written");

        let renamed = tauri::async_runtime::block_on(rename_file(
            old_path.to_string_lossy().to_string(),
            "renamed.md".to_string(),
        ))
        .expect("rename should succeed");

        let new_path = directory.join("renamed.md");
        let new_assets = directory.join("renamed.assets");
        assert_eq!(PathBuf::from(renamed), new_path);
        assert!(!old_path.exists());
        assert!(!old_assets.exists());
        assert_eq!(
            fs::read_to_string(&new_path).unwrap(),
            "![Diagram](renamed.assets/diagram.png)",
        );
        assert_eq!(fs::read(new_assets.join("diagram.png")).unwrap(), b"image");
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn rename_preflights_an_assets_collision_without_mutating_the_source() {
        let directory = test_directory("rename-assets-conflict");
        let old_path = directory.join("notes.md");
        let old_assets = directory.join("notes.assets");
        fs::write(&old_path, "![Diagram](notes.assets/diagram.png)")
            .expect("fixture should be written");
        fs::create_dir(&old_assets).expect("assets directory should be created");
        fs::create_dir(directory.join("renamed.assets"))
            .expect("conflicting assets directory should be created");

        let result = tauri::async_runtime::block_on(rename_file(
            old_path.to_string_lossy().to_string(),
            "renamed.md".to_string(),
        ));

        assert!(result.is_err());
        assert!(old_path.exists());
        assert!(old_assets.exists());
        assert!(!directory.join("renamed.md").exists());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn move_keeps_a_file_and_its_companion_assets_together() {
        let directory = test_directory("move-assets");
        let source_directory = directory.join("source");
        let target_directory = directory.join("target");
        fs::create_dir(&source_directory).expect("source directory should be created");
        fs::create_dir(&target_directory).expect("target directory should be created");
        let source_path = source_directory.join("notes.md");
        let source_assets = source_directory.join("notes.assets");
        fs::write(&source_path, "document").expect("fixture should be written");
        fs::create_dir(&source_assets).expect("assets directory should be created");
        fs::write(source_assets.join("diagram.png"), b"image")
            .expect("asset should be written");

        let moved = tauri::async_runtime::block_on(move_file(
            source_path.to_string_lossy().to_string(),
            target_directory.to_string_lossy().to_string(),
            Some(false),
        ))
        .expect("move should succeed");

        assert_eq!(PathBuf::from(moved), target_directory.join("notes.md"));
        assert!(!source_path.exists());
        assert!(!source_assets.exists());
        assert_eq!(fs::read_to_string(target_directory.join("notes.md")).unwrap(), "document");
        assert_eq!(
            fs::read(target_directory.join("notes.assets/diagram.png")).unwrap(),
            b"image",
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn duplicate_creates_independent_companion_assets_and_updates_references() {
        let directory = test_directory("duplicate-assets");
        let source_path = directory.join("notes.md");
        let source_assets = directory.join("notes.assets");
        fs::write(&source_path, "![Diagram](notes.assets/diagram.png)")
            .expect("fixture should be written");
        fs::create_dir(&source_assets).expect("assets directory should be created");
        fs::write(source_assets.join("diagram.png"), b"image")
            .expect("asset should be written");

        let duplicated = tauri::async_runtime::block_on(duplicate_file(
            source_path.to_string_lossy().to_string(),
        ))
        .expect("duplicate should succeed");

        let duplicated_path = directory.join("notes copy.md");
        let duplicated_assets = directory.join("notes copy.assets");
        assert_eq!(PathBuf::from(duplicated), duplicated_path);
        assert_eq!(
            fs::read_to_string(&duplicated_path).unwrap(),
            "![Diagram](notes copy.assets/diagram.png)",
        );
        assert_eq!(
            fs::read(duplicated_assets.join("diagram.png")).unwrap(),
            b"image",
        );
        assert!(source_assets.join("diagram.png").exists());
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn folder_duplicate_does_not_follow_symbolic_links() {
        use std::os::unix::fs::symlink;

        let directory = test_directory("duplicate-symlink");
        let source = directory.join("source");
        let outside = directory.join("outside");
        fs::create_dir(&source).expect("source directory should be created");
        fs::create_dir(&outside).expect("outside directory should be created");
        fs::write(outside.join("private.txt"), "outside")
            .expect("outside fixture should be written");
        symlink(&outside, source.join("link")).expect("symlink should be created");

        let result = tauri::async_runtime::block_on(duplicate_file(
            source.to_string_lossy().to_string(),
        ));

        assert!(result.is_err());
        assert!(!directory.join("source copy").exists());
        assert_eq!(fs::read_to_string(outside.join("private.txt")).unwrap(), "outside");
        let staging_items = fs::read_dir(&directory)
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .into_iter()
            .filter(|entry| entry.file_name().to_string_lossy().starts_with(".ghost-backup"))
            .count();
        assert_eq!(staging_items, 0);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn renders_the_largest_icns_representation_as_png() {
        let icns = include_bytes!("../../icons/icon-prod.icns");
        let png = super::render_icns_preview(icns).expect("ICNS preview should render");

        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        let width = u32::from_be_bytes(png[16..20].try_into().unwrap());
        let height = u32::from_be_bytes(png[20..24].try_into().unwrap());
        assert_eq!((width, height), (1024, 1024));
    }
}
