#![cfg(target_os = "macos")]

use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{msg_send, sel, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSView, NSWorkspace};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString, NSURL};
use objc2_quick_look_ui::{QLPreviewItem, QLPreviewView, QLPreviewViewStyle};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{State, WebviewWindow};

struct MountedQuickLookView {
    view_id: String,
    generation: u64,
    pointer: usize,
}

pub struct QuickLookViewState(Arc<Mutex<HashMap<String, MountedQuickLookView>>>);

impl QuickLookViewState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }
}

#[derive(Debug, Serialize)]
pub struct QuickLookNativeState {
    pub mounted: bool,
}

/// Release a retained Quick Look surface if its webview is destroyed before
/// React can send its normal hide command.
pub fn cleanup_quick_look_view(state: &QuickLookViewState, label: &str) {
    if MainThreadMarker::new().is_none() {
        return;
    }
    let mounted = state
        .0
        .lock()
        .ok()
        .and_then(|mut views| views.remove(label));
    if let Some(mounted) = mounted {
        release_mounted_view(mounted);
    }
}

fn frame_for_webview(webview: &NSView, x: f64, y: f64, width: f64, height: f64) -> NSRect {
    let bounds = webview.bounds();
    let native_y = if webview.isFlipped() {
        y
    } else {
        bounds.size.height - y - height
    };
    NSRect::new(
        NSPoint::new(x, native_y),
        NSSize::new(width.max(1.0), height.max(1.0)),
    )
}

unsafe fn view_from_pointer<'a>(pointer: usize) -> &'a QLPreviewView {
    unsafe { &*(pointer as *const QLPreviewView) }
}

/// Quick Look builds its interactive preview subtree asynchronously. The
/// outer QLPreviewView accepts first responder, but document providers place
/// selection, scrolling, and keyboard handling on a deeper child view. Finder's
/// QLPreviewPanel focuses that child. Mirror that behavior without depending on
/// any private Quick Look class names, which can change between macOS releases.
fn deepest_focusable_descendant(view: &NSView) -> Option<Retained<NSView>> {
    for child in view.subviews().to_vec().into_iter().rev() {
        if let Some(descendant) = deepest_focusable_descendant(&child) {
            return Some(descendant);
        }
        if child.acceptsFirstResponder() {
            return Some(child);
        }
    }
    None
}

/// Apple's public embedded Quick Look mode renders Office previews with text
/// interaction disabled, even though the same provider is selectable in
/// Finder's Quick Look panel. Opt into the panel interaction mode when the
/// current macOS implementation exposes its guarded selector. This app is
/// distributed directly rather than through the Mac App Store; if Apple
/// removes the selector, the standard read-only preview remains available.
fn enable_selectable_preview_mode(view: &QLPreviewView) {
    const QUICK_LOOK_PANEL_MODE: isize = 5;
    unsafe {
        let setter = sel!(setMode:reloadItemIfNeeded:);
        let supports_mode: bool = msg_send![view, respondsToSelector: setter];
        if supports_mode {
            // Set the mode before assigning previewItem. Changing it after the
            // provider loads does not update WebKit's text-selection policy
            // unless the entire item is reloaded.
            let _: () = msg_send![view, setMode: QUICK_LOOK_PANEL_MODE, reloadItemIfNeeded: false];
        }
    }
}

fn is_file_package(path: &std::path::Path) -> bool {
    let path = NSString::from_str(&path.to_string_lossy());
    NSWorkspace::sharedWorkspace().isFilePackageAtPath(&path)
}

fn release_mounted_view(mounted: MountedQuickLookView) {
    if let Some(view) = unsafe { Retained::from_raw(mounted.pointer as *mut QLPreviewView) } {
        view.removeFromSuperview();
        // Ghost explicitly owns this view beyond an individual window-close
        // event, so Quick Look requires a matching close before release.
        unsafe { view.close() };
        drop(view);
    }
}

fn on_webview<T, F>(window: &WebviewWindow, operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&NSView) -> Result<T, String> + Send + 'static,
{
    let (sender, receiver) = mpsc::sync_channel(1);
    window
        .with_webview(move |platform| {
            let webview = unsafe { &*(platform.inner() as *const NSView) };
            let _ = sender.send(operation(webview));
        })
        .map_err(|error| format!("Could not access the native Quick Look surface: {error}"))?;
    receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "The native Quick Look surface did not respond".to_string())?
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn show_quick_look_view(
    window: WebviewWindow,
    state: State<'_, QuickLookViewState>,
    path: String,
    view_id: String,
    generation: u64,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<QuickLookNativeState, String> {
    let canonical = std::fs::canonicalize(&path)
        .map_err(|error| format!("Could not open document preview: {error}"))?;
    if !canonical.is_file() && !is_file_package(&canonical) {
        return Err("Quick Look document previews require a file or document package".to_string());
    }
    let label = window.label().to_string();
    let views = state.0.clone();

    on_webview(&window, move |webview| {
        let previous = {
            let mut registry = views
                .lock()
                .map_err(|_| "The Quick Look view registry is unavailable".to_string())?;
            if registry
                .get(&label)
                .is_some_and(|mounted| mounted.generation > generation)
            {
                return Err("A newer Quick Look view is already mounted".to_string());
            }
            registry.remove(&label)
        };
        if let Some(previous) = previous {
            release_mounted_view(previous);
        }

        let frame = frame_for_webview(webview, x, y, width, height);
        let mtm = MainThreadMarker::new()
            .ok_or_else(|| "Quick Look was not called on the main thread".to_string())?;
        let preview_view = unsafe {
            QLPreviewView::initWithFrame_style(
                QLPreviewView::alloc(mtm),
                frame,
                QLPreviewViewStyle::Normal,
            )
        }
        .ok_or_else(|| "Quick Look could not create a document preview".to_string())?;
        enable_selectable_preview_mode(&preview_view);

        let path_string = NSString::from_str(&canonical.to_string_lossy());
        let url = NSURL::fileURLWithPath(&path_string);
        let preview_item: &ProtocolObject<dyn QLPreviewItem> = ProtocolObject::from_ref(&*url);
        unsafe {
            preview_view.setShouldCloseWithWindow(false);
            preview_view.setAutostarts(false);
            preview_view.setPreviewItem(Some(preview_item));
        }
        webview.addSubview(&preview_view);

        let mounted = MountedQuickLookView {
            view_id,
            generation,
            pointer: Retained::into_raw(preview_view) as usize,
        };
        match views.lock() {
            Ok(mut registry) => {
                registry.insert(label, mounted);
            }
            Err(_) => {
                release_mounted_view(mounted);
                return Err("The Quick Look view registry is unavailable".to_string());
            }
        }

        Ok(QuickLookNativeState { mounted: true })
    })
}

#[tauri::command]
pub fn update_quick_look_view_frame(
    window: WebviewWindow,
    state: State<'_, QuickLookViewState>,
    view_id: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let label = window.label().to_string();
    let views = state.0.clone();
    on_webview(&window, move |webview| {
        let pointer = views
            .lock()
            .map_err(|_| "The Quick Look view registry is unavailable".to_string())?
            .get(&label)
            .filter(|mounted| mounted.view_id == view_id)
            .map(|mounted| mounted.pointer);
        if let Some(pointer) = pointer {
            unsafe { view_from_pointer(pointer) }
                .setFrame(frame_for_webview(webview, x, y, width, height));
        }
        Ok(())
    })
}

#[tauri::command]
pub fn hide_quick_look_view(
    window: WebviewWindow,
    state: State<'_, QuickLookViewState>,
    view_id: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    let views = state.0.clone();
    on_webview(&window, move |_| {
        let mounted = {
            let mut registry = views
                .lock()
                .map_err(|_| "The Quick Look view registry is unavailable".to_string())?;
            if registry
                .get(&label)
                .is_some_and(|mounted| mounted.view_id == view_id)
            {
                registry.remove(&label)
            } else {
                None
            }
        };
        if let Some(mounted) = mounted {
            release_mounted_view(mounted);
        }
        Ok(())
    })
}

#[tauri::command]
pub fn quick_look_view_action(
    window: WebviewWindow,
    state: State<'_, QuickLookViewState>,
    view_id: String,
    action: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    let views = state.0.clone();
    on_webview(&window, move |webview| {
        let pointer = views
            .lock()
            .map_err(|_| "The Quick Look view registry is unavailable".to_string())?
            .get(&label)
            .filter(|mounted| mounted.view_id == view_id)
            .map(|mounted| mounted.pointer)
            .ok_or_else(|| "The Quick Look view is not mounted".to_string())?;
        let view = unsafe { view_from_pointer(pointer) };
        match action.as_str() {
            "refresh" => unsafe { view.refreshPreviewItem() },
            "focus" => {
                if let Some(native_window) = webview.window() {
                    if let Some(target) = deepest_focusable_descendant(view) {
                        native_window.makeFirstResponder(Some(&target));
                    } else {
                        native_window.makeFirstResponder(Some(view));
                    }
                }
            }
            _ => return Err("Unknown Quick Look action".to_string()),
        }
        Ok(())
    })
}
