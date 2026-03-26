#[cfg(target_os = "macos")]
use objc2::runtime::{AnyClass, AnyObject, Sel};
#[cfg(target_os = "macos")]
use objc2::{class, msg_send, sel};
#[cfg(target_os = "macos")]
use objc2::ffi::class_addMethod;
#[cfg(target_os = "macos")]
use std::mem::transmute;
#[cfg(target_os = "macos")]
use objc2_foundation::NSString;
#[cfg(target_os = "macos")]
use std::ffi::c_void;

#[cfg(target_os = "macos")]
pub unsafe fn install_context_menu_hook(webview_ptr: *mut c_void) {
    let webview = webview_ptr as *mut AnyObject;
    let class: *const AnyClass = msg_send![webview, class];
    let class = class as *mut AnyClass;

    let sel_will_open = sel!(willOpenMenu:withEvent:);

    // Check if already installed by us (avoid double-install on hot reload)
    let existing = objc2::ffi::class_getInstanceMethod(class as *const _, sel_will_open);
    if !existing.is_null() {
        eprintln!("[ghost] willOpenMenu:withEvent: already exists on class, attempting method_setImplementation...");
        // Replace the existing implementation instead of adding a new one
        let imp = transmute::<unsafe extern "C" fn(&AnyObject, Sel, *mut AnyObject, *mut AnyObject), unsafe extern "C-unwind" fn()>(will_open_menu);
        objc2::ffi::method_setImplementation(existing, imp);
    } else {
        eprintln!("[ghost] Adding willOpenMenu:withEvent: to class...");
        class_addMethod(
            class,
            sel_will_open,
            transmute::<unsafe extern "C" fn(&AnyObject, Sel, *mut AnyObject, *mut AnyObject), unsafe extern "C-unwind" fn()>(will_open_menu),
            std::ptr::null(),
        );
    }

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
    eprintln!("[ghost] willOpenMenu called! menu ptr: {:?}", menu);

    // Use raw ObjC messaging only — avoid objc2 high-level APIs that may panic
    let menu = menu as *mut AnyObject;
    if menu.is_null() { return; }

    // Find "Copy" item index
    let count: isize = msg_send![menu, numberOfItems];
    let mut copy_index: isize = -1;
    let mut copy_image: *mut AnyObject = std::ptr::null_mut();
    for i in 0..count {
        let item: *mut AnyObject = msg_send![menu, itemAtIndex: i];
        if item.is_null() { continue; }
        let title: *mut AnyObject = msg_send![item, title];
        if title.is_null() { continue; }
        let title_str: *const std::os::raw::c_char = msg_send![title, UTF8String];
        if title_str.is_null() { continue; }
        let title_rust = std::ffi::CStr::from_ptr(title_str).to_string_lossy();
        if title_rust == "Copy" {
            copy_index = i;
            copy_image = msg_send![item, image];
            break;
        }
    }
    eprintln!("[ghost] Found {} items, copy at index {}", count, copy_index);

    // Create submenu using raw alloc/init
    let submenu_title = NSString::from_str("Copy As\u{2026}");
    let empty_key = NSString::from_str("");

    let ns_menu_class = objc2::class!(NSMenu);
    let submenu: *mut AnyObject = msg_send![ns_menu_class, alloc];
    let submenu: *mut AnyObject = msg_send![submenu, initWithTitle: &*submenu_title];

    // Helper to create menu items
    let ns_menu_item_class = objc2::class!(NSMenuItem);

    let plain_title = NSString::from_str("Plain Text");
    let plain_item: *mut AnyObject = msg_send![ns_menu_item_class, alloc];
    let plain_item: *mut AnyObject = msg_send![plain_item, initWithTitle: &*plain_title, action: sel!(ghostCopyAsPlainText:), keyEquivalent: &*empty_key];
    let _: () = msg_send![submenu, addItem: plain_item];

    let md_title = NSString::from_str("Markdown");
    let md_item: *mut AnyObject = msg_send![ns_menu_item_class, alloc];
    let md_item: *mut AnyObject = msg_send![md_item, initWithTitle: &*md_title, action: sel!(ghostCopyAsMarkdown:), keyEquivalent: &*empty_key];
    let _: () = msg_send![submenu, addItem: md_item];

    let rich_title = NSString::from_str("Rich Text");
    let rich_item: *mut AnyObject = msg_send![ns_menu_item_class, alloc];
    let rich_item: *mut AnyObject = msg_send![rich_item, initWithTitle: &*rich_title, action: sel!(ghostCopyAsRichText:), keyEquivalent: &*empty_key];
    let _: () = msg_send![submenu, addItem: rich_item];

    // Create parent item
    let parent_item: *mut AnyObject = msg_send![ns_menu_item_class, alloc];
    let parent_item: *mut AnyObject = msg_send![parent_item, initWithTitle: &*submenu_title, action: std::ptr::null::<c_void>(), keyEquivalent: &*empty_key];
    let _: () = msg_send![parent_item, setSubmenu: submenu];
    if !copy_image.is_null() {
        let _: () = msg_send![parent_item, setImage: copy_image];
    }

    // Insert after Copy
    let insert_index = if copy_index >= 0 { copy_index + 1 } else { count };
    let _: () = msg_send![menu, insertItem: parent_item, atIndex: insert_index];
    eprintln!("[ghost] Inserted Copy As... at index {}", insert_index);
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
