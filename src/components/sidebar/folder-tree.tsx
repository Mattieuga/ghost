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

// Indentation: folders get toggle at INDENT_BASE + depth * INDENT_STEP,
// files get INDENT_BASE + depth * INDENT_STEP + FILE_EXTRA
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
        newlyCreatedFile={newlyCreatedFile}
        onNewFileRenamed={onNewFileRenamed}
        depth={0}
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
  defaultOpen?: boolean;
  depth: number;
  isRoot?: boolean;
  hasActiveFile?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isHighlighted = activeDropFolder === id;
  const { setNodeRef } = useDroppable({
    id: `folder:${id}`,
    data: { folderPath: id },
  });

  const togglePadding = INDENT_BASE + depth * INDENT_STEP;

  // Root folders: dot indicator (filled = open, outline = collapsed)
  // Dot color: amber if has active file, muted otherwise
  const dotColor = isRoot && hasActiveFile ? "#f57c00" : "#52525b";

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
            className="w-full text-left flex items-center gap-2 py-1.5 pr-2 hover:text-[#e4e4e7] transition-colors cursor-pointer"
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
      {open && (
        <div className="relative">
          {/* Vertical guide line */}
          <div
            className="absolute top-0 bottom-0 w-[1.5px] rounded-full"
            style={{
              left: `${togglePadding + (isRoot ? 3 : 7)}px`,
              backgroundColor: isRoot && hasActiveFile ? "#f57c00" : "#1c1c20",
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
  newlyCreatedFile,
  onNewFileRenamed,
  depth,
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
  newlyCreatedFile: string | null;
  onNewFileRenamed: () => void;
  depth: number;
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
              newlyCreatedFile={newlyCreatedFile}
              onNewFileRenamed={onNewFileRenamed}
              depth={depth + 1}
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
            indent={INDENT_BASE + (depth + 1) * INDENT_STEP + FILE_EXTRA}
            autoRename={entry.path === newlyCreatedFile}
            onAutoRenameDone={onNewFileRenamed}
          />
        )
      )}
    </>
  );
}
