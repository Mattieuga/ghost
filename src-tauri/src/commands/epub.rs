use std::collections::HashSet;
use std::fs::File;
use std::io::{self, Cursor, Read};

const MAX_BOOK_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES: u64 = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES: u64 = 256 * 1024 * 1024;
const MAX_ENTRIES: usize = 10_000;

// Validate the same immutable bytes sent to EPUB.js. Count actual inflated
// output, not just ZIP headers; nothing is extracted to disk or asset scope.
fn validate_epub(bytes: &[u8]) -> Result<(), String> {
    let mut archive = zip::ZipArchive::new(Cursor::new(bytes))
        .map_err(|_| "This file is not a readable EPUB archive".to_string())?;
    if archive.len() > MAX_ENTRIES {
        return Err("This EPUB contains too many resources to preview".into());
    }
    let mut names = HashSet::new();
    let mut expanded = 0;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = entry.name().to_owned();
        if !names.insert(name.clone())
            || entry.enclosed_name().is_none()
            || name.contains('\\')
            || name.split('/').any(|part| part == ".." || part == ".")
        {
            return Err("This EPUB contains ambiguous resource paths".into());
        }
        if name == "META-INF/rights.xml" || name == "META-INF/encryption.xml" {
            return Err("This EPUB has protected or obfuscated resources. Open it in a compatible book reader.".into());
        }
        if entry.size() > MAX_ENTRY_BYTES {
            return Err("An EPUB resource exceeds the 32 MB preview limit".into());
        }
        let limit = MAX_ENTRY_BYTES.min(MAX_EXPANDED_BYTES - expanded);
        let count = io::copy(&mut entry.by_ref().take(limit + 1), &mut io::sink())
            .map_err(|error| format!("Unable to read EPUB resource: {error}"))?;
        if count > limit {
            return Err("This EPUB exceeds the expanded preview limit".into());
        }
        expanded += count;
    }
    if !names.contains("META-INF/container.xml") || !names.contains("mimetype") {
        return Err("This archive is missing the EPUB container information".into());
    }
    let mut mimetype = String::new();
    archive
        .by_name("mimetype")
        .map_err(|error| error.to_string())?
        .take(64)
        .read_to_string(&mut mimetype)
        .map_err(|error| error.to_string())?;
    if mimetype.trim() != "application/epub+zip" {
        return Err("This archive is not an EPUB book".into());
    }
    Ok(())
}

fn read_book(path: &str) -> Result<Vec<u8>, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Choose an EPUB file".into());
    }
    if metadata.len() > MAX_BOOK_BYTES {
        return Err("This EPUB exceeds the 64 MB preview limit".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_BOOK_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_BOOK_BYTES {
        return Err("This EPUB exceeds the 64 MB preview limit".into());
    }
    validate_epub(&bytes)?;
    Ok(bytes)
}

#[tauri::command]
pub async fn read_epub(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || read_book(&path))
        .await
        .map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    fn book(extra: &[(&str, &[u8])]) -> Vec<u8> {
        let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let options =
            SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        for (name, content) in [
            ("mimetype", b"application/epub+zip".as_slice()),
            ("META-INF/container.xml", b"<container/>".as_slice()),
        ]
        .into_iter()
        .chain(extra.iter().copied())
        {
            writer.start_file(name, options).unwrap();
            writer.write_all(content).unwrap();
        }
        writer.finish().unwrap().into_inner()
    }

    #[test]
    fn accepts_a_bounded_epub_without_materializing_files() {
        assert!(validate_epub(&book(&[("Text/chapter.xhtml", b"<html/>")])).is_ok());
    }

    #[test]
    fn rejects_non_epub_and_protected_resources() {
        assert!(validate_epub(b"not a zip").is_err());
        assert!(
            validate_epub(&book(&[("META-INF/encryption.xml", b"<encryption/>")]))
                .unwrap_err()
                .contains("protected")
        );
        assert!(validate_epub(&book(&[("../chapter.xhtml", b"text")])).is_err());
    }

    #[test]
    fn rejects_highly_compressed_oversized_resources() {
        let bytes = book(&[("huge.xhtml", &vec![b'x'; MAX_ENTRY_BYTES as usize + 1])]);
        assert!(bytes.len() < 100_000);
        assert!(validate_epub(&bytes).unwrap_err().contains("32 MB"));
    }
}
