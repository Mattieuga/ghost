use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub struct WatcherState {
    pub watched_paths: Mutex<Vec<PathBuf>>,
    _watcher: Mutex<Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            watched_paths: Mutex::new(Vec::new()),
            _watcher: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub async fn watch_directories(app: AppHandle, paths: Vec<String>) -> Result<(), String> {
    let state = app.state::<WatcherState>();

    let app_handle = app.clone();
    let debouncer = new_debouncer(Duration::from_millis(500), move |events: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
        match events {
            Ok(events) => {
                for event in events {
                    if event.kind == DebouncedEventKind::Any {
                        let path_str = event.path.to_string_lossy().to_string();
                        let _ = app_handle.emit("fs-change", path_str);
                    }
                }
            }
            Err(e) => {
                eprintln!("Watch error: {:?}", e);
            }
        }
    }).map_err(|e| format!("Failed to create watcher: {}", e))?;

    let mut watcher_lock = state._watcher.lock().map_err(|e| e.to_string())?;
    let mut watched = state.watched_paths.lock().map_err(|e| e.to_string())?;

    // Store the debouncer
    *watcher_lock = Some(debouncer);

    // Watch all paths
    watched.clear();
    if let Some(ref mut w) = *watcher_lock {
        for path_str in &paths {
            let path = PathBuf::from(path_str);
            if path.exists() {
                w.watcher()
                    .watch(&path, notify::RecursiveMode::Recursive)
                    .map_err(|e| format!("Failed to watch {}: {}", path_str, e))?;
                watched.push(path);
            }
        }
    }

    Ok(())
}
