import React, { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { FileEntry } from "@/types";
import { useIsActiveFile } from "./sidebar-context";
import { useFileTreeNode } from "./file-tree-keyboard";
import { SidebarTrashDialog } from "./sidebar-trash-dialog";
import {
  SidebarFileTreeItem,
  SidebarTreeContextMenu,
  SidebarTreeRenameItem,
} from "./sidebar-tree-item";

interface FileItemProps {
  entry: FileEntry;
  projectPath: string;
  indent: number;
  onSelect: () => void | boolean | Promise<void | boolean>;
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
    if (!renameName || renameName === entry.name) {
      renameInFlightRef.current = true;
      onAutoRenameDone?.();
      setIsRenaming(false);
      setRenameName(entry.name);
      requestAnimationFrame(() => {
        renameInFlightRef.current = false;
        void focusTreePath(entry.path, projectPath);
      });
      return;
    }
    renameInFlightRef.current = true;
    try {
      await window.__ghostFlushSave?.();
      const newPath = await invoke<string>("rename_file", {
        oldPath: entry.path,
        newName: renameName,
      });
      onAutoRenameDone?.();
      const renamed = onRenamed?.(newPath);
      setDisplayName(renameName);
      setIsRenaming(false);
      requestAnimationFrame(() => void focusTreePath(newPath, projectPath));
      await renamed;
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
      window.alert(`Ghost couldn't copy this file as text. ${err instanceof Error ? err.message : String(err)}`);
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
      <SidebarTreeRenameItem
        kind="file"
        indent={indent}
        inputRef={inputRef as React.RefObject<HTMLInputElement>}
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
        error={renameError}
      />
    );
  }

  return (
    <>
      <SidebarFileTreeItem
        label={displayName}
        indent={indent}
        active={isActive}
        focused={isFocused}
        onActivate={() => {
          onSelect();
          requestAnimationFrame(restoreTreeFocus);
        }}
        onDoubleClick={handleOpenInNewWindow}
        containerRef={setRefs}
        containerProps={{
          ...listeners,
          ...attributes,
          ...nodeProps,
          "aria-current": isActive ? "page" : undefined,
          style: { opacity: isDragging ? 0.4 : 1, touchAction: "none" },
        }}
        menu={(
          <SidebarTreeContextMenu
            kind="file"
            actions={{
              open: () => { void onSelect(); },
              openNewWindow: () => { void handleOpenInNewWindow(); },
              openNewProject: onAddProject,
              newFile: onNewSibling,
              newFolder: onNewFolderSibling,
              copy: () => { void handleCopyPath(); },
              copyTextAs: (format) => { void handleCopyTextAs(format); },
              reveal: () => { void handleRevealInFinder(); },
              copyPath: () => { void handleCopyPath(); },
              duplicate: () => { void handleDuplicate(); },
              rename: startRename,
              trash: () => setShowDeleteDialog(true),
            }}
          />
        )}
      />

      <SidebarTrashDialog
        open={showDeleteDialog}
        kind="file"
        name={displayName}
        onOpenChange={setShowDeleteDialog}
        onConfirm={() => void handleDelete()}
      />
    </>
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
