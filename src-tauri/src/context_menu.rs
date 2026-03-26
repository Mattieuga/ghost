#[cfg(target_os = "macos")]
use objc2::runtime::{AnyClass, AnyObject, Sel};
#[cfg(target_os = "macos")]
use objc2::{msg_send, sel, MainThreadOnly};
#[cfg(target_os = "macos")]
use objc2::ffi::class_addMethod;
#[cfg(target_os = "macos")]
use std::mem::transmute;
#[cfg(target_os = "macos")]
use objc2_foundation::{MainThreadMarker, NSString};
#[cfg(target_os = "macos")]
use objc2_app_kit::{NSMenu, NSMenuItem};
#[cfg(target_os = "macos")]
use std::ffi::c_void;

#[cfg(target_os = "macos")]
pub unsafe fn install_context_menu_hook(webview_ptr: *mut c_void) {
    let webview = webview_ptr as *mut AnyObject;
    let class: *const AnyClass = msg_send![webview, class];
    let class = class as *mut AnyClass;

    // Check if willOpenMenu:withEvent: is already installed
    let sel_will_open = sel!(willOpenMenu:withEvent:);
    let existing = objc2::ffi::class_getInstanceMethod(class as *const _, sel_will_open);
    if !existing.is_null() {
        return;
    }

    // Install willOpenMenu:withEvent:
    class_addMethod(
        class,
        sel_will_open,
        transmute::<unsafe extern "C" fn(&AnyObject, Sel, *mut AnyObject, *mut AnyObject), unsafe extern "C-unwind" fn()>(will_open_menu),
        std::ptr::null(),
    );

    // Install action handlers
    class_addMethod(
        class,
        sel!(ghostCopyAsMarkdown:),
        transmute::<unsafe extern "C" fn(&AnyObject, Sel, *mut AnyObject), unsafe extern "C-unwind" fn()>(ghost_copy_as_markdown),
        std::ptr::null(),
    );
    class_addMethod(
        class,
        sel!(ghostCopyAsPlainText:),
        transmute::<unsafe extern "C" fn(&AnyObject, Sel, *mut AnyObject), unsafe extern "C-unwind" fn()>(ghost_copy_as_plain_text),
        std::ptr::null(),
    );
    class_addMethod(
        class,
        sel!(ghostCopyAsRichText:),
        transmute::<unsafe extern "C" fn(&AnyObject, Sel, *mut AnyObject), unsafe extern "C-unwind" fn()>(ghost_copy_as_rich_text),
        std::ptr::null(),
    );

    eprintln!("[ghost] Context menu hook installed");
}

#[cfg(target_os = "macos")]
unsafe extern "C" fn will_open_menu(
    _this: &AnyObject,
    _cmd: Sel,
    menu: *mut AnyObject,
    _event: *mut AnyObject,
) {
    // We're on the main thread since this is a UI callback
    let mtm = MainThreadMarker::new().unwrap();
    let menu = &*(menu as *mut NSMenu);

    // Find the "Copy" item index to insert after it
    let count: isize = msg_send![menu, numberOfItems];
    let mut copy_index: isize = -1;

    for i in 0..count {
        let item: *mut AnyObject = msg_send![menu, itemAtIndex: i];
        if item.is_null() { continue; }
        let action: Sel = msg_send![item, action];
        if action == sel!(copy:) {
            copy_index = i;
            break;
        }
    }

    // Create "Copy As..." submenu
    let submenu_title = NSString::from_str("Copy As\u{2026}");
    let empty_key = NSString::from_str("");
    let submenu = NSMenu::new(mtm);
    submenu.setTitle(&submenu_title);

    // Plain Text item
    let plain_item = NSMenuItem::alloc(mtm);
    let plain_title = NSString::from_str("Plain Text");
    let plain_item: objc2::rc::Retained<NSMenuItem> = msg_send![
        plain_item,
        initWithTitle: &*plain_title,
        action: sel!(ghostCopyAsPlainText:),
        keyEquivalent: &*empty_key
    ];
    submenu.addItem(&plain_item);

    // Markdown item
    let md_item = NSMenuItem::alloc(mtm);
    let md_title = NSString::from_str("Markdown");
    let md_item: objc2::rc::Retained<NSMenuItem> = msg_send![
        md_item,
        initWithTitle: &*md_title,
        action: sel!(ghostCopyAsMarkdown:),
        keyEquivalent: &*empty_key
    ];
    submenu.addItem(&md_item);

    // Rich Text item
    let rich_item = NSMenuItem::alloc(mtm);
    let rich_title = NSString::from_str("Rich Text");
    let rich_item: objc2::rc::Retained<NSMenuItem> = msg_send![
        rich_item,
        initWithTitle: &*rich_title,
        action: sel!(ghostCopyAsRichText:),
        keyEquivalent: &*empty_key
    ];
    submenu.addItem(&rich_item);

    // Create parent menu item with submenu
    let parent_item = NSMenuItem::alloc(mtm);
    let parent_item: objc2::rc::Retained<NSMenuItem> = msg_send![
        parent_item,
        initWithTitle: &*submenu_title,
        action: std::ptr::null::<c_void>(),
        keyEquivalent: &*empty_key
    ];
    parent_item.setSubmenu(Some(&submenu));

    // Insert after "Copy" if found, otherwise at the end
    let insert_index = if copy_index >= 0 { copy_index + 1 } else { count };
    menu.insertItem_atIndex(&parent_item, insert_index);
}

/// Copy selected text as markdown (raw text from selection)
#[cfg(target_os = "macos")]
unsafe extern "C" fn ghost_copy_as_markdown(
    this: &AnyObject,
    _cmd: Sel,
    _sender: *mut AnyObject,
) {
    let js = NSString::from_str(
        "(() => { const sel = window.getSelection(); if (!sel || sel.rangeCount === 0) return; const text = sel.toString(); window.__TAURI_INTERNALS__.invoke('plugin:clipboard-manager|write_text', { label: null, text: { plainText: { text: text } } }); })()"
    );
    let _: () = msg_send![this, evaluateJavaScript: &*js, completionHandler: std::ptr::null::<c_void>()];
}

/// Copy selected text as plain text
#[cfg(target_os = "macos")]
unsafe extern "C" fn ghost_copy_as_plain_text(
    this: &AnyObject,
    _cmd: Sel,
    _sender: *mut AnyObject,
) {
    let js = NSString::from_str(
        "(() => { const sel = window.getSelection(); if (!sel || sel.rangeCount === 0) return; const text = sel.toString(); window.__TAURI_INTERNALS__.invoke('plugin:clipboard-manager|write_text', { label: null, text: { plainText: { text: text } } }); })()"
    );
    let _: () = msg_send![this, evaluateJavaScript: &*js, completionHandler: std::ptr::null::<c_void>()];
}

/// Copy selected text as rich text (HTML)
#[cfg(target_os = "macos")]
unsafe extern "C" fn ghost_copy_as_rich_text(
    this: &AnyObject,
    _cmd: Sel,
    _sender: *mut AnyObject,
) {
    let js = NSString::from_str(
        "(() => { const sel = window.getSelection(); if (!sel || sel.rangeCount === 0) return; const range = sel.getRangeAt(0); const div = document.createElement('div'); div.appendChild(range.cloneContents()); const html = div.innerHTML; window.__TAURI_INTERNALS__.invoke('plugin:clipboard-manager|write_html', { label: null, html: { html: { html: html } } }); })()"
    );
    let _: () = msg_send![this, evaluateJavaScript: &*js, completionHandler: std::ptr::null::<c_void>()];
}
