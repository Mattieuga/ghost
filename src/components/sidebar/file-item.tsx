import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
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
import { Input } from "@/components/ui/input";
import { Pencil, Trash2 } from "lucide-react";
import type { FileEntry } from "@/types";

interface FileItemProps {
  entry: FileEntry;
  isActive: boolean;
  indent: number;
  onSelect: () => void;
  onDeleted?: () => void;
  onRenamed?: (newPath: string) => void;
}

export function FileItem({
  entry,
  isActive,
  indent,
  onSelect,
  onDeleted,
  onRenamed,
}: FileItemProps) {
  const [isRenaming, setIsRenaming] = useState(false);
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

  if (isRenaming) {
    return (
      <div className="pl-4 py-0.5">
        <Input
          ref={inputRef}
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleRename();
            if (e.key === "Escape") {
              setRenameName(entry.name);
              setIsRenaming(false);
            }
          }}
          className="h-6 text-xs px-1.5 bg-transparent border-sidebar-border"
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
            className={`mx-1.5 rounded-[5px] relative ${isActive ? "bg-[#18181b] active-file-indicator" : ""}`}
          >
          <button
            onClick={onSelect}
            className={`w-full text-left py-1 pr-2 text-[13px] truncate transition-colors cursor-pointer
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
        <ContextMenuContent>
          <ContextMenuItem
            onSelect={() => {
              setRenameName(displayName);
              setIsRenaming(true);
            }}
          >
            <Pencil className="size-4" />
            Rename
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => setShowDeleteDialog(true)}
            className="text-destructive"
          >
            <Trash2 className="size-4" />
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
