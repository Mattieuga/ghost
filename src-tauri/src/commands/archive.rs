use serde::Serialize;
use std::ffi::OsString;
use std::fs::{self, OpenOptions};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const BSDTAR_PATH: &str = "/usr/bin/tar";
const GZIP_PATH: &str = "/usr/bin/gzip";
const BZIP2_PATH: &str = "/usr/bin/bzip2";
const MAX_MANIFEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES: usize = 50_000;
const MAX_ERROR_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ArchiveEntry {
    pub path: String,
    pub kind: String,
    pub size_bytes: Option<u64>,
    pub modified_ms: Option<i64>,
    pub link_target: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ArchiveManifest {
    pub archive_size_bytes: u64,
    pub modified_ms: u64,
    pub entry_count: usize,
    pub total_uncompressed_bytes: Option<u64>,
    pub entries: Vec<ArchiveEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ArchiveExtraction {
    pub output_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RawCompression {
    Gzip,
    Bzip2,
}

impl RawCompression {
    pub(crate) fn decoder_path(self) -> &'static str {
        match self {
            Self::Gzip => GZIP_PATH,
            Self::Bzip2 => BZIP2_PATH,
        }
    }
}

pub(crate) fn raw_compression(path: &Path) -> Option<RawCompression> {
    let name = path.file_name()?.to_string_lossy().to_lowercase();
    if name.ends_with(".tar.gz") {
        None
    } else if name.ends_with(".gz") {
        Some(RawCompression::Gzip)
    } else if name.ends_with(".tar.bz2") {
        None
    } else if name.ends_with(".bz2") {
        Some(RawCompression::Bzip2)
    } else {
        None
    }
}

fn safe_stream_filename(name: &str) -> Option<String> {
    let filename = Path::new(name).file_name()?.to_str()?.trim();
    if filename.is_empty() || filename == "." || filename == ".." {
        None
    } else {
        Some(filename.to_string())
    }
}

fn stripped_stream_filename(path: &Path) -> String {
    path.file_stem()
        .filter(|stem| path.file_name() != Some(*stem))
        .and_then(|stem| stem.to_str())
        .and_then(safe_stream_filename)
        .unwrap_or_else(|| "Decompressed file".to_string())
}

fn gzip_original_filename(path: &Path) -> Option<String> {
    let mut file = fs::File::open(path).ok()?;
    let mut header = [0_u8; 10];
    file.read_exact(&mut header).ok()?;
    if header[0..3] != [0x1f, 0x8b, 8] {
        return None;
    }
    let flags = header[3];
    if flags & 0x04 != 0 {
        let mut length = [0_u8; 2];
        file.read_exact(&mut length).ok()?;
        let mut extra = file.by_ref().take(u16::from_le_bytes(length) as u64);
        std::io::copy(&mut extra, &mut std::io::sink()).ok()?;
    }
    if flags & 0x08 == 0 {
        return None;
    }

    let mut name = Vec::new();
    let reader = BufReader::new(file);
    for byte in reader.bytes().take(64 * 1024) {
        let byte = byte.ok()?;
        if byte == 0 {
            return safe_stream_filename(&String::from_utf8_lossy(&name));
        }
        name.push(byte);
    }
    None
}

pub(crate) fn stream_filename(path: &Path, compression: RawCompression) -> String {
    match compression {
        RawCompression::Gzip => gzip_original_filename(path),
        RawCompression::Bzip2 => None,
    }
    .unwrap_or_else(|| stripped_stream_filename(path))
}

pub(crate) fn canonical_file(path: &str) -> Result<PathBuf, String> {
    let canonical =
        fs::canonicalize(path).map_err(|error| format!("Archive not found: {error}"))?;
    let metadata =
        fs::metadata(&canonical).map_err(|error| format!("Unable to inspect archive: {error}"))?;
    if !metadata.is_file() {
        return Err("Archive path is not a file".to_string());
    }
    Ok(canonical)
}

fn canonical_directory(path: &str) -> Result<PathBuf, String> {
    let canonical =
        fs::canonicalize(path).map_err(|error| format!("Destination folder not found: {error}"))?;
    let metadata = fs::metadata(&canonical)
        .map_err(|error| format!("Unable to inspect destination folder: {error}"))?;
    if !metadata.is_dir() {
        return Err("Extraction destination is not a folder".to_string());
    }
    Ok(canonical)
}

fn archive_reference(path: &Path) -> OsString {
    let mut reference = OsString::from("@");
    reference.push(path.as_os_str());
    reference
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

fn read_manifest_output(path: &Path) -> Result<Vec<u8>, String> {
    let mut child = Command::new(BSDTAR_PATH)
        .args(["-cf", "-", "--format=mtree"])
        .arg(archive_reference(path))
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to start macOS archive reader: {error}"))?;

    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Unable to read archive manifest".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Unable to read archive errors".to_string())?;
    let stderr_thread = std::thread::spawn(move || drain_bounded(stderr, MAX_ERROR_BYTES));

    let mut manifest = Vec::new();
    if let Err(error) = stdout
        .by_ref()
        .take((MAX_MANIFEST_BYTES + 1) as u64)
        .read_to_end(&mut manifest)
    {
        let _ = child.kill();
        let _ = child.wait();
        let _ = stderr_thread.join();
        return Err(format!("Unable to read archive manifest: {error}"));
    }

    if manifest.len() > MAX_MANIFEST_BYTES {
        let _ = child.kill();
        let _ = child.wait();
        let _ = stderr_thread.join();
        return Err(format!(
            "Archive contains too many entries to preview safely (manifest exceeds {} MB)",
            MAX_MANIFEST_BYTES / (1024 * 1024),
        ));
    }

    let status = child
        .wait()
        .map_err(|error| format!("Unable to finish reading archive: {error}"))?;
    let stderr = stderr_thread.join().unwrap_or_default();
    if !status.success() {
        let detail = String::from_utf8_lossy(&stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "macOS could not read this archive. It may be corrupt, encrypted, or unsupported."
                .to_string()
        } else {
            format!("macOS could not read this archive: {detail}")
        });
    }

    Ok(manifest)
}

fn decode_mtree_word(word: &[u8]) -> String {
    let mut decoded = Vec::with_capacity(word.len());
    let mut index = 0;
    while index < word.len() {
        if word[index] == b'\\' && index + 3 < word.len() {
            let octal = &word[index + 1..index + 4];
            if octal.iter().all(|byte| matches!(byte, b'0'..=b'7')) {
                let value = (octal[0] - b'0') * 64 + (octal[1] - b'0') * 8 + (octal[2] - b'0');
                decoded.push(value);
                index += 4;
                continue;
            }
            if index + 1 < word.len() {
                decoded.push(word[index + 1]);
                index += 2;
                continue;
            }
        }
        decoded.push(word[index]);
        index += 1;
    }
    String::from_utf8_lossy(&decoded).into_owned()
}

fn parse_manifest(bytes: &[u8]) -> Result<Vec<ArchiveEntry>, String> {
    let mut entries = Vec::new();

    for raw_line in bytes.split(|byte| *byte == b'\n') {
        let line = raw_line.strip_suffix(b"\r").unwrap_or(raw_line);
        let line = line
            .iter()
            .copied()
            .skip_while(u8::is_ascii_whitespace)
            .collect::<Vec<_>>();
        if line.is_empty()
            || line[0] == b'#'
            || line.starts_with(b"/set")
            || line.starts_with(b"/unset")
        {
            continue;
        }

        let path_end = line
            .iter()
            .position(u8::is_ascii_whitespace)
            .unwrap_or(line.len());
        let decoded_path = decode_mtree_word(&line[..path_end]);
        let normalized_path = decoded_path
            .strip_prefix("./")
            .unwrap_or(&decoded_path)
            .trim_end_matches('/');
        if normalized_path.is_empty() || normalized_path == "." || normalized_path == "/." {
            continue;
        }

        let mut kind = "other".to_string();
        let mut size_bytes = None;
        let mut modified_ms = None;
        let mut link_target = None;

        for field in line[path_end..]
            .split(u8::is_ascii_whitespace)
            .filter(|field| !field.is_empty())
        {
            let Some(separator) = field.iter().position(|byte| *byte == b'=') else {
                continue;
            };
            let key = &field[..separator];
            let value = &field[separator + 1..];
            match key {
                b"type" => {
                    kind = match value {
                        b"file" => "file",
                        b"dir" => "directory",
                        b"link" => "symlink",
                        _ => "other",
                    }
                    .to_string();
                }
                b"size" => {
                    size_bytes = String::from_utf8_lossy(value).parse().ok();
                }
                b"time" => {
                    modified_ms = String::from_utf8_lossy(value)
                        .parse::<f64>()
                        .ok()
                        .map(|seconds| (seconds * 1000.0) as i64);
                }
                b"link" => link_target = Some(decode_mtree_word(value)),
                _ => {}
            }
        }

        entries.push(ArchiveEntry {
            path: normalized_path.to_string(),
            kind,
            size_bytes,
            modified_ms,
            link_target,
        });
        if entries.len() > MAX_ARCHIVE_ENTRIES {
            return Err(format!(
                "Archive contains more than {MAX_ARCHIVE_ENTRIES} entries and is too large to preview safely",
            ));
        }
    }

    Ok(entries)
}

pub(crate) fn list_archive_impl(path: &str) -> Result<ArchiveManifest, String> {
    let archive = canonical_file(path)?;
    let metadata =
        fs::metadata(&archive).map_err(|error| format!("Unable to inspect archive: {error}"))?;
    let archive_size_bytes = metadata.len();
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default();
    if let Some(compression) = raw_compression(&archive) {
        return Ok(ArchiveManifest {
            archive_size_bytes,
            modified_ms,
            entry_count: 1,
            total_uncompressed_bytes: None,
            entries: vec![ArchiveEntry {
                path: stream_filename(&archive, compression),
                kind: "file".to_string(),
                size_bytes: None,
                modified_ms: i64::try_from(modified_ms).ok(),
                link_target: None,
            }],
        });
    }

    let entries = parse_manifest(&read_manifest_output(&archive)?)?;
    let total_uncompressed_bytes = entries
        .iter()
        .filter(|entry| entry.kind == "file")
        .try_fold(0_u64, |total, entry| {
            entry.size_bytes.map(|size| total.saturating_add(size))
        });

    Ok(ArchiveManifest {
        archive_size_bytes,
        modified_ms,
        entry_count: entries.len(),
        total_uncompressed_bytes,
        entries,
    })
}

fn extraction_name(path: &Path) -> String {
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Archive");
    let lower = name.to_lowercase();
    const SUFFIXES: &[&str] = &[
        ".tar.bz2", ".tar.gz", ".tar.xz", ".tar.zst", ".tbz2", ".cpgz", ".tgz", ".tbz", ".txz",
        ".tzst", ".cpio", ".zip", ".tar", ".7z", ".rar", ".bz2", ".gz",
    ];
    for suffix in SUFFIXES {
        if lower.ends_with(suffix) {
            let stem = name[..name.len() - suffix.len()].trim();
            return if stem.is_empty() {
                "Archive".to_string()
            } else {
                stem.to_string()
            };
        }
    }
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .filter(|stem| !stem.trim().is_empty())
        .unwrap_or("Archive")
        .to_string()
}

fn create_extraction_directory(parent: &Path, base_name: &str) -> Result<PathBuf, String> {
    for attempt in 1..=10_000 {
        let name = if attempt == 1 {
            base_name.to_string()
        } else {
            format!("{base_name} {attempt}")
        };
        let candidate = parent.join(name);
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("Unable to create extraction folder: {error}")),
        }
    }
    Err("Unable to find an unused extraction folder name".to_string())
}

fn extract_archive_impl(
    archive_path: &str,
    destination_parent: &str,
) -> Result<ArchiveExtraction, String> {
    let archive = canonical_file(archive_path)?;
    let parent = canonical_directory(destination_parent)?;
    let output = create_extraction_directory(&parent, &extraction_name(&archive))?;

    if let Some(compression) = raw_compression(&archive) {
        return extract_raw_stream(&archive, &output, compression);
    }

    let mut child = Command::new(BSDTAR_PATH)
        .args([
            "-x",
            "-k",
            "--safe-writes",
            "--no-same-owner",
            "--no-same-permissions",
            "-f",
        ])
        .arg(&archive)
        .arg("-C")
        .arg(&output)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn();

    let failure = match child.as_mut() {
        Ok(child) => {
            let stderr = child
                .stderr
                .take()
                .map(|stderr| drain_bounded(stderr, MAX_ERROR_BYTES))
                .unwrap_or_default();
            let status = child.wait();
            if matches!(status, Ok(status) if status.success()) {
                None
            } else {
                let detail = String::from_utf8_lossy(&stderr);
                let detail = detail.trim();
                Some(if detail.is_empty() {
                    "macOS could not extract this archive. It may be corrupt, encrypted, or unsupported.".to_string()
                } else {
                    format!("macOS could not extract this archive: {detail}")
                })
            }
        }
        Err(error) => Some(format!("Unable to start macOS archive extraction: {error}")),
    };

    if let Some(message) = failure {
        return match fs::remove_dir_all(&output) {
            Ok(()) => Err(message),
            Err(cleanup_error) => Err(format!(
                "{message} Partial files remain at {} because cleanup failed: {cleanup_error}",
                output.display(),
            )),
        };
    }

    Ok(ArchiveExtraction {
        output_path: output.to_string_lossy().into_owned(),
    })
}

fn extract_raw_stream(
    archive: &Path,
    output: &Path,
    compression: RawCompression,
) -> Result<ArchiveExtraction, String> {
    let filename = stream_filename(archive, compression);
    let destination = output.join(filename);
    let destination_file = match OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&destination)
    {
        Ok(file) => file,
        Err(error) => {
            let _ = fs::remove_dir(output);
            return Err(format!("Unable to create decompressed file: {error}"));
        }
    };

    let mut child = Command::new(compression.decoder_path())
        .arg("-dc")
        .arg(archive)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::from(destination_file))
        .stderr(Stdio::piped())
        .spawn();

    let failure = match child.as_mut() {
        Ok(child) => {
            let stderr = child
                .stderr
                .take()
                .map(|stderr| drain_bounded(stderr, MAX_ERROR_BYTES))
                .unwrap_or_default();
            let status = child.wait();
            if matches!(status, Ok(status) if status.success()) {
                None
            } else {
                let detail = String::from_utf8_lossy(&stderr);
                let detail = detail.trim();
                Some(if detail.is_empty() {
                    "macOS could not decompress this file. It may be corrupt or unsupported."
                        .to_string()
                } else {
                    format!("macOS could not decompress this file: {detail}")
                })
            }
        }
        Err(error) => Some(format!("Unable to start macOS decompressor: {error}")),
    };

    if let Some(message) = failure {
        return match fs::remove_dir_all(output) {
            Ok(()) => Err(message),
            Err(cleanup_error) => Err(format!(
                "{message} Partial files remain at {} because cleanup failed: {cleanup_error}",
                output.display(),
            )),
        };
    }

    Ok(ArchiveExtraction {
        output_path: output.to_string_lossy().into_owned(),
    })
}

#[tauri::command]
pub async fn list_archive(path: String) -> Result<ArchiveManifest, String> {
    tauri::async_runtime::spawn_blocking(move || list_archive_impl(&path))
        .await
        .map_err(|error| format!("Archive reader stopped unexpectedly: {error}"))?
}

#[tauri::command]
pub async fn extract_archive(
    archive_path: String,
    destination_parent: String,
) -> Result<ArchiveExtraction, String> {
    tauri::async_runtime::spawn_blocking(move || {
        extract_archive_impl(&archive_path, &destination_parent)
    })
    .await
    .map_err(|error| format!("Archive extraction stopped unexpectedly: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::{
        decode_mtree_word, extract_archive_impl, extraction_name, list_archive_impl,
        parse_manifest, safe_stream_filename, stripped_stream_filename, BSDTAR_PATH, BZIP2_PATH,
        GZIP_PATH,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::process::Command;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn test_directory(name: &str) -> PathBuf {
        let suffix = TEST_COUNTER.fetch_add(1, Ordering::Relaxed);
        let directory = std::env::temp_dir().join(format!(
            "ghost-archive-test-{name}-{}-{suffix}",
            std::process::id(),
        ));
        fs::create_dir(&directory).expect("test directory should be created");
        directory
    }

    fn create_archive(root: &Path, name: &str, source_name: &str) -> PathBuf {
        let source = root.join(source_name);
        fs::create_dir_all(source.join("nested folder")).expect("source tree should be created");
        fs::write(source.join("README.md"), "hello").expect("source file should be written");
        fs::write(source.join("nested folder/value.txt"), "world")
            .expect("nested source file should be written");
        let archive = root.join(name);
        let status = Command::new(BSDTAR_PATH)
            .arg("-acf")
            .arg(&archive)
            .arg("-C")
            .arg(&source)
            .arg(".")
            .status()
            .expect("system archive command should start");
        assert!(status.success(), "test archive should be created");
        archive
    }

    fn create_stream(root: &Path, source_name: &str, output_name: &str, tool: &str) -> PathBuf {
        let source = root.join(source_name);
        fs::write(&source, b"compressed stream payload").expect("stream source should be written");
        let output = root.join(output_name);
        let output_file = fs::File::create(&output).expect("stream output should be created");
        let status = Command::new(tool)
            .arg("-c")
            .arg(&source)
            .stdout(output_file)
            .status()
            .expect("system compressor should start");
        assert!(status.success(), "test stream should be created");
        output
    }

    #[test]
    fn parses_mtree_entries_and_decodes_escaped_paths() {
        let manifest = br#"#mtree
./folder\040name time=1700000000.5 mode=755 type=dir
./folder\040name/a\040b.txt time=1700000001.0 type=file size=42
./shortcut type=link link=folder\040name/a\040b.txt
"#;
        let entries = parse_manifest(manifest).expect("manifest should parse");

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].path, "folder name");
        assert_eq!(entries[0].kind, "directory");
        assert_eq!(entries[1].path, "folder name/a b.txt");
        assert_eq!(entries[1].size_bytes, Some(42));
        assert_eq!(entries[1].modified_ms, Some(1_700_000_001_000));
        assert_eq!(
            entries[2].link_target.as_deref(),
            Some("folder name/a b.txt")
        );
    }

    #[test]
    fn decodes_literal_escapes_and_invalid_utf8_lossily() {
        assert_eq!(decode_mtree_word(br"a\075b"), "a=b");
        assert_eq!(decode_mtree_word(&[b'a', 0xff]), "a�");
    }

    #[test]
    fn derives_finder_style_extraction_names() {
        assert_eq!(extraction_name(Path::new("/tmp/project.tar.gz")), "project");
        assert_eq!(extraction_name(Path::new("/tmp/assets.TBZ2")), "assets");
        assert_eq!(extraction_name(Path::new("/tmp/.zip")), "Archive");
        assert_eq!(extraction_name(Path::new("/tmp/.gz")), "Archive");
    }

    #[test]
    fn keeps_raw_stream_output_names_inside_the_extraction_folder() {
        assert_eq!(
            safe_stream_filename("../picture.webp").as_deref(),
            Some("picture.webp")
        );
        assert_eq!(safe_stream_filename(".."), None);
        assert_eq!(safe_stream_filename(""), None);
        assert_eq!(
            stripped_stream_filename(Path::new("/tmp/.gz")),
            "Decompressed file"
        );
    }

    #[test]
    fn lists_and_extracts_raw_gzip_and_bzip2_streams() {
        let root = test_directory("raw-streams");
        let destination = root.join("destination");
        fs::create_dir(&destination).expect("destination should be created");

        let gzip = create_stream(&root, "picture.webp", "renamed.gz", GZIP_PATH);
        let gzip_manifest =
            list_archive_impl(gzip.to_str().unwrap()).expect("gzip stream should be listed");
        assert_eq!(gzip_manifest.entry_count, 1);
        assert_eq!(gzip_manifest.entries[0].path, "picture.webp");
        assert_eq!(gzip_manifest.entries[0].size_bytes, None);
        let gzip_output =
            extract_archive_impl(gzip.to_str().unwrap(), destination.to_str().unwrap())
                .expect("gzip stream should extract");
        assert_eq!(
            fs::read(Path::new(&gzip_output.output_path).join("picture.webp")).unwrap(),
            b"compressed stream payload",
        );

        let bzip = create_stream(&root, "photo.jpg", "renamed.bz2", BZIP2_PATH);
        let bzip_manifest =
            list_archive_impl(bzip.to_str().unwrap()).expect("bzip2 stream should be listed");
        assert_eq!(bzip_manifest.entries[0].path, "renamed");
        let bzip_output =
            extract_archive_impl(bzip.to_str().unwrap(), destination.to_str().unwrap())
                .expect("bzip2 stream should extract");
        assert_eq!(
            fs::read(Path::new(&bzip_output.output_path).join("renamed")).unwrap(),
            b"compressed stream payload",
        );

        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn lists_and_extracts_with_the_macos_archive_tool() {
        let root = test_directory("round-trip");
        let archive = create_archive(&root, "sample.zip", "source");
        let destination_parent = root.join("destination");
        fs::create_dir(&destination_parent).expect("destination parent should be created");
        fs::create_dir(destination_parent.join("sample"))
            .expect("an existing extraction folder should be preserved");
        fs::write(destination_parent.join("sample/keep.txt"), "keep")
            .expect("existing content should be written");

        let manifest = list_archive_impl(archive.to_str().unwrap())
            .expect("system archive reader should list the zip");
        assert!(manifest.entries.iter().any(|entry| {
            entry.path == "README.md" && entry.kind == "file" && entry.size_bytes == Some(5)
        }));
        assert!(manifest
            .entries
            .iter()
            .any(|entry| entry.path == "nested folder/value.txt"));

        let extracted = extract_archive_impl(
            archive.to_str().unwrap(),
            destination_parent.to_str().unwrap(),
        )
        .expect("system archive reader should extract the zip");
        assert!(extracted.output_path.ends_with("sample 2"));
        assert_eq!(
            fs::read_to_string(Path::new(&extracted.output_path).join("nested folder/value.txt"))
                .unwrap(),
            "world",
        );
        assert_eq!(
            fs::read_to_string(destination_parent.join("sample/keep.txt")).unwrap(),
            "keep",
        );

        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn lists_common_tar_compression_families() {
        let root = test_directory("formats");
        for (index, name) in [
            "sample.tar",
            "sample.tar.gz",
            "sample.tar.bz2",
            "sample.tar.xz",
        ]
        .into_iter()
        .enumerate()
        {
            let archive = create_archive(&root, name, &format!("source-{index}"));
            let manifest = list_archive_impl(archive.to_str().unwrap())
                .unwrap_or_else(|error| panic!("{name} should be readable: {error}"));
            assert!(manifest
                .entries
                .iter()
                .any(|entry| entry.path == "README.md"));
        }
        fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn rejects_manifests_above_the_entry_limit() {
        let mut manifest = String::from("#mtree\n");
        for index in 0..=super::MAX_ARCHIVE_ENTRIES {
            manifest.push_str(&format!("./file-{index} type=file size=1\n"));
        }
        let error =
            parse_manifest(manifest.as_bytes()).expect_err("oversized manifest should be rejected");
        assert!(error.contains("too large to preview safely"));
    }

    #[test]
    fn failed_extraction_removes_only_its_new_output_folder() {
        let root = test_directory("failed-extraction");
        let archive = root.join("broken.zip");
        fs::write(&archive, "not an archive").expect("invalid archive should be written");
        let destination = root.join("destination");
        fs::create_dir(&destination).expect("destination should be created");

        let error = extract_archive_impl(archive.to_str().unwrap(), destination.to_str().unwrap())
            .expect_err("invalid archive should fail extraction");
        assert!(error.contains("could not extract"));
        assert_eq!(
            fs::read_dir(&destination)
                .expect("destination should remain readable")
                .count(),
            0,
        );

        fs::remove_dir_all(root).expect("test directory should be removed");
    }
}
