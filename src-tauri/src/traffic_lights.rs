#![cfg(target_os = "macos")]

use objc2::msg_send;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Sel};
use objc2::sel;
use objc2_app_kit::{NSView, NSWindow, NSWindowButton};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use std::mem::transmute;

/// Traffic light position constants (must match tauri.conf.json)
const X: f64 = 18.0;
const Y_OFFSET: f64 = 34.0;
const BUTTON_HEIGHT: f64 = 14.0;
const BUTTON_SPACING: f64 = 20.0;

/// Position the traffic light buttons on an NSWindow.
///
/// wry's `inset_traffic_lights` runs once at creation. macOS resets the
/// positions on focus, resize, and fullscreen transitions. This function
/// re-applies the same layout so we can call it from window event handlers.
unsafe fn apply(ns_window: &NSWindow) {
    let titlebar_h = BUTTON_HEIGHT + Y_OFFSET;

    let buttons = [
        NSWindowButton::CloseButton,
        NSWindowButton::MiniaturizeButton,
        NSWindowButton::ZoomButton,
    ];

    for (i, kind) in buttons.iter().enumerate() {
        let Some(btn) = ns_window.standardWindowButton(*kind) else {
            continue;
        };
        let frame: NSRect = msg_send![&*btn, frame];
        let btn_y = (titlebar_h - frame.size.height) / 2.0;
        let origin = NSPoint::new(X + (i as f64 * BUTTON_SPACING), btn_y);
        let new_frame = NSRect::new(origin, frame.size);
        let _: () = msg_send![&*btn, setFrame: new_frame];
    }

    // Resize the titlebar container so macOS doesn't clip the buttons
    if let Some(close) = ns_window.standardWindowButton(NSWindowButton::CloseButton) {
        let superview: Option<Retained<NSView>> = msg_send![&*close, superview];
        if let Some(container) = superview {
            let cf: NSRect = msg_send![&*container, frame];
            let new_frame = NSRect::new(cf.origin, NSSize::new(cf.size.width, titlebar_h));
            let _: () = msg_send![&*container, setFrame: new_frame];
        }
    }
}

/// Called by NSNotificationCenter when the titlebar container frame changes.
unsafe extern "C" fn handle_frame_change(
    this: &AnyObject,
    _cmd: Sel,
    _notification: *mut AnyObject,
) {
    let ns_window: *mut NSWindow = msg_send![this, window];
    if !ns_window.is_null() {
        apply(&*ns_window);
    }
}

/// Install a frame-change observer on the titlebar container so traffic lights
/// are repositioned continuously during live resize (not just after).
unsafe fn observe_frame_changes(webview: *mut AnyObject, ns_window: &NSWindow) {
    let Some(close) = ns_window.standardWindowButton(NSWindowButton::CloseButton) else {
        return;
    };
    let superview: Option<Retained<NSView>> = msg_send![&*close, superview];
    let Some(container) = superview else { return };

    // Enable frame change notifications on the titlebar container
    let _: () = msg_send![&*container, setPostsFrameChangedNotifications: true];

    // Install the handler method on the webview's class (like context_menu does)
    let sel = sel!(ghostHandleFrameChange:);
    let class: *const AnyClass = msg_send![webview, class];
    let class = class as *mut AnyClass;

    let existing = objc2::ffi::class_getInstanceMethod(class as *const _, sel);
    if existing.is_null() {
        objc2::ffi::class_addMethod(
            class,
            sel,
            transmute::<
                unsafe extern "C" fn(&AnyObject, Sel, *mut AnyObject),
                unsafe extern "C-unwind" fn(),
            >(handle_frame_change),
            std::ptr::null(),
        );
    }

    // Register with NSNotificationCenter
    let center: *mut AnyObject = msg_send![objc2::class!(NSNotificationCenter), defaultCenter];
    let name = NSString::from_str("NSViewFrameDidChangeNotification");
    let _: () = msg_send![
        center,
        addObserver: webview,
        selector: sel,
        name: &*name,
        object: &*container
    ];
}

/// Apply traffic light positioning to a webview window.
/// Safe to call repeatedly (idempotent).
pub fn reposition(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        let wv = webview.inner() as *mut AnyObject;
        let ns_window: *mut NSWindow = msg_send![wv, window];
        if !ns_window.is_null() {
            apply(&*ns_window);
        }
    });
}

/// Apply positioning and install a live-resize observer.
/// Call once during setup.
pub fn setup(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        let wv = webview.inner() as *mut AnyObject;
        let ns_window: *mut NSWindow = msg_send![wv, window];
        if !ns_window.is_null() {
            apply(&*ns_window);
            observe_frame_changes(wv, &*ns_window);
        }
    });
}
