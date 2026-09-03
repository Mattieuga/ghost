#![cfg(target_os = "macos")]

use objc2::rc::Retained;
use objc2::{AnyThread, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::NSView;
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString, NSStringCompareOptions, NSURL};
use objc2_pdf_kit::{PDFDisplayDirection, PDFDisplayMode, PDFDocument, PDFSelection, PDFView};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{State, WebviewWindow};

struct MountedPdfView {
    view_id: String,
    generation: u64,
    pointer: usize,
    search_query: String,
    search_results: Vec<usize>,
}

pub struct PdfViewState(Arc<Mutex<HashMap<String, MountedPdfView>>>);

impl PdfViewState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }
}

/// Release a retained PDFKit surface when its webview is destroyed before the
/// React cleanup command can run. Tauri delivers window lifecycle events on
/// the AppKit thread, so this must only be called from that event handler.
pub fn cleanup_pdf_view(state: &PdfViewState, label: &str) {
    if MainThreadMarker::new().is_none() {
        return;
    }
    let pointer = state
        .0
        .lock()
        .ok()
        .and_then(|mut views| views.remove(label));
    if let Some(mounted) = pointer {
        release_mounted_view(mounted);
    }
}

#[derive(Debug, Serialize)]
pub struct PdfNativeState {
    pub page_count: usize,
    pub current_page: usize,
    pub scale_factor: f64,
    pub locked: bool,
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

unsafe fn view_from_pointer<'a>(pointer: usize) -> &'a PDFView {
    unsafe { &*(pointer as *const PDFView) }
}

unsafe fn selection_from_pointer<'a>(pointer: usize) -> &'a PDFSelection {
    unsafe { &*(pointer as *const PDFSelection) }
}

fn clear_search_results(mounted: &mut MountedPdfView) {
    for pointer in mounted.search_results.drain(..) {
        if let Some(selection) = unsafe { Retained::from_raw(pointer as *mut PDFSelection) } {
            drop(selection);
        }
    }
    mounted.search_query.clear();
}

fn release_mounted_view(mut mounted: MountedPdfView) {
    clear_search_results(&mut mounted);
    if let Some(view) = unsafe { Retained::from_raw(mounted.pointer as *mut PDFView) } {
        view.removeFromSuperview();
        drop(view);
    }
}

fn state_for_view(view: &PDFView) -> Result<PdfNativeState, String> {
    let document =
        unsafe { view.document() }.ok_or_else(|| "The PDF document is unavailable".to_string())?;
    let page_count = unsafe { document.pageCount() };
    let current_page = unsafe { view.currentPage() }
        .map(|page| unsafe { document.indexForPage(&page) + 1 })
        .unwrap_or(0);
    Ok(PdfNativeState {
        page_count,
        current_page,
        scale_factor: unsafe { view.scaleFactor() },
        locked: unsafe { document.isLocked() },
    })
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
        .map_err(|error| format!("Could not access the native PDF surface: {}", error))?;
    receiver
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| "The native PDF surface did not respond".to_string())?
}

#[tauri::command]
// Tauri maps these flat parameters directly from the invoke payload. Keeping
// the rectangle fields flat avoids a second frontend/native wire type.
#[allow(clippy::too_many_arguments)]
pub fn show_pdf_view(
    window: WebviewWindow,
    state: State<'_, PdfViewState>,
    path: String,
    view_id: String,
    generation: u64,
    hidden: bool,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<PdfNativeState, String> {
    let canonical =
        std::fs::canonicalize(&path).map_err(|error| format!("Could not open PDF: {}", error))?;
    let label = window.label().to_string();
    let views = state.0.clone();

    on_webview(&window, move |webview| {
        let mounted = {
            let mut registry = views
                .lock()
                .map_err(|_| "The PDF view registry is unavailable".to_string())?;
            if registry
                .get(&label)
                .is_some_and(|mounted| mounted.generation > generation)
            {
                return Err("A newer PDF view is already mounted".to_string());
            }
            registry.remove(&label)
        };
        if let Some(mounted) = mounted {
            release_mounted_view(mounted);
        }

        let path_string = NSString::from_str(&canonical.to_string_lossy());
        let url = NSURL::fileURLWithPath(&path_string);
        let document = unsafe { PDFDocument::initWithURL(PDFDocument::alloc(), &url) }
            .ok_or_else(|| "PDFKit could not open this document".to_string())?;
        if unsafe { document.isLocked() } {
            return Err(
                "This PDF is password protected. Open it in Preview to unlock it.".to_string(),
            );
        }

        let frame = frame_for_webview(webview, x, y, width, height);
        let mtm = MainThreadMarker::new()
            .ok_or_else(|| "PDFKit was not called on the main thread".to_string())?;
        let pdf_view = unsafe { PDFView::initWithFrame(PDFView::alloc(mtm), frame) };
        unsafe {
            pdf_view.setDisplayMode(PDFDisplayMode::SinglePageContinuous);
            pdf_view.setDisplayDirection(PDFDisplayDirection::Vertical);
            pdf_view.setDisplaysPageBreaks(true);
            pdf_view.setMinScaleFactor(0.25);
            pdf_view.setMaxScaleFactor(8.0);
            pdf_view.setDocument(Some(&document));
            pdf_view.setAutoScales(true);
        }
        pdf_view.setHidden(hidden);
        webview.addSubview(&pdf_view);
        let native_state = state_for_view(&pdf_view)?;
        let pointer = Retained::into_raw(pdf_view) as usize;
        views
            .lock()
            .map_err(|_| "The PDF view registry is unavailable".to_string())?
            .insert(
                label,
                MountedPdfView {
                    view_id,
                    generation,
                    pointer,
                    search_query: String::new(),
                    search_results: Vec::new(),
                },
            );
        Ok(native_state)
    })
}

#[tauri::command]
pub fn update_pdf_view_frame(
    window: WebviewWindow,
    state: State<'_, PdfViewState>,
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
            .map_err(|_| "The PDF view registry is unavailable".to_string())?
            .get(&label)
            .filter(|mounted| mounted.view_id == view_id)
            .map(|mounted| mounted.pointer);
        if let Some(pointer) = pointer {
            let view = unsafe { view_from_pointer(pointer) };
            view.setFrame(frame_for_webview(webview, x, y, width, height));
        }
        Ok(())
    })
}

#[tauri::command]
pub fn hide_pdf_view(
    window: WebviewWindow,
    state: State<'_, PdfViewState>,
    view_id: String,
) -> Result<(), String> {
    let label = window.label().to_string();
    let views = state.0.clone();
    on_webview(&window, move |_| {
        let mounted = {
            let mut registry = views
                .lock()
                .map_err(|_| "The PDF view registry is unavailable".to_string())?;
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
pub fn pdf_view_action(
    window: WebviewWindow,
    state: State<'_, PdfViewState>,
    view_id: String,
    action: String,
    page: Option<usize>,
) -> Result<PdfNativeState, String> {
    let label = window.label().to_string();
    let views = state.0.clone();
    on_webview(&window, move |webview| {
        let pointer = views
            .lock()
            .map_err(|_| "The PDF view registry is unavailable".to_string())?
            .get(&label)
            .filter(|mounted| mounted.view_id == view_id)
            .map(|mounted| mounted.pointer)
            .ok_or_else(|| "The PDF view is not mounted".to_string())?;
        let view = unsafe { view_from_pointer(pointer) };
        unsafe {
            match action.as_str() {
                "first" => view.goToFirstPage(None),
                "previous" => view.goToPreviousPage(None),
                "next" => view.goToNextPage(None),
                "last" => view.goToLastPage(None),
                "zoom-in" => view.zoomIn(None),
                "zoom-out" => view.zoomOut(None),
                "fit" => view.setAutoScales(true),
                "suspend" => {
                    view.setHidden(true);
                    if let Some(native_window) = webview.window() {
                        native_window.makeFirstResponder(Some(webview));
                    }
                }
                "resume" => view.setHidden(false),
                "page" => {
                    let document = view
                        .document()
                        .ok_or_else(|| "The PDF document is unavailable".to_string())?;
                    let index = page
                        .unwrap_or(1)
                        .saturating_sub(1)
                        .min(document.pageCount().saturating_sub(1));
                    if let Some(target) = document.pageAtIndex(index) {
                        view.goToPage(&target);
                    }
                }
                "focus" => {
                    if let Some(native_window) = webview.window() {
                        native_window.makeFirstResponder(Some(view));
                    }
                }
                _ => return Err("Unknown PDF action".to_string()),
            }
        }
        state_for_view(view)
    })
}

#[tauri::command]
pub fn get_pdf_view_state(
    window: WebviewWindow,
    state: State<'_, PdfViewState>,
    view_id: String,
) -> Result<PdfNativeState, String> {
    let label = window.label().to_string();
    let views = state.0.clone();
    on_webview(&window, move |_| {
        let pointer = views
            .lock()
            .map_err(|_| "The PDF view registry is unavailable".to_string())?
            .get(&label)
            .filter(|mounted| mounted.view_id == view_id)
            .map(|mounted| mounted.pointer)
            .ok_or_else(|| "The PDF view is not mounted".to_string())?;
        state_for_view(unsafe { view_from_pointer(pointer) })
    })
}

#[derive(Debug, Serialize)]
pub struct PdfSearchResult {
    pub count: usize,
    pub current_index: Option<usize>,
}

#[tauri::command]
pub fn search_pdf_view(
    window: WebviewWindow,
    state: State<'_, PdfViewState>,
    view_id: String,
    query: String,
    match_index: Option<usize>,
) -> Result<PdfSearchResult, String> {
    let label = window.label().to_string();
    let views = state.0.clone();
    on_webview(&window, move |_| {
        let mut registry = views
            .lock()
            .map_err(|_| "The PDF view registry is unavailable".to_string())?;
        let mounted = registry
            .get_mut(&label)
            .filter(|mounted| mounted.view_id == view_id)
            .ok_or_else(|| "The PDF view is not mounted".to_string())?;
        let view = unsafe { view_from_pointer(mounted.pointer) };
        if mounted.search_query != query {
            unsafe { view.setCurrentSelection_animate(None, false) };
            clear_search_results(mounted);
            if !query.is_empty() {
                let document = unsafe { view.document() }
                    .ok_or_else(|| "The PDF document is unavailable".to_string())?;
                let term = NSString::from_str(&query);
                let matches = unsafe {
                    document.findString_withOptions(
                        &term,
                        NSStringCompareOptions::CaseInsensitiveSearch,
                    )
                };
                mounted.search_results.reserve(matches.len());
                for index in 0..matches.len() {
                    let selection = matches.objectAtIndex(index);
                    mounted
                        .search_results
                        .push(Retained::into_raw(selection) as usize);
                }
                mounted.search_query = query.clone();
            }
        }
        let count = mounted.search_results.len();
        let current_index = (count > 0).then(|| match_index.unwrap_or(0) % count);
        if let Some(index) = current_index {
            let selection = unsafe { selection_from_pointer(mounted.search_results[index]) };
            unsafe {
                view.setCurrentSelection_animate(Some(selection), true);
                view.goToSelection(selection);
            }
        }
        Ok(PdfSearchResult {
            count,
            current_index,
        })
    })
}
