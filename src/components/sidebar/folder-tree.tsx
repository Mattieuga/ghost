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
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { FolderMinus, FilePlus, FolderPlus } from "lucide-react";
import { useMemo, useState, useCallback } from "react";

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
      <div className="px-3 py-1 text-xs text-destructive truncate">
        {folderName}
      </div>
    );
  }

  return (
    <DroppableFolder
      id={path}
      folderName={folderName}
      activeDropFolder={activeDropFolder}
      onFolderSelect={onFolderSelect}
      onRemoveFolder={onRemoveFolder}
      onCreateFile={handleCreateFile}
      onCreateFolder={handleCreateFolder}
      defaultOpen={true}
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
  defaultOpen = false,
  children,
}: {
  id: string;
  folderName: string;
  activeDropFolder: string | null;
  onFolderSelect: (path: string) => void;
  onRemoveFolder?: (path: string) => void;
  onCreateFile: (dir: string) => void;
  onCreateFolder: (dir: string) => void;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isHighlighted = activeDropFolder === id;
  const { setNodeRef } = useDroppable({
    id: `folder:${id}`,
    data: { folderPath: id },
  });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-md transition-colors ${isHighlighted ? "bg-sidebar-accent/60 ring-1 ring-sidebar-border" : ""}`}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button
            onClick={() => {
              setOpen(!open);
              onFolderSelect(id);
            }}
            className="w-full text-left flex items-center gap-1.5 px-3 py-1 text-[13px] text-sidebar-foreground hover:text-sidebar-primary transition-colors"
          >
            <span className="text-[10px] leading-none opacity-50">{open ? ">" : ">"}</span>
            <span className={open ? "" : ""}>{folderName}</span>
          </button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={() => onCreateFile(id)}>
            <FilePlus className="size-4" />
            New File
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCreateFolder(id)}>
            <FolderPlus className="size-4" />
            New Folder
          </ContextMenuItem>
          {onRemoveFolder && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => onRemoveFolder(id)}>
                <FolderMinus className="size-4" />
                Remove Folder
              </ContextMenuItem>
            </>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {open && <div className="ml-1">{children}</div>}
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
          />
        )
      )}
    </>
  );
}
