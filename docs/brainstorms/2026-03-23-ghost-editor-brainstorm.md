# Ghost — Minimalist Markdown Editor

**Date:** 2026-03-23

## What We're Building

A lightweight, native-feeling markdown editor for Mac. Bear-style editing — you type markdown shortcuts but see rich text, not raw syntax. Files live on the local filesystem. No cloud, no database, no accounts.

## Why This Approach

- **Tauri** over Electron: ~5MB app vs ~200MB. Uses the system webview, launches fast, low memory. Native file system access via Rust backend.
- **Tiptap** over CodeMirror: ProseMirror-based, built for rich-text editing. Best fit for the Bear-style "type markdown, see formatted output" model. Strong extension system for customization.
- **React + shadcn/ui + Tailwind**: React has the strongest Tiptap integration. shadcn gives us accessible, ownable primitives (context menus, dialogs, dropdowns) without component library bloat. Tailwind for rapid, consistent styling.

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| App shell | Tauri | Native feel, tiny bundle, filesystem access |
| Editor core | Tiptap (ProseMirror) | Best for Bear-style live rich-text markdown |
| UI framework | React | Best Tiptap integration, large ecosystem |
| Components | shadcn/ui + Tailwind | Ownable primitives, minimal, customizable |
| Folder model | Multiple tracked folders | Add/remove folders from anywhere on disk |
| File filter | `.md` only by default | Setting to show all file types |
| Storage | Local filesystem | No cloud, no database — just files |

## Core Features

1. **Sidebar** — left panel showing tracked folders and their `.md` files
   - Right-click / context menu to add or remove tracked folders
   - Tree view of subfolders within each tracked folder
   - Setting to toggle between `.md` only and all files

2. **Editor** — Tiptap-based rich-text markdown editing
   - Type `#` + space → heading (syntax hidden, text styled)
   - Type `**` → bold (syntax hidden, text rendered bold)
   - All standard markdown shortcuts, rendered as rich text
   - Files saved directly to disk

3. **Settings** — minimal settings surface
   - File filter toggle (`.md` only vs all files)

## Open Questions

- Keyboard shortcut scheme (Cmd+S to save? Autosave?)
- Search across files?
- Dark mode / theme support?
- Window management (tabs, single document?)

## Tech Stack

```
Tauri (Rust backend)
├── React (UI framework)
│   ├── Tiptap (editor core)
│   ├── shadcn/ui (component primitives)
│   └── Tailwind CSS (styling)
└── Local filesystem (storage)
```
