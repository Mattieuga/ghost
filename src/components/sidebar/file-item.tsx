import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
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
import type { FileEntry } from "@/types";

interface FileItemProps {
  entry: FileEntry;
  isActive: boolean;
  indent: number;
  onSelect: () => void;
  onDeleted?: () => void;
  onRenamed?: (newPath: string) => void;
  onNewSibling?: () => void;
  onNewFolderSibling?: () => void;
  autoRename?: boolean;
  onAutoRenameDone?: () => void;
  rootGuideX?: number | null;
}

export function FileItem({
  entry,
  isActive,
  indent,
  onSelect,
  onDeleted,
  onRenamed,
  onNewSibling,
  onNewFolderSibling,
  autoRename,
  onAutoRenameDone,
  rootGuideX,
}: FileItemProps) {
  const [isRenaming, setIsRenaming] = useState(!!autoRename);
  const [displayName, setDisplayName] = useState(entry.name);
  const [renameName, setRenameName] = useState(entry.name);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const parentDir = entry.path.substring(0, entry.path.lastIndexOf("/"));

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: entry.path,
    data: { name: entry.name, path: entry.path, type: "file" },
  });

  const { setNodeRef: setDropRef } = useDroppable({
    id: `file-drop:${entry.path}`,
    data: { folderPath: parentDir },
  });

  const setRefs = (el: HTMLElement | null) => {
    setDragRef(el);
    setDropRef(el);
  };

  useEffect(() => {
    setDisplayName(entry.name);
  }, [entry.name]);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
      const dotIndex = renameName.lastIndexOf(".");
      if (dotIndex > 0) {
        inputRef.current.setSelectionRange(0, dotIndex);
      } else {
        inputRef.current.select();
      }
    }
  }, [isRenaming]);

  const handleRename = async () => {
    onAutoRenameDone?.();
    if (!renameName || renameName === entry.name) {
      setIsRenaming(false);
      setRenameName(entry.name);
      return;
    }
    setDisplayName(renameName);
    setIsRenaming(false);
    try {
      const newPath = await invoke<string>("rename_file", {
        oldPath: entry.path,
        newName: renameName,
      });
      onRenamed?.(newPath);
    } catch (err) {
      console.error("Failed to rename:", err);
      setDisplayName(entry.name);
      setRenameName(entry.name);
    }
  };

  const handleDelete = async () => {
    try {
      await invoke("delete_file", { path: entry.path });
      setShowDeleteDialog(false);
      onDeleted?.();
    } catch (err) {
      console.error("Failed to delete:", err);
    }
  };

  const handleDuplicate = async () => {
    try {
      await invoke<string>("duplicate_file", { path: entry.path });
    } catch (err) {
      console.error("Failed to duplicate:", err);
    }
  };

  const handleRevealInFinder = async () => {
    try {
      await invoke("reveal_in_finder", { path: entry.path });
    } catch (err) {
      console.error("Failed to reveal:", err);
    }
  };

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(entry.path);
    } catch (err) {
      console.error("Failed to copy path:", err);
    }
  };

  const handleCopyTextAs = async (format: "plain" | "markdown" | "rich") => {
    try {
      const content = await invoke<string>("read_file", { path: entry.path });
      if (format === "plain" || format === "markdown") {
        await navigator.clipboard.writeText(content);
      } else {
        // Rich text — write as HTML
        const blob = new Blob([content], { type: "text/html" });
        await navigator.clipboard.write([
          new ClipboardItem({ "text/html": blob, "text/plain": new Blob([content], { type: "text/plain" }) }),
        ]);
      }
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  if (isRenaming) {
    return (
      <div className="py-0.5 pr-2" style={{ paddingLeft: `${indent}px` }}>
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") {
              setRenameName(entry.name);
              setIsRenaming(false);
              onAutoRenameDone?.();
            }
          }}
          className="w-full bg-transparent text-[13px] text-[#e4e4e7] outline-none caret-[#f57c00] border border-[#3f3f46] rounded-[4px] px-2 py-1"
        />
      </div>
    );
  }

  return (
    <div
      ref={setRefs}
      {...listeners}
      {...attributes}
      style={{ opacity: isDragging ? 0.4 : 1, touchAction: "none" }}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={`mx-1.5 rounded-[5px] relative ${isActive ? "bg-white/[0.06]" : ""}`}
          >
          {isActive && rootGuideX != null && (
            <div
              className="absolute top-0 bottom-0 w-[1.5px] rounded-full"
              style={{ left: `${rootGuideX - 6}px`, backgroundColor: "#f57c00" }}
            />
          )}
          <button
            onClick={onSelect}
            className={`w-full text-left py-1 pr-2 text-[13px] truncate transition-colors cursor-pointer select-none
              ${isActive
                ? "text-[#e4e4e7] font-medium"
                : "text-[#71717a] hover:text-[#a1a1aa]"
              }`}
            style={{ paddingLeft: `${indent - 6}px` }}
          >
            {displayName}
          </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuItem onSelect={onSelect} disabled={isActive}>
            Open File
          </ContextMenuItem>
          <ContextMenuItem disabled>
            Open File in New Window
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={onNewSibling}>
            New File
            <ContextMenuShortcut>⌘N</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem onSelect={onNewFolderSibling}>
            New Folder
            <ContextMenuShortcut>⇧⌘N</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => handleCopyPath()}>
            Copy File
            <ContextMenuShortcut>⌘C</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>Copy Text As</ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem onSelect={() => handleCopyTextAs("plain")}>
                Plain Text
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => handleCopyTextAs("markdown")}>
                Markdown
              </ContextMenuItem>
              <ContextMenuItem onSelect={() => handleCopyTextAs("rich")}>
                Rich Text
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
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
          <ContextMenuItem
            onSelect={() => {
              setRenameName(displayName);
              setIsRenaming(true);
            }}
          >
            Rename...
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => setShowDeleteDialog(true)}
            className="text-destructive"
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete file</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{displayName}"? This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowDeleteDialog(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
