#[cfg(target_os = "macos")]
use objc2::runtime::AnyObject;
#[cfg(target_os = "macos")]
use objc2::{msg_send, sel};
#[cfg(target_os = "macos")]
use std::ffi::c_void;

/// Enable the DOM element-fullscreen API in WKWebView. WebKit leaves this
/// preference disabled by default for embedded webviews, which makes
/// `document.fullscreenEnabled` false and causes fullscreen requests to fail.
#[cfg(target_os = "macos")]
pub unsafe fn enable_element_fullscreen(webview_ptr: *mut c_void) -> bool {
    if webview_ptr.is_null() {
        return false;
    }

    let webview = webview_ptr.cast::<AnyObject>();
    let configuration: *mut AnyObject = msg_send![webview, configuration];
    if configuration.is_null() {
        return false;
    }

    let preferences: *mut AnyObject = msg_send![configuration, preferences];
    if preferences.is_null() {
        return false;
    }

    let setter = sel!(setElementFullscreenEnabled:);
    let supports_preference: bool = msg_send![preferences, respondsToSelector: setter];
    if !supports_preference {
        return false;
    }

    let _: () = msg_send![preferences, setElementFullscreenEnabled: true];
    true
}
