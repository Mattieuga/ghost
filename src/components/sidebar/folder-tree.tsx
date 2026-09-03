import { FileItem } from "./file-item";
import type { FileEntry } from "@/types";
import { invoke } from "@tauri-apps/api/core";
import { useDroppable } from "@dnd-kit/core";
import React, { useMemo, useState, useCallback, useRef, useEffect, useSyncExternalStore } from "react";
import { useActiveFileStore, useSidebarActions } from "./sidebar-context";
import { useFileTreeNode } from "./file-tree-keyboard";
import { SidebarTrashDialog } from "./sidebar-trash-dialog";
import {
  SIDEBAR_FILE_EXTRA_INDENT,
  SIDEBAR_INDENT_BASE,
  SIDEBAR_INDENT_STEP,
  SidebarFolderTreeItem,
  SidebarTreeContextMenu,
  SidebarTreeRenameItem,
} from "./sidebar-tree-item";

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
  onFileSelect: (path: string) => void | boolean | Promise<void | boolean>;

  onRemoveFolder: (path: string) => void;
  onRootRenamed?: (oldPath: string, newPath: string) => void | Promise<void>;
  onFileRenamed: (oldPath: string, newPath: string) => void | Promise<void>;
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
    [onFileSelect, onNewFileCreated]
  );

  const handleCreateFolder = useCallback(
    async (parentDir: string) => {
      let name = "New Folder";
      let counter = 1;
      while (counter < 100) {
        try {
          const newPath = await invoke<string>("create_directory", { parent: parentDir, name });
          onNewFolderCreated?.(newPath);
          return;
        } catch {
          counter++;
          name = `New Folder ${counter}`;
        }
      }
    },
    [onNewFolderCreated]
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
      projectPath={path}
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
        projectPath={path}

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
  projectPath,
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
  projectPath: string;
  folderName: string;
  activeDropFolder: string | null;
  onRemoveFolder?: (path: string) => void;
  onRenamed?: (oldPath: string, newPath: string) => void | Promise<void>;
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
  const renameInFlightRef = useRef(false);
  const isHighlighted = activeDropFolder === id;
  const activeFileStore = useActiveFileStore();
  const containsActiveFile = useSyncExternalStore(
    useCallback((cb) => activeFileStore.subscribe(cb), [activeFileStore]),
    () => { const af = activeFileStore.get(); return !isRoot && !open && !!af && af.startsWith(id + "/"); },
  );
  const { setNodeRef } = useDroppable({
    id: `folder:${JSON.stringify([projectPath, id])}`,
    data: { folderPath: id },
  });
  const sidebarActions = useSidebarActions();
  // A plain root, or a folder inside one, can be synced and becomes its own
  // root. A mirrored root can stop or be linked into a repository.
  const ownKind = sidebarActions.rootKindOf?.(id) ?? null;
  const parentKind = sidebarActions.rootKindOf?.(projectPath) ?? null;
  const canSync = !!sidebarActions.syncFolder
    && (ownKind === "plain" || (!isRoot && ownKind === null && parentKind === "plain"));
  // The Shared root mirrors other people's trees: no structure changes here,
  // and it comes and goes with what is shared rather than being closed.
  const inShared = sidebarActions.isSharedRoot?.(isRoot ? id : projectPath) ?? false;
  const isMirroredRoot = isRoot && ownKind === "mirrored" && !inShared;
  const canLeave = inShared && !isRoot && id.substring(0, id.lastIndexOf("/")) === projectPath && !!sidebarActions.leave;
  const leave = canLeave ? () => sidebarActions.leave?.(id) : undefined;

  const dotColor = isRoot && hasActiveFile ? "var(--ghost-amber)" : "var(--muted-foreground)";
  // This is intentionally separate from data-folder-active. A collapsed root
  // keeps its active dot, but has no visible descendant for the guide to point
  // at, so SidebarGuide should clear rather than paint the whole root row.
  const isCollapsedActiveRoot = isRoot && !open && hasActiveFile;

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
    if (renameInFlightRef.current) return;
    if (!renameName || renameName === folderName) {
      renameInFlightRef.current = true;
      setIsRenaming(false);
      setRenameName(folderName);
      requestAnimationFrame(() => {
        renameInFlightRef.current = false;
        void focusTreePath(id, projectPath);
      });
      return;
    }
    renameInFlightRef.current = true;
    try {
      await window.__ghostFlushSave?.();
      const newPath = await invoke<string>("rename_file", { oldPath: id, newName: renameName });
      const renamed = onRenamed?.(id, newPath);
      setDisplayFolderName(renameName);
      setIsRenaming(false);
      requestAnimationFrame(() => void focusTreePath(newPath, isRoot ? newPath : projectPath));
      await renamed;
    } catch (err) {
      console.error("Failed to rename folder:", err);
      setDisplayFolderName(folderName);
      setIsRenaming(true);
      setRenameError(true);
      setTimeout(() => setRenameError(false), 500);
    } finally {
      renameInFlightRef.current = false;
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

  const { isFocused, nodeProps, restoreTreeFocus, focusTreePath } = useFileTreeNode({
    path: id,
    projectPath,
    label: displayFolderName,
    kind: "folder",
    parentPath: isRoot ? null : id.substring(0, id.lastIndexOf("/")),
    expanded: open,
    expand: () => setExpanded(true),
    collapse: () => setExpanded(false),
    actions: {
      activate: () => setExpanded(!open),
      rename: inShared ? undefined : startRename,
      duplicate: inShared ? undefined : handleDuplicate,
      trash: inShared ? leave : isRoot ? undefined : () => setShowDeleteDialog(true),
      copyPath: handleCopyPath,
      reveal: handleRevealInFinder,
      newFile: inShared ? undefined : () => { setExpanded(true); onCreateFile(id); },
      newFolder: inShared ? undefined : () => { setExpanded(true); onCreateFolder(id); },
      closeProject: isRoot && !inShared ? () => onRemoveFolder?.(id) : undefined,
    },
  });

  const contextMenu = (
    <SidebarTreeContextMenu
      kind="folder"
      expanded={open}
      actions={{
        toggle: isRoot ? undefined : () => {
          const next = !open;
          setOpen(next);
          onOpenChange?.(next);
        },
        closeProject: isRoot && !inShared ? () => onRemoveFolder?.(id) : undefined,
        syncFolder: canSync ? () => sidebarActions.syncFolder?.(id) : undefined,
        stopSyncing: isMirroredRoot ? () => sidebarActions.stopSyncing?.(id) : undefined,
        linkIntoProject: isMirroredRoot ? () => sidebarActions.linkIntoProject?.(id) : undefined,
        leave,
        openNewProject: onAddProject,
        newFile: inShared ? undefined : () => { setOpen(true); onCreateFile(id); },
        newFolder: inShared ? undefined : () => { setOpen(true); onCreateFolder(id); },
        copy: isRoot ? undefined : () => { void handleCopyPath(); },
        reveal: () => { void handleRevealInFinder(); },
        copyPath: () => { void handleCopyPath(); },
        duplicate: inShared ? undefined : () => { void handleDuplicate(); },
        rename: inShared ? undefined : startRename,
        trash: inShared || isRoot ? undefined : () => setShowDeleteDialog(true),
      }}
    />
  );

  if (isRenaming) {
    return (
      <div ref={setNodeRef}>
        <SidebarTreeRenameItem
          kind="folder"
          depth={depth}
          expanded={open}
          isRoot={isRoot}
          dotColor={dotColor}
          inputRef={renameInputRef}
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onBlur={() => {
            if (!renameInFlightRef.current) void handleRename();
          }}
          onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.stopPropagation();
                void handleRename();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                renameInFlightRef.current = true;
                setRenameName(folderName);
                setIsRenaming(false);
                requestAnimationFrame(() => {
                  renameInFlightRef.current = false;
                  void focusTreePath(id, projectPath);
                });
              }
          }}
          error={renameError}
        >
          {children}
        </SidebarTreeRenameItem>
      </div>
    );
  }

  return (
    <>
      <SidebarFolderTreeItem
        label={displayFolderName}
        depth={depth}
        expanded={open}
        isRoot={isRoot}
        rootId={id}
        active={containsActiveFile}
        focused={isFocused}
        highlighted={isHighlighted}
        activeRootCollapsed={isCollapsedActiveRoot}
        dotColor={dotColor}
        onActivate={() => {
          const next = !open;
          setExpanded(next);
          requestAnimationFrame(restoreTreeFocus);
        }}
        menu={contextMenu}
        containerRef={setNodeRef}
        containerProps={nodeProps}
        buttonProps={{
          onPointerDown: (e) => {
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
          },
        }}
      >
        {children}
      </SidebarFolderTreeItem>

      <SidebarTrashDialog
        open={showDeleteDialog}
        kind="folder"
        name={displayFolderName}
        description={`“${displayFolderName}” and its contents can be recovered from the macOS Trash.`}
        onOpenChange={setShowDeleteDialog}
        onConfirm={() => { void handleDelete(); setShowDeleteDialog(false); }}
      />
    </>
  );
}

const FileTree = React.memo(function FileTree({
  entries,
  projectPath,

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
  projectPath: string;

  activeDropFolder: string | null;
  onFileSelect: (path: string) => void | boolean | Promise<void | boolean>;

  onFileRenamed: (oldPath: string, newPath: string) => void | Promise<void>;
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
  const displayEntries = useMemo(
    () => entries.filter((entry) => !entry.is_directory || !isSkippedDir?.(entry.name)),
    [entries, isSkippedDir],
  );
  const activeFileStore = useActiveFileStore();
  const activePath = useSyncExternalStore(
    useCallback((callback) => activeFileStore.subscribe(callback), [activeFileStore]),
    () => activeFileStore.get(),
  );
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const requiredIndex = Math.max(
      displayEntries.findIndex((entry) => entry.path === newlyCreatedFile),
      displayEntries.findIndex((entry) => entry.path === newlyCreatedFolder),
      displayEntries.findIndex((entry) => entry.path === activePath),
    );
    setVisibleCount((current) => Math.max(
      Math.min(PAGE_SIZE, displayEntries.length),
      Math.min(current, displayEntries.length),
      requiredIndex + 1,
    ));
  }, [activePath, displayEntries, newlyCreatedFile, newlyCreatedFolder]);

  useEffect(() => {
    if (visibleCount >= displayEntries.length || !sentinelRef.current) return;
    const observer = new IntersectionObserver((items) => {
      if (items[0]?.isIntersecting) {
        setVisibleCount((v) => Math.min(v + PAGE_SIZE, displayEntries.length));
      }
    }, { rootMargin: "200px" });
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [visibleCount, displayEntries.length]);

  return (
    <>
      {displayEntries.slice(0, visibleCount).map((entry) =>
        entry.is_directory ? (
          <DroppableFolder
            key={entry.path}
            id={entry.path}
            projectPath={projectPath}
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
              projectPath={projectPath}

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
            projectPath={projectPath}
            onSelect={() => onFileSelect(entry.path)}
            onRenamed={(newPath) => onFileRenamed(entry.path, newPath)}
            onDeleted={() => onFileDeleted(entry.path)}
            onNewSibling={() => onCreateFile(entry.path.substring(0, entry.path.lastIndexOf("/")))}
            onNewFolderSibling={() => onCreateFolder(entry.path.substring(0, entry.path.lastIndexOf("/")))}
            indent={SIDEBAR_INDENT_BASE + (depth + 1) * SIDEBAR_INDENT_STEP + SIDEBAR_FILE_EXTRA_INDENT}
            autoRename={entry.path === newlyCreatedFile}
            onAutoRenameDone={onNewFileRenamed}
            onAddProject={onAddProject}
            onDuplicated={onRefresh}
            disableDnd={displayEntries.length > 200}
          />
        )
      )}
      {visibleCount < displayEntries.length && (
        <div ref={sentinelRef} className="px-4 py-1 text-[11px] text-ring">
          {displayEntries.length - visibleCount} more items...
        </div>
      )}
    </>
  );
// Rename/delete callbacks affect which open document subsequent saves target,
// so they must never be hidden behind a stale memoized tree.
}, (prev, next) =>
  prev.entries === next.entries &&
  prev.projectPath === next.projectPath &&
  prev.depth === next.depth &&
  prev.activeDropFolder === next.activeDropFolder &&
  prev.newlyCreatedFile === next.newlyCreatedFile &&
  prev.newlyCreatedFolder === next.newlyCreatedFolder &&
  prev.onFileRenamed === next.onFileRenamed &&
  prev.onFileDeleted === next.onFileDeleted
);
