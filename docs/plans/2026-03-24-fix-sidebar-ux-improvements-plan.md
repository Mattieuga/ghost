---
title: "fix: Sidebar UX improvements"
type: fix
date: 2026-03-24
---

# Sidebar UX Improvements

10 fixes and enhancements to the sidebar and file management UX.

## Tasks

### 1. Caret points down when folder is expanded
- [ ] Change `ChevronRight` with `rotate-90` to `ChevronDown` swap, or fix the rotation to point downward when `[state=open]`
- Files: `src/components/sidebar/folder-tree.tsx`

### 2. Sidebar refresh preserves expand/collapse state
- [ ] The `refreshKey` in layout.tsx changes the `key` prop on FolderTree, which remounts the entire component and loses collapse state
- [ ] Instead of changing `key`, have `useDirectory` re-fetch data while keeping the component mounted
- Files: `src/components/layout.tsx`, `src/hooks/use-directory.ts`

### 3. Remove sidebar collapse button
- [ ] Remove `SidebarTrigger` from the header
- [ ] Remove `SidebarRail` from sidebar
- [ ] Remove `collapsible="icon"` prop or set to `"none"`
- Files: `src/components/layout.tsx`

### 4. Highlight active folder/file in sidebar
- [ ] Track a `selectedItem` (can be a folder path or file path)
- [ ] Clicking a folder highlights it (doesn't open a file, just visual selection)
- [ ] Clicking a file highlights it AND opens it
- [ ] Use `isActive` prop on `SidebarMenuButton` for the highlight
- Files: `src/components/layout.tsx`, `src/components/sidebar/folder-tree.tsx`

### 5. Independent scroll for sidebar and content
- [ ] Add `overflow-hidden` to the root container to prevent scroll leaking
- [ ] Ensure sidebar has its own scroll container with `overscroll-behavior: contain`
- [ ] Ensure main content area has independent scroll with `overscroll-behavior: contain`
- Files: `src/components/layout.tsx`, `src/styles/globals.css`

### 6. Drag files between folders
- [ ] Add HTML5 drag-and-drop to file items (`draggable`, `onDragStart`, `onDragOver`, `onDrop`)
- [ ] On drop, invoke `rename_file` with the new parent directory
- [ ] Visual feedback during drag (drop target highlight on folders)
- Files: `src/components/sidebar/file-item.tsx`, `src/components/sidebar/folder-tree.tsx`

### 7. Right-click to create folder in sidebar
- [ ] Add "New Folder" to folder context menu
- [ ] Write Rust command `create_directory(parent: String, name: String) -> String`
- [ ] Inline rename for new folder name
- Files: `src/components/sidebar/folder-tree.tsx`, `src-tauri/src/commands/fs.rs`

### 8. Right-click to create file in sidebar
- [ ] Add "New File" to folder context menu (and empty sidebar area context menu)
- [ ] Creates `Untitled.md` in the right-clicked folder
- Files: `src/components/sidebar/folder-tree.tsx`

### 9. Rename shows new name immediately + updates header
- [ ] After rename, optimistically update the displayed name before fs watcher fires
- [ ] Pass renamed file path back to layout so `activeFile` state updates
- [ ] Header filename should derive from `activeFile` reactively
- Files: `src/components/sidebar/file-item.tsx`, `src/components/layout.tsx`

### 10. Click filename in header to rename
- [ ] Make the filename in the header clickable → shows inline input
- [ ] On submit, invoke `rename_file` and update `activeFile` state
- Files: `src/components/layout.tsx`
