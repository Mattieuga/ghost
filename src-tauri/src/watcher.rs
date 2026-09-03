//! Folder watching for the sidebar tree and the mirror engine.
//!
//! Every change emits two events: `fs-change` carries a bare path for the
//! existing tree-refresh listeners, and `fs-event` carries a structured
//! payload with the event kind and, for renames the platform could pair, the
//! previous path. Ghost's own atomic saves, its temp files, its `.ghost`
//! metadata, and repositories or build output inside a root are filtered
//! natively so they never reach ingestion.

use notify::event::{ModifyKind, RenameMode};
use notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{new_debouncer_opt, DebounceEventResult, Debouncer, NoCache};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

use crate::own_writes::OwnWriteRegistry;

/// A watched root as the frontend spelled it and as the platform reports
/// it. FSEvents delivers canonical paths (`/private/tmp`, symlinks
/// resolved), so events are rewritten back to the given spelling before
/// they leave here.
#[derive(Debug, Clone)]
pub struct WatchedRoot {
    pub given: PathBuf,
    pub canonical: PathBuf,
}

/// The debouncer runs without a file-id cache: building one walks every
/// watched folder, symlinks included, which is far too much for an open
/// code checkout. Renames therefore arrive unpaired, as a remove and a
/// create, which the frontend already handles; synced roots pair them by
/// content hash.
pub struct WatcherState {
    pub watched_paths: Mutex<Vec<WatchedRoot>>,
    _watcher: Mutex<Option<Debouncer<RecommendedWatcher, NoCache>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watched_paths: Mutex::new(Vec::new()),
            _watcher: Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FsEventKind {
    Create,
    Modify,
    Remove,
    Rename,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsEvent {
    pub kind: FsEventKind,
    pub path: String,
    /// Previous path when the platform paired a rename.
    pub from: Option<String>,
}

/// Directories whose contents never reach the frontend. Version control
/// owns the first group; the rest is build output nobody wants mirrored.
pub const IGNORED_DIRECTORIES: &[&str] = &[
    ".ghost", ".git", ".hg", ".svn", ".jj", ".sl", ".bzr", ".fossil", "_darcs", ".pijul",
    "node_modules", ".venv", "target", "dist", "build", ".cache", "DerivedData", "Pods",
];

fn is_ignored_file_name(name: &str) -> bool {
    name == ".DS_Store" || (name.starts_with(".ghost-") && name.ends_with(".tmp"))
}

/// Whether an event path inside `root` should be dropped. Only components
/// below the root count, so a root that itself lives under a folder named
/// `build` is still watched.
pub fn should_ignore_within(root: &Path, path: &Path) -> bool {
    let relative = match path.strip_prefix(root) {
        Ok(relative) => relative,
        Err(_) => return false,
    };
    for component in relative.components() {
        if let Component::Normal(part) = component {
            let name = part.to_string_lossy();
            if IGNORED_DIRECTORIES.contains(&name.as_ref()) {
                return true;
            }
        }
    }
    path.file_name()
        .map(|name| is_ignored_file_name(&name.to_string_lossy()))
        .unwrap_or(false)
}

pub fn should_ignore(roots: &[PathBuf], path: &Path) -> bool {
    match roots.iter().find(|root| path.starts_with(root)) {
        Some(root) => should_ignore_within(root, path),
        None => path
            .file_name()
            .map(|name| is_ignored_file_name(&name.to_string_lossy()))
            .unwrap_or(false),
    }
}

pub fn map_event(kind: &EventKind, paths: &[PathBuf]) -> Vec<FsEvent> {
    let text = |path: &PathBuf| path.to_string_lossy().to_string();
    match kind {
        EventKind::Access(_) => Vec::new(),
        EventKind::Modify(ModifyKind::Name(RenameMode::Both)) if paths.len() >= 2 => vec![FsEvent {
            kind: FsEventKind::Rename,
            path: text(&paths[1]),
            from: Some(text(&paths[0])),
        }],
        EventKind::Modify(ModifyKind::Name(RenameMode::From)) => paths
            .iter()
            .map(|path| FsEvent { kind: FsEventKind::Remove, path: text(path), from: None })
            .collect(),
        EventKind::Modify(ModifyKind::Name(RenameMode::To)) => paths
            .iter()
            .map(|path| FsEvent { kind: FsEventKind::Create, path: text(path), from: None })
            .collect(),
        EventKind::Create(_) => paths
            .iter()
            .map(|path| FsEvent { kind: FsEventKind::Create, path: text(path), from: None })
            .collect(),
        EventKind::Remove(_) => paths
            .iter()
            .map(|path| FsEvent { kind: FsEventKind::Remove, path: text(path), from: None })
            .collect(),
        EventKind::Modify(_) => paths
            .iter()
            .map(|path| FsEvent { kind: FsEventKind::Modify, path: text(path), from: None })
            .collect(),
        _ => paths
            .iter()
            .map(|path| FsEvent { kind: FsEventKind::Other, path: text(path), from: None })
            .collect(),
    }
}

fn dispatch(app: &AppHandle, result: DebounceEventResult) {
    let events = match result {
        Ok(events) => events,
        Err(errors) => {
            for error in errors {
                eprintln!("Watch error: {:?}", error);
            }
            return;
        }
    };
    let watched: Vec<WatchedRoot> = app
        .state::<WatcherState>()
        .watched_paths
        .lock()
        .map(|paths| paths.clone())
        .unwrap_or_default();
    let roots: Vec<PathBuf> = watched.iter().map(|root| root.given.clone()).collect();
    let own_writes = app.state::<OwnWriteRegistry>();
    let as_given = |path: &Path| -> PathBuf {
        for root in &watched {
            if root.canonical != root.given {
                if let Ok(rest) = path.strip_prefix(&root.canonical) {
                    return root.given.join(rest);
                }
            }
        }
        path.to_path_buf()
    };

    for debounced in events {
        let paths: Vec<PathBuf> = debounced.paths.iter().map(|path| as_given(path)).collect();
        for event in map_event(&debounced.kind, &paths) {
            let path = Path::new(&event.path);
            if should_ignore(&roots, path) {
                continue;
            }
            // Ghost's own writes: a create or modify carrying the stamp it
            // recorded, or a rename whose source is its own temp file. A
            // rename by another app keeps the stamp, so the stamp alone must
            // not silence it.
            let own = match event.kind {
                FsEventKind::Create | FsEventKind::Modify => own_writes.is_own_write(path),
                FsEventKind::Rename => event
                    .from
                    .as_deref()
                    .and_then(|from| Path::new(from).file_name())
                    .map(|name| is_ignored_file_name(&name.to_string_lossy()))
                    .unwrap_or(false),
                _ => false,
            };
            if own {
                continue;
            }
            if let Some(from) = &event.from {
                let _ = app.emit("fs-change", from.clone());
            }
            let _ = app.emit("fs-change", event.path.clone());
            let _ = app.emit("fs-event", event);
        }
    }
}

#[tauri::command]
pub async fn watch_directories(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let state = app.state::<WatcherState>();

    let handler_app = app.clone();
    let mut debouncer = new_debouncer_opt::<_, RecommendedWatcher, NoCache>(
        Duration::from_millis(500),
        None,
        move |result: DebounceEventResult| dispatch(&handler_app, result),
        NoCache,
        notify::Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    let mut watched_now = Vec::new();
    for path_str in &paths {
        let path = PathBuf::from(path_str);
        if path.exists() {
            debouncer
                .watch(&path, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch {}: {}", path_str, e))?;
            let canonical = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
            watched_now.push(WatchedRoot { given: path, canonical });
        }
    }

    let mut watcher_lock = state._watcher.lock().map_err(|e| e.to_string())?;
    let mut watched = state.watched_paths.lock().map_err(|e| e.to_string())?;
    *watcher_lock = Some(debouncer);
    *watched = watched_now;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{CreateKind, ModifyKind, RenameMode};

    fn roots() -> Vec<PathBuf> {
        vec![PathBuf::from("/Users/me/build/notes")]
    }

    #[test]
    fn ignores_ghost_metadata_repositories_and_temp_files_below_the_root() {
        let roots = roots();
        assert!(should_ignore(&roots, Path::new("/Users/me/build/notes/.ghost/index.json")));
        assert!(should_ignore(&roots, Path::new("/Users/me/build/notes/lib/.git/HEAD")));
        assert!(should_ignore(&roots, Path::new("/Users/me/build/notes/node_modules/x/README.md")));
        assert!(should_ignore(&roots, Path::new("/Users/me/build/notes/.ghost-plan.md-1-2.tmp")));
        assert!(should_ignore(&roots, Path::new("/Users/me/build/notes/.DS_Store")));
        assert!(!should_ignore(&roots, Path::new("/Users/me/build/notes/plan.md")));
        assert!(!should_ignore(&roots, Path::new("/Users/me/build/notes/deep/er/plan.md")));
    }

    #[test]
    fn a_root_under_an_ignored_name_is_still_watched() {
        let roots = roots();
        assert!(!should_ignore(&roots, Path::new("/Users/me/build/notes/plan.md")));
    }

    #[test]
    fn pairs_renames_and_maps_other_kinds() {
        let from = PathBuf::from("/r/a.md");
        let to = PathBuf::from("/r/b.md");
        let renamed = map_event(
            &EventKind::Modify(ModifyKind::Name(RenameMode::Both)),
            &[from.clone(), to.clone()],
        );
        assert_eq!(renamed, vec![FsEvent {
            kind: FsEventKind::Rename,
            path: "/r/b.md".into(),
            from: Some("/r/a.md".into()),
        }]);

        let created = map_event(&EventKind::Create(CreateKind::File), &[to.clone()]);
        assert_eq!(created[0].kind, FsEventKind::Create);
        assert!(map_event(&EventKind::Access(notify::event::AccessKind::Any), &[to]).is_empty());
    }
}
