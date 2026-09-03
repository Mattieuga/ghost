mod bookmarks;
mod commands;
mod menu;
mod own_writes;
mod watcher;
mod windows;
#[cfg(target_os = "macos")]
mod context_menu;
#[cfg(target_os = "macos")]
mod traffic_lights;
#[cfg(target_os = "macos")]
mod webview_config;
#[cfg(target_os = "macos")]
mod pdf_view;
#[cfg(target_os = "macos")]
mod quick_look_view;

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tauri::RunEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(watcher::WatcherState::new())
        .manage(own_writes::OwnWriteRegistry::new())
        .manage(commands::fs::FileWriteState::new())
        .manage(commands::fs::SourceSaveState::new())
        .manage(commands::fs::LargeTextSearchState::new())
        .manage(pdf_view::PdfViewState::new())
        .manage(quick_look_view::QuickLookViewState::new())
        .manage(windows::EditorWindowMap(Mutex::new(HashMap::new())))
        .manage(windows::ClosingEditorWindows(Mutex::new(HashSet::new())))
        .manage(menu::ShowMainMenuItem(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            commands::archive::list_archive,
            commands::archive::extract_archive,
            commands::archive_preview::materialize_archive_entry,
            commands::archive_preview::cancel_archive_preview,
            commands::archive_preview::release_archive_preview,
            commands::ghost_folder::ghost_folder,
            commands::ghost_folder::ensure_notes_folder,
            commands::fs::write_conflict_copy,
            commands::fs::hash_file,
            commands::fs::hash_text_content,
            commands::fs::ensure_directory,
            commands::fs::remove_ghost_metadata_file,
            commands::sync_candidate::inspect_sync_candidate,
            commands::sync_links::link_folder_into_repository,
            commands::sync_links::mounted_volumes,
            commands::sync_links::remove_ghost_metadata_dir,
            commands::fs::copy_file_into,
            bookmarks::create_folder_bookmark,
            bookmarks::resolve_folder_bookmark,
            commands::fs::is_directory,
            commands::fs::read_directory,
            commands::fs::list_workspace_files,
            commands::fs::read_file,
            commands::fs::read_text_preview,
            commands::fs::read_file_if_text,
            commands::fs::inspect_source,
            commands::fs::read_source_chunk,
            commands::fs::read_source_chunk_raw,
            commands::fs::read_text_window,
            commands::fs::search_large_text,
            commands::fs::cancel_large_text_search,
            commands::fs::inspect_image,
            commands::fs::read_image_thumbnail,
            commands::fs::list_directory_files,
            commands::fs::write_file,
            commands::fs::get_file_version,
            commands::fs::begin_source_save,
            commands::fs::append_source_save,
            commands::fs::commit_source_save,
            commands::fs::abort_source_save,
            commands::fs::create_file,
            commands::fs::create_directory,
            commands::fs::move_file,
            commands::fs::rename_file,
            commands::fs::delete_file,
            commands::fs::duplicate_file,
            commands::fs::reveal_in_finder,
            commands::fs::open_url,
            commands::fs::save_image,
            commands::fs::save_image_from_path,
            commands::fs::markdown_to_html,
            commands::fs::markdown_to_plain_text,
            commands::fs::get_file_metadata,
            commands::fs::read_file_icon,
            commands::fs::prepare_html_preview,
            commands::fs::prepare_media_asset,
            commands::fs::list_system_fonts,
            commands::fs::open_with_default_app,
            commands::search::search_file_contents,
            pdf_view::show_pdf_view,
            pdf_view::update_pdf_view_frame,
            pdf_view::hide_pdf_view,
            pdf_view::pdf_view_action,
            pdf_view::get_pdf_view_state,
            pdf_view::search_pdf_view,
            quick_look_view::show_quick_look_view,
            quick_look_view::update_quick_look_view_frame,
            quick_look_view::hide_quick_look_view,
            quick_look_view::quick_look_view_action,
            watcher::watch_directories,
            windows::open_editor_window,
            windows::list_editor_windows,
            windows::close_editor_window,
            windows::emit_file_renamed,
            windows::emit_file_deleted,
        ])
        .setup(|app| {
            app.manage(commands::archive_preview::ArchivePreviewCache::new(
                app.handle(),
            )?);
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
                        unsafe {
                            context_menu::install_context_menu_hook(webview.inner());
                            webview_config::enable_element_fullscreen(webview.inner());
                        }
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
                RunEvent::Exit => {
                    if let Some(cache) = app_handle
                        .try_state::<commands::archive_preview::ArchivePreviewCache>()
                    {
                        cache.cleanup_session();
                    }
                }
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
                            } else if label.starts_with("editor-") {
                                let may_close = app_handle
                                    .try_state::<windows::ClosingEditorWindows>()
                                    .and_then(|state| state.0.lock().ok().map(|mut closing| closing.remove(label)))
                                    .unwrap_or(false);

                                if !may_close {
                                    api.prevent_close();
                                    if let Some(window) = app_handle.get_webview_window(label) {
                                        let _ = window.emit("request-editor-close", ());
                                    }
                                }
                            }
                        }
                        tauri::WindowEvent::Destroyed => {
                            #[cfg(target_os = "macos")]
                            if let Some(state) = app_handle.try_state::<pdf_view::PdfViewState>() {
                                pdf_view::cleanup_pdf_view(&state, label);
                            }
                            #[cfg(target_os = "macos")]
                            if let Some(state) = app_handle.try_state::<quick_look_view::QuickLookViewState>() {
                                quick_look_view::cleanup_quick_look_view(&state, label);
                            }

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
