mod commands;
mod watcher;

use tauri::Manager;
use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder, PredefinedMenuItem};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .manage(watcher::WatcherState::new())
        .invoke_handler(tauri::generate_handler![
            commands::fs::read_directory,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::create_file,
            commands::fs::create_directory,
            commands::fs::move_file,
            commands::fs::rename_file,
            commands::fs::delete_file,
            commands::fs::duplicate_file,
            commands::fs::reveal_in_finder,
            watcher::watch_directories,
        ])
        .setup(|app| {
            // Build macOS menu bar
            let app_menu = SubmenuBuilder::new(app, "Ghost")
                .about(None)
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .show_all()
                .separator()
                .quit()
                .build()?;

            let file_menu = SubmenuBuilder::new(app, "File")
                .item(&MenuItemBuilder::with_id("add_folder", "Add Folder")
                    .accelerator("CmdOrCtrl+O")
                    .build(app)?)
                .item(&MenuItemBuilder::with_id("new_file", "New File")
                    .accelerator("CmdOrCtrl+N")
                    .build(app)?)
                .separator()
                .close_window()
                .build()?;

            let edit_menu = SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?;

            let view_menu = SubmenuBuilder::new(app, "View")
                .item(&PredefinedMenuItem::fullscreen(app, None)?)
                .build()?;

            let menu = MenuBuilder::new(app)
                .item(&app_menu)
                .item(&file_menu)
                .item(&edit_menu)
                .item(&view_menu)
                .build()?;

            app.set_menu(menu)?;

            // Handle menu events
            app.on_menu_event(move |app_handle, event| {
                match event.id().as_ref() {
                    "add_folder" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.eval("window.__ghostAddFolder && window.__ghostAddFolder()");
                        }
                    }
                    "new_file" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.eval("window.__ghostNewFile && window.__ghostNewFile()");
                        }
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
