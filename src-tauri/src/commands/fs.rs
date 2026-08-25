use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;
use pulldown_cmark::{Parser, Options, html};
use tauri::{Manager, State};

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);
const TEXT_PROBE_BYTES: u64 = 64 * 1024;
const COMPLETE_TEXT_READ_MAX_BYTES: u64 = 20 * 1024 * 1024;
const INLINE_IMAGE_IMPORT_MAX_BYTES: usize = 64 * 1024 * 1024;
const SOURCE_CHUNK_MAX_BYTES: usize = 4 * 1024 * 1024;
const SOURCE_LINE_SCAN_LIMIT: u64 = 5_000_001;
// Must match EXTREME_SOURCE_MAX_BYTES in src/lib/resource-policy.ts. Files
// beyond this boundary are probed only; scanning the full file here would
// defeat the fast bounded-viewer path selected by the frontend.
const EXTREME_SOURCE_BYTES: u64 = 128 * 1024 * 1024;

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

struct SourceSaveSession {
    target_path: PathBuf,
    temporary_path: PathBuf,
    temporary_file: fs::File,
    expected_version: Option<FileVersionToken>,
    force: bool,
}

/// Staged source saves keep each IPC message bounded while preserving the
/// atomic-replacement behavior used by ordinary document saves.
pub struct SourceSaveState {
    sessions: Mutex<HashMap<u64, SourceSaveSession>>,
    next_id: AtomicU64,
}

#[derive(Default)]
struct LargeTextSearchRegistry {
    active: HashSet<String>,
    cancelled: HashSet<String>,
}

pub struct LargeTextSearchState(Mutex<LargeTextSearchRegistry>);

struct ActiveLargeTextSearch<'a> {
    registry: &'a Mutex<LargeTextSearchRegistry>,
    search_id: String,
}

impl Drop for ActiveLargeTextSearch<'_> {
    fn drop(&mut self) {
        if let Ok(mut registry) = self.registry.lock() {
            registry.active.remove(&self.search_id);
            registry.cancelled.remove(&self.search_id);
        }
    }
}

impl LargeTextSearchState {
    pub fn new() -> Self {
        Self(Mutex::new(LargeTextSearchRegistry::default()))
    }
}

impl SourceSaveState {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
        }
    }
}

impl Drop for SourceSaveState {
    fn drop(&mut self) {
        if let Ok(sessions) = self.sessions.get_mut() {
            for (_, session) in sessions.drain() {
                drop(session.temporary_file);
                let _ = fs::remove_file(session.temporary_path);
            }
        }
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
pub async fn read_directory(
    path: String,
    extensions: Vec<String>,
    max_depth: Option<usize>,
    show_hidden: Option<bool>,
) -> Result<Vec<FileEntry>, String> {
    let dir_path = Path::new(&path);
    if !dir_path.exists() {
        return Err(format!("Directory does not exist: {}", path));
    }
    if !dir_path.is_dir() {
        return Err(format!("Path is not a directory: {}", path));
    }

    let limit = max_depth.unwrap_or(32);
    read_dir_recursive(
        dir_path,
        &extensions,
        0,
        limit,
        show_hidden.unwrap_or(false),
    )
    .map_err(|e| e.to_string())
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

fn read_dir_recursive(
    dir: &Path,
    extensions: &[String],
    depth: usize,
    max_depth: usize,
    show_hidden: bool,
) -> Result<Vec<FileEntry>, std::io::Error> {
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

        if !show_hidden && name.starts_with('.') {
            continue;
        }

        let path = entry.path();
        let is_dir =
            entry.file_type().map(|t| t.is_dir()).unwrap_or(false) && !is_file_package(&path);

        if is_dir {
            let children = read_dir_recursive(
                &path,
                extensions,
                depth + 1,
                max_depth,
                show_hidden,
            )?;
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
    let mut file = fs::File::open(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(COMPLETE_TEXT_READ_MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to read file: {}", e))?;
    if bytes.len() as u64 > COMPLETE_TEXT_READ_MAX_BYTES {
        return Err(format!(
            "Complete text reads are limited to {} MiB; use the source or windowed reader",
            COMPLETE_TEXT_READ_MAX_BYTES / (1024 * 1024)
        ));
    }
    String::from_utf8(bytes).map_err(|e| format!("Failed to read file as UTF-8: {}", e))
}

#[derive(Debug, Serialize)]
pub struct TextPreview {
    pub text: String,
    pub truncated: bool,
}

/// Return a small textual prefix for transient UI such as Quick Open. This
/// command never scans or transfers the complete file.
#[tauri::command]
pub async fn read_text_preview(path: String, max_bytes: Option<usize>) -> Result<Option<TextPreview>, String> {
    let limit = max_bytes.unwrap_or(64 * 1024).clamp(1024, 256 * 1024);
    let metadata = fs::metadata(&path).map_err(|error| format!("Failed to inspect preview: {}", error))?;
    let mut file = fs::File::open(&path).map_err(|error| format!("Failed to read preview: {}", error))?;
    let mut bytes = vec![0u8; limit + 4];
    let read = file
        .read(&mut bytes)
        .map_err(|error| format!("Failed to read preview: {}", error))?;
    bytes.truncate(read);
    let Some(sample) = decode_text_probe(&bytes[..bytes.len().min(limit)]) else {
        return Ok(None);
    };
    if !looks_like_text(sample) {
        return Ok(None);
    }
    Ok(Some(TextPreview {
        text: sample.to_string(),
        truncated: read > sample.len() || metadata.len() > sample.len() as u64,
    }))
}

#[derive(Debug, Serialize)]
pub struct SourceReadDiagnostics {
    pub elapsed_us: u64,
    pub bytes_read: u64,
}

#[derive(Debug, Serialize)]
pub struct SourceInspection {
    pub version: FileVersionToken,
    pub size_bytes: u64,
    pub line_count: u64,
    pub line_count_complete: bool,
    pub max_line_bytes: u64,
    pub looks_textual: bool,
    pub line_separator: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<SourceReadDiagnostics>,
}

/// Inspect source structure before the frontend decides whether any complete
/// body should cross IPC. Line counting stops at the extreme-viewer threshold.
#[tauri::command]
pub async fn inspect_source(path: String, probe_text: Option<bool>) -> Result<SourceInspection, String> {
    let started_at = std::time::Instant::now();
    let source_path = Path::new(&path);
    let version = file_version(source_path)
        .map_err(|error| format!("Failed to inspect source: {}", error))?;
    // Finder packages such as .app bundles are directories on disk but behave
    // like files in macOS. A bounded negative text probe lets the shared
    // loader route them to the external viewer instead of failing to open.
    if source_path.is_dir() {
        return Ok(SourceInspection {
            size_bytes: version.size_bytes,
            version,
            line_count: 0,
            line_count_complete: true,
            max_line_bytes: 0,
            looks_textual: false,
            line_separator: "\n".to_string(),
            diagnostics: cfg!(debug_assertions).then(|| SourceReadDiagnostics {
                elapsed_us: started_at.elapsed().as_micros().min(u64::MAX as u128) as u64,
                bytes_read: 0,
            }),
        });
    }
    let mut file = fs::File::open(source_path)
        .map_err(|error| format!("Failed to inspect source: {}", error))?;
    let mut buffer = vec![0u8; 64 * 1024];
    let mut probe = Vec::with_capacity(TEXT_PROBE_BYTES as usize);
    let mut breaks = 0u64;
    let mut current_line_bytes = 0u64;
    let mut max_line_bytes = 0u64;
    let mut pending_cr = false;
    let mut separator: Option<&'static str> = None;
    let mut complete = true;
    let mut bytes_read = 0u64;
    let probe_only = version.size_bytes > EXTREME_SOURCE_BYTES;

    'read: loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Failed to inspect source: {}", error))?;
        if read == 0 {
            if pending_cr {
                breaks += 1;
                max_line_bytes = max_line_bytes.max(current_line_bytes);
                separator.get_or_insert("\r");
            }
            break;
        }
        bytes_read = bytes_read.saturating_add(read as u64);

        if probe.len() < TEXT_PROBE_BYTES as usize {
            let remaining = TEXT_PROBE_BYTES as usize - probe.len();
            probe.extend_from_slice(&buffer[..read.min(remaining)]);
        }

        if probe_only && probe.len() >= TEXT_PROBE_BYTES as usize {
            complete = false;
            break;
        }

        for &byte in &buffer[..read] {
            if pending_cr {
                pending_cr = false;
                if byte == b'\n' {
                    breaks += 1;
                    max_line_bytes = max_line_bytes.max(current_line_bytes);
                    current_line_bytes = 0;
                    separator.get_or_insert("\r\n");
                    if breaks >= SOURCE_LINE_SCAN_LIMIT {
                        complete = false;
                        break 'read;
                    }
                    continue;
                }
                breaks += 1;
                max_line_bytes = max_line_bytes.max(current_line_bytes);
                current_line_bytes = 0;
                separator.get_or_insert("\r");
                if breaks >= SOURCE_LINE_SCAN_LIMIT {
                    complete = false;
                    break 'read;
                }
            }

            if byte == b'\r' {
                pending_cr = true;
            } else if byte == b'\n' {
                breaks += 1;
                max_line_bytes = max_line_bytes.max(current_line_bytes);
                current_line_bytes = 0;
                separator.get_or_insert("\n");
                if breaks >= SOURCE_LINE_SCAN_LIMIT {
                    complete = false;
                    break 'read;
                }
            } else {
                current_line_bytes = current_line_bytes.saturating_add(1);
            }
        }

    }

    max_line_bytes = max_line_bytes.max(current_line_bytes);

    let looks_textual = if probe_text.unwrap_or(false) {
        decode_text_probe(&probe).is_some_and(looks_like_text)
    } else {
        true
    };
    let line_count = if version.size_bytes == 0 { 1 } else { breaks.saturating_add(1) };

    Ok(SourceInspection {
        size_bytes: version.size_bytes,
        version,
        line_count,
        line_count_complete: complete,
        max_line_bytes,
        looks_textual,
        line_separator: separator.unwrap_or("\n").to_string(),
        diagnostics: cfg!(debug_assertions).then(|| SourceReadDiagnostics {
            elapsed_us: started_at.elapsed().as_micros().min(u64::MAX as u128) as u64,
            bytes_read,
        }),
    })
}

#[derive(Debug, Serialize)]
pub struct SourceChunk {
    pub text: String,
    pub next_offset: u64,
    pub eof: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<SourceReadDiagnostics>,
}

fn versions_match(path: &Path, expected: &FileVersionToken) -> Result<(), String> {
    let current = file_version(path)
        .map_err(|error| format!("Failed to verify source: {}", error))?;
    if &current == expected {
        Ok(())
    } else {
        Err("The file changed on disk while Ghost was reading it".to_string())
    }
}

/// Read one bounded UTF-8 chunk. Offsets returned by this command always land
/// on a character boundary, and a CRLF pair is kept in the same response.
struct SourceChunkBytes {
    bytes: Vec<u8>,
    next_offset: u64,
    eof: bool,
    diagnostics: Option<SourceReadDiagnostics>,
}

fn read_source_chunk_bytes(
    path: &Path,
    offset: u64,
    max_bytes: Option<usize>,
    expected_version: &FileVersionToken,
) -> Result<SourceChunkBytes, String> {
    let started_at = std::time::Instant::now();
    versions_match(path, expected_version)?;
    let limit = max_bytes.unwrap_or(SOURCE_CHUNK_MAX_BYTES).clamp(4, SOURCE_CHUNK_MAX_BYTES);
    let mut file = fs::File::open(path)
        .map_err(|error| format!("Failed to read source: {}", error))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| format!("Failed to seek source: {}", error))?;

    let mut bytes = vec![0u8; limit + 4];
    let read = file
        .read(&mut bytes)
        .map_err(|error| format!("Failed to read source: {}", error))?;
    bytes.truncate(read);
    if read == 0 {
        return Ok(SourceChunkBytes {
            bytes,
            next_offset: offset,
            eof: true,
            diagnostics: cfg!(debug_assertions).then(|| SourceReadDiagnostics {
                elapsed_us: started_at.elapsed().as_micros().min(u64::MAX as u128) as u64,
                bytes_read: 0,
            }),
        });
    }

    let mut end = read.min(limit);
    loop {
        match std::str::from_utf8(&bytes[..end]) {
            Ok(_) => break,
            Err(error) if error.error_len().is_none() => {
                end = error.valid_up_to();
                if end == 0 {
                    return Err("Source contains an incomplete UTF-8 character larger than the read boundary".to_string());
                }
            }
            Err(error) => {
                return Err(format!("Source is not valid UTF-8 near byte {}", offset + error.valid_up_to() as u64));
            }
        }
    }
    if end < read && end > 0 && bytes[end - 1] == b'\r' && bytes[end] == b'\n' {
        end += 1;
    }

    bytes.truncate(end);
    let next_offset = offset + end as u64;
    Ok(SourceChunkBytes {
        bytes,
        next_offset,
        eof: next_offset >= expected_version.size_bytes,
        diagnostics: cfg!(debug_assertions).then(|| SourceReadDiagnostics {
            elapsed_us: started_at.elapsed().as_micros().min(u64::MAX as u128) as u64,
            bytes_read: read as u64,
        }),
    })
}

#[tauri::command]
pub async fn read_source_chunk(
    path: String,
    offset: u64,
    max_bytes: Option<usize>,
    expected_version: FileVersionToken,
) -> Result<SourceChunk, String> {
    let chunk = read_source_chunk_bytes(Path::new(&path), offset, max_bytes, &expected_version)?;
    let text = String::from_utf8(chunk.bytes)
        .map_err(|error| format!("Source is not valid UTF-8: {}", error))?;
    Ok(SourceChunk {
        text,
        next_offset: chunk.next_offset,
        eof: chunk.eof,
        diagnostics: chunk.diagnostics,
    })
}

/// Raw source transport for the WebView. Returning `tauri::ipc::Response`
/// selects Tauri's octet-stream path, so large chunks arrive as ArrayBuffer
/// instead of being escaped and parsed as JSON strings.
#[tauri::command]
pub async fn read_source_chunk_raw(
    path: String,
    offset: u64,
    max_bytes: Option<usize>,
    expected_version: FileVersionToken,
) -> Result<tauri::ipc::Response, String> {
    let chunk = read_source_chunk_bytes(Path::new(&path), offset, max_bytes, &expected_version)?;
    Ok(tauri::ipc::Response::new(chunk.bytes))
}

#[derive(Debug, Serialize)]
pub struct TextWindow {
    pub text: String,
    pub offset: u64,
    pub next_offset: u64,
    pub eof: bool,
    pub starts_mid_line: bool,
    pub ends_mid_line: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<SourceReadDiagnostics>,
}

#[tauri::command]
pub async fn read_text_window(
    path: String,
    offset: u64,
    max_bytes: Option<usize>,
    expected_version: FileVersionToken,
) -> Result<TextWindow, String> {
    let started_at = std::time::Instant::now();
    let source_path = Path::new(&path);
    versions_match(source_path, &expected_version)?;
    let limit = max_bytes.unwrap_or(SOURCE_CHUNK_MAX_BYTES).clamp(4, SOURCE_CHUNK_MAX_BYTES);
    let requested = offset.min(expected_version.size_bytes);
    let mut file = fs::File::open(source_path)
        .map_err(|error| format!("Failed to read text window: {}", error))?;
    file.seek(SeekFrom::Start(requested))
        .map_err(|error| format!("Failed to seek text window: {}", error))?;
    let mut bytes = vec![0u8; limit + 4];
    let read = file
        .read(&mut bytes)
        .map_err(|error| format!("Failed to read text window: {}", error))?;
    bytes.truncate(read);

    let mut leading = 0usize;
    while leading < bytes.len() && (bytes[leading] & 0b1100_0000) == 0b1000_0000 {
        leading += 1;
    }
    let actual_offset = requested + leading as u64;
    let available = &bytes[leading..];
    let mut end = available.len().min(limit);
    loop {
        match std::str::from_utf8(&available[..end]) {
            Ok(_) => break,
            Err(error) if error.error_len().is_none() => {
                end = error.valid_up_to();
                if end == 0 && !available.is_empty() {
                    return Err("Text window could not align to UTF-8".to_string());
                }
            }
            Err(error) => {
                return Err(format!(
                    "Source is not valid UTF-8 near byte {}",
                    actual_offset + error.valid_up_to() as u64
                ));
            }
        }
    }
    if end < available.len() && end > 0 && available[end - 1] == b'\r' && available[end] == b'\n' {
        end += 1;
    }
    let next_offset = actual_offset + end as u64;
    let eof = next_offset >= expected_version.size_bytes;
    let text = std::str::from_utf8(&available[..end])
        .map_err(|error| format!("Source is not valid UTF-8: {}", error))?
        .to_string();

    let starts_mid_line = if actual_offset == 0 {
        false
    } else {
        let mut previous = [0u8; 1];
        let mut prior = fs::File::open(source_path)
            .map_err(|error| format!("Failed to inspect text window: {}", error))?;
        prior
            .seek(SeekFrom::Start(actual_offset - 1))
            .and_then(|_| prior.read_exact(&mut previous))
            .map_err(|error| format!("Failed to inspect text window: {}", error))?;
        !matches!(previous[0], b'\n' | b'\r')
    };
    let ends_mid_line = !eof && !text.ends_with(['\n', '\r']);

    Ok(TextWindow {
        text,
        offset: actual_offset,
        next_offset,
        eof,
        starts_mid_line,
        ends_mid_line,
        diagnostics: cfg!(debug_assertions).then(|| SourceReadDiagnostics {
            elapsed_us: started_at.elapsed().as_micros().min(u64::MAX as u128) as u64,
            bytes_read: read as u64,
        }),
    })
}

#[derive(Debug, Serialize)]
pub struct LargeTextSearchResult {
    pub offsets: Vec<u64>,
    pub reached_end: bool,
    pub cancelled: bool,
}

#[tauri::command]
pub fn cancel_large_text_search(
    state: State<'_, LargeTextSearchState>,
    search_id: String,
) -> Result<(), String> {
    let mut registry = state
        .0
        .lock()
        .map_err(|_| "The text search queue is unavailable".to_string())?;
    if registry.active.contains(&search_id) {
        registry.cancelled.insert(search_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn search_large_text(
    state: State<'_, LargeTextSearchState>,
    search_id: String,
    path: String,
    query: String,
    expected_version: FileVersionToken,
    max_results: Option<usize>,
) -> Result<LargeTextSearchResult, String> {
    if query.is_empty() {
        return Ok(LargeTextSearchResult { offsets: Vec::new(), reached_end: true, cancelled: false });
    }
    let needle = query.into_bytes();
    if needle.len() > 64 * 1024 {
        return Err("Search terms are limited to 64 KB".to_string());
    }
    let result_limit = max_results.unwrap_or(200).clamp(1, 1000);
    let source_path = Path::new(&path);
    versions_match(source_path, &expected_version)?;
    let mut file = fs::File::open(source_path)
        .map_err(|error| format!("Failed to search source: {}", error))?;
    state
        .0
        .lock()
        .map_err(|_| "The text search queue is unavailable".to_string())?
        .active
        .insert(search_id.clone());
    let _active_search = ActiveLargeTextSearch {
        registry: &state.0,
        search_id: search_id.clone(),
    };
    let mut buffer = vec![0u8; SOURCE_CHUNK_MAX_BYTES];
    let mut carry = Vec::<u8>::new();
    let mut absolute_offset = 0u64;
    let mut offsets = Vec::new();
    let mut reached_end = false;
    let mut cancelled = false;

    loop {
        if state
            .0
            .lock()
            .map_err(|_| "The text search queue is unavailable".to_string())?
            .cancelled
            .contains(&search_id)
        {
            cancelled = true;
            break;
        }
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Failed to search source: {}", error))?;
        if read == 0 {
            reached_end = true;
            break;
        }
        let base_offset = absolute_offset.saturating_sub(carry.len() as u64);
        let mut haystack = Vec::with_capacity(carry.len() + read);
        haystack.extend_from_slice(&carry);
        haystack.extend_from_slice(&buffer[..read]);
        if haystack.len() >= needle.len() {
            let first_lower = needle[0].to_ascii_lowercase();
            let first_upper = needle[0].to_ascii_uppercase();
            let mut inspect_candidate = |index: usize| {
                if haystack[index..index + needle.len()].eq_ignore_ascii_case(&needle) {
                    let match_offset = base_offset + index as u64;
                    if offsets.last().copied() != Some(match_offset) {
                        offsets.push(match_offset);
                    }
                }
                offsets.len() >= result_limit
            };
            if first_lower == first_upper {
                for index in memchr::memchr_iter(first_lower, &haystack[..=haystack.len() - needle.len()]) {
                    if inspect_candidate(index) {
                        break;
                    }
                }
            } else {
                for index in memchr::memchr2_iter(first_lower, first_upper, &haystack[..=haystack.len() - needle.len()]) {
                    if inspect_candidate(index) {
                        break;
                    }
                }
            }
        }
        absolute_offset += read as u64;
        if offsets.len() >= result_limit {
            break;
        }
        let overlap = needle.len().saturating_sub(1).min(haystack.len());
        carry.clear();
        carry.extend_from_slice(&haystack[haystack.len() - overlap..]);
    }
    Ok(LargeTextSearchResult { offsets, reached_end, cancelled })
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

    let mut complete = Vec::new();
    let mut complete_file = fs::File::open(&path)
        .map_err(|error| format!("Failed to read file: {}", error))?;
    Read::by_ref(&mut complete_file)
        .take(COMPLETE_TEXT_READ_MAX_BYTES + 1)
        .read_to_end(&mut complete)
        .map_err(|error| format!("Failed to read file: {}", error))?;
    if complete.len() as u64 > COMPLETE_TEXT_READ_MAX_BYTES {
        return Err(format!(
            "Complete text probes are limited to {} MiB; use inspect_source instead",
            COMPLETE_TEXT_READ_MAX_BYTES / (1024 * 1024)
        ));
    }

    // The bounded sample looked textual. Only now load the complete file, and
    // still reject invalid UTF-8 or control-heavy content found after the probe.
    Ok(decode_text_bytes(&complete))
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

const IMAGE_DECODE_BUDGET_BYTES: u64 = 128 * 1024 * 1024;
const IMAGE_MAX_DECODED_PIXELS: u64 = 40_000_000;
const IMAGE_THUMBNAIL_MAX_OUTPUT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct ImageInspection {
    pub width: u64,
    pub height: u64,
    pub frame_count: usize,
    pub estimated_decoded_bytes: u64,
    pub needs_thumbnail: bool,
    pub format: Option<String>,
}

#[cfg(target_os = "macos")]
fn image_source(path: &Path) -> Result<objc2_core_foundation::CFRetained<objc2_image_io::CGImageSource>, String> {
    use objc2_core_foundation::CFURL;
    use objc2_image_io::CGImageSource;

    let url = CFURL::from_file_path(path)
        .ok_or_else(|| "Could not create a file URL for the image".to_string())?;
    unsafe { CGImageSource::with_url(&url, None) }
        .ok_or_else(|| "ImageIO could not open this image".to_string())
}

#[cfg(target_os = "macos")]
fn image_property_number(
    properties: &objc2_core_foundation::CFDictionary,
    key: &objc2_core_foundation::CFString,
) -> Option<u64> {
    use objc2_core_foundation::{CFDictionary, CFNumber, CFString, CFType};
    let typed: &CFDictionary<CFString, CFType> = unsafe { properties.cast_unchecked() };
    let value = unsafe { typed.get_unchecked(key) }?;
    value.downcast_ref::<CFNumber>()?.as_i64().and_then(|number| u64::try_from(number).ok())
}

#[cfg(target_os = "macos")]
fn inspect_image_native(path: &Path) -> Result<ImageInspection, String> {
    use objc2_image_io::{kCGImagePropertyPixelHeight, kCGImagePropertyPixelWidth};

    let source = image_source(path)?;
    let properties = unsafe { source.properties_at_index(0, None) }
        .ok_or_else(|| "ImageIO could not read image dimensions".to_string())?;
    let width = image_property_number(&properties, unsafe { kCGImagePropertyPixelWidth })
        .ok_or_else(|| "Image width is unavailable".to_string())?;
    let height = image_property_number(&properties, unsafe { kCGImagePropertyPixelHeight })
        .ok_or_else(|| "Image height is unavailable".to_string())?;
    let frame_count = unsafe { source.count() };
    let pixels = width.saturating_mul(height);
    // Use the full frame count as a conservative upper bound. WebKit's exact
    // animation cache varies by codec, but treating a many-frame GIF/TIFF as a
    // single bitmap can understate its working set by orders of magnitude.
    let estimated_decoded_bytes = pixels
        .saturating_mul(4)
        .saturating_mul(frame_count.max(1) as u64);
    let extension = path.extension().and_then(|value| value.to_str()).map(|value| value.to_ascii_lowercase());
    let needs_thumbnail = extension.as_deref() == Some("icns")
        || pixels > IMAGE_MAX_DECODED_PIXELS
        || estimated_decoded_bytes > IMAGE_DECODE_BUDGET_BYTES;
    let format = unsafe { source.r#type() }.map(|value| value.to_string());

    Ok(ImageInspection {
        width,
        height,
        frame_count,
        estimated_decoded_bytes,
        needs_thumbnail,
        format,
    })
}

#[cfg(not(target_os = "macos"))]
fn inspect_image_native(_path: &Path) -> Result<ImageInspection, String> {
    Err("Native image inspection is currently supported on macOS only".to_string())
}

#[tauri::command]
pub async fn inspect_image(path: String) -> Result<ImageInspection, String> {
    inspect_image_native(Path::new(&path))
}

#[cfg(target_os = "macos")]
fn render_image_thumbnail(path: &Path, max_pixel_size: u32) -> Result<Vec<u8>, String> {
    use objc2::AnyThread;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep};
    use objc2_core_foundation::{CFBoolean, CFDictionary, CFNumber, CFString, CFType};
    use objc2_image_io::{
        kCGImageSourceCreateThumbnailFromImageAlways,
        kCGImageSourceCreateThumbnailWithTransform,
        kCGImageSourceShouldCacheImmediately,
        kCGImageSourceThumbnailMaxPixelSize,
    };
    use objc2_foundation::NSDictionary;

    let source = image_source(path)?;
    let max_size = CFNumber::new_i64(max_pixel_size as i64);
    let keys: [&CFString; 4] = [
        unsafe { kCGImageSourceCreateThumbnailFromImageAlways },
        unsafe { kCGImageSourceCreateThumbnailWithTransform },
        unsafe { kCGImageSourceShouldCacheImmediately },
        unsafe { kCGImageSourceThumbnailMaxPixelSize },
    ];
    let true_value: &CFType = CFBoolean::new(true).as_ref();
    let max_value: &CFType = max_size.as_ref();
    let values: [&CFType; 4] = [true_value, true_value, true_value, max_value];
    let options = CFDictionary::from_slices(&keys, &values);
    let image = unsafe { source.thumbnail_at_index(0, Some(options.as_opaque())) }
        .ok_or_else(|| "ImageIO could not create a bounded thumbnail".to_string())?;
    let representation = NSBitmapImageRep::initWithCGImage(NSBitmapImageRep::alloc(), &image);
    let properties = NSDictionary::dictionary();
    let png = unsafe {
        representation.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
    }
    .ok_or_else(|| "Could not encode the image thumbnail".to_string())?;
    let bytes = png.to_vec();
    if bytes.len() > IMAGE_THUMBNAIL_MAX_OUTPUT_BYTES {
        return Err("The bounded image thumbnail is unexpectedly large".to_string());
    }
    Ok(bytes)
}

#[cfg(not(target_os = "macos"))]
fn render_image_thumbnail(_path: &Path, _max_pixel_size: u32) -> Result<Vec<u8>, String> {
    Err("Native image thumbnails are currently supported on macOS only".to_string())
}

#[tauri::command]
pub async fn read_image_thumbnail(path: String, max_pixel_size: Option<u32>) -> Result<Vec<u8>, String> {
    let maximum = max_pixel_size.unwrap_or(3072).clamp(256, 4096);
    render_image_thumbnail(Path::new(&path), maximum)
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

/// Atomically replace a literal byte sequence without materializing the file.
/// Used for Ghost's companion-assets path rewrite during rename/duplicate.
fn atomic_replace_literal(path: &Path, needle: &[u8], replacement: &[u8]) -> Result<(), std::io::Error> {
    if needle.is_empty() || needle == replacement {
        return Ok(());
    }

    let (temporary_path, mut temporary_file) = create_temporary_file(path)?;
    let finish = || -> Result<(), std::io::Error> {
        if let Ok(metadata) = fs::metadata(path) {
            temporary_file.set_permissions(metadata.permissions())?;
            copy_extended_attributes(path, &temporary_path)?;
        }

        let mut source = fs::File::open(path)?;
        let mut buffer = vec![0u8; 64 * 1024];
        let mut carry = Vec::<u8>::new();

        loop {
            let read = source.read(&mut buffer)?;
            let eof = read == 0;
            let mut data = Vec::with_capacity(carry.len() + read);
            data.extend_from_slice(&carry);
            data.extend_from_slice(&buffer[..read]);
            let boundary = if eof {
                data.len()
            } else {
                data.len().saturating_sub(needle.len().saturating_sub(1))
            };

            let mut cursor = 0usize;
            while cursor < boundary {
                let Some(relative) = data[cursor..]
                    .windows(needle.len())
                    .position(|candidate| candidate == needle)
                else {
                    break;
                };
                let match_start = cursor + relative;
                if match_start >= boundary {
                    break;
                }
                temporary_file.write_all(&data[cursor..match_start])?;
                temporary_file.write_all(replacement)?;
                cursor = match_start + needle.len();
            }

            if cursor < boundary {
                temporary_file.write_all(&data[cursor..boundary])?;
            }
            let retained_from = cursor.max(boundary).min(data.len());
            carry.clear();
            carry.extend_from_slice(&data[retained_from..]);

            if eof {
                break;
            }
        }

        temporary_file.sync_all()?;
        drop(temporary_file);
        fs::rename(&temporary_path, path)?;
        if let Some(parent) = path.parent() {
            if let Ok(directory) = fs::File::open(parent) {
                let _ = directory.sync_all();
            }
        }
        Ok(())
    };

    let result = finish();
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct FileVersionToken {
    pub canonical_path: String,
    pub size_bytes: u64,
    pub modified_ns: String,
    pub device_id: Option<String>,
    pub file_id: Option<String>,
}

fn file_version(path: &Path) -> Result<FileVersionToken, std::io::Error> {
    let canonical_path = fs::canonicalize(path)?;
    let metadata = fs::metadata(&canonical_path)?;
    let modified_ns = metadata
        .modified()?
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();

    #[cfg(unix)]
    let (device_id, file_id) = {
        use std::os::unix::fs::MetadataExt;
        (Some(metadata.dev().to_string()), Some(metadata.ino().to_string()))
    };
    #[cfg(not(unix))]
    let (device_id, file_id) = (None, None);

    Ok(FileVersionToken {
        canonical_path: canonical_path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
        modified_ns: modified_ns.to_string(),
        device_id,
        file_id,
    })
}

fn source_save_conflict() -> WriteFileError {
    WriteFileError::Conflict {
        message: "The file changed on disk after Ghost opened it. Your edits have not been overwritten."
            .to_string(),
    }
}

fn create_temporary_file(path: &Path) -> Result<(PathBuf, fs::File), std::io::Error> {
    let parent = path.parent().ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidInput, "File has no parent directory")
    })?;
    let file_name = path.file_name().and_then(|name| name.to_str()).unwrap_or("document");

    for _ in 0..100 {
        let suffix = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let candidate = parent.join(format!(
            ".ghost-{}-{}-{}.tmp",
            file_name,
            std::process::id(),
            suffix
        ));
        match OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(file) => return Ok((candidate, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "Could not create a temporary save file",
    ))
}

#[tauri::command]
pub async fn get_file_version(path: String) -> Result<FileVersionToken, String> {
    file_version(Path::new(&path)).map_err(|error| format!("Failed to inspect file: {}", error))
}

#[derive(Debug, Serialize)]
pub struct SourceSaveHandle {
    pub session_id: u64,
}

#[tauri::command]
pub async fn begin_source_save(
    state: State<'_, SourceSaveState>,
    path: String,
    expected_version: Option<FileVersionToken>,
    force: Option<bool>,
) -> Result<SourceSaveHandle, WriteFileError> {
    let target_path = fs::canonicalize(&path)
        .map_err(|error| WriteFileError::io(format!("Failed to prepare save: {}", error)))?;
    if !force.unwrap_or(false) {
        if let Some(expected) = expected_version.as_ref() {
            let current = file_version(&target_path)
                .map_err(|error| WriteFileError::io(format!("Failed to verify file before saving: {}", error)))?;
            if &current != expected {
                return Err(source_save_conflict());
            }
        }
    }

    let (temporary_path, temporary_file) = create_temporary_file(&target_path)
        .map_err(|error| WriteFileError::io(format!("Failed to prepare save: {}", error)))?;
    if let Ok(metadata) = fs::metadata(&target_path) {
        if let Err(error) = temporary_file.set_permissions(metadata.permissions()) {
            let _ = fs::remove_file(&temporary_path);
            return Err(WriteFileError::io(format!("Failed to prepare save: {}", error)));
        }
    }

    let session_id = state.next_id.fetch_add(1, Ordering::Relaxed);
    let session = SourceSaveSession {
        target_path,
        temporary_path,
        temporary_file,
        expected_version,
        force: force.unwrap_or(false),
    };
    state
        .sessions
        .lock()
        .map_err(|_| WriteFileError::io("The source save queue is unavailable"))?
        .insert(session_id, session);

    Ok(SourceSaveHandle { session_id })
}

#[tauri::command]
pub async fn append_source_save(
    state: State<'_, SourceSaveState>,
    session_id: u64,
    chunk: String,
) -> Result<(), WriteFileError> {
    if chunk.len() > SOURCE_CHUNK_MAX_BYTES {
        return Err(WriteFileError::io("A source-save chunk exceeded the 4 MiB limit"));
    }
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| WriteFileError::io("The source save queue is unavailable"))?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| WriteFileError::io("The source save session is no longer available"))?;
    session
        .temporary_file
        .write_all(chunk.as_bytes())
        .map_err(|error| WriteFileError::io(format!("Failed to stage source save: {}", error)))
}

#[tauri::command]
pub async fn abort_source_save(
    state: State<'_, SourceSaveState>,
    session_id: u64,
) -> Result<(), WriteFileError> {
    let session = state
        .sessions
        .lock()
        .map_err(|_| WriteFileError::io("The source save queue is unavailable"))?
        .remove(&session_id);
    if let Some(session) = session {
        drop(session.temporary_file);
        fs::remove_file(session.temporary_path)
            .map_err(|error| WriteFileError::io(format!("Failed to cancel source save: {}", error)))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn commit_source_save(
    write_state: State<'_, FileWriteState>,
    source_state: State<'_, SourceSaveState>,
    session_id: u64,
) -> Result<FileVersionToken, WriteFileError> {
    let session = source_state
        .sessions
        .lock()
        .map_err(|_| WriteFileError::io("The source save queue is unavailable"))?
        .remove(&session_id)
        .ok_or_else(|| WriteFileError::io("The source save session is no longer available"))?;

    let SourceSaveSession {
        target_path,
        temporary_path,
        temporary_file,
        expected_version,
        force,
    } = session;

    let finish = || -> Result<FileVersionToken, WriteFileError> {
        let _write_guard = write_state
            .0
            .lock()
            .map_err(|_| WriteFileError::io("The save queue is unavailable"))?;
        if !force {
            if let Some(expected) = expected_version.as_ref() {
                let current = file_version(&target_path).map_err(|error| {
                    WriteFileError::io(format!("Failed to verify file before saving: {}", error))
                })?;
                if &current != expected {
                    return Err(source_save_conflict());
                }
            }
        }

        if target_path.exists() {
            copy_extended_attributes(&target_path, &temporary_path)
                .map_err(|error| WriteFileError::io(format!("Failed to preserve file metadata: {}", error)))?;
        }
        temporary_file
            .sync_all()
            .map_err(|error| WriteFileError::io(format!("Failed to synchronize source save: {}", error)))?;
        drop(temporary_file);
        fs::rename(&temporary_path, &target_path)
            .map_err(|error| WriteFileError::io(format!("Failed to finish source save: {}", error)))?;
        if let Some(parent) = target_path.parent() {
            if let Ok(directory) = fs::File::open(parent) {
                let _ = directory.sync_all();
            }
        }
        file_version(&target_path)
            .map_err(|error| WriteFileError::io(format!("Failed to inspect saved file: {}", error)))
    };

    let result = finish();
    if result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }
    result
}

fn write_file_checked(
    path: &Path,
    content: &str,
    expected_content: Option<&str>,
    expected_version: Option<&FileVersionToken>,
    force: bool,
) -> Result<(), WriteFileError> {
    if !force {
        if let Some(expected) = expected_version {
            let current = file_version(path).map_err(|error| {
                WriteFileError::io(format!("Failed to verify file before saving: {}", error))
            })?;
            if &current != expected {
                return Err(source_save_conflict());
            }
        }
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
pub async fn write_file(
    state: State<'_, FileWriteState>,
    path: String,
    content: String,
    expected_content: Option<String>,
    expected_version: Option<FileVersionToken>,
    force: Option<bool>,
) -> Result<FileVersionToken, WriteFileError> {
    if content.len() as u64 > COMPLETE_TEXT_READ_MAX_BYTES {
        return Err(WriteFileError::io(format!(
            "Complete string saves are limited to {} MiB; use the streaming source saver",
            COMPLETE_TEXT_READ_MAX_BYTES / (1024 * 1024)
        )));
    }
    let _write_guard = state
        .0
        .lock()
        .map_err(|_| WriteFileError::io("The save queue is unavailable"))?;
    write_file_checked(
        Path::new(&path),
        &content,
        expected_content.as_deref(),
        expected_version.as_ref(),
        force.unwrap_or(false),
    )?;
    file_version(Path::new(&path))
        .map_err(|error| WriteFileError::io(format!("Failed to inspect saved file: {}", error)))
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
                    Some((old_assets, new_assets, old_name, new_name))
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

    if let Some((old_assets, new_assets, old_name, new_name)) = asset_rename {
        if let Err(error) = fs::rename(&old_assets, &new_assets) {
            let _ = fs::rename(&new_path, old);
            return Err(format!("Failed to rename companion assets: {}", error));
        }
        if let Err(error) = atomic_replace_literal(
            &new_path,
            old_name.as_bytes(),
            new_name.as_bytes(),
        ) {
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
        let asset_rewrite = if let (Some(source_assets), Some(dest_assets)) =
            (source_assets.as_ref(), dest_assets.as_ref())
        {
            let old_name = source_assets.file_name().and_then(|name| name.to_str())
                .ok_or("Cannot determine companion assets name")?;
            let new_name = dest_assets.file_name().and_then(|name| name.to_str())
                .ok_or("Cannot determine duplicated assets name")?;
            Some((old_name.to_string(), new_name.to_string()))
        } else {
            None
        };

        let staging_file = unused_backup_path(&dest)?;
        if let Err(error) = copy_file_with_metadata(source, &staging_file) {
            remove_staging_path(&staging_file);
            return Err(format!("Failed to duplicate file: {}", error));
        }
        if let Some((old_name, new_name)) = asset_rewrite {
            if let Err(error) = atomic_replace_literal(
                &staging_file,
                old_name.as_bytes(),
                new_name.as_bytes(),
            ) {
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

fn reserve_image_asset(active_file: &Path, filename: &str) -> Result<(String, PathBuf), String> {
    validate_name(filename)?;

    // Build {stem}.assets/ directory alongside the active markdown file
    let dir = active_file.parent().ok_or("Cannot determine file directory")?;
    let file_stem = active_file.file_stem().ok_or("Cannot determine file stem")?.to_string_lossy();
    let assets_dir_name = format!("{}.assets", file_stem);
    let assets_dir = dir.join(&assets_dir_name);

    fs::create_dir_all(&assets_dir)
        .map_err(|e| format!("Failed to create assets directory: {}", e))?;

    // Deduplicate: if filename exists, add a numeric suffix
    let mut final_name = filename.to_string();
    let path = Path::new(filename);
    let stem = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let mut counter = 1u32;
    while assets_dir.join(&final_name).exists() {
        final_name = format!("{}-{}{}", stem, counter, ext);
        counter += 1;
    }

    Ok((format!("{}/{}", assets_dir_name, final_name), assets_dir.join(final_name)))
}

#[tauri::command]
pub async fn save_image(active_file: String, filename: String, data: Vec<u8>) -> Result<String, String> {
    if data.len() > INLINE_IMAGE_IMPORT_MAX_BYTES {
        return Err(format!(
            "Clipboard and browser image imports are limited to {} MiB; use the file picker for larger images",
            INLINE_IMAGE_IMPORT_MAX_BYTES / (1024 * 1024)
        ));
    }
    let (relative_path, file_path) = reserve_image_asset(Path::new(&active_file), &filename)?;
    fs::write(&file_path, &data)
        .map_err(|e| format!("Failed to write image: {}", e))?;
    Ok(relative_path)
}

#[tauri::command]
pub async fn save_image_from_path(active_file: String, source_path: String) -> Result<String, String> {
    let source = Path::new(&source_path);
    if !source.is_file() {
        return Err("The selected image is no longer a file".to_string());
    }
    let filename = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("Cannot determine image filename")?
        .replace(char::is_whitespace, "-");
    let (relative_path, destination) = reserve_image_asset(Path::new(&active_file), &filename)?;
    fs::copy(source, &destination)
        .map_err(|error| format!("Failed to copy image: {}", error))?;
    Ok(relative_path)
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

#[cfg(target_os = "macos")]
fn file_icon_png(path: &Path, pixel_size: u32) -> Result<Option<Vec<u8>>, String> {
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSWorkspace};
    use objc2_foundation::{NSDictionary, NSSize, NSString};

    if !path.exists() {
        return Ok(None);
    }
    let path = NSString::from_str(&path.to_string_lossy());
    let icon = NSWorkspace::sharedWorkspace().iconForFile(&path);
    icon.setSize(NSSize::new(pixel_size as f64, pixel_size as f64));
    let tiff = icon
        .TIFFRepresentation()
        .ok_or_else(|| "macOS did not provide icon image data".to_string())?;
    let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)
        .ok_or_else(|| "Could not decode the macOS file icon".to_string())?;
    let properties = NSDictionary::dictionary();
    let png = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &properties)
    }
    .ok_or_else(|| "Could not encode the macOS file icon".to_string())?;
    let bytes = png.to_vec();
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("The macOS file icon exceeded the preview safety limit".to_string());
    }
    Ok(Some(bytes))
}

#[cfg(not(target_os = "macos"))]
fn file_icon_png(_path: &Path, _pixel_size: u32) -> Result<Option<Vec<u8>>, String> {
    Ok(None)
}

/// Return the Finder icon for a file or package. Unsupported platforms and
/// paths without an icon fall back to Ghost's generic file glyph.
#[tauri::command]
pub async fn read_file_icon(
    path: String,
    pixel_size: Option<u32>,
) -> Result<Option<Vec<u8>>, String> {
    file_icon_png(Path::new(&path), pixel_size.unwrap_or(128).clamp(32, 256))
}

/// Give a sandboxed HTML preview access to resources relative to its source
/// file. Script execution and navigation remain disabled by the iframe.
#[tauri::command]
pub async fn prepare_html_preview(
    app: tauri::AppHandle,
    path: String,
) -> Result<String, String> {
    let canonical_path = fs::canonicalize(&path)
        .map_err(|error| format!("Failed to prepare HTML preview: {}", error))?;
    if !canonical_path.is_file() {
        return Err("The HTML preview source is not a file".to_string());
    }
    let parent = canonical_path
        .parent()
        .ok_or_else(|| "The HTML preview source has no parent directory".to_string())?;
    app.asset_protocol_scope()
        .allow_directory(parent, true)
        .map_err(|error| format!("Failed to allow HTML preview resources: {}", error))?;
    Ok(parent.to_string_lossy().to_string())
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
            pulldown_cmark::Event::End(
                pulldown_cmark::TagEnd::Paragraph
                | pulldown_cmark::TagEnd::Heading(_)
                | pulldown_cmark::TagEnd::Item
                | pulldown_cmark::TagEnd::BlockQuote(_),
            ) => {
                plain.push('\n');
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
    if !meta.is_file() && !is_file_package(Path::new(&path)) {
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
        decode_text_bytes, duplicate_file, file_version, inspect_source, move_file,
        read_dir_recursive, read_file_if_text, read_source_chunk, read_source_chunk_raw,
        rename_file, write_file_checked, WriteFileError, EXTREME_SOURCE_BYTES,
        TEMP_FILE_COUNTER, TEXT_PROBE_BYTES,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::Ordering;
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

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
    fn directory_listing_hides_dotfiles_unless_requested() {
        let directory = test_directory("hidden-files");
        fs::write(directory.join("visible.txt"), "visible").expect("fixture should be written");
        fs::write(directory.join(".hidden.txt"), "hidden").expect("fixture should be written");
        fs::create_dir(directory.join(".hidden-folder"))
            .expect("fixture directory should be created");

        let hidden = read_dir_recursive(&directory, &[], 0, 1, false)
            .expect("directory should be listed");
        assert_eq!(
            hidden
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            ["visible.txt"]
        );

        let visible = read_dir_recursive(&directory, &[], 0, 1, true)
            .expect("directory should be listed");
        assert_eq!(
            visible
                .iter()
                .map(|entry| entry.name.as_str())
                .collect::<Vec<_>>(),
            [".hidden-folder", ".hidden.txt", "visible.txt"],
        );
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn directory_inspection_is_a_bounded_negative_text_probe() {
        let directory = test_directory("package-inspection");
        let inspection = tauri::async_runtime::block_on(inspect_source(
            directory.to_string_lossy().into_owned(),
            Some(true),
        ))
        .expect("directory metadata should be inspectable");

        assert!(!inspection.looks_textual);
        assert_eq!(inspection.line_count, 0);
        assert_eq!(inspection.max_line_bytes, 0);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_application_bundles_are_listed_as_files() {
        let directory = test_directory("application-package");
        let application = directory.join("Example.app");
        fs::create_dir(&application).expect("application package should be created");

        let entries = read_dir_recursive(&directory, &[], 0, 1, false)
            .expect("directory should be listed");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].path, application.to_string_lossy());
        assert!(!entries[0].is_directory);
        fs::remove_dir_all(directory).expect("test directory should be removed");
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
    fn bounded_source_chunks_round_trip_crlf_and_astral_unicode() {
        let directory = test_directory("source-chunks");
        let path = directory.join("unicode.txt");
        let content = "first😀\r\n雪 second\r\nlast";
        fs::write(&path, content.as_bytes()).expect("fixture should be written");

        let inspection = tauri::async_runtime::block_on(inspect_source(
            path.to_string_lossy().to_string(),
            Some(false),
        ))
        .expect("source should inspect");
        assert_eq!(inspection.line_separator, "\r\n");
        assert_eq!(inspection.line_count, 3);
        assert_eq!(inspection.max_line_bytes, 10);

        let raw = tauri::async_runtime::block_on(read_source_chunk_raw(
            path.to_string_lossy().to_string(),
            0,
            Some(7),
            inspection.version.clone(),
        ))
        .expect("raw chunk should read")
        .body()
        .expect("raw response should resolve");
        match raw {
            InvokeResponseBody::Raw(bytes) => assert_eq!(bytes, b"first"),
            InvokeResponseBody::Json(_) => panic!("source chunk must bypass JSON serialization"),
        }

        let mut offset = 0;
        let mut rebuilt = String::new();
        while offset < inspection.size_bytes {
            let chunk = tauri::async_runtime::block_on(read_source_chunk(
                path.to_string_lossy().to_string(),
                offset,
                Some(7),
                inspection.version.clone(),
            ))
            .expect("chunk should read");
            assert!(chunk.next_offset > offset || chunk.eof);
            rebuilt.push_str(&chunk.text);
            offset = chunk.next_offset;
            if chunk.eof {
                break;
            }
        }
        assert_eq!(rebuilt, content);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn extreme_source_inspection_stops_after_the_text_probe() {
        let directory = test_directory("extreme-source-probe");
        let path = directory.join("large.txt");
        let mut file = fs::File::create(&path).expect("fixture should be created");
        std::io::Write::write_all(&mut file, b"bounded probe\n")
            .expect("fixture prefix should be written");
        file.set_len(EXTREME_SOURCE_BYTES + 1)
            .expect("sparse fixture should be extended");

        let inspection = tauri::async_runtime::block_on(inspect_source(
            path.to_string_lossy().to_string(),
            Some(false),
        ))
        .expect("extreme source should inspect");
        assert_eq!(inspection.size_bytes, EXTREME_SOURCE_BYTES + 1);
        assert!(!inspection.line_count_complete);

        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn source_chunk_rejects_an_external_replacement() {
        let directory = test_directory("source-conflict");
        let path = directory.join("source.txt");
        fs::write(&path, "before").expect("fixture should be written");
        let version = file_version(&path).expect("version should resolve");
        let replacement = directory.join("replacement.txt");
        fs::write(&replacement, "after").expect("replacement should be written");
        fs::rename(&replacement, &path).expect("fixture should be replaced");

        let error = tauri::async_runtime::block_on(read_source_chunk(
            path.to_string_lossy().to_string(),
            0,
            Some(16),
            version,
        ))
        .expect_err("replacement should invalidate the read");
        assert!(error.contains("changed on disk"));
        let _ = fs::remove_dir_all(directory);
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

        write_file_checked(&path, "after", Some("before"), None, false)
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

        let error = write_file_checked(&path, "my edit", Some("original"), None, false)
            .expect_err("external change should conflict");

        assert!(matches!(error, WriteFileError::Conflict { .. }));
        assert_eq!(fs::read_to_string(&path).unwrap(), "changed elsewhere");
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn checked_write_uses_the_version_token_when_no_complete_content_is_retained() {
        let directory = test_directory("write-version-conflict");
        let path = directory.join("notes.csv");
        fs::write(&path, "original").expect("fixture should be written");
        let expected = file_version(&path).expect("fixture version should be available");
        fs::write(&path, "changed elsewhere and resized").expect("fixture should change");

        let error = write_file_checked(&path, "my edit", None, Some(&expected), false)
            .expect_err("external version change should conflict");

        assert!(matches!(error, WriteFileError::Conflict { .. }));
        assert_eq!(fs::read_to_string(&path).unwrap(), "changed elsewhere and resized");
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn forced_checked_write_explicitly_overwrites_a_conflict() {
        let directory = test_directory("force-write");
        let path = directory.join("notes.md");
        fs::write(&path, "changed elsewhere").expect("fixture should be written");

        write_file_checked(&path, "my edit", Some("original"), None, true)
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

        write_file_checked(&path, "after", Some("before"), None, false)
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
    fn imageio_inspects_and_bounds_icns_thumbnails() {
        use super::{inspect_image_native, render_image_thumbnail};

        let directory = test_directory("imageio-thumbnail");
        let path = directory.join("icon.icns");
        fs::write(&path, include_bytes!("../../icons/icon-prod.icns"))
            .expect("ICNS fixture should be written");
        let inspection = inspect_image_native(&path).expect("ImageIO should inspect the icon");
        assert!(inspection.width > 0);
        assert!(inspection.height > 0);
        assert!(inspection.needs_thumbnail);

        let thumbnail = render_image_thumbnail(&path, 512).expect("thumbnail should render");
        assert!(thumbnail.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(thumbnail.len() <= super::IMAGE_THUMBNAIL_MAX_OUTPUT_BYTES);
        let _ = fs::remove_dir_all(directory);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn finder_file_icons_are_encoded_as_bounded_pngs() {
        let directory = test_directory("finder-file-icon");
        let path = directory.join("Example.app");
        fs::create_dir(&path).expect("application package should be created");

        let icon = super::file_icon_png(&path, 128)
            .expect("Finder icon lookup should succeed")
            .expect("Finder should provide an application icon");
        assert!(icon.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert!(icon.len() <= 8 * 1024 * 1024);
        fs::remove_dir_all(directory).expect("test directory should be removed");
    }

    #[test]
    fn complete_text_read_rejects_files_above_the_normal_source_budget() {
        let directory = test_directory("bounded-read");
        let path = directory.join("large.txt");
        let file = fs::File::create(&path).expect("fixture should be created");
        file.set_len(super::COMPLETE_TEXT_READ_MAX_BYTES + 1)
            .expect("sparse fixture should be sized");

        let error = tauri::async_runtime::block_on(super::read_file(
            path.to_string_lossy().into_owned(),
        ))
        .expect_err("complete read should be rejected");
        assert!(error.contains("Complete text reads are limited"));
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn transient_text_preview_is_bounded_and_reports_truncation() {
        let directory = test_directory("text-preview");
        let path = directory.join("large.log");
        fs::write(&path, "a".repeat(8 * 1024)).expect("fixture should be written");

        let preview = tauri::async_runtime::block_on(super::read_text_preview(
            path.to_string_lossy().into_owned(),
            Some(1024),
        ))
        .expect("preview should succeed")
        .expect("fixture should be textual");
        assert_eq!(preview.text.len(), 1024);
        assert!(preview.truncated);
        let _ = fs::remove_dir_all(directory);
    }

    #[test]
    fn streaming_literal_rewrite_handles_matches_across_read_boundaries() {
        let directory = test_directory("streaming-rewrite");
        let path = directory.join("large.md");
        let mut content = "x".repeat(64 * 1024 - 4);
        content.push_str("draft.assets/one.png\n");
        content.push_str(&"y".repeat(64 * 1024));
        content.push_str("draft.assets/two.png");
        fs::write(&path, content).expect("fixture should be written");

        super::atomic_replace_literal(&path, b"draft.assets", b"final.assets")
            .expect("streaming rewrite should succeed");
        let rewritten = fs::read_to_string(&path).expect("fixture should remain UTF-8");
        assert!(!rewritten.contains("draft.assets"));
        assert_eq!(rewritten.matches("final.assets").count(), 2);
        let _ = fs::remove_dir_all(directory);
    }
}
