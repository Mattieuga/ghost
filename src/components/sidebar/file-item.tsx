import React, { useState, useRef, useEffect } from "react";
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
import { useIsActiveFile } from "./sidebar-context";
import { useFileTreeNode } from "./file-tree-keyboard";

interface FileItemProps {
  entry: FileEntry;
  projectPath: string;
  indent: number;
  onSelect: () => void;
  onDeleted?: () => void;
  onRenamed?: (newPath: string) => void | Promise<void>;
  onNewSibling?: () => void;
  onNewFolderSibling?: () => void;
  autoRename?: boolean;
  onAutoRenameDone?: () => void;
  onAddProject?: () => void;
  onDuplicated?: () => void;
  disableDnd?: boolean;
}

export const FileItem = React.memo(function FileItem({
  entry,
  projectPath,
  indent,
  onSelect,
  onDeleted,
  onRenamed,
  onNewSibling,
  onNewFolderSibling,
  autoRename,
  onAutoRenameDone,
  onAddProject,
  onDuplicated,
  disableDnd,
}: FileItemProps) {
  const isActive = useIsActiveFile(entry.path);
  const [isRenaming, setIsRenaming] = useState(false);
  const [displayName, setDisplayName] = useState(entry.name);
  const [renameName, setRenameName] = useState(entry.name);
  const [renameError, setRenameError] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const blurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const renameInFlightRef = useRef(false);
  const handleOpenInNewWindow = async () => {
    try {
      await window.__ghostFlushSave?.();
      await invoke("open_editor_window", { filePath: entry.path });
    } catch (err) {
      console.error("Failed to open editor window:", err);
    }
  };

  const parentDir = entry.path.substring(0, entry.path.lastIndexOf("/"));
  const occurrenceId = JSON.stringify([projectPath, entry.path]);

  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: disableDnd ? `disabled-drag:${occurrenceId}` : `file:${occurrenceId}`,
    data: { name: entry.name, path: entry.path, type: "file" },
    disabled: disableDnd,
  });

  const { setNodeRef: setDropRef } = useDroppable({
    id: disableDnd ? `disabled-drop:${occurrenceId}` : `file-drop:${occurrenceId}`,
    data: { folderPath: parentDir },
    disabled: disableDnd,
  });

  const setRefs = (el: HTMLElement | null) => {
    if (disableDnd) return;
    setDragRef(el);
    setDropRef(el);
  };

  useEffect(() => {
    setDisplayName(entry.name);
  }, [entry.name]);

  // Auto-enter rename mode for newly created files
  useEffect(() => {
    if (autoRename) {
      setRenameName(entry.name);
      setIsRenaming(true);
    }
  }, [autoRename]);

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
    if (renameInFlightRef.current) return;
    onAutoRenameDone?.();
    if (!renameName || renameName === entry.name) {
      renameInFlightRef.current = true;
      setIsRenaming(false);
      setRenameName(entry.name);
      requestAnimationFrame(() => {
        renameInFlightRef.current = false;
        void focusTreePath(entry.path, projectPath);
      });
      return;
    }
    renameInFlightRef.current = true;
    setDisplayName(renameName);
    setIsRenaming(false);
    try {
      await window.__ghostFlushSave?.();
      const newPath = await invoke<string>("rename_file", {
        oldPath: entry.path,
        newName: renameName,
      });
      await onRenamed?.(newPath);
      await focusTreePath(newPath, projectPath);
    } catch (err) {
      console.error("Failed to rename:", err);
      setDisplayName(entry.name);
      setIsRenaming(true);
      setRenameError(true);
      setTimeout(() => setRenameError(false), 500);
    } finally {
      renameInFlightRef.current = false;
    }
  };

  const handleDelete = async () => {
    try {
      await window.__ghostFlushSave?.();
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
      onDuplicated?.();
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

  const startRename = () => {
    setRenameName(displayName);
    setIsRenaming(true);
  };

  const handleCopyPath = async () => {
    try {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(entry.path);
    } catch (err) {
      console.error("Failed to copy path:", err);
    }
  };

  const handleCopyTextAs = async (format: "plain" | "markdown" | "rich") => {
    try {
      const { writeText, writeHtml } = await import("@tauri-apps/plugin-clipboard-manager");
      const content = await invoke<string>("read_file", { path: entry.path });

      if (format === "markdown") {
        await writeText(content);
      } else if (format === "plain") {
        const plainText = await invoke<string>("markdown_to_plain_text", { markdown: content });
        await writeText(plainText);
      } else {
        const html = await invoke<string>("markdown_to_html", { markdown: content });
        await writeHtml(html);
      }
    } catch (err) {
      console.error("Failed to copy text:", err);
    }
  };

  const { isFocused, nodeProps, restoreTreeFocus, focusTreePath } = useFileTreeNode({
    path: entry.path,
    projectPath,
    label: displayName,
    kind: "file",
    parentPath: parentDir,
    actions: {
      activate: onSelect,
      preview: onSelect,
      openNewWindow: handleOpenInNewWindow,
      rename: startRename,
      duplicate: handleDuplicate,
      trash: () => setShowDeleteDialog(true),
      copyPath: handleCopyPath,
      reveal: handleRevealInFinder,
      newFile: onNewSibling,
      newFolder: onNewFolderSibling,
    },
  });

  if (isRenaming) {
    return (
      <div className="py-0.5 pr-2" style={{ paddingLeft: `${indent}px` }}>
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          value={renameName}
          onChange={(e) => setRenameName(e.target.value)}
          onFocus={() => {
            if (blurTimeout.current) {
              clearTimeout(blurTimeout.current);
              blurTimeout.current = null;
            }
          }}
          onBlur={() => {
            if (!renameInFlightRef.current) {
              blurTimeout.current = setTimeout(() => void handleRename(), 50);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              if (blurTimeout.current) clearTimeout(blurTimeout.current);
              void handleRename();
            }
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              renameInFlightRef.current = true;
              onAutoRenameDone?.();
              setRenameName(entry.name);
              setIsRenaming(false);
              requestAnimationFrame(() => {
                renameInFlightRef.current = false;
                void focusTreePath(entry.path, projectPath);
              });
            }
          }}
          className={`w-full bg-transparent text-[13px] text-card-foreground outline-none caret-ghost-amber border rounded-[4px] px-2 py-1 transition-colors ${
            renameError ? "border-red-500 shake-error" : "border-ring"
          }`}
        />
      </div>
    );
  }

  return (
    <div
      ref={setRefs}
      {...listeners}
      {...attributes}
      {...nodeProps}
      aria-current={isActive ? "page" : undefined}
      style={{ opacity: isDragging ? 0.4 : 1, touchAction: "none" }}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            data-tree-focus-target
            data-file-active={isActive || undefined}
            className={`mx-1.5 rounded-[5px] relative ${isActive ? "bg-white/[0.06]" : "data-[state=open]:bg-white/[0.06]"} ${isFocused ? "ring-1 ring-ghost-amber/80 bg-ghost-amber/[0.07]" : ""}`}
          >
          {/* Guide line rendered by SidebarGuide overlay */}
          <button
            data-tree-label
            tabIndex={-1}
            onClick={() => {
              onSelect();
              requestAnimationFrame(restoreTreeFocus);
            }}
            onDoubleClick={handleOpenInNewWindow}
            className={`w-full text-left py-1 pr-2 text-[13px] truncate transition-colors cursor-pointer select-none
              ${isActive
                ? "text-card-foreground font-medium"
                : "text-sidebar-foreground hover:text-sidebar-primary"
              }`}
            style={{ paddingLeft: `${indent - 6}px` }}
          >
            {displayName}
          </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56" onCloseAutoFocus={(e) => e.preventDefault()}>
          <ContextMenuItem onSelect={onSelect} disabled={isActive}>
            Open File
          </ContextMenuItem>
          <ContextMenuItem onSelect={handleOpenInNewWindow}>
            Open File in New Window
          </ContextMenuItem>
          <ContextMenuItem onSelect={onAddProject}>
            Open New Project
            <ContextMenuShortcut>⌘O</ContextMenuShortcut>
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
            onSelect={startRename}
          >
            Rename...
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            onSelect={() => setShowDeleteDialog(true)}
            className="text-destructive"
          >
            Move to Trash
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent onKeyDown={(e) => { if (e.key === "Enter") handleDelete(); }}>
          <DialogHeader>
            <DialogTitle>Move file to Trash?</DialogTitle>
            <DialogDescription>
              “{displayName}” can be recovered from the macOS Trash.
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
              Move to Trash
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
// Callbacks are excluded: they are inline closures but always derive from
// stable useCallback refs or the entry path (which IS compared). Adding
// new callbacks that close over mutable unrelated state would need to be
// included here.
}, (prev, next) =>
  prev.entry.path === next.entry.path &&
  prev.entry.name === next.entry.name &&
  prev.projectPath === next.projectPath &&
  prev.indent === next.indent &&
  prev.autoRename === next.autoRename &&
  prev.onDuplicated === next.onDuplicated &&
  prev.disableDnd === next.disableDnd
);
