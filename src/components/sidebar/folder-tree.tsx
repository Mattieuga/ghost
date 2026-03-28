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
import { useMemo, useState, useCallback, useRef, useEffect } from "react";

const INDENT_BASE = 16;
const INDENT_STEP = 14;
const FILE_EXTRA = 12;

interface FolderTreeProps {
  path: string;
  entries: FileEntry[];
  error: string | null;
  onRefreshFolder: () => void;
  activeFile: string | null;
  activeDropFolder: string | null;
  onFileSelect: (path: string) => void;

  onRemoveFolder: (path: string) => void;
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
}

export function FolderTree({
  path,
  entries,
  error,
  onRefreshFolder,
  activeFile,
  onFileSelect,

  onRemoveFolder,
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

  if (error) {
    return (
      <div className="px-4 py-1 text-xs text-destructive truncate">
        {folderName}
      </div>
    );
  }

  const hasActiveFile = activeFile ? activeFile.startsWith(path + "/") : false;
  const rootGuideX = INDENT_BASE + 3;

  return (
    <DroppableFolder
      id={path}
      folderName={folderName}
      activeDropFolder={activeDropFolder}

      onRemoveFolder={onRemoveFolder}
      onCreateFile={handleCreateFile}
      onCreateFolder={handleCreateFolder}
      onRefresh={refresh}
      defaultOpen={true}
      depth={0}
      isRoot={true}
      hasActiveFile={hasActiveFile}
      onOpenChange={(isOpen) => onRootOpenChange?.(path, isOpen)}
      onAddProject={onAddProject}
    >
      <FileTree
        entries={entries}
        activeFile={activeFile}

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
        rootGuideX={hasActiveFile ? rootGuideX : null}
      />
    </DroppableFolder>
  );
}

function DroppableFolder({
  id,
  folderName,
  activeDropFolder,
  activeFile,
  onRemoveFolder,
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
  rootGuideX,
  children,
}: {
  id: string;
  folderName: string;
  activeDropFolder: string | null;
  activeFile?: string | null;
  rootGuideX?: number | null;
  onRemoveFolder?: (path: string) => void;
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
  // For non-root folders: highlight when closed and containing the active file
  const containsActiveFile = !isRoot && !open && !!activeFile && activeFile.startsWith(id + "/");
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
      await invoke<string>("rename_file", { oldPath: id, newName: renameName });
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
      await invoke("delete_file", { path: id });
      onRefresh();
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  // Build context menu items based on folder type
  const renderContextMenu = () => {
    if (isRoot) {
      return (
        <ContextMenuContent className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onSelect={() => onRemoveFolder?.(id)}>
            Close Project
          </ContextMenuItem>
          <ContextMenuItem disabled>
            Open in New Window
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
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => setShowDeleteDialog(true)} className="text-destructive">
            Delete Folder
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
        <ContextMenuItem disabled>
          Open in New Window
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
          Delete Folder
        </ContextMenuItem>
      </ContextMenuContent>
    );
  };

  const guideLine = open ? (
    <div className="relative">
      <div
        className="absolute top-0 bottom-0 w-[1.5px] rounded-full"
        data-tree-guide={isRoot ? "root" : "sub"}
        style={{
          left: `${togglePadding + (isRoot ? 3 : 7)}px`,
          backgroundColor: isRoot && hasActiveFile ? "var(--ghost-amber)" : "var(--border)",
          opacity: isRoot && hasActiveFile ? 0.45 : 1,
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
      className={`rounded-md transition-colors ${isHighlighted ? "bg-muted/60 ring-1 ring-border" : ""}`}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={() => {
              const next = !open;
              setOpen(next);
              onOpenChange?.(next);
            }}
            data-folder-active={containsActiveFile || undefined}
            className={`relative w-full text-left flex items-center gap-2 py-1.5 pr-2 overflow-hidden hover:text-card-foreground transition-colors cursor-pointer select-none rounded-[5px] ${containsActiveFile ? "bg-white/[0.06]" : "data-[state=open]:bg-white/[0.06]"}`}
            style={{ paddingLeft: `${togglePadding}px` }}
          >
            {containsActiveFile && rootGuideX != null && (
              <div
                className="absolute top-0 bottom-0 w-[1.5px] rounded-full"
                style={{ left: `${rootGuideX}px`, backgroundColor: "var(--ghost-amber)" }}
              />
            )}
            {isRoot ? (
              <span
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
            <DialogTitle>Delete folder</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{displayFolderName}" and all its contents? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => { handleDelete(); setShowDeleteDialog(false); }}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FileTree({
  entries,
  activeFile,

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
  rootGuideX,
}: {
  entries: FileEntry[];
  activeFile: string | null;

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
  rootGuideX: number | null;
}) {
  return (
    <>
      {entries.map((entry, index) =>
        entry.is_directory ? (
          <DroppableFolder
            key={`dir-${index}`}
            id={entry.path}
            folderName={entry.name}
            activeDropFolder={activeDropFolder}
            activeFile={activeFile}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRefresh={onRefresh}
            onAddProject={onAddProject}
            depth={depth + 1}
            autoRename={entry.path === newlyCreatedFolder}
            onAutoRenameDone={onNewFolderRenamed}
            rootGuideX={rootGuideX}
          >
            <FileTree
              entries={entry.children ?? []}
              activeFile={activeFile}
      
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
              rootGuideX={rootGuideX}
            />
          </DroppableFolder>
        ) : (
          <FileItem
            key={entry.path}
            entry={entry}
            isActive={activeFile === entry.path}
            onSelect={() => onFileSelect(entry.path)}
            onRenamed={(newPath) => onFileRenamed(entry.path, newPath)}
            onDeleted={() => onFileDeleted(entry.path)}
            onNewSibling={() => onCreateFile(entry.path.substring(0, entry.path.lastIndexOf("/")))}
            onNewFolderSibling={() => onCreateFolder(entry.path.substring(0, entry.path.lastIndexOf("/")))}
            indent={INDENT_BASE + (depth + 1) * INDENT_STEP + FILE_EXTRA}
            autoRename={entry.path === newlyCreatedFile}
            onAutoRenameDone={onNewFileRenamed}
            rootGuideX={rootGuideX}
            onAddProject={onAddProject}
          />
        )
      )}
    </>
  );
}
