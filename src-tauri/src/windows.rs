use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;
use tauri::webview::WebviewWindowBuilder;
use tauri::{Emitter, Manager, WebviewUrl};

/// Tracks which file paths are open in which editor windows
pub struct EditorWindowMap(pub Mutex<HashMap<String, String>>);

/// Counter for generating unique editor window labels
static EDITOR_COUNTER: AtomicU32 = AtomicU32::new(0);

/// Creates an accessory editor window for a given file path
pub fn create_editor_window(app: &tauri::AppHandle, file_path: &str) -> Result<String, String> {
    let map = app.state::<EditorWindowMap>();

    // Phase 1: Check/reserve under lock, then release
    let label = {
        let mut map_lock = map.0.lock().map_err(|e| e.to_string())?;

        // If already open, focus existing window
        if let Some(existing_label) = map_lock.get(file_path) {
            if let Some(win) = app.get_webview_window(existing_label) {
                let _ = win.show();
                let _ = win.set_focus();
                return Ok(existing_label.clone());
            }
            // Window was closed but map not cleaned up — remove stale entry
            map_lock.remove(file_path);
        }

        let count = EDITOR_COUNTER.fetch_add(1, Ordering::Relaxed);
        let label = format!("editor-{}", count);
        // Reserve the slot so concurrent calls don't duplicate
        map_lock.insert(file_path.to_string(), label.clone());
        label
    }; // lock released here

    // Phase 2: Build window without holding the lock
    let mut encoded_path = String::with_capacity(file_path.len() * 3);
    for &b in file_path.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                encoded_path.push(b as char);
            }
            _ => {
                encoded_path.push('%');
                encoded_path.push_str(&format!("{:02X}", b));
            }
        }
    }

    let url = WebviewUrl::App(format!("index.html?mode=editor&file={}", encoded_path).into());

    // Cascade offset: 30px per window, wrap after 10
    let count: u32 = label.strip_prefix("editor-").unwrap_or("0").parse().unwrap_or(0);
    let offset = (count % 10) as f64 * 30.0;

    let file_name = file_path
        .rsplit('/')
        .next()
        .unwrap_or(file_path);

    let builder = WebviewWindowBuilder::new(app, &label, url)
        .title(file_name)
        .inner_size(800.0, 600.0)
        .min_inner_size(400.0, 300.0)
        .position(200.0 + offset, 200.0 + offset)
        .decorations(true)
        .focused(true);

    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::Position::Logical(tauri::LogicalPosition::new(18.0, 28.0)));

    match builder.build() {
        Ok(window) => {
            #[cfg(target_os = "macos")]
            {
                let _ = window.with_webview(|webview| {
                    unsafe { super::context_menu::install_context_menu_hook(webview.inner()); }
                });
            }
            Ok(label)
        }
        Err(e) => {
            // Roll back the reservation on failure
            if let Ok(mut map_lock) = map.0.lock() {
                map_lock.remove(file_path);
            }
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn open_editor_window(app: tauri::AppHandle, file_path: String) -> Result<String, String> {
    create_editor_window(&app, &file_path)
}

#[tauri::command]
pub fn emit_file_renamed(app: tauri::AppHandle, old_path: String, new_path: String) -> Result<(), String> {
    let map = app.state::<EditorWindowMap>();
    if let Ok(mut map_lock) = map.0.lock() {
        if let Some(label) = map_lock.remove(&old_path) {
            map_lock.insert(new_path.clone(), label);
        }
    }
    let _ = app.emit("file-renamed", serde_json::json!({ "oldPath": old_path, "newPath": new_path }));
    Ok(())
}

#[tauri::command]
pub fn emit_file_deleted(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let _ = app.emit("file-deleted", &path);
    Ok(())
}
