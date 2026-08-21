import { FileItem } from "./file-item";
import type { FileEntry } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { useDroppable } from "@dnd-kit/core";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import React, { useMemo, useState, useCallback, useRef, useEffect, useSyncExternalStore } from "react";
import { useActiveFileStore } from "./sidebar-context";
import { useFileTreeNode } from "./file-tree-keyboard";

const INDENT_BASE = 16;
const INDENT_STEP = 14;
const FILE_EXTRA = 12;

function startProjectDrag(
  e: PointerEvent,
  folderIndex: number,
  label: string,
  onReorder: (from: number, to: number) => void,
) {
  const rootEl = (e.target as HTMLElement).closest("[data-root-folder]") as HTMLElement | null;
  if (!rootEl) return;

  const allRoots = Array.from(document.querySelectorAll("[data-root-folder]")) as HTMLElement[];
  let currentIndex = folderIndex;

  const ghost = document.createElement("div");
  ghost.className = "project-drag-ghost";
  ghost.textContent = label;
  ghost.style.left = `${e.clientX + 10}px`;
  ghost.style.top = `${e.clientY - 10}px`;
  document.body.appendChild(ghost);

  const indicator = document.createElement("div");
  indicator.className = "project-drop-indicator";
  document.body.appendChild(indicator);

  rootEl.style.opacity = "0.4";
  document.body.style.cursor = "grabbing";
  document.body.style.userSelect = "none";

  const onMove = (ev: PointerEvent) => {
    ghost.style.left = `${ev.clientX + 10}px`;
    ghost.style.top = `${ev.clientY - 10}px`;

    for (let i = 0; i < allRoots.length; i++) {
      const rect = allRoots[i].getBoundingClientRect();
      if (ev.clientY < rect.top + rect.height / 2) {
        currentIndex = i;
        indicator.style.top = `${rect.top}px`;
        indicator.style.left = `${rect.left + 16}px`;
        indicator.style.width = `${rect.width - 32}px`;
        indicator.style.display = "block";
        return;
      }
      currentIndex = i + 1;
      if (i === allRoots.length - 1) {
        indicator.style.top = `${rect.bottom}px`;
        indicator.style.left = `${rect.left + 16}px`;
        indicator.style.width = `${rect.width - 32}px`;
        indicator.style.display = "block";
      }
    }
  };

  const onUp = () => {
    ghost.remove();
    indicator.remove();
    rootEl.style.opacity = "";
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);

    if (currentIndex !== folderIndex && currentIndex !== folderIndex + 1) {
      const toIndex = currentIndex > folderIndex ? currentIndex - 1 : currentIndex;
      onReorder(folderIndex, toIndex);
    }
  };

  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
}

interface FolderTreeProps {
  path: string;
  entries: FileEntry[];
  error: string | null;
  onRefreshFolder: () => void;
  activeDropFolder: string | null;
  onFileSelect: (path: string) => void;

  onRemoveFolder: (path: string) => void;
  onRootRenamed?: (oldPath: string, newPath: string) => void;
  onFileRenamed: (oldPath: string, newPath: string) => void;
  onFileDeleted: (path: string) => void;
  newlyCreatedFile: string | null;
  onNewFileRenamed: () => void;
  onNewFileCreated?: (path: string) => void;
  newlyCreatedFolder: string | null;
  onNewFolderCreated?: (path: string) => void;
  onNewFolderRenamed: () => void;
  onRootOpenChange?: (path: string, isOpen: boolean) => void;
  onAddProject?: () => void;
  folderIndex?: number;
  folderCount?: number;
  onReorderProject?: (fromIndex: number, toIndex: number) => void;
  defaultOpen?: boolean;
  onExpandFolder?: (path: string) => void;
  isSkippedDir?: (name: string) => boolean;
}

export function FolderTree({
  path,
  entries,
  error,
  onRefreshFolder,
  onFileSelect,

  onRemoveFolder,
  onRootRenamed,
  onFileRenamed,
  onFileDeleted,
  activeDropFolder,
  newlyCreatedFile,
  onNewFileRenamed,
  onNewFileCreated,
  newlyCreatedFolder,
  onNewFolderCreated,
  onNewFolderRenamed,
  onRootOpenChange,
  onAddProject,
  folderIndex,
  folderCount,
  onReorderProject,
  defaultOpen: rootDefaultOpen = true,
  onExpandFolder,
  isSkippedDir,
}: FolderTreeProps) {
  const refresh = onRefreshFolder;

  const folderName = useMemo(() => {
    const parts = path.split("/");
    return parts[parts.length - 1] || path;
  }, [path]);

  const handleCreateFile = useCallback(
    async (dir: string) => {
      let name = "Untitled.md";
      let counter = 1;
      while (counter < 100) {
        try {
          const newPath = await invoke<string>("create_file", { dir, name });
          onNewFileCreated?.(newPath);
          onFileSelect(newPath);
          return;
        } catch {
          counter++;
          name = `Untitled ${counter}.md`;
        }
      }
    },
    [refresh, onFileSelect, onNewFileCreated]
  );

  const handleCreateFolder = useCallback(
    async (parentDir: string) => {
      let name = "New Folder";
      let counter = 1;
      while (counter < 100) {
        try {
          const newPath = await invoke<string>("create_directory", { parent: parentDir, name });
          refresh();
          onNewFolderCreated?.(newPath);
          return;
        } catch {
          counter++;
          name = `New Folder ${counter}`;
        }
      }
    },
    [refresh, onNewFolderCreated]
  );

  const activeFileStore = useActiveFileStore();
  const hasActiveFile = useSyncExternalStore(
    useCallback((cb) => activeFileStore.subscribe(cb), [activeFileStore]),
    () => { const af = activeFileStore.get(); return !!af && af.startsWith(path + "/"); },
  );

  if (error) {
    return (
      <div
        className="flex items-center gap-2 px-4 py-1 text-xs text-destructive"
        title={error}
      >
        <span className="min-w-0 flex-1 truncate">{folderName} unavailable</span>
        <button className="text-ring hover:text-foreground" onClick={refresh}>Retry</button>
        <button className="text-ring hover:text-foreground" onClick={() => onRemoveFolder(path)}>Close</button>
      </div>
    );
  }

  return (
    <DroppableFolder
      id={path}
      folderName={folderName}
      activeDropFolder={activeDropFolder}

      onRemoveFolder={onRemoveFolder}
      onRenamed={onRootRenamed}
      onCreateFile={handleCreateFile}
      onCreateFolder={handleCreateFolder}
      onRefresh={refresh}
      defaultOpen={rootDefaultOpen}
      depth={0}
      isRoot={true}
      hasActiveFile={hasActiveFile}
      onOpenChange={(isOpen) => onRootOpenChange?.(path, isOpen)}
      onAddProject={onAddProject}
      folderIndex={folderIndex}
      folderCount={folderCount}
      onReorderProject={onReorderProject}
    >
      <FileTree
        entries={entries}

        activeDropFolder={activeDropFolder}
        onFileSelect={onFileSelect}

        onFileRenamed={onFileRenamed}
        onFileDeleted={onFileDeleted}
        onCreateFile={handleCreateFile}
        onCreateFolder={handleCreateFolder}
        onRefresh={refresh}
        newlyCreatedFile={newlyCreatedFile}
        onNewFileRenamed={onNewFileRenamed}
        newlyCreatedFolder={newlyCreatedFolder}
        onNewFolderRenamed={onNewFolderRenamed}
        onAddProject={onAddProject}
        depth={0}
        onExpandFolder={onExpandFolder}
        isSkippedDir={isSkippedDir}
      />
    </DroppableFolder>
  );
}

function DroppableFolder({
  id,
  folderName,
  activeDropFolder,
  onRemoveFolder,
  onRenamed,
  onDeleted,
  onCreateFile,
  onCreateFolder,
  onRefresh,
  defaultOpen = false,
  depth,
  isRoot = false,
  hasActiveFile = false,
  autoRename,
  onAutoRenameDone,
  onOpenChange,
  onAddProject,
  folderIndex,
  folderCount,
  onReorderProject,
  children,
}: {
  id: string;
  folderName: string;
  activeDropFolder: string | null;
  onRemoveFolder?: (path: string) => void;
  onRenamed?: (oldPath: string, newPath: string) => void;
  onDeleted?: (path: string) => void;
  onCreateFile: (dir: string) => void;
  onCreateFolder: (dir: string) => void;
  onRefresh: () => void;
  defaultOpen?: boolean;
  depth: number;
  isRoot?: boolean;
  hasActiveFile?: boolean;
  autoRename?: boolean;
  onAutoRenameDone?: () => void;
  onOpenChange?: (isOpen: boolean) => void;
  onAddProject?: () => void;
  folderIndex?: number;
  folderCount?: number;
  onReorderProject?: (fromIndex: number, toIndex: number) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [isRenaming, setIsRenaming] = useState(false);
  const [displayFolderName, setDisplayFolderName] = useState(folderName);
  const [renameName, setRenameName] = useState(folderName);
  const [renameError, setRenameError] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  // Sync display name with prop
  useEffect(() => {
    setDisplayFolderName(folderName);
  }, [folderName]);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const isHighlighted = activeDropFolder === id;
  const activeFileStore = useActiveFileStore();
  const containsActiveFile = useSyncExternalStore(
    useCallback((cb) => activeFileStore.subscribe(cb), [activeFileStore]),
    () => { const af = activeFileStore.get(); return !isRoot && !open && !!af && af.startsWith(id + "/"); },
  );
  const { setNodeRef } = useDroppable({
    id: `folder:${id}`,
    data: { folderPath: id },
  });

  const togglePadding = INDENT_BASE + depth * INDENT_STEP;
  const dotColor = isRoot && hasActiveFile ? "var(--ghost-amber)" : "var(--muted-foreground)";

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  // Auto-enter rename mode for newly created folders
  useEffect(() => {
    if (autoRename) {
      setRenameName(folderName);
      setIsRenaming(true);
      onAutoRenameDone?.();
    }
  }, [autoRename]);

  const handleRename = async () => {
    if (!renameName || renameName === folderName) {
      setIsRenaming(false);
      setRenameName(folderName);
      return;
    }
    setDisplayFolderName(renameName);
    setIsRenaming(false);
    try {
      await window.__ghostFlushSave?.();
      const newPath = await invoke<string>("rename_file", { oldPath: id, newName: renameName });
      onRenamed?.(id, newPath);
    } catch (err) {
      console.error("Failed to rename folder:", err);
      setDisplayFolderName(folderName);
      setIsRenaming(true);
      setRenameError(true);
      setTimeout(() => setRenameError(false), 500);
    }
  };

  const startRename = () => {
    setRenameName(folderName);
    setIsRenaming(true);
  };

  const handleRevealInFinder = async () => {
    try {
      await invoke("reveal_in_finder", { path: id });
    } catch (err) {
      console.error("Failed to reveal:", err);
    }
  };

  const handleCopyPath = async () => {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(id);
    } catch (err) {
      console.error("Failed to copy path:", err);
    }
  };

  const handleDuplicate = async () => {
    try {
      await invoke<string>("duplicate_file", { path: id });
      onRefresh();
    } catch (err) {
      console.error("Failed to duplicate:", err);
    }
  };

  const handleDelete = async () => {
    try {
      await window.__ghostFlushSave?.();
      await invoke("delete_file", { path: id });
      onDeleted?.(id);
      onRefresh();
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  const setExpanded = useCallback((expanded: boolean) => {
    setOpen(expanded);
    onOpenChange?.(expanded);
  }, [onOpenChange]);

  const { isFocused, nodeProps, restoreTreeFocus } = useFileTreeNode({
    path: id,
    label: displayFolderName,
    kind: "folder",
    parentPath: isRoot ? null : id.substring(0, id.lastIndexOf("/")),
    expanded: open,
    expand: () => setExpanded(true),
    collapse: () => setExpanded(false),
    actions: {
      activate: () => setExpanded(!open),
      rename: startRename,
      duplicate: handleDuplicate,
      trash: isRoot ? undefined : () => setShowDeleteDialog(true),
      copyPath: handleCopyPath,
      reveal: handleRevealInFinder,
      newFile: () => { setExpanded(true); onCreateFile(id); },
      newFolder: () => { setExpanded(true); onCreateFolder(id); },
      closeProject: isRoot ? () => onRemoveFolder?.(id) : undefined,
    },
  });

  // Build context menu items based on folder type
  const renderContextMenu = () => {
    if (isRoot) {
      return (
        <ContextMenuContent className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onSelect={() => onRemoveFolder?.(id)}>
            Close Project
          </ContextMenuItem>
          <ContextMenuItem onSelect={onAddProject}>
            Open New Project
            <ContextMenuShortcut>⌘O</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => { setOpen(true); onCreateFile(id); }}>
            New File
            <ContextMenuShortcut>⌘N</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => { setOpen(true); onCreateFolder(id); }}>
            New Folder
            <ContextMenuShortcut>⇧⌘N</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleRevealInFinder}>
            Reveal in Finder
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleCopyPath}>
            Copy File Path
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={handleDuplicate}>
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem onSelect={startRename}>
            Rename...
          </ContextMenuItem>
        </ContextMenuContent>
      );
    }

    // Sub-folder menu
    return (
      <ContextMenuContent className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem onSelect={() => { const next = !open; setOpen(next); onOpenChange?.(next); }}>
          {open ? "Collapse" : "Expand"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={onAddProject}>
          Open New Project
          <ContextMenuShortcut>⌘O</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => { setOpen(true); onCreateFile(id); }}>
          New File
          <ContextMenuShortcut>⌘N</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => { setOpen(true); onCreateFolder(id); }}>
          New Folder
          <ContextMenuShortcut>⇧⌘N</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleCopyPath}>
          Copy Folder
          <ContextMenuShortcut>⌘C</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleRevealInFinder}>
          Reveal in Finder
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleCopyPath}>
          Copy File Path
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleDuplicate}>
          Duplicate
        </ContextMenuItem>
        <ContextMenuItem onSelect={startRename}>
          Rename...
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => setShowDeleteDialog(true)} className="text-destructive">
          Move Folder to Trash
        </ContextMenuItem>
      </ContextMenuContent>
    );
  };

  const guideLine = open ? (
    <div className="relative" role="group">
      <div
        className="absolute top-0 bottom-0 w-[1.5px] rounded-full"
        data-tree-guide={isRoot ? "root" : "sub"}
        style={{
          left: `${togglePadding + (isRoot ? 3 : 7)}px`,
          backgroundColor: "var(--border)",
        }}
      />
      {children}
    </div>
  ) : null;

  if (isRenaming) {
    return (
      <div
        ref={setNodeRef}
        className="rounded-md"
      >
        <div
          className="flex items-center gap-2 py-1 pr-2"
          style={{ paddingLeft: `${togglePadding}px` }}
        >
          {isRoot ? (
            <span
              className="inline-block size-[7px] shrink-0 rounded-full"
              style={{
                backgroundColor: open ? dotColor : "transparent",
                border: `1.5px solid ${dotColor}`,
              }}
            />
          ) : (
            <span className="text-[16px] leading-none text-muted-foreground">{open ? "▾" : "▸"}</span>
          )}
          <input
            ref={renameInputRef}
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRename();
              if (e.key === "Escape") {
                setRenameName(folderName);
                setIsRenaming(false);
              }
            }}
            className={`flex-1 bg-transparent text-[13px] text-card-foreground font-medium outline-none caret-ghost-amber border rounded-[4px] px-2 py-0.5 transition-colors ${
              renameError ? "border-red-500 shake-error" : "border-ring"
            }`}
          />
        </div>
        {guideLine}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...nodeProps}
      data-root-folder={isRoot ? id : undefined}
      className={`rounded-md transition-colors ${isHighlighted ? "bg-muted/60 ring-1 ring-border" : ""}`}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            data-tree-focus-target
            tabIndex={-1}
            onClick={() => {
              const next = !open;
              setExpanded(next);
              requestAnimationFrame(restoreTreeFocus);
            }}
            onPointerDown={(e) => {
              if (!isRoot || folderIndex === undefined || !onReorderProject || (folderCount ?? 0) < 2) return;
              const startX = e.clientX;
              const startY = e.clientY;
              let dragging = false;
              const onMove = (ev: PointerEvent) => {
                if (!dragging && (Math.abs(ev.clientX - startX) > 4 || Math.abs(ev.clientY - startY) > 4)) {
                  dragging = true;
                  startProjectDrag(e.nativeEvent, folderIndex, displayFolderName, onReorderProject);
                  cleanup();
                }
              };
              const onUp = () => cleanup();
              const cleanup = () => {
                document.removeEventListener("pointermove", onMove);
                document.removeEventListener("pointerup", onUp);
              };
              document.addEventListener("pointermove", onMove);
              document.addEventListener("pointerup", onUp);
            }}
            data-folder-active={containsActiveFile || undefined}
            className={`relative w-full text-left flex items-center gap-2 py-1.5 pr-2 overflow-hidden hover:text-card-foreground transition-colors cursor-pointer select-none rounded-[5px] ${containsActiveFile ? "bg-white/[0.06]" : "data-[state=open]:bg-white/[0.06]"} ${isFocused ? "ring-1 ring-inset ring-ghost-amber/80 bg-ghost-amber/[0.05]" : ""}`}
            style={{ paddingLeft: `${togglePadding}px` }}
          >
            {/* Guide line rendered by SidebarGuide overlay */}
            {isRoot ? (
              <span
                data-root-dot
                className="inline-block size-[7px] shrink-0 rounded-full transition-colors"
                style={{
                  backgroundColor: open ? dotColor : "transparent",
                  border: `1.5px solid ${dotColor}`,
                }}
              />
            ) : (
              <span data-tree-label className="text-[16px] leading-none text-muted-foreground">{open ? "▾" : "▸"}</span>
            )}
            <span data-tree-label className={`text-[13px] font-medium truncate ${containsActiveFile ? "text-card-foreground" : isRoot ? "text-card-foreground" : "text-sidebar-primary"}`}>{displayFolderName}</span>
          </button>
        </ContextMenuTrigger>
        {renderContextMenu()}
      </ContextMenu>
      {guideLine}

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent onKeyDown={(e) => { if (e.key === "Enter") { handleDelete(); setShowDeleteDialog(false); } }}>
          <DialogHeader>
            <DialogTitle>Move folder to Trash?</DialogTitle>
            <DialogDescription>
              “{displayFolderName}” and its contents can be recovered from the macOS Trash.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => { handleDelete(); setShowDeleteDialog(false); }}>
              Move to Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const FileTree = React.memo(function FileTree({
  entries,

  activeDropFolder,
  onFileSelect,

  onFileRenamed,
  onFileDeleted,
  onCreateFile,
  onCreateFolder,
  onRefresh,
  newlyCreatedFile,
  onNewFileRenamed,
  newlyCreatedFolder,
  onNewFolderRenamed,
  onAddProject,
  depth,
  onExpandFolder,
  isSkippedDir,
}: {
  entries: FileEntry[];

  activeDropFolder: string | null;
  onFileSelect: (path: string) => void;

  onFileRenamed: (oldPath: string, newPath: string) => void;
  onFileDeleted: (path: string) => void;
  onCreateFile: (dir: string) => void;
  onCreateFolder: (dir: string) => void;
  onRefresh: () => void;
  onAddProject?: () => void;
  newlyCreatedFile: string | null;
  onNewFileRenamed: () => void;
  newlyCreatedFolder: string | null;
  onNewFolderRenamed: () => void;
  depth: number;
  onExpandFolder?: (path: string) => void;
  isSkippedDir?: (name: string) => boolean;
}) {
  const PAGE_SIZE = 100;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [entries]);

  useEffect(() => {
    if (visibleCount >= entries.length || !sentinelRef.current) return;
    const observer = new IntersectionObserver((items) => {
      if (items[0]?.isIntersecting) {
        setVisibleCount((v) => Math.min(v + PAGE_SIZE, entries.length));
      }
    }, { rootMargin: "200px" });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [visibleCount, entries.length]);

  return (
    <>
      {entries.slice(0, visibleCount).map((entry) =>
        entry.is_directory ? (
          <DroppableFolder
            key={entry.path}
            id={entry.path}
            folderName={entry.name}
            activeDropFolder={activeDropFolder}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRefresh={onRefresh}
            onRenamed={onFileRenamed}
            onDeleted={onFileDeleted}
            onAddProject={onAddProject}
            depth={depth + 1}
            autoRename={entry.path === newlyCreatedFolder}
            onAutoRenameDone={onNewFolderRenamed}
            onOpenChange={(isOpen) => { if (isOpen) onExpandFolder?.(entry.path); }}
            defaultOpen={entry.children !== null && (entry.children?.length ?? 0) > 0 ? undefined : false}
          >
            <FileTree
              entries={entry.children ?? []}

              activeDropFolder={activeDropFolder}
              onFileSelect={onFileSelect}

              onFileRenamed={onFileRenamed}
              onFileDeleted={onFileDeleted}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onRefresh={onRefresh}
              newlyCreatedFile={newlyCreatedFile}
              onNewFileRenamed={onNewFileRenamed}
              newlyCreatedFolder={newlyCreatedFolder}
              onNewFolderRenamed={onNewFolderRenamed}
              onAddProject={onAddProject}
              depth={depth + 1}
              onExpandFolder={onExpandFolder}
              isSkippedDir={isSkippedDir}
            />
          </DroppableFolder>
        ) : (
          <FileItem
            key={entry.path}
            entry={entry}
            onSelect={() => onFileSelect(entry.path)}
            onRenamed={(newPath) => onFileRenamed(entry.path, newPath)}
            onDeleted={() => onFileDeleted(entry.path)}
            onNewSibling={() => onCreateFile(entry.path.substring(0, entry.path.lastIndexOf("/")))}
            onNewFolderSibling={() => onCreateFolder(entry.path.substring(0, entry.path.lastIndexOf("/")))}
            indent={INDENT_BASE + (depth + 1) * INDENT_STEP + FILE_EXTRA}
            autoRename={entry.path === newlyCreatedFile}
            onAutoRenameDone={onNewFileRenamed}
            onAddProject={onAddProject}
            onDuplicated={onRefresh}
            disableDnd={entries.length > 200}
          />
        )
      )}
      {visibleCount < entries.length && (
        <div ref={sentinelRef} className="px-4 py-1 text-[11px] text-ring">
          {entries.length - visibleCount} more items...
        </div>
      )}
    </>
  );
// Rename/delete callbacks affect which open document subsequent saves target,
// so they must never be hidden behind a stale memoized tree.
}, (prev, next) =>
  prev.entries === next.entries &&
  prev.depth === next.depth &&
  prev.activeDropFolder === next.activeDropFolder &&
  prev.newlyCreatedFile === next.newlyCreatedFile &&
  prev.newlyCreatedFolder === next.newlyCreatedFolder &&
  prev.onFileRenamed === next.onFileRenamed &&
  prev.onFileDeleted === next.onFileDeleted
);
