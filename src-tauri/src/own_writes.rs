//! Remembers files Ghost itself just wrote so the folder watcher can tell a
//! mirror write from an external one. Entries are keyed by device and inode
//! rather than path because the atomic save renames a temp file into place,
//! which changes the inode the path points at.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

/// How long a recorded write stays recognisable. FSEvents delivers within
/// a second or two; anything older is treated as a genuine external change.
const OWN_WRITE_TTL: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct FileIdentity {
    pub device: u64,
    pub inode: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileStamp {
    pub identity: FileIdentity,
    pub modified_ns: u128,
}

#[derive(Default)]
pub struct OwnWriteRegistry {
    entries: Mutex<HashMap<FileIdentity, (u128, Instant)>>,
}

impl OwnWriteRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record the file at `path` as just written by Ghost.
    pub fn record_path(&self, path: &Path) {
        if let Some(stamp) = stamp_of(path) {
            self.record(stamp, Instant::now());
        }
    }

    pub fn record(&self, stamp: FileStamp, now: Instant) {
        if let Ok(mut entries) = self.entries.lock() {
            purge(&mut entries, now);
            entries.insert(stamp.identity, (stamp.modified_ns, now));
        }
    }

    /// Whether a watcher event for `path` describes Ghost's own write. The
    /// entry is kept until it expires because one save produces several
    /// filesystem events.
    pub fn is_own_write(&self, path: &Path) -> bool {
        match stamp_of(path) {
            Some(stamp) => self.matches(stamp, Instant::now()),
            None => false,
        }
    }

    pub fn matches(&self, stamp: FileStamp, now: Instant) -> bool {
        let Ok(mut entries) = self.entries.lock() else { return false };
        purge(&mut entries, now);
        entries
            .get(&stamp.identity)
            .map(|(modified_ns, _)| *modified_ns == stamp.modified_ns)
            .unwrap_or(false)
    }
}

fn purge(entries: &mut HashMap<FileIdentity, (u128, Instant)>, now: Instant) {
    entries.retain(|_, (_, recorded)| now.duration_since(*recorded) < OWN_WRITE_TTL);
}

pub fn stamp_of(path: &Path) -> Option<FileStamp> {
    let metadata = fs::metadata(path).ok()?;
    let modified_ns = metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();

    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        FileIdentity { device: metadata.dev(), inode: metadata.ino() }
    };
    #[cfg(not(unix))]
    let identity = FileIdentity { device: 0, inode: 0 };

    Some(FileStamp { identity, modified_ns })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stamp(inode: u64, modified_ns: u128) -> FileStamp {
        FileStamp { identity: FileIdentity { device: 1, inode }, modified_ns }
    }

    #[test]
    fn recognises_the_same_file_stamp_until_it_expires() {
        let registry = OwnWriteRegistry::new();
        let start = Instant::now();
        registry.record(stamp(7, 100), start);

        assert!(registry.matches(stamp(7, 100), start + Duration::from_secs(1)));
        assert!(registry.matches(stamp(7, 100), start + Duration::from_secs(2)));
        assert!(!registry.matches(stamp(7, 100), start + OWN_WRITE_TTL));
    }

    #[test]
    fn a_later_external_write_changes_the_stamp_and_is_not_suppressed() {
        let registry = OwnWriteRegistry::new();
        let start = Instant::now();
        registry.record(stamp(7, 100), start);

        assert!(!registry.matches(stamp(7, 250), start));
        assert!(!registry.matches(stamp(8, 100), start));
    }

    #[test]
    fn stamps_real_files_by_inode() {
        let dir = std::env::temp_dir().join(format!("ghost-own-writes-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("note.md");
        fs::write(&file, "one").unwrap();

        let registry = OwnWriteRegistry::new();
        registry.record_path(&file);
        assert!(registry.is_own_write(&file));

        // A rewrite through a different inode with a new mtime is external.
        let temp = dir.join("note.tmp");
        fs::write(&temp, "two, later").unwrap();
        std::thread::sleep(Duration::from_millis(20));
        fs::rename(&temp, &file).unwrap();
        assert!(!registry.is_own_write(&file));

        let _ = fs::remove_dir_all(&dir);
    }
}
