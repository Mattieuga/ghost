---
title: Radix context menu steals focus from dynamically created inputs
category: ui-bugs
tags: [radix, context-menu, focus, blur, react, auto-rename]
module: ghost
date: 2026-03-25
severity: major
symptoms:
  - Inline rename input appears briefly then immediately disappears
  - Auto-rename works from keyboard shortcut but not from context menu
  - onBlur fires unexpectedly on newly focused inputs
---

# Radix Context Menu Steals Focus from Dynamically Created Inputs

## Problem

When a context menu action creates a new element and focuses it (e.g., "New File" creates a file and enters rename mode), the rename input appears briefly then immediately loses focus and exits rename mode. The same flow triggered by a keyboard shortcut (Cmd+N) works perfectly.

## Root Cause

Radix UI's `ContextMenu` has a focus scope that **restores focus to the trigger element when the menu closes**. The sequence:

1. User clicks "New File" in context menu
2. `onSelect` fires synchronously, starts async file creation
3. Radix begins closing the menu (asynchronous — animation/cleanup)
4. File is created, state updates, sidebar re-renders with new FileItem
5. FileItem mounts with `autoRename=true`, useEffect focuses the rename input
6. **Radix's focus restoration fires** (on requestAnimationFrame), steals focus back to the trigger element
7. Rename input receives `blur` event
8. Blur handler exits rename mode

The keyboard shortcut doesn't have this problem because there's no Radix menu involved — nothing fights for focus.

## Solution

Add `onCloseAutoFocus={(e) => e.preventDefault()}` to every `ContextMenuContent`:

```tsx
<ContextMenuContent
  className="w-56"
  onCloseAutoFocus={(e) => e.preventDefault()}
>
```

This is Radix's official API for suppressing focus restoration on menu close. It tells the Dismissable Layer not to move focus back to the trigger.

## Additional Pattern: Blur-Resistant Rename Input

The rename input also needs to survive sidebar re-renders (caused by the file watcher) which can unmount/remount the input. Use a delayed blur pattern:

```tsx
const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

// In the input:
onFocus={() => {
  if (blurTimeout.current) {
    clearTimeout(blurTimeout.current);
    blurTimeout.current = null;
  }
}}
onBlur={() => {
  blurTimeout.current = setTimeout(() => handleRename(), 50);
}}
```

If the input is refocused within 50ms (as happens during re-renders), the blur is cancelled. Real user blur (clicking away) proceeds after 50ms.

## Related Learnings from This Branch

### Empty folders hidden by extension filter

**Problem:** New folders didn't appear in sidebar.
**Cause:** `read_directory` Rust command filtered out directories with no matching files when extension filter was active (`["md"]`).
**Fix:** Always show directories regardless of file filter.

### Stale closures in keyboard event handlers

**Problem:** Cmd+N created files in the wrong folder (always the first tracked folder, not the active file's folder).
**Cause:** `activeFile` was captured in a `useEffect` closure but not in its dependency array. The handler always saw `null`.
**Fix:** Use a ref (`activeFileRef.current = activeFile`) that always has the current value.

### Folder rename collapses the folder

**Problem:** Renaming a folder caused it to collapse.
**Cause:** `key={entry.path}` on DroppableFolder — renamed folder has new path, new key, React unmounts and remounts with `defaultOpen={false}`.
**Fix:** Use index-based keys for directories (`key={dir-${index}}`) so renames don't cause remounting.

### Context menu vs keyboard shortcut code paths diverge

**Problem:** Context menu "New File" didn't trigger auto-rename, Cmd+N did.
**Cause:** Two different code paths — Cmd+N in `layout.tsx` set `newlyCreatedFile`, but context menu used `handleCreateFile` in `folder-tree.tsx` which didn't.
**Fix:** Added `onNewFileCreated` callback from `handleCreateFile` to layout, mirroring the `onNewFolderCreated` pattern.

### State-based refresh vs direct refresh

**Problem:** Context menu "New File" auto-rename flickered even after fixing the callback.
**Cause:** `handleCreateFile` called `refresh()` (direct async fetch) while Cmd+N used `handleFsChange()` (state-based `refreshTrigger` increment). Direct fetch caused extra re-renders with different timing.
**Fix:** Route all refreshes through `handleFsChange` (state-based) for consistent batching.

## Prevention

1. **Always use `onCloseAutoFocus={e => e.preventDefault()}`** on Radix menu content when menu actions create focusable elements
2. **Use refs for values accessed in event handler closures** — don't rely on stale closure captures
3. **Use index-based keys** for items that can be renamed in-place
4. **Keep one code path for actions** — keyboard shortcuts and menu items should call the same function
5. **Use state-based refresh** (`refreshTrigger`) rather than direct `refresh()` calls for consistent React batching
