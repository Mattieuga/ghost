---
title: "feat: Ghost Markdown Editor"
type: feat
date: 2026-03-23
---

# Ghost — Minimalist Markdown Editor for Mac

## Overview

A lightweight, Bear-style markdown editor built with Tauri v2 + React + Tiptap + shadcn/ui + Tailwind CSS. The editor renders markdown as rich text (syntax hidden), tracks multiple folders on disk, and saves files locally. No cloud, no database, no accounts.

## Problem Statement

Bear is Mac-only, proprietary, and cloud-dependent. Obsidian is powerful but complex. There is no simple, local-first, open markdown editor that combines Bear's editing UX with direct filesystem access and a minimal footprint.

## Key Decisions (from Brainstorm + Gap Resolution)

| Decision | Choice | Rationale |
|---|---|---|
| Save strategy | **Autosave** with 1s debounce + Cmd+S for immediate | Matches Bear/iA Writer. No "unsaved changes" friction. |
| Document model | **Single document** | Simpler. Clicking a file replaces the current one. Autosave prevents data loss. |
| File creation | **Cmd+N** creates new file in selected folder | Essential for a self-contained editor. |
| File operations | Create, rename, delete from sidebar context menu | Baseline expectations for a file-centric app. |
| Markdown flavor | **CommonMark + GFM task lists + strikethrough** | Covers 95% of real-world markdown. No tables/math/footnotes in v1. |
| File watching | **Rust `notify` crate** with debounced sidebar updates | Keeps sidebar in sync. Prompt on external edit of open file. |
| Theme | **Dark mode default**, respect macOS system preference | Fits the "sleek, minimal" aesthetic. |
| Search | **Not in v1** | Major feature, defer. Design data layer to support it later. |
| Tabs | **Not in v1** | Single document keeps it simple. |
| Round-trip fidelity | **Best-effort via `tiptap-markdown`** | Document this limitation. Some whitespace normalization expected. |

## Tech Stack

```
Tauri v2 (Rust backend)
├── tauri-plugin-fs (file read/write/watch)
├── tauri-plugin-dialog (native folder picker)
├── tauri-plugin-store (persist settings + tracked folders)
├── notify crate (filesystem watcher)
│
React + TypeScript (frontend, via Vite)
├── Tiptap + @tiptap/react (editor core)
│   ├── @tiptap/starter-kit (headings, bold, italic, lists, etc.)
│   ├── @tiptap/extension-task-list + task-item
│   ├── @tiptap/extension-link
│   └── tiptap-markdown (markdown ↔ rich text serialization)
├── shadcn/ui (context menus, sidebar, dialogs, scroll areas)
└── Tailwind CSS v4 (styling)
```

## Implementation Phases

### Phase 1: Project Scaffolding

Set up the Tauri v2 + React + TypeScript project with all dependencies configured.

**Tasks:**

- [x] Scaffold Tauri v2 project with React template (`pnpm create tauri-app`)
- [x] Configure Vite with Tailwind CSS v4 (`@tailwindcss/vite` plugin)
- [x] Initialize shadcn/ui (`pnpm dlx shadcn@latest init`)
- [x] Install shadcn components: `context-menu`, `dialog`, `scroll-area`, `separator`, `tooltip`, `collapsible`, `sidebar`
- [x] Set up path aliases (`@/` → `src/`) in `tsconfig.json` and `vite.config.ts`
- [x] Add Tauri plugins to `Cargo.toml`: `tauri-plugin-fs`, `tauri-plugin-dialog`, `tauri-plugin-store`
- [x] Register plugins in `src-tauri/src/lib.rs`
- [x] Configure capabilities in `src-tauri/capabilities/default.json` (fs, dialog, store permissions)
- [x] Set up global CSS with dark theme variables (OKLCH neutral palette)
- [x] Create `ThemeProvider` component that respects macOS system preference
- [x] Verify `pnpm tauri dev` launches successfully with hot reload

**Key files:**

```
package.json
vite.config.ts
tsconfig.json
components.json
src/styles/globals.css
src/App.tsx
src/main.tsx
src/lib/utils.ts
src/components/theme-provider.tsx
src-tauri/Cargo.toml
src-tauri/tauri.conf.json
src-tauri/capabilities/default.json
src-tauri/src/lib.rs
src-tauri/src/main.rs
```

### Phase 2: Sidebar + Folder Tracking

Build the sidebar with folder management — the foundation for all file operations.

**Tasks:**

- [x] Create `GhostLayout` component using shadcn `SidebarProvider` + `Sidebar` + `SidebarInset`
- [x] Build `FolderTree` component using `Collapsible` + `SidebarMenu*` primitives
- [x] Write Rust command `read_directory(path: String) -> Vec<FileEntry>` that recursively reads a directory, returning files/subfolders filtered by extension
- [x] Write Rust command `get_tracked_folders() -> Vec<String>` using `tauri-plugin-store`
- [x] Write Rust command `add_tracked_folder(path: String)` that persists to store
- [x] Write Rust command `remove_tracked_folder(path: String)` that removes from store
- [x] Integrate `tauri-plugin-dialog` folder picker — "Add Folder" triggers native macOS folder selection
- [x] Build `FolderContextMenu` (right-click on folder) with: Remove Folder, New File, Reveal in Finder
- [x] Build `FileContextMenu` (right-click on file) with: Rename, Delete, Reveal in Finder
- [x] Build `SidebarEmptyState` — shown when no folders are tracked, with an "Add Folder" button (solves discoverability of right-click)
- [x] Add file filter logic — `.md` only by default, configurable via settings
- [x] Sort files alphabetically within each folder, folders before files
- [x] Handle edge case: tracked folder deleted/moved externally — show error badge, offer to remove

**Key files:**

```
src/components/layout.tsx           — GhostLayout (sidebar + main area)
src/components/sidebar/folder-tree.tsx
src/components/sidebar/file-item.tsx
src/components/sidebar/folder-context-menu.tsx
src/components/sidebar/file-context-menu.tsx
src/components/sidebar/empty-state.tsx
src/hooks/use-tracked-folders.ts    — React hook wrapping Tauri store commands
src/hooks/use-directory.ts          — React hook for reading directory contents
src/types.ts                        — FileEntry, FolderEntry types
src-tauri/src/commands/fs.rs        — read_directory, file operations
src-tauri/src/commands/mod.rs
```

### Phase 3: Editor Core

Integrate Tiptap with Bear-style markdown editing and file I/O.

**Tasks:**

- [x] Install Tiptap packages: `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm`, `@tiptap/extension-task-list`, `@tiptap/extension-task-item`, `@tiptap/extension-link`, `tiptap-markdown`
- [x] Create `MarkdownEditor` component with `useEditor` hook
- [x] Configure StarterKit with all standard extensions (headings h1-h6, bold, italic, strike, code, code blocks, blockquotes, bullet/ordered lists, horizontal rules)
- [x] Add TaskList + TaskItem extensions (checkboxes)
- [x] Add Link extension with `autolink: true`
- [x] Configure `tiptap-markdown` extension (`html: false`, `tightLists: true`, `transformPastedText: true`)
- [x] Write Rust command `read_file(path: String) -> String`
- [x] Write Rust command `write_file(path: String, content: String)`
- [x] Build `useActiveFile` hook — manages currently open file path + content
- [x] Load file content into editor on file selection (`editor.commands.setContent(markdown)`)
- [x] Implement autosave: debounced `onUpdate` (1s after last keystroke) calls `write_file`
- [x] Implement Cmd+S for immediate save via Tiptap keyboard shortcut extension
- [x] Style the editor content area — typography, spacing, heading sizes, code block styling
- [x] Handle opening a non-text file gracefully (show "Cannot edit this file type" message)
- [x] Handle empty state (no file selected) — show centered prompt or blank area

**Key files:**

```
src/components/editor/markdown-editor.tsx
src/components/editor/editor-styles.css   — Tiptap content styling (prose-like)
src/hooks/use-active-file.ts
src-tauri/src/commands/fs.rs              — read_file, write_file added here
```

### Phase 4: File Operations + File Watching

Complete file lifecycle and real-time sync.

**Tasks:**

- [x] Write Rust command `create_file(dir: String, name: String) -> String` — creates `.md` file, returns path
- [x] Write Rust command `rename_file(old_path: String, new_name: String) -> String`
- [x] Write Rust command `delete_file(path: String)` — moves to macOS Trash (not permanent delete)
- [x] Build "New File" flow: Cmd+N or context menu → inline rename in sidebar → focus editor
- [x] Build "Rename" flow: context menu → inline edit of filename in sidebar
- [x] Build "Delete" flow: context menu → confirmation dialog → trash file → close if active
- [x] Add `notify` crate to Rust backend for filesystem watching
- [x] Write Rust command `watch_directories(paths: Vec<String>)` that emits events to frontend
- [x] Listen for file-system events on frontend, update sidebar tree reactively
- [x] Handle external modification of open file: detect via watcher, prompt "File changed externally. Reload?"
- [x] Handle tracked folder becoming inaccessible: show warning icon, offer remove

**Key files:**

```
src-tauri/src/commands/fs.rs              — create_file, rename_file, delete_file
src-tauri/src/watcher.rs                  — filesystem watcher using notify crate
src/hooks/use-file-watcher.ts             — listen to Tauri events for fs changes
src/components/sidebar/inline-rename.tsx   — inline rename input in sidebar
src/components/dialogs/delete-confirm.tsx
```

### Phase 5: Settings + Polish

Minimal settings, keyboard shortcuts, and visual polish.

**Tasks:**

- [x] Build Settings dialog (Cmd+, to open, or gear icon in sidebar footer)
- [x] Settings: file filter toggle (`.md` only vs all files)
- [x] Settings: theme toggle (system / dark / light)
- [x] Persist settings via `tauri-plugin-store`
- [x] Configure `tauri.conf.json` window properties: title "Ghost", min size 600x400, decorations
- [ ] Add standard macOS menu bar: File (New, Add Folder, Close), Edit (Undo, Redo, Cut, Copy, Paste), View (Toggle Sidebar)
- [ ] Add Cmd+\ or Cmd+B to toggle sidebar
- [ ] Add Cmd+P or Cmd+O for quick file open (simple list filter, not full search)
- [x] Style the editor for a polished, minimal feel — focus on typography, whitespace, and transitions
- [ ] Handle window state persistence (size, position, sidebar width) via store
- [ ] Restore last-opened file on app launch
- [x] Add empty-state illustrations or subtle guidance text
- [ ] Test with real-world markdown files for round-trip fidelity

**Key files:**

```
src/components/dialogs/settings.tsx
src/hooks/use-settings.ts
src-tauri/tauri.conf.json
```

## Acceptance Criteria

### Functional Requirements

- [ ] User can add/remove tracked folders via context menu and folder picker
- [ ] Sidebar shows `.md` files in tracked folders with collapsible subfolder tree
- [ ] Clicking a file opens it in the editor as rich text (markdown syntax hidden)
- [ ] Typing markdown shortcuts (# for heading, ** for bold, etc.) renders as formatted text
- [ ] Files autosave to disk with 1s debounce after last edit
- [ ] Cmd+S saves immediately
- [ ] User can create new `.md` files (Cmd+N or context menu)
- [ ] User can rename and delete files from context menu
- [ ] Settings persist across app restarts (tracked folders, theme, file filter)
- [ ] Sidebar updates when files change on disk (via file watcher)

### Non-Functional Requirements

- [ ] App bundle under 15MB
- [ ] Launch time under 1 second
- [ ] Editor responds to keystrokes with no perceptible lag
- [ ] Works offline (no network required)

## Dependencies and Risks

| Risk | Mitigation |
|---|---|
| macOS security-scoped bookmarks for persistent folder access | Tauri v2's dialog plugin may handle this; if not, custom Rust implementation needed. Test early in Phase 2. |
| Markdown round-trip fidelity (whitespace/formatting changes on save) | Test `tiptap-markdown` with diverse real-world files. Document known normalization behaviors. |
| Tiptap performance with large files (>10k lines) | Defer to v2. Most markdown files are small. Could add virtual rendering later. |
| `notify` crate cross-platform behavior | macOS uses FSEvents which is reliable. Test with rapid file changes. |

## Not in v1 (Deferred)

- Tabs / multi-document
- Full-text search across files
- Syntax-highlighted code blocks
- Table editing
- Image preview
- Math/LaTeX
- Drag-and-drop file reordering
- Export to PDF/HTML
- Spell check toggle
- Custom keyboard shortcuts

## References

- Brainstorm: `docs/discovery/2026-03-23-ghost-editor-brainstorm.md`
- Tauri v2 docs: https://v2.tauri.app
- Tiptap docs: https://tiptap.dev/docs
- shadcn/ui docs: https://ui.shadcn.com
- Bear editor (UX reference): https://bear.app
