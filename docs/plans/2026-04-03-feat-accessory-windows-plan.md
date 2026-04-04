---
title: "feat: Accessory Windows — Multi-Window Editing"
type: feat
date: 2026-04-03
---

# Accessory Windows — Multi-Window Editing

## Overview

Add multi-window support to Ghost. Double-clicking a file in the sidebar opens it in a standalone "accessory window" — a focused, single-file editor without the sidebar or project navigation. The main window remains the project hub. Files opened from Finder always open in accessory windows. The app stays alive when only accessory windows are open, and a "Show Main Window" menu item lets users re-show the main window after closing it.

## Problem Statement

Ghost is currently a single-window app. Users can only view one file at a time. There's no way to reference one document while editing another, and opening a file from Finder forces it into the project sidebar. Users need the ability to have multiple files open simultaneously in separate windows.

## Proposed Solution

Introduce "accessory windows" — lightweight editor-only windows created dynamically via the Tauri v2 `WebviewWindow` API. Each loads the same `index.html` with query parameters (`?mode=editor&file=/path/to/doc.md`) that tell the React app to render an editor-only layout instead of the full `GhostLayout`.

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Tauri (Rust)                       │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ "main"   │  │"editor-1"│  │ App-level state   │   │
│  │ window   │  │ window   │  │ - WatcherState    │   │
│  │          │  │          │  │ - EditorWindowMap  │   │
│  └────┬─────┘  └────┬─────┘  │ - WindowCounter    │   │
│       │              │        └──────────────────┘   │
│       │              │                                │
│  Events: file-changed, settings-changed,              │
│          file-renamed, file-deleted, file-open        │
└───────┬──────────────┬────────────────────────────────┘
        │              │
┌───────▼──────┐ ┌─────▼────────┐
│  GhostLayout │ │ EditorWindow │  (React)
│  - Sidebar   │ │ - Editor     │
│  - Editor    │ │ - Title bar  │
│  - Settings  │ │ - Find/Repl  │
│  - CmdPalet  │ │ - Autosave   │
│  - DnD       │ └──────────────┘
└──────────────┘
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Content sync strategy | Auto-reload from disk on `fs-change` | Seamless; file watcher detects saves from other windows, editor reloads silently |
| Main window on close | **Hide** (never destroy) | Preserves all state; "Show Main Window" just un-hides. Only Cmd+Q actually quits. |
| Cold start from Finder | Accessory window only | Main window available via View > Show Main Window |
| Window entry point | Same `index.html` + query params | No build config changes needed |
| Capability config | Add `"editor-*"` glob to `default.json` | Same permissions; simplest approach |
| Click disambiguation | 250ms delayed single-click + context menu | Standard macOS pattern; context menu as fallback |
| Settings from accessory | Focus main window, open settings there | Avoids extracting settings panel |
| Command palette in accessory | Disabled | Accessory windows are single-file focused |
| Keyboard shortcuts in accessory | Only Cmd+F, Cmd+Alt+F, Cmd+S, Cmd+W | Sidebar-related shortcuts do nothing |

### Implementation Phases

#### Phase 1: Foundation — Window Infrastructure

Create the Rust-side plumbing for multi-window support.

**1.1 Update capabilities** (`src-tauri/capabilities/default.json`)
- [x] Change `"windows": ["main"]` to `"windows": ["main", "editor-*"]`
- [x] Add `core:window:allow-close` permission for accessory windows to self-close

**1.2 Add `open_editor_window` Tauri command** (`src-tauri/src/lib.rs`)
- [ ] New async command: `open_editor_window(app: AppHandle, file_path: String) -> Result<String, String>`
- [ ] Generate unique label: `format!("editor-{}", counter)` using an `AtomicU32` counter
- [ ] Create window via `WebviewWindowBuilder`:
  - URL: `index.html?mode=editor&file={urlencoded_path}`
  - Size: 800×600, min 400×300
  - Position: cascade offset (30px × window_count, wrap after 10)
  - `title_bar_style(TitleBarStyle::Overlay)`, `decorations(true)`, `focused(true)`
  - Traffic light position matching main window: `{x: 18, y: 28}`
- [ ] Install context menu hook on the new window's webview (extract `install_context_menu_hook` call into a reusable function)
- [ ] Return the window label
- [ ] Register command in `invoke_handler`

**1.3 Route menu events to focused window** (`src-tauri/src/lib.rs`)
- [ ] Replace all 4 `get_webview_window("main")` calls in `on_menu_event` with focused-window detection:
  ```rust
  let focused = app_handle.webview_windows()
      .values()
      .find(|w| w.is_focused().unwrap_or(false));
  ```
- [ ] For `add_folder` and `new_file`: always route to main window (sidebar-specific)
- [ ] For `find` and `find_replace`: route to focused window
- [ ] For `command_palette`: route to main window only

**1.4 Add "Show Main Window" menu item** (`src-tauri/src/lib.rs`)
- [ ] Add to View menu: `MenuItem::with_id(app, "show_main_window", "Show Main Window", true, None::<&str>)`
- [ ] Handle in `on_menu_event`: `get_webview_window("main")?.show()?.set_focus()?`
- [ ] Grey-out logic: enable when main window is hidden, disable when visible (track via `WindowEvent::Focused` and close-requested intercept)

**1.5 Hide-on-close for main window + always-alive app** (`src-tauri/src/lib.rs`)
- [ ] Intercept `WindowEvent::CloseRequested` for `"main"` label: `api.prevent_close()`, then `win.hide()`
- [ ] Accessory windows close normally (destroy on close) — no intercept needed
- [ ] In `.run()` callback, handle `RunEvent::ExitRequested`: always call `api.prevent_exit()` — the app never terminates on window close
- [ ] Only Cmd+Q / "Quit Ghost" menu item terminates the app (Tauri's built-in `.quit()` menu item handles this)
- [ ] Clicking the dock icon when main window is hidden should re-show it (handle `RunEvent::Reopen` or macOS `applicationShouldHandleReopen`)

**1.6 Update Finder file-open handler** (`src-tauri/src/lib.rs`)
- [ ] In `RunEvent::Opened`, instead of emitting `"file-open"` to the main window, call the `open_editor_window` logic directly
- [ ] Remove `PendingOpenFiles` state (no longer needed — accessory windows handle Finder opens)
- [ ] Handle multiple files: iterate URLs, open one accessory window per file

**Success criteria:**
- [ ] Can create a new window from Rust command
- [ ] Menu events route to the correct (focused) window
- [ ] Closing main window hides it; "Show Main Window" un-hides it
- [ ] App stays alive always — only Cmd+Q / "Quit Ghost" terminates
- [ ] Clicking dock icon re-shows hidden main window
- [ ] Finder-opened files spawn accessory windows

---

#### Phase 2: Frontend — Editor Window Component

Create the React component tree for accessory windows.

**2.1 Add window mode detection** (`src/App.tsx`)
- [ ] Read `window.location.search` on mount
- [ ] If `mode=editor` param present: render `<EditorWindow filePath={file} />`
- [ ] Otherwise: render `<GhostLayout />` (existing behavior)

**2.2 Create `EditorWindow` component** (`src/components/editor-window.tsx`)
- [ ] New component — the root for accessory windows
- [ ] State: `fileContent`, `wordCount`, `searchOpen`, `searchMode`, `searchTerm`, `replaceTerm`, `searchResultIndex`, `searchResultCount`
- [ ] On mount: `invoke("read_file", { path: filePath })` to load content
- [ ] Render:
  - Overlay title bar with: file path breadcrumb, word count, find/replace toggle
  - `<MarkdownEditor>` with same props interface as in `GhostLayout`
  - Drag region for window dragging (`data-tauri-drag-region`)
- [ ] Register `window.__ghostFind`, `window.__ghostFindAndReplace`, `window.__ghostCopyAs` globals
- [ ] Do NOT register `__ghostAddFolder`, `__ghostNewFile`, `__ghostCommandPalette`
- [ ] Autosave via same 1s debounce + Cmd+S pattern (already in `MarkdownEditor`)

**2.3 Apply theme and settings in accessory windows** (`src/components/editor-window.tsx`)
- [ ] Call `useSettings()` on mount to load current settings
- [ ] Call `applyTheme(settings.themeColors)` from `theme-engine.ts`
- [ ] Apply font settings via CSS custom properties (same as `layout.tsx` lines 96-102)
- [ ] Listen for `"settings-changed"` Tauri event to re-apply settings when they change in the main window

**2.4 Emit settings-changed event from main window** (`src/hooks/use-settings.ts`)
- [ ] After `store.set()` and `store.save()` in `updateSettings`, emit a Tauri event:
  ```typescript
  import { emit } from '@tauri-apps/api/event';
  await emit('settings-changed', newSettings);
  ```

**2.5 Handle keyboard shortcuts in accessory windows** (`src/components/editor-window.tsx`)
- [ ] Cmd+F → toggle find bar
- [ ] Cmd+Alt+F → toggle find and replace
- [ ] Cmd+S → already handled by `MarkdownEditor`
- [ ] Cmd+W → close window (native macOS, handled by Tauri)
- [ ] Cmd+, → focus main window and open settings (emit event to main)
- [ ] Cmd+N, Cmd+O, Cmd+\, Cmd+K → no-op in accessory windows

**Success criteria:**
- [ ] Accessory windows render an editor with the correct file content
- [ ] Title bar shows path, word count, and find/replace
- [ ] Theme and font settings match the main window
- [ ] Settings changes in main propagate to open accessory windows
- [ ] Keyboard shortcuts work correctly (find, save) and don't fire sidebar actions

---

#### Phase 3: Integration — Triggers and Context Menus

Wire up the user-facing triggers for opening accessory windows.

**3.1 Add double-click handler to `FileItem`** (`src/components/sidebar/file-item.tsx`)
- [ ] Add `onDoubleClick` to the file button (line ~227)
- [ ] Implement click disambiguation: delay single-click by 250ms, cancel if double-click fires
  ```typescript
  const clickTimeout = useRef<NodeJS.Timeout | null>(null);
  const handleClick = () => {
    if (clickTimeout.current) clearTimeout(clickTimeout.current);
    clickTimeout.current = setTimeout(() => onSelect(), 250);
  };
  const handleDoubleClick = () => {
    if (clickTimeout.current) clearTimeout(clickTimeout.current);
    invoke('open_editor_window', { filePath: entry.path });
  };
  ```
- [ ] Test that single-click still opens in main editor (with 250ms delay)

**3.2 Enable "Open in New Window" context menu items**
- [ ] `file-item.tsx` (line ~243): Remove `disabled`, add `onSelect` handler calling `invoke('open_editor_window', { filePath: entry.path })`
- [ ] `folder-tree.tsx` (lines ~394, ~434): These are folder-level "Open in New Window" — defer or remove these (opening a folder in a new window is undefined behavior for this feature)

**3.3 Prevent duplicate accessory windows for the same file**
- [ ] On `open_editor_window`: check if an `editor-*` window already has this file open
- [ ] If yes: focus that existing window instead of creating a new one
- [ ] Implementation: maintain a `HashMap<String, String>` mapping file paths to window labels in Rust state

**Success criteria:**
- [ ] Double-clicking a file opens an accessory window
- [ ] Single-clicking still opens in the main editor (250ms delay)
- [ ] Context menu "Open in New Window" works
- [ ] Double-clicking a file already open in an accessory window focuses that window

---

#### Phase 4: Cross-Window Sync

Handle the case where the same file is open in multiple windows.

**4.1 Auto-reload on file change in `EditorWindow`** (`src/components/editor-window.tsx`)
- [ ] Listen for `"fs-change"` Tauri events
- [ ] When the event path matches the current file AND the change was NOT triggered by this window's own save:
  - Silently re-read the file from disk via `invoke("read_file", { path: filePath })`
  - Replace editor content with the new content
- [ ] Track "last saved by me" timestamp to distinguish own saves from external changes
- [ ] Note: cursor position and undo history will reset on reload — acceptable for v1

**4.2 Auto-reload on file change in main editor** (`src/components/layout.tsx`)
- [ ] Same auto-reload logic when the active file is modified by an accessory window's save
- [ ] Only trigger when the file watcher detects a change AND `activeFile` matches the changed path
- [ ] Skip reload if the editor has unsaved changes newer than the fs-change (compare timestamps)

**4.3 Handle file rename across windows** (`src/components/editor-window.tsx`)
- [ ] Add new Tauri event: `"file-renamed"` with `{ oldPath, newPath }`
- [ ] Emit from the main window's rename handler (layout.tsx `handleRename`)
- [ ] In `EditorWindow`: if `filePath` matches `oldPath`, update internal path and title bar
- [ ] In Rust: update the file-path-to-window-label map

**4.4 Handle file deletion across windows** (`src/components/editor-window.tsx`)
- [ ] Add new Tauri event: `"file-deleted"` with `{ path }`
- [ ] Emit from the main window's delete handler
- [ ] In `EditorWindow`: if `filePath` matches, auto-close the accessory window
- [ ] In Rust: clean up the file-path-to-window-label map on window close

**4.5 Add Rust-side events for file operations** (`src-tauri/src/lib.rs` or new `src-tauri/src/commands/window.rs`)
- [ ] New command: `emit_file_renamed(app: AppHandle, old_path: String, new_path: String)`
- [ ] New command: `emit_file_deleted(app: AppHandle, path: String)`
- [ ] Both broadcast to all windows via `app_handle.emit()`

**Success criteria:**
- [ ] Editing a file in the main editor and saving auto-reloads the content in its accessory window
- [ ] Editing in an accessory window and saving auto-reloads the content in the main editor
- [ ] Renaming a file in the sidebar updates the accessory window's title and save path
- [ ] Deleting a file auto-closes the corresponding accessory window

---

## Acceptance Criteria

### Functional Requirements
- [ ] Double-clicking a file in the sidebar opens it in a new accessory window
- [ ] Single-clicking a file in the sidebar still opens it in the main editor
- [ ] Accessory windows show only the editor — no sidebar, no file navigation
- [ ] Accessory windows have the same title bar as main: file path, word count, find/replace
- [ ] Accessory windows inherit theme, font, and editor settings from global settings
- [ ] Settings changes propagate to open accessory windows in real time
- [ ] Cmd+F and Cmd+Alt+F work in the focused window (main or accessory)
- [ ] Closing the main window hides it (preserves all state)
- [ ] View > "Show Main Window" un-hides the main window and focuses it
- [ ] "Show Main Window" is greyed out when the main window is already visible
- [ ] Clicking the dock icon re-shows the main window if hidden
- [ ] App only terminates via Cmd+Q / "Quit Ghost" — never on window close
- [ ] Files opened from Finder always open in accessory windows
- [ ] Opening a file already in an accessory window focuses that window
- [ ] Context menu "Open File in New Window" works
- [ ] When the same file is saved in another window, the editor auto-reloads the content
- [ ] File renames in the sidebar update the accessory window's path and title
- [ ] File deletion auto-closes the corresponding accessory window
- [ ] Unlimited accessory windows can be open simultaneously

### Non-Functional Requirements
- [ ] Accessory window opens in under 500ms
- [ ] No memory leaks when creating and closing many windows
- [ ] Theme/settings propagation is near-instant (under 100ms)

## Dependencies & Prerequisites

- Tauri v2 `WebviewWindowBuilder` API (already available in current dependency)
- `urlencoding` crate for Rust (for encoding file paths in URLs) — or use `percent-encoding`
- No new frontend dependencies needed

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| 250ms click delay feels sluggish | Medium | Medium | Context menu as primary alternative; can tune delay |
| File watcher singleton gets replaced by accessory window | High | High | Accessory windows must NOT call `watch_directories`; rely on global `fs-change` events |
| Content sync race conditions | Medium | Medium | Auto-reload from disk on fs-change; last save wins, cursor resets on reload |
| Memory pressure from many windows | Low | Medium | Each WKWebView ~50-100MB; users unlikely to open 20+ |
| Context menu hook may not work on new windows | Medium | Low | The hook is class-level (ObjC); may auto-apply. Test and install per-window if needed |

## Key Files That Will Change

| File | Changes |
|------|---------|
| `src-tauri/capabilities/default.json` | Add `"editor-*"` to windows array |
| `src-tauri/src/lib.rs` | New command, menu routing, window lifecycle, Finder handler, "Show Main Window" |
| `src/App.tsx` | Route to `EditorWindow` or `GhostLayout` based on query params |
| `src/components/editor-window.tsx` | **New file** — accessory window root component |
| `src/components/sidebar/file-item.tsx` | Double-click handler, enable context menu item |
| `src/components/sidebar/folder-tree.tsx` | Enable/remove "Open in New Window" context menu items |
| `src/components/layout.tsx` | File-changed banner, emit rename/delete events |
| `src/hooks/use-settings.ts` | Emit `settings-changed` event on update |
| `src/types/ghost-window.d.ts` | Add any new window globals |

## References

- [Brainstorm: Accessory Windows](../brainstorms/2026-04-01-accessory-windows-brainstorm.md)
- [Ghost Architecture & Learnings](../solutions/architecture/ghost-architecture-and-learnings.md)
- [Tauri v2 WebviewWindowBuilder API](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindowBuilder.html)
- [Tauri v2 Capabilities for Windows](https://v2.tauri.app/learn/security/capabilities-for-windows-and-platforms/)
- [Tauri v2 Inter-Process Communication](https://v2.tauri.app/concept/inter-process-communication/)
- Documented learnings: [Window dragging](../solutions/ui-bugs/tauri-v2-window-dragging-overlay-titlebar.md), [Traffic light position](../solutions/ui-bugs/tauri-v2-traffic-light-position.md), [Context menu focus](../solutions/ui-bugs/radix-context-menu-focus-stealing.md)
