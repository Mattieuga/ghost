mod commands;
mod menu;
mod watcher;
mod windows;
#[cfg(target_os = "macos")]
mod context_menu;
#[cfg(target_os = "macos")]
mod traffic_lights;

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::Manager;
use tauri::RunEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(watcher::WatcherState::new())
        .manage(windows::EditorWindowMap(Mutex::new(HashMap::new())))
        .manage(menu::ShowMainMenuItem(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::fs::is_directory,
            commands::fs::read_directory,
            commands::fs::read_file,
            commands::fs::read_file_bytes,
            commands::fs::list_directory_files,
            commands::fs::write_file,
            commands::fs::create_file,
            commands::fs::create_directory,
            commands::fs::move_file,
            commands::fs::rename_file,
            commands::fs::delete_file,
            commands::fs::duplicate_file,
            commands::fs::reveal_in_finder,
            commands::fs::open_url,
            commands::fs::save_image,
            commands::fs::markdown_to_html,
            commands::fs::markdown_to_plain_text,
            commands::fs::get_file_metadata,
            commands::fs::list_system_fonts,
            commands::search::search_file_contents,
            watcher::watch_directories,
            windows::open_editor_window,
            windows::emit_file_renamed,
            windows::emit_file_deleted,
        ])
        .setup(|app| {
            menu::setup_menu(app)?;

            // Use dev icon for dock when in debug mode
            #[cfg(all(debug_assertions, target_os = "macos"))]
            {
                use objc2::{AnyThread, MainThreadMarker};
                use objc2_app_kit::{NSApplication, NSImage};
                use objc2_foundation::NSData;

                let icon_bytes = include_bytes!("../../icon-dev.png");
                if let Some(mtm) = MainThreadMarker::new() {
                    let data = NSData::with_bytes(icon_bytes);
                    if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
                        let ns_app = NSApplication::sharedApplication(mtm);
                        unsafe { ns_app.setApplicationIconImage(Some(&image)); }
                        println!("[ghost] dev icon set successfully");
                    } else {
                        println!("[ghost] failed to create NSImage from dev icon bytes");
                    }
                } else {
                    println!("[ghost] not on main thread, skipping dev icon");
                }
            }

            // Install native context menu hook + traffic light positioning on macOS
            #[cfg(target_os = "macos")]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.with_webview(|webview| {
                        unsafe { context_menu::install_context_menu_hook(webview.inner()); }
                    });
                    traffic_lights::setup(&window);
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match &event {
                RunEvent::Opened { urls } => {
                    for url in urls {
                        if url.scheme() == "file" {
                            if let Ok(path) = url.to_file_path() {
                                let path_str = path.to_string_lossy().to_string();
                                let _ = windows::create_editor_window(app_handle, &path_str);
                            }
                        }
                    }
                }
                RunEvent::WindowEvent { label, event: window_event, .. } => {
                    // Re-apply traffic light positions on events that reset them
                    #[cfg(target_os = "macos")]
                    {
                        match window_event {
                            tauri::WindowEvent::Focused(true)
                            | tauri::WindowEvent::Resized(_)
                            | tauri::WindowEvent::ThemeChanged(_) => {
                                if let Some(win) = app_handle.get_webview_window(label) {
                                    traffic_lights::reposition(&win);
                                }
                            }
                            _ => {}
                        }
                    }

                    match window_event {
                        tauri::WindowEvent::CloseRequested { api, .. } => {
                            if label == "main" {
                                api.prevent_close();
                                if let Some(win) = app_handle.get_webview_window("main") {
                                    let _ = win.hide();
                                }
                                if let Some(state) = app_handle.try_state::<menu::ShowMainMenuItem>() {
                                    state.set_enabled(true);
                                }
                            }
                        }
                        tauri::WindowEvent::Destroyed => {
                            if label.starts_with("editor-") {
                                if let Some(map) = app_handle.try_state::<windows::EditorWindowMap>() {
                                    if let Ok(mut map_lock) = map.0.lock() {
                                        map_lock.retain(|_, v| v != label);
                                        if map_lock.is_empty() {
                                            let main_visible = app_handle
                                                .get_webview_window("main")
                                                .and_then(|w| w.is_visible().ok())
                                                .unwrap_or(false);
                                            if !main_visible {
                                                app_handle.exit(0);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
                RunEvent::ExitRequested { api, .. } => {
                    api.prevent_exit();
                }
                #[cfg(target_os = "macos")]
                RunEvent::Reopen { .. } => {
                    if let Some(win) = app_handle.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                        if let Some(state) = app_handle.try_state::<menu::ShowMainMenuItem>() {
                            state.set_enabled(false);
                        }
                    }
                }
                _ => {}
            }
        });
}
