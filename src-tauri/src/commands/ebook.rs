use std::fs::File;
use std::io::Read;
use std::path::Path;

const MAX_BOOK_BYTES: usize = 64 * 1024 * 1024;
const MAX_FB2_BYTES: usize = 16 * 1024 * 1024;

fn uint(bytes: &[u8], offset: usize, count: usize) -> Result<usize, String> {
    bytes
        .get(offset..offset + count)
        .map(|slice| slice.iter().fold(0, |n, b| (n << 8) | *b as usize))
        .ok_or_else(|| "This Kindle book has a truncated header".into())
}

// Validate the immutable snapshot passed to the parser, including both headers
// in combined MOBI/KF8 books. No decryption or filesystem extraction occurs.
fn validate_mobi(bytes: &[u8]) -> Result<(), String> {
    if bytes.get(60..68) != Some(b"BOOKMOBI") {
        return Err("This file is not a MOBI or AZW3 book".into());
    }
    let count = uint(bytes, 76, 2)?;
    if count == 0 || count > 10_000 {
        return Err("This Kindle book has an unsupported number of records".into());
    }
    let mut offsets = (0..count)
        .map(|i| uint(bytes, 78 + i * 8, 4))
        .collect::<Result<Vec<_>, _>>()?;
    if offsets[0] < 78 + count * 8 {
        return Err("This Kindle book has an invalid record table".into());
    }
    offsets.push(bytes.len());
    if offsets
        .windows(2)
        .any(|w| w[0] > w[1] || w[1] > bytes.len())
    {
        return Err("This Kindle book has invalid record offsets".into());
    }
    for (index, pair) in offsets.windows(2).enumerate() {
        let record = &bytes[pair[0]..pair[1]];
        if record.len() > 16 * 1024 * 1024 {
            return Err("A Kindle resource exceeds the 16 MB preview limit".into());
        }
        if record.get(16..20) != Some(b"MOBI") {
            if index == 0 {
                return Err("This Kindle book has no MOBI header".into());
            }
            continue;
        }
        if uint(record, 12, 2)? != 0 {
            return Err("This book is DRM-protected. Open it in a compatible reader.".into());
        }
        if !matches!(uint(record, 0, 2)?, 1 | 2) {
            return Err("This book uses HUFF/CDIC or unsupported compression. Open it in a compatible reader.".into());
        }
        let text_records = uint(record, 8, 2)?;
        if text_records == 0
            || index + text_records >= count
            || uint(record, 4, 4)? > MAX_BOOK_BYTES
            || uint(record, 10, 2)? > 32 * 1024
        {
            return Err("This Kindle book exceeds the text preview limits".into());
        }
        for text in index + 1..=index + text_records {
            if offsets[text + 1] - offsets[text] > 64 * 1024 {
                return Err("A Kindle text record exceeds the preview limit".into());
            }
        }
    }
    Ok(())
}

fn read_book(path: &str) -> Result<Vec<u8>, String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let limit = match extension.as_str() {
        "fb2" => MAX_FB2_BYTES,
        "mobi" | "azw3" => MAX_BOOK_BYTES,
        _ => return Err("Choose a MOBI, AZW3, or FB2 book".into()),
    };
    let file = File::open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > limit as u64 {
        return Err(format!(
            "This book exceeds the {} MB preview limit",
            limit / 1024 / 1024
        ));
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err("This book exceeds the preview limit".into());
    }
    if extension != "fb2" {
        validate_mobi(&bytes)?;
    }
    Ok(bytes)
}

#[tauri::command]
pub async fn read_ebook(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = tauri::async_runtime::spawn_blocking(move || read_book(&path))
        .await
        .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn book() -> Vec<u8> {
        let mut bytes = vec![0; 140];
        bytes[60..68].copy_from_slice(b"BOOKMOBI");
        bytes[76..78].copy_from_slice(&2u16.to_be_bytes());
        bytes[78..82].copy_from_slice(&96u32.to_be_bytes());
        bytes[86..90].copy_from_slice(&136u32.to_be_bytes());
        bytes[96..98].copy_from_slice(&2u16.to_be_bytes());
        bytes[104..106].copy_from_slice(&1u16.to_be_bytes());
        bytes[112..116].copy_from_slice(b"MOBI");
        bytes
    }
    #[test]
    fn accepts_plain_kindle_records() {
        assert!(validate_mobi(&book()).is_ok());
    }
    #[test]
    fn reads_real_mobi_and_kf8_books() {
        for name in ["alice-gutenberg.mobi", "alice-gutenberg.azw3"] {
            let path = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../example test files")
                .join(name);
            assert!(read_book(path.to_str().unwrap()).unwrap().len() > 100_000);
        }
    }
    #[test]
    fn rejects_drm_and_unsupported_compression() {
        let mut bytes = book();
        bytes[109] = 2;
        assert!(validate_mobi(&bytes).unwrap_err().contains("DRM"));
        bytes[109] = 0;
        bytes[96..98].copy_from_slice(&17480u16.to_be_bytes());
        assert!(validate_mobi(&bytes).unwrap_err().contains("compression"));
    }
    #[test]
    fn rejects_truncated_and_overlapping_record_tables() {
        assert!(validate_mobi(b"broken").is_err());
        let mut bytes = book();
        bytes[86..90].copy_from_slice(&80u32.to_be_bytes());
        assert!(validate_mobi(&bytes).is_err());
        bytes[86..90].copy_from_slice(&1000u32.to_be_bytes());
        assert!(validate_mobi(&bytes).is_err());
    }
}
