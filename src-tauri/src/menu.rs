use std::sync::Mutex;
use tauri::menu::{MenuBuilder, SubmenuBuilder, MenuItemBuilder, PredefinedMenuItem};
use tauri::Manager;

/// Stores the "Show Main Window" menu item so we can enable/disable it
pub struct ShowMainMenuItem(pub Mutex<Option<tauri::menu::MenuItem<tauri::Wry>>>);

impl ShowMainMenuItem {
    pub fn set_enabled(&self, enabled: bool) {
        if let Ok(mi) = self.0.lock() {
            if let Some(ref item) = *mi {
                let _ = item.set_enabled(enabled);
            }
        }
    }
}

/// Build and install the app menu bar. Returns Ok(()) on success.
pub fn setup_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
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
        .separator()
        .item(&MenuItemBuilder::with_id("find", "Find")
            .accelerator("CmdOrCtrl+F")
            .build(app)?)
        .item(&MenuItemBuilder::with_id("find_replace", "Find and Replace")
            .accelerator("CmdOrCtrl+Alt+F")
            .build(app)?)
        .build()?;

    let show_main_item = MenuItemBuilder::with_id("show_main_window", "Show Main Window")
        .enabled(false)
        .build(app)?;

    // Store the menu item for later enable/disable
    if let Ok(mut mi) = app.state::<ShowMainMenuItem>().0.lock() {
        *mi = Some(show_main_item.clone());
    }

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&show_main_item)
        .separator()
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
        let focused_window = app_handle
            .webview_windows()
            .into_values()
            .find(|w| w.is_focused().unwrap_or(false));

        match event.id().as_ref() {
            "add_folder" => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.eval("window.__ghostAddFolder && window.__ghostAddFolder()");
                }
            }
            "new_file" => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                    let _ = window.eval("window.__ghostNewFile && window.__ghostNewFile()");
                }
            }
            "find" => {
                if let Some(window) = focused_window {
                    let _ = window.eval("window.__ghostFind && window.__ghostFind()");
                }
            }
            "find_replace" => {
                if let Some(window) = focused_window {
                    let _ = window.eval("window.__ghostFindAndReplace && window.__ghostFindAndReplace()");
                }
            }
            "show_main_window" => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                if let Some(state) = app_handle.try_state::<ShowMainMenuItem>() {
                    state.set_enabled(false);
                }
            }
            _ => {}
        }
    });

    Ok(())
}
