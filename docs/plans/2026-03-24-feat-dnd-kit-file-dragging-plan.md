---
title: "feat: File drag-and-drop with dnd-kit"
type: feat
date: 2026-03-24
---

# File Drag-and-Drop with @dnd-kit

## Problem

HTML5 Drag and Drop API does not work in Tauri v2's WebKit webview on macOS. Tauri's `dragDropEnabled` (defaults to `true`) intercepts all drag events at the OS level before JavaScript sees them. Custom mouse-event approaches lacked visual feedback and were fragile.

## Solution

Use `@dnd-kit/react` (new-generation API, v0.3.x). It uses **Pointer Events**, not the HTML5 DnD API, so it works in Tauri's WKWebView without any config changes.

## What to install

```bash
pnpm add @dnd-kit/react @dnd-kit/helpers @dnd-kit/collision
```

## What to remove

- Delete `src/hooks/use-drag-drop.ts` (custom mouse-event hook)
- Remove all HTML5 drag handlers from `folder-tree.tsx` (`onDragOver`, `onDragLeave`, `onDrop`, `dragOverPath` state, `handleDragOver`, `handleDragLeave`, `handleDrop`)
- Remove `draggable` and `onDragStart` from `file-item.tsx`

## Implementation

### Step 1: Wrap sidebar in DragDropProvider

In `layout.tsx`, wrap the sidebar content area with `<DragDropProvider>`:

```tsx
import { DragDropProvider, DragOverlay } from '@dnd-kit/react';

<DragDropProvider onDragEnd={handleDragEnd}>
  <SidebarContent>
    {/* folder trees */}
  </SidebarContent>
  <DragOverlay>
    {(source) => (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-popover border shadow-lg text-sm">
        <FileText className="size-3.5" />
        {source.data?.name}
      </div>
    )}
  </DragOverlay>
</DragDropProvider>
```

`handleDragEnd` checks if a file was dropped over a folder and calls `move_file`.

### Step 2: Make files draggable with useSortable

In `file-item.tsx`, use `useSortable` from `@dnd-kit/react/sortable`:

```tsx
import { useSortable } from '@dnd-kit/react/sortable';

const { ref, isDragging } = useSortable({
  id: entry.path,
  type: 'file',
  group: parentFolderPath,
  data: { name: entry.name, path: entry.path },
});

// Apply ref to the SidebarMenuItem wrapper, add opacity when dragging
```

### Step 3: Make folders droppable with useSortable

In `folder-tree.tsx` SubFolder component:

```tsx
import { useSortable } from '@dnd-kit/react/sortable';
import { CollisionPriority } from '@dnd-kit/abstract';

const { ref, isDropTarget } = useSortable({
  id: entry.path,
  type: 'folder',
  accept: ['file'],
  collisionPriority: CollisionPriority.Low,
});

// Highlight folder with bg-accent when isDropTarget is true
```

### Step 4: CSS requirement

Add `touch-action: none` to the sidebar tree container to prevent WebKit from intercepting pointer events as scroll gestures:

```css
[data-slot="sidebar-content"] {
  touch-action: none;
}
```

Actually — this may conflict with sidebar scrolling. Test first. May need to only apply it during active drag via a class.

### Step 5: Handle the drop

In `layout.tsx`'s `handleDragEnd`:

```tsx
const handleDragEnd = (event) => {
  if (event.canceled) return;
  const { source, target } = event.operation;
  if (source?.type === 'file' && target?.type === 'folder') {
    handleFileMoved(source.id, target.id);
  }
};
```

## Key considerations

- **PointerSensor activation distance**: Set to 5px so clicks don't accidentally trigger drags
- **DragOverlay**: Renders a floating badge with the filename that follows the cursor
- **isDropTarget**: Each folder highlights when a file is hovering over it
- **isDragging**: The original file item becomes semi-transparent during drag
- **No conflict with Collapsible**: The collapsible trigger and drag handle can coexist since they respond to different event types (click vs pointer drag with activation distance)
- **`touch-action: none`**: Required for WebKit but may need conditional application to not break scrolling

## Files to change

- `package.json` — add dnd-kit packages
- `src/components/layout.tsx` — add DragDropProvider + DragOverlay + handleDragEnd
- `src/components/sidebar/file-item.tsx` — add useSortable, remove HTML5 drag
- `src/components/sidebar/folder-tree.tsx` — add useSortable to folders, remove HTML5 drag handlers, pass parentFolderPath to FileItem
- `src/hooks/use-drag-drop.ts` — DELETE
- `src/styles/globals.css` — touch-action rule (if needed)

## Acceptance criteria

- [ ] Files can be dragged from one folder to another
- [ ] A floating label with the filename follows the cursor during drag
- [ ] The drop target folder highlights when a file hovers over it
- [ ] The dragged file becomes semi-transparent at its original position
- [ ] Clicking a file still opens it (no accidental drags)
- [ ] Sidebar scrolling still works normally when not dragging
- [ ] No blank screen, no broken JSX
