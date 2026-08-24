use super::archive::{canonical_file, list_archive_impl, raw_compression, RawCompression};
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

const BSDTAR_PATH: &str = "/usr/bin/tar";
const FILE_PATH: &str = "/usr/bin/file";
const SIPS_PATH: &str = "/usr/bin/sips";
const TEXT_PREVIEW_LIMIT: u64 = 10 * 1024 * 1024;
const DOCUMENT_PREVIEW_LIMIT: u64 = 100 * 1024 * 1024;
const MEDIA_PREVIEW_LIMIT: u64 = 256 * 1024 * 1024;
const ABSOLUTE_PREVIEW_LIMIT: u64 = MEDIA_PREVIEW_LIMIT;
const CACHE_BUDGET: u64 = 512 * 1024 * 1024;
const PREVIEW_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_ERROR_BYTES: usize = 64 * 1024;
const SNIFF_BYTES: usize = 16 * 1024;
const MAX_IMAGE_PIXELS: u64 = 100_000_000;

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct PreviewKey {
    archive_path: String,
    archive_size: u64,
    archive_modified_ns: u128,
    entry_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ArchivePreviewArtifact {
    pub token: String,
    pub path: String,
    pub display_name: String,
    pub mime_type: Option<String>,
    pub size_bytes: u64,
}

#[derive(Debug, Clone)]
struct CacheEntry {
    key: PreviewKey,
    directory: PathBuf,
    artifact: ArchivePreviewArtifact,
    leases: u32,
    last_used: u64,
}

struct PendingPreview {
    partial_directory: PathBuf,
    artifact_path: PathBuf,
    display_name: String,
    mime_type: Option<String>,
    size_bytes: u64,
    token: String,
}

#[derive(Default)]
struct CacheIndex {
    entries: HashMap<String, CacheEntry>,
    by_key: HashMap<PreviewKey, String>,
    total_bytes: u64,
    clock: u64,
}

struct PreviewCacheShared {
    session_directory: PathBuf,
    index: Mutex<CacheIndex>,
    cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
    next_token: AtomicU64,
}

#[derive(Clone)]
pub struct ArchivePreviewCache {
    shared: Arc<PreviewCacheShared>,
}

impl ArchivePreviewCache {
    pub fn new(app: &tauri::AppHandle) -> Result<Self, String> {
        let app_cache = app
            .path()
            .app_cache_dir()
            .map_err(|error| format!("Unable to resolve Ghost's cache folder: {error}"))?;
        fs::create_dir_all(&app_cache)
            .map_err(|error| format!("Unable to create Ghost's cache folder: {error}"))?;
        let preview_root = app_cache.join("archive-previews");
        ensure_cache_directory(&preview_root)?;
        let root = preview_root.join("v1");
        Self::new_in_root(root)
    }

    fn new_in_root(root: PathBuf) -> Result<Self, String> {
        ensure_cache_directory(&root)?;
        purge_cache_root(&root)?;

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let sequence = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
        let session_directory = root.join(format!(
            "session-{}-{timestamp}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&session_directory)
            .map_err(|error| format!("Unable to create archive preview session: {error}"))?;

        Ok(Self {
            shared: Arc::new(PreviewCacheShared {
                session_directory,
                index: Mutex::new(CacheIndex::default()),
                cancellations: Mutex::new(HashMap::new()),
                next_token: AtomicU64::new(0),
            }),
        })
    }

    pub fn cleanup_session(&self) {
        let _ = remove_cache_path(&self.shared.session_directory);
    }

    fn register_request(&self, request_id: &str) -> Result<Arc<AtomicBool>, String> {
        if request_id.is_empty() || request_id.len() > 160 {
            return Err("Invalid archive preview request".to_string());
        }
        let cancellation = Arc::new(AtomicBool::new(false));
        self.shared
            .cancellations
            .lock()
            .map_err(|_| "Archive preview cancellation state is unavailable".to_string())?
            .insert(request_id.to_string(), cancellation.clone());
        Ok(cancellation)
    }

    fn finish_request(&self, request_id: &str) {
        if let Ok(mut cancellations) = self.shared.cancellations.lock() {
            cancellations.remove(request_id);
        }
    }

    fn cancel(&self, request_id: &str) {
        if let Ok(cancellations) = self.shared.cancellations.lock() {
            if let Some(cancellation) = cancellations.get(request_id) {
                cancellation.store(true, Ordering::Release);
            }
        }
    }

    fn release(&self, token: &str) {
        if let Ok(mut index) = self.shared.index.lock() {
            index.clock = index.clock.saturating_add(1);
            let clock = index.clock;
            if let Some(entry) = index.entries.get_mut(token) {
                entry.leases = entry.leases.saturating_sub(1);
                entry.last_used = clock;
            }
            evict_inactive_entries(&mut index);
        }
    }

    fn acquire_cached(&self, key: &PreviewKey) -> Option<ArchivePreviewArtifact> {
        let mut index = self.shared.index.lock().ok()?;
        let token = index.by_key.get(key)?.clone();
        let exists = index
            .entries
            .get(&token)
            .is_some_and(|entry| Path::new(&entry.artifact.path).is_file());
        if !exists {
            index.by_key.remove(key);
            if let Some(entry) = index.entries.remove(&token) {
                index.total_bytes = index.total_bytes.saturating_sub(entry.artifact.size_bytes);
                let _ = remove_cache_path(&entry.directory);
            }
            return None;
        }
        index.clock = index.clock.saturating_add(1);
        let clock = index.clock;
        let entry = index.entries.get_mut(&token)?;
        entry.leases = entry.leases.saturating_add(1);
        entry.last_used = clock;
        Some(entry.artifact.clone())
    }

    fn publish(
        &self,
        key: PreviewKey,
        pending: PendingPreview,
    ) -> Result<ArchivePreviewArtifact, String> {
        let final_directory = self.shared.session_directory.join(&pending.token);
        fs::rename(&pending.partial_directory, &final_directory)
            .map_err(|error| format!("Unable to publish archive preview: {error}"))?;
        let artifact_name = pending
            .artifact_path
            .file_name()
            .ok_or_else(|| "Archive preview filename is unavailable".to_string())?;
        let final_path = final_directory.join(artifact_name);
        let artifact = ArchivePreviewArtifact {
            token: pending.token.clone(),
            path: final_path.to_string_lossy().into_owned(),
            display_name: pending.display_name,
            mime_type: pending.mime_type,
            size_bytes: pending.size_bytes,
        };

        let mut index = match self.shared.index.lock() {
            Ok(index) => index,
            Err(_) => {
                let _ = remove_cache_path(&final_directory);
                return Err("Archive preview cache index is unavailable".to_string());
            }
        };

        if let Some(existing_token) = index.by_key.get(&key).cloned() {
            let existing_is_valid = index
                .entries
                .get(&existing_token)
                .is_some_and(|entry| Path::new(&entry.artifact.path).is_file());
            if existing_is_valid {
                index.clock = index.clock.saturating_add(1);
                let clock = index.clock;
                if let Some(existing) = index.entries.get_mut(&existing_token) {
                    existing.leases = existing.leases.saturating_add(1);
                    existing.last_used = clock;
                    let artifact = existing.artifact.clone();
                    drop(index);
                    let _ = remove_cache_path(&final_directory);
                    return Ok(artifact);
                }
            }

            index.by_key.remove(&key);
            if let Some(stale) = index.entries.remove(&existing_token) {
                index.total_bytes = index.total_bytes.saturating_sub(stale.artifact.size_bytes);
                let _ = remove_cache_path(&stale.directory);
            }
        }

        index.clock = index.clock.saturating_add(1);
        let last_used = index.clock;
        index.total_bytes = index.total_bytes.saturating_add(pending.size_bytes);
        index.by_key.insert(key.clone(), pending.token.clone());
        index.entries.insert(
            pending.token,
            CacheEntry {
                key,
                directory: final_directory,
                artifact: artifact.clone(),
                leases: 1,
                last_used,
            },
        );
        evict_inactive_entries(&mut index);
        Ok(artifact)
    }

    fn materialize(
        &self,
        archive_path: &str,
        entry_path: &str,
        cancellation: Arc<AtomicBool>,
    ) -> Result<ArchivePreviewArtifact, String> {
        let archive = canonical_file(archive_path)?;
        let (archive_size, archive_modified_ns) = archive_fingerprint(&archive)?;
        let key = PreviewKey {
            archive_path: archive.to_string_lossy().into_owned(),
            archive_size,
            archive_modified_ns,
            entry_path: entry_path.to_string(),
        };
        if let Some(artifact) = self.acquire_cached(&key) {
            return Ok(artifact);
        }

        let manifest = list_archive_impl(
            archive
                .to_str()
                .ok_or_else(|| "Archive path is not valid UTF-8".to_string())?,
        )?;
        let matches = manifest
            .entries
            .iter()
            .filter(|entry| entry.path == entry_path)
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err(if matches.is_empty() {
                "The selected archive entry no longer exists".to_string()
            } else {
                "Duplicate archive paths cannot be previewed safely".to_string()
            });
        }
        let entry = matches[0];
        if entry.kind != "file" {
            return Err("Only regular files can be previewed".to_string());
        }
        if is_archive_name(entry_path) {
            return Err("Nested archives are not previewed in place yet".to_string());
        }

        let display_name = entry_path
            .rsplit('/')
            .next()
            .filter(|name| !name.is_empty())
            .unwrap_or("Preview")
            .to_string();
        if entry
            .size_bytes
            .is_some_and(|size| size > ABSOLUTE_PREVIEW_LIMIT)
        {
            return Err(preview_too_large_message(ABSOLUTE_PREVIEW_LIMIT));
        }

        let sequence = self.shared.next_token.fetch_add(1, Ordering::Relaxed);
        let token = format!("preview-{sequence}");
        let partial_directory = self
            .shared
            .session_directory
            .join(format!("{token}.partial"));
        fs::create_dir(&partial_directory)
            .map_err(|error| format!("Unable to create archive preview workspace: {error}"))?;
        let partial_path = partial_directory.join("payload.partial");

        let result = materialize_to_file(
            &archive,
            entry_path,
            raw_compression(&archive),
            &partial_path,
            entry.size_bytes,
            cancellation.clone(),
        );
        let size_bytes = match result {
            Ok(size) => size,
            Err(error) => {
                let _ = remove_cache_path(&partial_directory);
                return Err(error);
            }
        };
        if cancellation.load(Ordering::Acquire) {
            let _ = remove_cache_path(&partial_directory);
            return Err("Archive preview cancelled".to_string());
        }

        let archive_unchanged = archive_fingerprint(&archive)
            .map(|(size, modified_ns)| {
                size == key.archive_size && modified_ns == key.archive_modified_ns
            })
            .unwrap_or(false);
        if !archive_unchanged {
            let _ = remove_cache_path(&partial_directory);
            return Err(
                "The archive changed while Ghost was preparing this preview. Try again."
                    .to_string(),
            );
        }

        let mime_type = detect_mime_type(&partial_path);
        let final_limit = preview_limit_for_mime(mime_type.as_deref());
        if size_bytes > final_limit {
            let _ = remove_cache_path(&partial_directory);
            return Err(preview_too_large_message(final_limit));
        }
        if mime_type.as_deref().is_some_and(is_archive_mime) {
            let _ = remove_cache_path(&partial_directory);
            return Err("Nested archives are not previewed in place yet".to_string());
        }
        if mime_type
            .as_deref()
            .is_some_and(|mime| mime.starts_with("image/"))
            && image_dimensions(&partial_path)
                .is_some_and(|(width, height)| width.saturating_mul(height) > MAX_IMAGE_PIXELS)
        {
            let _ = remove_cache_path(&partial_directory);
            return Err(
                "This image is too large to decode safely for preview (limit: 100 megapixels)."
                    .to_string(),
            );
        }

        let extension = storage_extension(mime_type.as_deref(), &display_name);
        if cancellation.load(Ordering::Acquire) {
            let _ = remove_cache_path(&partial_directory);
            return Err("Archive preview cancelled".to_string());
        }
        let artifact_name = extension
            .map(|extension| format!("payload.{extension}"))
            .unwrap_or_else(|| "payload".to_string());
        let artifact_path = partial_directory.join(artifact_name);
        if let Err(error) = fs::rename(&partial_path, &artifact_path) {
            let _ = remove_cache_path(&partial_directory);
            return Err(format!("Unable to finalize archive preview: {error}"));
        }

        match self.publish(
            key,
            PendingPreview {
                partial_directory: partial_directory.clone(),
                artifact_path,
                display_name,
                mime_type,
                size_bytes,
                token,
            },
        ) {
            Ok(artifact) => Ok(artifact),
            Err(error) => {
                let _ = remove_cache_path(&partial_directory);
                Err(error)
            }
        }
    }
}

fn archive_fingerprint(path: &Path) -> Result<(u64, u128), String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("Unable to inspect archive for preview: {error}"))?;
    let modified_ns = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    Ok((metadata.len(), modified_ns))
}

fn purge_cache_root(root: &Path) -> Result<(), String> {
    let entries = fs::read_dir(root)
        .map_err(|error| format!("Unable to inspect archive preview cache: {error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("Unable to inspect cached preview: {error}"))?;
        remove_cache_path(&entry.path())?;
    }
    Ok(())
}

fn ensure_cache_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(()),
        Ok(_) => Err(format!(
            "Archive preview cache path is not a safe directory: {}",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => fs::create_dir(path)
            .map_err(|error| format!("Unable to create archive preview cache: {error}")),
        Err(error) => Err(format!("Unable to inspect archive preview cache: {error}")),
    }
}

fn remove_cache_path(path: &Path) -> Result<(), String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("Unable to inspect cached preview: {error}")),
    };
    if metadata.is_dir() && !metadata.file_type().is_symlink() {
        fs::remove_dir_all(path)
            .map_err(|error| format!("Unable to remove cached preview folder: {error}"))
    } else {
        fs::remove_file(path).map_err(|error| format!("Unable to remove cached preview: {error}"))
    }
}

fn evict_inactive_entries(index: &mut CacheIndex) {
    while index.total_bytes > CACHE_BUDGET {
        let candidate = index
            .entries
            .iter()
            .filter(|(_, entry)| entry.leases == 0)
            .min_by_key(|(_, entry)| entry.last_used)
            .map(|(token, _)| token.clone());
        let Some(token) = candidate else {
            break;
        };
        let Some(entry) = index.entries.remove(&token) else {
            break;
        };
        if index.by_key.get(&entry.key) == Some(&token) {
            index.by_key.remove(&entry.key);
        }
        index.total_bytes = index.total_bytes.saturating_sub(entry.artifact.size_bytes);
        let _ = remove_cache_path(&entry.directory);
    }
}

fn is_archive_name(name: &str) -> bool {
    let lower = name.to_lowercase();
    [
        ".tar.bz2", ".tar.gz", ".tar.xz", ".tar.zst", ".tbz2", ".cpgz", ".tgz", ".tbz", ".txz",
        ".tzst", ".cpio", ".zip", ".tar", ".7z", ".rar", ".gz", ".bz2",
    ]
    .iter()
    .any(|suffix| lower.ends_with(suffix))
}

fn preview_limit_for_mime(mime_type: Option<&str>) -> u64 {
    let Some(mime_type) = mime_type else {
        return ABSOLUTE_PREVIEW_LIMIT;
    };
    if mime_type.starts_with("text/")
        || matches!(
            mime_type,
            "application/json"
                | "application/xml"
                | "application/javascript"
                | "application/x-empty"
        )
    {
        TEXT_PREVIEW_LIMIT
    } else if mime_type.starts_with("image/")
        || mime_type.starts_with("font/")
        || mime_type == "application/pdf"
        || mime_type.contains("font")
    {
        DOCUMENT_PREVIEW_LIMIT
    } else {
        MEDIA_PREVIEW_LIMIT
    }
}

fn preview_too_large_message(limit: u64) -> String {
    format!(
        "This entry is too large to preview safely (limit: {} MiB). Extract the archive to open it.",
        limit / (1024 * 1024)
    )
}

fn drain_bounded<R: Read>(mut reader: R, limit: usize) -> Vec<u8> {
    let mut result = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = match reader.read(&mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(count) => count,
        };
        if result.len() < limit {
            let remaining = limit - result.len();
            result.extend_from_slice(&buffer[..count.min(remaining)]);
        }
    }
    result
}

fn preview_command(
    archive: &Path,
    entry_path: &str,
    compression: Option<RawCompression>,
) -> Command {
    if let Some(compression) = compression {
        let mut command = Command::new(compression.decoder_path());
        command.arg("-dc").arg(archive);
        command
    } else {
        let mut command = Command::new(BSDTAR_PATH);
        command.arg("-xOf").arg(archive).arg("--").arg(entry_path);
        command
    }
}

fn materialize_to_file(
    archive: &Path,
    entry_path: &str,
    compression: Option<RawCompression>,
    output: &Path,
    expected_size: Option<u64>,
    cancellation: Arc<AtomicBool>,
) -> Result<u64, String> {
    if cancellation.load(Ordering::Acquire) {
        return Err("Archive preview cancelled".to_string());
    }
    let output_file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)
        .map_err(|error| format!("Unable to create archive preview: {error}"))?;
    let mut command = preview_command(archive, entry_path, compression);
    let mut child = command
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to start archive preview reader: {error}"))?;
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Unable to read archive preview".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Unable to read archive preview errors".to_string())?;
    let stderr_thread = std::thread::spawn(move || drain_bounded(stderr, MAX_ERROR_BYTES));
    let child = Arc::new(Mutex::new(child));
    let watcher_child = child.clone();
    let watcher_cancel = cancellation.clone();
    let done = Arc::new(AtomicBool::new(false));
    let watcher_done = done.clone();
    let stop_reason = Arc::new(AtomicU8::new(0));
    let watcher_reason = stop_reason.clone();
    let started = Instant::now();
    let watcher = std::thread::spawn(move || {
        while !watcher_done.load(Ordering::Acquire) {
            let reason = if watcher_cancel.load(Ordering::Acquire) {
                1
            } else if started.elapsed() >= PREVIEW_TIMEOUT {
                2
            } else {
                0
            };
            if reason != 0 {
                watcher_reason.store(reason, Ordering::Release);
                if let Ok(mut child) = watcher_child.lock() {
                    let _ = child.kill();
                }
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    });

    let mut output_file = output_file;
    let mut buffer = [0_u8; 64 * 1024];
    let mut sniff = Vec::with_capacity(SNIFF_BYTES);
    let mut total = 0_u64;
    let mut active_limit = ABSOLUTE_PREVIEW_LIMIT;
    let mut read_error = None;
    loop {
        let count = match stdout.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) => {
                read_error = Some(format!("Unable to decompress archive entry: {error}"));
                break;
            }
        };
        if sniff.len() < SNIFF_BYTES {
            let remaining = SNIFF_BYTES - sniff.len();
            sniff.extend_from_slice(&buffer[..count.min(remaining)]);
            if sniff.len() >= SNIFF_BYTES {
                active_limit = preview_limit_for_sniff(&sniff);
            }
        }
        total = total.saturating_add(count as u64);
        if total > active_limit || total > ABSOLUTE_PREVIEW_LIMIT {
            stop_reason.store(3, Ordering::Release);
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
            }
            break;
        }
        if let Err(error) = output_file.write_all(&buffer[..count]) {
            read_error = Some(format!("Unable to write archive preview: {error}"));
            if let Ok(mut child) = child.lock() {
                let _ = child.kill();
            }
            break;
        }
    }
    if sniff.len() < SNIFF_BYTES {
        active_limit = preview_limit_for_sniff(&sniff);
    }
    let status = child
        .lock()
        .map_err(|_| "Archive preview process is unavailable".to_string())?
        .wait()
        .map_err(|error| format!("Unable to finish archive preview: {error}"));
    done.store(true, Ordering::Release);
    let _ = watcher.join();
    let stderr = stderr_thread.join().unwrap_or_default();

    if let Some(error) = read_error {
        return Err(error);
    }
    match stop_reason.load(Ordering::Acquire) {
        1 => return Err("Archive preview cancelled".to_string()),
        2 => return Err("Archive preview took longer than 30 seconds and was stopped".to_string()),
        3 => return Err(preview_too_large_message(active_limit)),
        _ => {}
    }
    let status = status?;
    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr);
        let detail = detail.trim();
        return Err(if detail.is_empty() {
            "macOS could not preview this archive entry. It may be encrypted, corrupt, or unsupported."
                .to_string()
        } else {
            format!("macOS could not preview this archive entry: {detail}")
        });
    }
    if total > active_limit {
        return Err(preview_too_large_message(active_limit));
    }
    if expected_size.is_some_and(|expected| expected != total) {
        return Err(
            "The archive returned more than one matching entry or changed during preview. Duplicate paths cannot be previewed safely."
                .to_string(),
        );
    }
    output_file
        .flush()
        .map_err(|error| format!("Unable to finish writing archive preview: {error}"))?;
    Ok(total)
}

fn preview_limit_for_sniff(bytes: &[u8]) -> u64 {
    if bytes.is_empty() || looks_like_text(bytes) {
        TEXT_PREVIEW_LIMIT
    } else if is_document_signature(bytes) {
        DOCUMENT_PREVIEW_LIMIT
    } else {
        MEDIA_PREVIEW_LIMIT
    }
}

fn looks_like_text(bytes: &[u8]) -> bool {
    let Ok(text) = std::str::from_utf8(bytes) else {
        return false;
    };
    let mut characters = 0usize;
    let mut suspicious = 0usize;
    for character in text.chars() {
        characters += 1;
        if character == '\0' {
            return false;
        }
        if character.is_control() && !matches!(character, '\n' | '\r' | '\t' | '\u{000C}') {
            suspicious += 1;
        }
    }
    suspicious == 0 || suspicious.saturating_mul(100) <= characters.max(1)
}

fn is_document_signature(bytes: &[u8]) -> bool {
    bytes.starts_with(b"%PDF-")
        || bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || bytes.starts_with(b"\xff\xd8\xff")
        || bytes.starts_with(b"GIF87a")
        || bytes.starts_with(b"GIF89a")
        || bytes.starts_with(b"BM")
        || bytes.starts_with(b"II*\0")
        || bytes.starts_with(b"MM\0*")
        || bytes.starts_with(b"wOFF")
        || bytes.starts_with(b"wOF2")
        || bytes.starts_with(b"OTTO")
        || bytes.starts_with(&[0, 1, 0, 0])
        || bytes.get(0..4) == Some(b"icns")
        || bytes.get(0..4) == Some(b"RIFF") && bytes.get(8..12) == Some(b"WEBP")
}

fn detect_mime_type(path: &Path) -> Option<String> {
    if !path.is_file() {
        return None;
    }
    let output = Command::new(FILE_PATH)
        .args(["-b", "--mime-type"])
        .arg(path)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let mime = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_lowercase();
    if mime.is_empty() {
        None
    } else if mime == "application/x-empty" {
        Some("text/plain".to_string())
    } else {
        Some(mime)
    }
}

fn image_dimensions(path: &Path) -> Option<(u64, u64)> {
    let output = Command::new(SIPS_PATH)
        .args(["-g", "pixelWidth", "-g", "pixelHeight"])
        .arg(path)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut width = None;
    let mut height = None;
    for line in text.lines() {
        let Some((key, value)) = line.trim().split_once(':') else {
            continue;
        };
        match key.trim() {
            "pixelWidth" => width = value.trim().parse().ok(),
            "pixelHeight" => height = value.trim().parse().ok(),
            _ => {}
        }
    }
    Some((width?, height?))
}

fn is_archive_mime(mime: &str) -> bool {
    matches!(
        mime,
        "application/zip"
            | "application/x-tar"
            | "application/gzip"
            | "application/x-gzip"
            | "application/x-bzip2"
            | "application/x-xz"
            | "application/zstd"
            | "application/x-7z-compressed"
            | "application/vnd.rar"
            | "application/x-rar"
            | "application/x-cpio"
    )
}

fn storage_extension(mime_type: Option<&str>, display_name: &str) -> Option<String> {
    let detected = match mime_type {
        Some("image/png") => Some("png"),
        Some("image/jpeg") => Some("jpg"),
        Some("image/gif") => Some("gif"),
        Some("image/webp") => Some("webp"),
        Some("image/bmp") | Some("image/x-ms-bmp") => Some("bmp"),
        Some("image/tiff") => Some("tiff"),
        Some("image/x-icon") | Some("image/vnd.microsoft.icon") => Some("ico"),
        Some("image/svg+xml") => Some("svg"),
        Some("image/icns") | Some("image/x-icns") | Some("image/x-apple-icns") => Some("icns"),
        Some("image/heic") => Some("heic"),
        Some("image/heif") => Some("heif"),
        Some("application/pdf") => Some("pdf"),
        Some("font/ttf") | Some("application/x-font-ttf") => Some("ttf"),
        Some("font/otf") | Some("application/x-font-otf") => Some("otf"),
        Some("font/woff") | Some("application/font-woff") => Some("woff"),
        Some("font/woff2") => Some("woff2"),
        Some("audio/mpeg") => Some("mp3"),
        Some("audio/mp4") => Some("m4a"),
        Some("audio/x-wav") | Some("audio/wav") => Some("wav"),
        Some("audio/x-aiff") | Some("audio/aiff") => Some("aiff"),
        Some("audio/x-caf") => Some("caf"),
        Some("audio/aac") => Some("aac"),
        Some("audio/flac") | Some("audio/x-flac") => Some("flac"),
        Some("audio/ogg") => Some("ogg"),
        Some("audio/opus") => Some("opus"),
        Some("audio/basic") => Some("au"),
        Some("video/mp4") => Some("mp4"),
        Some("video/quicktime") => Some("mov"),
        Some("video/webm") => Some("webm"),
        Some("video/x-matroska") => Some("mkv"),
        Some("video/x-msvideo") => Some("avi"),
        Some("video/x-ms-wmv") => Some("wmv"),
        Some("video/mpeg") => Some("mpeg"),
        Some("video/ogg") => Some("ogv"),
        Some("video/mp2t") => Some("ts"),
        Some("video/3gpp") => Some("3gp"),
        Some("video/3gpp2") => Some("3g2"),
        Some("text/markdown") => Some("md"),
        Some("application/json") => Some("json"),
        Some("application/xml") | Some("text/xml") => Some("xml"),
        Some(mime) if mime.starts_with("text/") => Some("txt"),
        _ => None,
    };
    let generic_binary = matches!(
        mime_type,
        Some(
            "application/octet-stream"
                | "application/x-executable"
                | "application/x-mach-binary"
                | "application/x-dosexec"
                | "application/x-object"
                | "application/x-sharedlib"
        )
    );
    detected.map(str::to_string).or_else(|| {
        if generic_binary {
            return None;
        }
        Path::new(display_name)
            .extension()
            .and_then(|extension| extension.to_str())
            .filter(|extension| {
                !extension.is_empty()
                    && extension.len() <= 12
                    && extension
                        .chars()
                        .all(|character| character.is_ascii_alphanumeric())
            })
            .map(|extension| extension.to_lowercase())
    })
}

#[tauri::command]
pub async fn materialize_archive_entry(
    cache: State<'_, ArchivePreviewCache>,
    archive_path: String,
    entry_path: String,
    request_id: String,
) -> Result<ArchivePreviewArtifact, String> {
    let cache = cache.inner().clone();
    let cancellation = cache.register_request(&request_id)?;
    let task_cache = cache.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        task_cache.materialize(&archive_path, &entry_path, cancellation)
    })
    .await;
    cache.finish_request(&request_id);
    joined.map_err(|error| format!("Archive preview stopped unexpectedly: {error}"))?
}

#[tauri::command]
pub fn cancel_archive_preview(cache: State<'_, ArchivePreviewCache>, request_id: String) {
    cache.cancel(&request_id);
}

#[tauri::command]
pub fn release_archive_preview(cache: State<'_, ArchivePreviewCache>, token: String) {
    cache.release(&token);
}

#[cfg(test)]
mod tests {
    use super::{
        detect_mime_type, is_archive_name, looks_like_text, storage_extension, ArchivePreviewCache,
        PendingPreview, PreviewKey, TEXT_PREVIEW_LIMIT,
    };
    use std::fs;
    use std::path::Path;
    use std::process::Command;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Arc;

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_directory(name: &str) -> std::path::PathBuf {
        let suffix = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "ghost-archive-preview-test-{name}-{}-{suffix}",
            std::process::id(),
        ));
        fs::create_dir(&directory).expect("test directory should be created");
        directory
    }

    fn create_archive(root: &Path, name: &str) -> std::path::PathBuf {
        let source = root.join(format!("source-{name}"));
        fs::create_dir(&source).expect("archive source should be created");
        fs::write(source.join("README.md"), "preview payload")
            .expect("archive source should be written");
        let archive = root.join(name);
        let status = Command::new("/usr/bin/tar")
            .arg("-acf")
            .arg(&archive)
            .arg("-C")
            .arg(&source)
            .arg(".")
            .status()
            .expect("system archive creator should start");
        assert!(status.success(), "{name} should be created");
        archive
    }

    fn create_stream(
        root: &Path,
        source_name: &str,
        output_name: &str,
        tool: &str,
    ) -> std::path::PathBuf {
        let source = root.join(source_name);
        fs::write(&source, "raw stream preview").expect("stream source should be written");
        let output = root.join(output_name);
        let output_file = fs::File::create(&output).expect("stream output should be created");
        let status = Command::new(tool)
            .arg("-c")
            .arg(&source)
            .stdout(output_file)
            .status()
            .expect("system compressor should start");
        assert!(status.success(), "raw stream should be created");
        output
    }

    #[test]
    fn rejects_nested_archive_names() {
        assert!(is_archive_name("backup.tar.gz"));
        assert!(!is_archive_name("archive-notes.txt"));
    }

    #[test]
    fn identifies_text_and_safe_storage_extensions() {
        assert!(looks_like_text(b"hello\nworld"));
        assert!(!looks_like_text(b"hello\0world"));
        assert_eq!(
            storage_extension(Some("image/jpeg"), "payload"),
            Some("jpg".into())
        );
        assert_eq!(
            storage_extension(Some("text/plain"), "notes.bin"),
            Some("txt".into())
        );
        assert_eq!(storage_extension(None, "notes.SWIFT"), Some("swift".into()));
        assert_eq!(
            storage_extension(Some("application/octet-stream"), "not-text.txt"),
            None
        );
        assert_eq!(detect_mime_type(Path::new("/definitely/missing")), None);
    }

    #[test]
    fn materializes_entries_from_common_container_families_and_reuses_the_cache() {
        let root = test_directory("containers");
        for name in [
            "sample.zip",
            "sample.tar",
            "sample.tar.gz",
            "sample.tgz",
            "sample.tar.bz2",
            "sample.tbz",
            "sample.tbz2",
            "sample.tar.xz",
            "sample.txz",
            "sample.tar.zst",
            "sample.tzst",
            "sample.cpio",
            "sample.cpgz",
            "sample.7z",
        ] {
            let archive = create_archive(&root, name);
            let cache = ArchivePreviewCache::new_in_root(root.join(format!("cache-{name}")))
                .expect("preview cache should be created");
            let artifact = cache
                .materialize(
                    archive.to_str().unwrap(),
                    "README.md",
                    Arc::new(AtomicBool::new(false)),
                )
                .unwrap_or_else(|error| panic!("{name} should preview: {error}"));
            assert_eq!(artifact.display_name, "README.md");
            assert_eq!(
                fs::read_to_string(&artifact.path).unwrap(),
                "preview payload"
            );
            assert_eq!(artifact.mime_type.as_deref(), Some("text/plain"));

            let cached = cache
                .materialize(
                    archive.to_str().unwrap(),
                    "README.md",
                    Arc::new(AtomicBool::new(false)),
                )
                .expect("the completed preview should be reused");
            assert_eq!(cached.token, artifact.token);
            cache.release(&artifact.token);
            cache.release(&artifact.token);
            cache.cleanup_session();
        }
        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn materializes_raw_gzip_and_bzip2_through_the_same_cache() {
        let root = test_directory("raw-streams");
        let gzip = create_stream(&root, "notes.md", "renamed.gz", "/usr/bin/gzip");
        let bzip = create_stream(&root, "photo.txt", "renamed.bz2", "/usr/bin/bzip2");
        let cache = ArchivePreviewCache::new_in_root(root.join("cache")).unwrap();

        let gzip_artifact = cache
            .materialize(
                gzip.to_str().unwrap(),
                "notes.md",
                Arc::new(AtomicBool::new(false)),
            )
            .expect("gzip stream should preview");
        assert_eq!(
            fs::read_to_string(&gzip_artifact.path).unwrap(),
            "raw stream preview"
        );
        assert_eq!(gzip_artifact.mime_type.as_deref(), Some("text/plain"));

        let bzip_artifact = cache
            .materialize(
                bzip.to_str().unwrap(),
                "renamed",
                Arc::new(AtomicBool::new(false)),
            )
            .expect("bzip2 stream should preview");
        assert_eq!(
            fs::read_to_string(&bzip_artifact.path).unwrap(),
            "raw stream preview"
        );
        assert_eq!(bzip_artifact.display_name, "renamed");

        cache.release(&gzip_artifact.token);
        cache.release(&bzip_artifact.token);
        cache.cleanup_session();
        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn purges_abandoned_sessions_without_following_cache_symlinks() {
        let root = test_directory("startup-cleanup");
        let cache_root = root.join("cache");
        let abandoned = cache_root.join("session-abandoned");
        fs::create_dir_all(&abandoned).unwrap();
        fs::write(abandoned.join("payload.partial"), "partial").unwrap();
        let outside = root.join("keep.txt");
        fs::write(&outside, "keep").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, cache_root.join("outside-link")).unwrap();

        let cache = ArchivePreviewCache::new_in_root(cache_root.clone())
            .expect("cache startup should purge abandoned entries");
        assert_eq!(fs::read_to_string(&outside).unwrap(), "keep");
        let remaining = fs::read_dir(&cache_root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect::<Vec<_>>();
        assert_eq!(remaining, vec![cache.shared.session_directory.clone()]);

        #[cfg(unix)]
        {
            let external_directory = root.join("external-cache-target");
            fs::create_dir(&external_directory).unwrap();
            let linked_root = root.join("linked-cache-root");
            std::os::unix::fs::symlink(&external_directory, &linked_root).unwrap();
            let error = ArchivePreviewCache::new_in_root(linked_root)
                .err()
                .expect("a linked cache root should be rejected");
            assert!(error.contains("not a safe directory"));
        }

        cache.cleanup_session();
        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn evicts_inactive_entries_when_the_session_budget_is_exceeded() {
        let root = test_directory("lru");
        let archive = create_archive(&root, "sample.zip");
        let cache = ArchivePreviewCache::new_in_root(root.join("cache")).unwrap();
        let artifact = cache
            .materialize(
                archive.to_str().unwrap(),
                "README.md",
                Arc::new(AtomicBool::new(false)),
            )
            .unwrap();
        {
            let mut index = cache.shared.index.lock().unwrap();
            index.total_bytes = super::CACHE_BUDGET + 1;
        }
        cache.release(&artifact.token);
        assert!(!Path::new(&artifact.path).exists());
        assert!(cache.shared.index.lock().unwrap().entries.is_empty());

        cache.cleanup_session();
        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn deduplicates_concurrent_publications_for_the_same_entry() {
        let root = test_directory("deduplicated-publication");
        let cache = ArchivePreviewCache::new_in_root(root.join("cache")).unwrap();
        let key = PreviewKey {
            archive_path: "/tmp/sample.zip".to_string(),
            archive_size: 100,
            archive_modified_ns: 200,
            entry_path: "README.md".to_string(),
        };
        let pending = |token: &str| {
            let partial_directory = cache
                .shared
                .session_directory
                .join(format!("{token}.partial"));
            fs::create_dir(&partial_directory).unwrap();
            let artifact_path = partial_directory.join("payload.txt");
            fs::write(&artifact_path, "same preview").unwrap();
            PendingPreview {
                partial_directory,
                artifact_path,
                display_name: "README.md".to_string(),
                mime_type: Some("text/plain".to_string()),
                size_bytes: 12,
                token: token.to_string(),
            }
        };

        let first = cache.publish(key.clone(), pending("preview-a")).unwrap();
        let second = cache.publish(key, pending("preview-b")).unwrap();

        assert_eq!(first.token, "preview-a");
        assert_eq!(second.token, first.token);
        let index = cache.shared.index.lock().unwrap();
        assert_eq!(index.entries.len(), 1);
        assert_eq!(index.entries[&first.token].leases, 2);
        drop(index);
        assert!(!cache.shared.session_directory.join("preview-b").exists());

        cache.release(&first.token);
        cache.release(&second.token);
        cache.cleanup_session();
        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn rejects_duplicate_link_nested_oversized_and_cancelled_entries() {
        let root = test_directory("rejections");
        let source = root.join("source");
        fs::create_dir(&source).unwrap();
        fs::write(
            source.join("large.txt"),
            vec![b'a'; (TEXT_PREVIEW_LIMIT + 1) as usize],
        )
        .unwrap();
        fs::write(
            source.join("mislabeled.txt"),
            vec![0_u8; (TEXT_PREVIEW_LIMIT + 1) as usize],
        )
        .unwrap();
        let large_archive = root.join("large.zip");
        let status = Command::new("/usr/bin/tar")
            .args(["-acf"])
            .arg(&large_archive)
            .arg("-C")
            .arg(&source)
            .arg(".")
            .status()
            .unwrap();
        assert!(status.success());
        let cache = ArchivePreviewCache::new_in_root(root.join("cache")).unwrap();
        let oversized = cache
            .materialize(
                large_archive.to_str().unwrap(),
                "large.txt",
                Arc::new(AtomicBool::new(false)),
            )
            .expect_err("large text should be rejected during bounded materialization");
        assert!(oversized.contains("10 MiB"));

        let ordinary = create_archive(&root, "ordinary.zip");
        let cancelled = cache
            .materialize(
                ordinary.to_str().unwrap(),
                "README.md",
                Arc::new(AtomicBool::new(true)),
            )
            .expect_err("cancelled materialization should stop");
        assert_eq!(cancelled, "Archive preview cancelled");
        assert!(fs::read_dir(&cache.shared.session_directory)
            .unwrap()
            .next()
            .is_none());

        let mislabeled = cache
            .materialize(
                large_archive.to_str().unwrap(),
                "mislabeled.txt",
                Arc::new(AtomicBool::new(false)),
            )
            .expect("binary content should not inherit a text limit from its extension");
        assert_eq!(mislabeled.size_bytes, TEXT_PREVIEW_LIMIT + 1);
        assert_eq!(
            mislabeled.mime_type.as_deref(),
            Some("application/octet-stream")
        );
        assert!(Path::new(&mislabeled.path).extension().is_none());
        cache.release(&mislabeled.token);

        let duplicate_source = root.join("duplicate-source");
        fs::create_dir(&duplicate_source).unwrap();
        fs::write(duplicate_source.join("same.txt"), "first").unwrap();
        let duplicate_archive = root.join("duplicate.tar");
        assert!(Command::new("/usr/bin/tar")
            .arg("-cf")
            .arg(&duplicate_archive)
            .arg("-C")
            .arg(&duplicate_source)
            .arg("same.txt")
            .status()
            .unwrap()
            .success());
        fs::write(duplicate_source.join("same.txt"), "second").unwrap();
        assert!(Command::new("/usr/bin/tar")
            .arg("-rf")
            .arg(&duplicate_archive)
            .arg("-C")
            .arg(&duplicate_source)
            .arg("same.txt")
            .status()
            .unwrap()
            .success());
        let duplicate_error = cache
            .materialize(
                duplicate_archive.to_str().unwrap(),
                "same.txt",
                Arc::new(AtomicBool::new(false)),
            )
            .expect_err("duplicate paths should be rejected");
        assert!(duplicate_error.contains("Duplicate"));

        let special_source = root.join("special-source");
        fs::create_dir(&special_source).unwrap();
        fs::write(special_source.join("inner.zip"), "not really an archive").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("inner.zip", special_source.join("shortcut")).unwrap();
        let special_archive = root.join("special.tar");
        assert!(Command::new("/usr/bin/tar")
            .arg("-cf")
            .arg(&special_archive)
            .arg("-C")
            .arg(&special_source)
            .arg(".")
            .status()
            .unwrap()
            .success());
        let nested_error = cache
            .materialize(
                special_archive.to_str().unwrap(),
                "inner.zip",
                Arc::new(AtomicBool::new(false)),
            )
            .expect_err("nested archives should be rejected");
        assert!(nested_error.contains("Nested"));
        #[cfg(unix)]
        {
            let link_error = cache
                .materialize(
                    special_archive.to_str().unwrap(),
                    "shortcut",
                    Arc::new(AtomicBool::new(false)),
                )
                .expect_err("links should be rejected");
            assert!(link_error.contains("regular files"));
        }

        fs::remove_dir_all(root).expect("test directory should be removed");
    }
}
