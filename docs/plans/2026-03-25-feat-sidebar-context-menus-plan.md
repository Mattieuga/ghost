---
title: "feat: Comprehensive sidebar context menus"
type: feat
date: 2026-03-25
---

# Comprehensive Sidebar Context Menus

## Overview

Replace the basic context menus on files, folders, and root folders with full-featured menus matching the spec. Some actions are functional now, some need new Rust commands, some are UI-only stubs.

## Menu Specs

### File Context Menu

- Open File — opens in editor. Disabled if already active
- Open File in New Window — disabled/stub for now
- ---
- New File (⌘N) — creates sibling file with auto-rename
- New Folder (⇧⌘N) — creates sibling folder
- ---
- Copy File (⌘C) — copies file to clipboard (OS copy)
- Copy Text As ▸
  - Plain Text
  - Markdown
  - Rich Text
- ---
- Reveal in Finder
- Copy File Path
- ---
- Duplicate — copies file as sibling with " copy" suffix
- Rename...
- ---
- Delete

### Folder Context Menu (sub-folders)

- Expand / Collapse (dynamic label based on state)
- Open in New Window — disabled/stub
- ---
- New File (⌘N) — inside that folder
- New Folder (⇧⌘N) — inside that folder
- ---
- Copy Folder (⌘C)
- ---
- Reveal in Finder
- Copy File Path
- ---
- Duplicate
- Rename...
- ---
- Delete Folder

### Root Folder Context Menu (top-level tracked folders)

- Close Project — removes from tracked folders
- Open in New Window — disabled/stub
- ---
- New File (⌘N)
- New Folder (⇧⌘N)
- ---
- Reveal in Finder
- Copy File Path
- ---
- Duplicate
- Rename...
- ---
- Delete Folder

## New Rust Commands Needed

- [ ] `duplicate_file(path: String) -> String` — copies file/folder as sibling with " copy" suffix
- [ ] `reveal_in_finder(path: String)` — opens Finder at that path
- [ ] `copy_to_clipboard(text: String)` — copies text to system clipboard

## New Frontend Callbacks Needed

- [ ] `onDuplicate(path: string)` — calls duplicate_file, refreshes sidebar
- [ ] `onRevealInFinder(path: string)` — calls reveal_in_finder
- [ ] `onCopyPath(path: string)` — copies path to clipboard
- [ ] `onCopyFile(path: string)` — OS-level file copy to clipboard
- [ ] `onNewFolder(parentDir: string)` — creates folder with auto-rename
- [ ] Keyboard shortcut: Cmd+Shift+N for new folder

## Files to Change

- `src-tauri/src/commands/fs.rs` — add duplicate_file, reveal_in_finder
- `src/components/sidebar/file-item.tsx` — expand context menu
- `src/components/sidebar/folder-tree.tsx` — expand both folder and root folder context menus
- `src/components/layout.tsx` — add Cmd+Shift+N shortcut, pass new callbacks

## Acceptance Criteria

- [ ] File context menu has all specified items
- [ ] Folder context menu has all specified items with dynamic Expand/Collapse
- [ ] Root folder context menu has Close Project instead of Expand/Collapse
- [ ] Open File is disabled when file is already active
- [ ] Open in New Window items are present but disabled
- [ ] Copy Text As submenu works for active file content
- [ ] Reveal in Finder opens the correct location
- [ ] Copy File Path copies to clipboard
- [ ] Duplicate creates a copy with " copy" suffix
- [ ] Cmd+Shift+N creates new folder
- [ ] Keyboard shortcuts shown in menu items
