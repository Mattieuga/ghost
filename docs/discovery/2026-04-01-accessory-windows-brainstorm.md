# Accessory Windows

**Date:** 2026-04-01
**Status:** Ready for planning

## What We're Building

Multi-window support for Ghost. Double-clicking a file in the sidebar opens it in a standalone "accessory window" — a focused editor for a single file, without the sidebar or project navigation. The main window remains the project hub; accessory windows are for focused editing.

### Core behaviors

- **Double-click** a file in the sidebar → opens in a new accessory window
- **Single-click** continues to open in the main editor (unchanged)
- Unlimited accessory windows allowed simultaneously
- Closing the main window keeps the app running if accessory windows are open
- **View → "Show Main Window"** menu item: greyed out when main window is visible, enabled when it's been closed
- **Finder-opened files** always open in an accessory window (never added to sidebar)

### Accessory window characteristics

- Editor only — no sidebar, no file switching
- Same overlay title bar style as main window (path, word count, find/replace access)
- Inherits global editor settings (font size, line height, max width, theme, paragraph spacing)
- Default size on open (not persisted across restarts), slightly offset from previous windows

### Editing conflicts

- A file can be open in both the main editor and an accessory window simultaneously
- Changes sync between windows — edits in one appear in the other

## Why This Approach

- Matches macOS document-based app conventions (iA Writer, TextEdit)
- Clean separation: main window = project context, accessory windows = focused editing
- Finder-open → accessory window avoids polluting the sidebar with unrelated files
- Synced editing (vs. last-save-wins) prevents silent data loss
- Inheriting settings keeps things simple — no per-window settings UI needed

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Trigger for new window | Double-click in sidebar | Single-click stays as "open in main editor" |
| Dual-editing strategy | Sync changes between windows | Prevents silent overwrites |
| Editor settings | Inherit from global settings | Simpler, consistent experience |
| Title bar style | Same as main window | Path, word count, find/replace — full editing header |
| Finder-opened files | Always open in accessory window | Don't pollute sidebar; matches Mac conventions |
| Window size persistence | Sensible default each time | No persistence needed; offset new windows slightly |
| Context menu stubs | Enable the existing "Open in New Window" items | Already stubbed out in file-item.tsx and folder-tree.tsx |

## Open Questions

- Should closing an accessory window with unsaved changes warn the user, or rely on autosave (current behavior)?
  - Leaning: autosave handles it, consistent with main window behavior
- Should there be a keyboard shortcut to open the current file in a new window from the main editor?
- Window minimum size for accessory windows — same 300x300 as main, or smaller?

## Technical Considerations (for planning phase)

- Single-window assumption is deeply embedded: hardcoded `"main"` label in menu handlers, context menu hooks, and capability permissions
- Tauri supports dynamic window creation via `WebviewWindow` API
- Editor state sync will need an IPC mechanism (Tauri events or filesystem watcher)
- The `GhostLayout` component holds all state (~943 lines) — accessory windows need a lighter component tree
- Context menu hook in `context_menu.rs` is installed only on `"main"` — needs per-window installation
- Capabilities in `default.json` are scoped to `"main"` window — need wildcard or per-window grants
