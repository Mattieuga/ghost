---
title: Ghost Editor Architecture & Build Learnings
category: architecture
tags: [tauri, react, tiptap, dnd-kit, shadcn, tailwind, webkit, macos]
module: ghost
date: 2026-03-24
severity: reference
symptoms: []
---

# Ghost Editor — Architecture Decisions & Build Learnings

## What We Built

A minimalist, Bear-style markdown editor for Mac. Local-first, no cloud, no database. Type markdown shortcuts, see rich text. ~5MB app bundle.

## Stack

```
Tauri v2 (Rust)
├── tauri-plugin-fs        — read/write files + directories
├── tauri-plugin-dialog    — native macOS folder picker
├── tauri-plugin-store     — persist settings + tracked folders (JSON)
├── notify 7               — filesystem watcher (FSEvents on macOS)
├── move_file, create_directory — custom Rust commands

React 19 + TypeScript (Vite 7)
├── Tiptap 2 + tiptap-markdown — Bear-style rich-text markdown editing
├── @dnd-kit/core 6.3      — pointer-event drag-and-drop
├── shadcn/ui              — context menus, sidebar, dialogs, collapsible
└── Tailwind CSS v4        — OKLCH dark theme, CSS-first config
```

## Architecture Decisions

### Tauri v2 over Electron

**Choice:** Tauri v2 with WebKit webview.
**Why:** ~5MB app vs ~200MB. Uses system webview, launches instantly, low memory. Native filesystem access through Rust backend without Node.js overhead.
**Tradeoff:** WebKit has quirks vs Chromium (HTML5 drag-and-drop doesn't work — see below). Rust backend requires separate compilation step.

### Tiptap over CodeMirror

**Choice:** Tiptap (ProseMirror-based) with `tiptap-markdown` for serialization.
**Why:** Bear-style editing needs rich-text rendering with hidden syntax. Tiptap's InputRules system converts `# ` → heading, `**text**` → bold as you type, consuming the syntax characters. CodeMirror is code-editor-flavored — fighting the grain for WYSIWYG-like markdown.
**Key config:** `html: false`, `tightLists: true`, `transformPastedText: true` on `tiptap-markdown`.

### Single document, not tabs

**Choice:** Clicking a file replaces the current one.
**Why:** Simpler state management, autosave prevents data loss. Tabs are deferred to v2.

### Autosave with debounce

**Choice:** 1-second debounce after last keystroke, plus Cmd+S for immediate save.
**Why:** Matches Bear/iA Writer. No "unsaved changes" friction. Debounce prevents disk thrashing during rapid typing.

### Multiple tracked folders (not vault)

**Choice:** Users add/remove individual folders from anywhere on disk.
**Why:** More flexible than Obsidian's single-vault model. Folders persist via `tauri-plugin-store` as a JSON array.

### Dark OKLCH theme

**Choice:** Neutral OKLCH palette, dark by default, respects macOS system preference.
**Why:** OKLCH gives perceptually uniform color. All chromaticity at 0 (fully desaturated) for the minimal aesthetic. Sidebar slightly darker than content area for visual separation.

## Critical Learnings

### 1. Tauri's `dragDropEnabled` blocks ALL in-webview drag events

**Problem:** HTML5 Drag and Drop API (draggable, onDragStart, dataTransfer) does nothing in Tauri v2's WebKit webview on macOS.

**Root cause:** Tauri has `dragDropEnabled` defaulting to `true` on windows. This OS-level drag-drop system intercepts pointer/drag events before the webview's JavaScript sees them. It's designed for dragging files FROM the OS INTO the app.

**Solution:** Use `@dnd-kit/core` v6, which uses **Pointer Events** (pointerdown/pointermove/pointerup) instead of the HTML5 DnD API. Also set `dragDropEnabled: false` in `tauri.conf.json` and add `touch-action: none` on draggable elements for WebKit.

**Failed approaches:**
1. HTML5 draggable + dataTransfer — silently fails, no events fire
2. Custom mouse-event hook (mousedown/mousemove/mouseup) — worked but no visual feedback, fragile
3. `@dnd-kit/react` v0.3.x (new API) — has a bug in ActivationController causing TypeError on every pointer down
4. `@dnd-kit/core` v6 (stable API) — works perfectly

**Key takeaway:** Always use `@dnd-kit/core` (stable) not `@dnd-kit/react` (pre-1.0) for production. Configure `PointerSensor` with `activationConstraint: { distance: 5 }` to distinguish clicks from drags.

### 2. shadcn's SidebarProvider uses `min-h-svh` which breaks scroll isolation

**Problem:** Sidebar and content scrolled as one unit. Arrow-keying through a file would eventually scroll the sidebar too.

**Root cause:** `SidebarProvider` wrapper has `min-h-svh`, allowing it to grow taller than the viewport. The entire page becomes one scroll context.

**Solution:** Changed to `h-svh overflow-hidden` on the wrapper. Added `overflow-hidden` to `SidebarInset`. Added `overscroll-contain` to `SidebarContent` and the main content area. Each container now has its own independent scroll.

### 3. CSS descendant selectors break with nested Collapsibles

**Problem:** Chevron rotation `[[data-state=open]_&]:rotate-0` worked for top-level folders but not nested ones.

**Root cause:** The CSS descendant selector matches ANY ancestor with `data-state=open`, not just the closest Collapsible. A child folder's chevron would inherit the parent's open state.

**Solution:** Use controlled React state (`useState`) per folder and conditionally render `ChevronDown` vs `ChevronRight` based on the `open` boolean. No CSS data-attribute selectors.

### 4. Sidebar refresh via key remounting loses expand/collapse state

**Problem:** When files changed on disk (via watcher), sidebar folders would collapse.

**Root cause:** `key={folder}-${refreshKey}` — changing the key remounts the entire `FolderTree` component, resetting all `useState` values including collapsible open/closed state.

**Solution:** Pass `refreshTrigger` as a prop to `useDirectory` hook, which re-fetches data via `useEffect` dependency. The component stays mounted, preserving collapse state.

### 5. Tailwind v4 is CSS-first — no tailwind.config.js

**Key difference from v3:** All theme configuration happens in CSS via `@theme inline`. No JavaScript config file. Uses `@tailwindcss/vite` plugin instead of PostCSS. Import order matters: `@import "tailwindcss"` first, then `"tw-animate-css"`.

### 6. Tauri v2 capabilities are mandatory

Every plugin operation requires an explicit permission grant in `src-tauri/capabilities/default.json`. Unlike v1's allowlist, v2 uses fine-grained capability system. Deny rules always take precedence.

### 7. Tailwind v4 can turn repo-local data into HMR dependencies

**Problem:** Editing and saving a large CSV fixture appeared to crash and
restart Ghost, even though the chunked native save completed successfully.

**Root cause:** Tailwind v4 automatically scans repository content for utility
class candidates. The `@tailwindcss/vite` plugin registers every scanned file
as a Vite watch dependency and explicitly sends `full-reload` when one changes.
Because Ghost's editable viewer fixtures live inside the repository, saving a
fixture caused the development WebView to navigate with reload semantics.
Production builds were unaffected because they have no Vite development
server.

**Solution:** Exclude `example test files/` from Tailwind's scan with `@source
not` in `src/styles/globals.css` and from `server.watch.ignored` in
`vite.config.ts`. Treat any future generated or runtime-editable corpus inside
the repository the same way.

**Diagnostic takeaway:** Distinguish an application crash from a development
reload before changing resource limits. Here, Ghost and WebKit PIDs stayed
alive, the save committed in 249 ms, and preserved Web Inspector logs showed
`pagehide` followed by a Vite connection and navigation type `reload`.

## File Organization

```
src/
├── components/
│   ├── layout.tsx              — main shell (sidebar + editor + DndContext)
│   ├── theme-provider.tsx      — dark/light/system theme
│   ├── editor/                 — Tiptap editor + styles
│   ├── sidebar/                — folder tree, file items, empty state
│   ├── dialogs/                — settings, delete confirmation
│   └── ui/                     — shadcn primitives (owned, editable)
├── hooks/                      — useTrackedFolders, useDirectory, useSettings, useFileWatcher
├── lib/utils.ts                — cn() merge utility
├── types.ts                    — FileEntry type
└── styles/globals.css          — OKLCH theme variables

src-tauri/
├── src/
│   ├── lib.rs                  — plugin registration + command handlers
│   ├── main.rs                 — entry point
│   ├── watcher.rs              — notify-based filesystem watcher
│   └── commands/fs.rs          — read_directory, read/write/create/rename/delete/move
├── capabilities/default.json   — fs, dialog, store permissions
├── Cargo.toml                  — Rust dependencies
└── tauri.conf.json             — window config, dragDropEnabled: false
```

## Conventions

- **Rust commands** are async, return `Result<T, String>`, registered in `lib.rs`
- **React hooks** wrap Tauri IPC calls (`invoke`) with React state
- **shadcn components** are source-owned in `src/components/ui/` — edit freely
- **Theme** uses CSS variables in OKLCH color space, toggled via `.dark` class
- **File operations** go through Rust (not `@tauri-apps/plugin-fs` JS API) for custom logic like filtered directory reading
- **Settings** persist via `tauri-plugin-store` with `{ defaults: {}, autoSave: true }`

## What's Deferred (v2)

- Tabs / multi-document
- Full-text search
- Syntax-highlighted code blocks
- Table editing
- Image preview
- macOS native menu bar
- Window state persistence
- Quick file open (Cmd+P)
- Spell check
