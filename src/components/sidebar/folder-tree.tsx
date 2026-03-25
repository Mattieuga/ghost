import { useDirectory } from "@/hooks/use-directory";
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
import { useMemo, useState, useCallback, useRef, useEffect } from "react";

const INDENT_BASE = 16;
const INDENT_STEP = 14;
const FILE_EXTRA = 12;

interface FolderTreeProps {
  path: string;
  extensions: string[];
  activeFile: string | null;
  selectedItem: string | null;
  refreshTrigger: number;
  activeDropFolder: string | null;
  onFileSelect: (path: string) => void;
  onFolderSelect: (path: string) => void;
  onRemoveFolder: (path: string) => void;
  onFileRenamed: (oldPath: string, newPath: string) => void;
  onFileDeleted: (path: string) => void;
  newlyCreatedFile: string | null;
  onNewFileRenamed: () => void;
}

export function FolderTree({
  path,
  extensions,
  activeFile,
  selectedItem,
  refreshTrigger,
  onFileSelect,
  onFolderSelect,
  onRemoveFolder,
  onFileRenamed,
  onFileDeleted,
  activeDropFolder,
  newlyCreatedFile,
  onNewFileRenamed,
}: FolderTreeProps) {
  const { entries, error, refresh } = useDirectory(path, extensions, refreshTrigger);

  const folderName = useMemo(() => {
    const parts = path.split("/");
    return parts[parts.length - 1] || path;
  }, [path]);

  const handleCreateFile = useCallback(
    async (dir: string) => {
      let name = "Untitled.md";
      let counter = 1;
      while (true) {
        try {
          const newPath = await invoke<string>("create_file", { dir, name });
          refresh();
          onFileSelect(newPath);
          return;
        } catch {
          counter++;
          name = `Untitled ${counter}.md`;
        }
      }
    },
    [refresh, onFileSelect]
  );

  const handleCreateFolder = useCallback(
    async (parentDir: string) => {
      let name = "New Folder";
      let counter = 1;
      while (true) {
        try {
          await invoke<string>("create_directory", { parent: parentDir, name });
          refresh();
          return;
        } catch {
          counter++;
          name = `New Folder ${counter}`;
        }
      }
    },
    [refresh]
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
      onFolderSelect={onFolderSelect}
      onRemoveFolder={onRemoveFolder}
      onCreateFile={handleCreateFile}
      onCreateFolder={handleCreateFolder}
      onRefresh={refresh}
      defaultOpen={true}
      depth={0}
      isRoot={true}
      hasActiveFile={hasActiveFile}
    >
      <FileTree
        entries={entries}
        activeFile={activeFile}
        selectedItem={selectedItem}
        activeDropFolder={activeDropFolder}
        onFileSelect={onFileSelect}
        onFolderSelect={onFolderSelect}
        onFileRenamed={onFileRenamed}
        onFileDeleted={onFileDeleted}
        onCreateFile={handleCreateFile}
        onCreateFolder={handleCreateFolder}
        onRefresh={refresh}
        newlyCreatedFile={newlyCreatedFile}
        onNewFileRenamed={onNewFileRenamed}
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
  onFolderSelect,
  onRemoveFolder,
  onCreateFile,
  onCreateFolder,
  onRefresh,
  defaultOpen = false,
  depth,
  isRoot = false,
  hasActiveFile = false,
  children,
}: {
  id: string;
  folderName: string;
  activeDropFolder: string | null;
  onFolderSelect: (path: string) => void;
  onRemoveFolder?: (path: string) => void;
  onCreateFile: (dir: string) => void;
  onCreateFolder: (dir: string) => void;
  onRefresh: () => void;
  defaultOpen?: boolean;
  depth: number;
  isRoot?: boolean;
  hasActiveFile?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameName, setRenameName] = useState(folderName);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const isHighlighted = activeDropFolder === id;
  const { setNodeRef } = useDroppable({
    id: `folder:${id}`,
    data: { folderPath: id },
  });

  const togglePadding = INDENT_BASE + depth * INDENT_STEP;
  const dotColor = isRoot && hasActiveFile ? "#f57c00" : "#52525b";

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleRename = async () => {
    if (!renameName || renameName === folderName) {
      setIsRenaming(false);
      setRenameName(folderName);
      return;
    }
    try {
      await invoke<string>("rename_file", { oldPath: id, newName: renameName });
      // Don't call onRefresh() — let the file watcher handle the update.
      // This prevents the folder from collapsing because the parent
      // re-fetches entries with a new path (new key = remount = defaultOpen).
    } catch (err) {
      console.error("Failed to rename folder:", err);
      setRenameName(folderName);
    }
    setIsRenaming(false);
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
      await navigator.clipboard.writeText(id);
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
        <ContextMenuContent className="w-56">
          <ContextMenuItem onSelect={() => onRemoveFolder?.(id)}>
            Close Project
          </ContextMenuItem>
          <ContextMenuItem disabled>
            Open in New Window
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onCreateFile(id)}>
            New File
            <ContextMenuShortcut>⌘N</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCreateFolder(id)}>
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
          <ContextMenuItem onSelect={handleDelete} className="text-destructive">
            Delete Folder
          </ContextMenuItem>
        </ContextMenuContent>
      );
    }

    // Sub-folder menu
    return (
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={() => setOpen(!open)}>
          {open ? "Collapse" : "Expand"}
        </ContextMenuItem>
        <ContextMenuItem disabled>
          Open in New Window
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onCreateFile(id)}>
          New File
          <ContextMenuShortcut>⌘N</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onCreateFolder(id)}>
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
        <ContextMenuItem onSelect={handleDelete} className="text-destructive">
          Delete Folder
        </ContextMenuItem>
      </ContextMenuContent>
    );
  };

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
            <span className="text-[16px] leading-none text-[#52525b]">{open ? "▾" : "▸"}</span>
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
            className="flex-1 bg-transparent text-[13px] text-[#e4e4e7] font-medium outline-none caret-[#f57c00] border border-[#3f3f46] rounded-[4px] px-2 py-0.5"
          />
        </div>
        {open && (
          <div className="relative">
            <div
              className="absolute top-0 bottom-0 w-[1.5px] rounded-full"
              style={{
                left: `${togglePadding + (isRoot ? 3 : 7)}px`,
                backgroundColor: isRoot && hasActiveFile ? "#f57c00" : "#1c1c20",
                opacity: isRoot && hasActiveFile ? 0.45 : 1,
              }}
            />
            {children}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      className={`rounded-md transition-colors ${isHighlighted ? "bg-[#18181b]/60 ring-1 ring-[#1c1c20]" : ""}`}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={() => {
              setOpen(!open);
              onFolderSelect(id);
            }}
            className="w-full text-left flex items-center gap-2 py-1.5 pr-2 hover:text-[#e4e4e7] transition-colors cursor-pointer select-none"
            style={{ paddingLeft: `${togglePadding}px` }}
          >
            {isRoot ? (
              <span
                className="inline-block size-[7px] shrink-0 rounded-full transition-colors"
                style={{
                  backgroundColor: open ? dotColor : "transparent",
                  border: `1.5px solid ${dotColor}`,
                }}
              />
            ) : (
              <span className="text-[16px] leading-none text-[#52525b]">{open ? "▾" : "▸"}</span>
            )}
            <span className={`text-[13px] font-medium ${isRoot ? "text-[#e4e4e7]" : "text-[#a1a1aa]"}`}>{folderName}</span>
          </button>
        </ContextMenuTrigger>
        {renderContextMenu()}
      </ContextMenu>
      {open && (
        <div className="relative">
          <div
            className="absolute top-0 bottom-0 w-[1.5px] rounded-full"
            style={{
              left: `${togglePadding + (isRoot ? 3 : 7)}px`,
              backgroundColor: isRoot && hasActiveFile ? "#f57c00" : "#1c1c20",
              opacity: isRoot && hasActiveFile ? 0.45 : 1,
            }}
          />
          {children}
        </div>
      )}
    </div>
  );
}

function FileTree({
  entries,
  activeFile,
  selectedItem,
  activeDropFolder,
  onFileSelect,
  onFolderSelect,
  onFileRenamed,
  onFileDeleted,
  onCreateFile,
  onCreateFolder,
  onRefresh,
  newlyCreatedFile,
  onNewFileRenamed,
  depth,
  rootGuideX,
}: {
  entries: FileEntry[];
  activeFile: string | null;
  selectedItem: string | null;
  activeDropFolder: string | null;
  onFileSelect: (path: string) => void;
  onFolderSelect: (path: string) => void;
  onFileRenamed: (oldPath: string, newPath: string) => void;
  onFileDeleted: (path: string) => void;
  onCreateFile: (dir: string) => void;
  onCreateFolder: (dir: string) => void;
  onRefresh: () => void;
  newlyCreatedFile: string | null;
  onNewFileRenamed: () => void;
  depth: number;
  rootGuideX: number | null;
}) {
  return (
    <>
      {entries.map((entry) =>
        entry.is_directory ? (
          <DroppableFolder
            key={entry.path}
            id={entry.path}
            folderName={entry.name}
            activeDropFolder={activeDropFolder}
            onFolderSelect={onFolderSelect}
            onCreateFile={onCreateFile}
            onCreateFolder={onCreateFolder}
            onRefresh={onRefresh}
            depth={depth + 1}
          >
            <FileTree
              entries={entry.children ?? []}
              activeFile={activeFile}
              selectedItem={selectedItem}
              activeDropFolder={activeDropFolder}
              onFileSelect={onFileSelect}
              onFolderSelect={onFolderSelect}
              onFileRenamed={onFileRenamed}
              onFileDeleted={onFileDeleted}
              onCreateFile={onCreateFile}
              onCreateFolder={onCreateFolder}
              onRefresh={onRefresh}
              newlyCreatedFile={newlyCreatedFile}
              onNewFileRenamed={onNewFileRenamed}
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
          />
        )
      )}
    </>
  );
}
