import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { cloudItemPath, type CloudItem, type CloudItemKind } from "@/cloud/cloud-data";
import type { VisibleCloudItem } from "@/cloud/cloud-sharing";
import type { CloudTreeState } from "@/cloud/use-cloud-tree";
import { AppNotification } from "@/components/ui/app-notification";
import { FileTreeKeyboard, useFileTreeNode } from "@/components/sidebar/file-tree-keyboard";
import { SidebarMutedRow, SidebarSectionHeader } from "@/components/sidebar/sidebar-section-header";
import { SidebarTrashDialog } from "@/components/sidebar/sidebar-trash-dialog";
import {
  SIDEBAR_FILE_EXTRA_INDENT,
  SIDEBAR_INDENT_BASE,
  SIDEBAR_INDENT_STEP,
  SidebarFileTreeItem,
  SidebarFolderTreeItem,
  SidebarTreeContextMenu,
  SidebarTreeRenameItem,
} from "@/components/sidebar/sidebar-tree-item";

/**
 * The web sidebar: the synced roots this account owns under "Cloud", and
 * what other people shared under "Shared". Guests see only the second.
 */
export function CloudTree({
  tree,
  selectedId,
  onSelectDocument,
  onItemsDeleted,
  onFocusEditor = focusCloudEditor,
  accountLabel,
  onSignOut,
}: {
  tree: CloudTreeState;
  selectedId: string | null;
  onSelectDocument(item: VisibleCloudItem): void;
  onItemsDeleted?(itemIds: string[]): void;
  onFocusEditor?: () => void;
  accountLabel?: string | null;
  onSignOut?: () => void;
}) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [pendingTrash, setPendingTrash] = useState<VisibleCloudItem | null>(null);
  const [pendingLeave, setPendingLeave] = useState<VisibleCloudItem | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNotification(tree.error);
  }, [tree.error]);

  useEffect(() => {
    if (!renamingId || !renameInputRef.current) return;
    renameInputRef.current.focus();
    const dotIndex = renameName.lastIndexOf(".");
    if (dotIndex > 0) renameInputRef.current.setSelectionRange(0, dotIndex);
    else renameInputRef.current.select();
  }, [renamingId]);

  // Synced roots start open: they are the whole point of the page.
  useEffect(() => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      for (const root of tree.roots) next.add(root.id);
      return next;
    });
  }, [tree.roots]);

  const reportError = (reason: unknown) => {
    setNotification(reason instanceof Error ? reason.message : String(reason));
  };

  const startRename = (item: VisibleCloudItem) => {
    setRenameName(item.name);
    setRenameError(false);
    setRenamingId(item.id);
  };

  const finishRename = async (item: VisibleCloudItem): Promise<boolean> => {
    const nextName = renameName.trim();
    if (!nextName || nextName === item.name) {
      setRenamingId(null);
      return true;
    }
    try {
      const renamed = await tree.rename(item.id, nextName);
      if (selectedId === item.id && renamed.kind === "document") onSelectDocument(renamed);
      setRenamingId(null);
      return true;
    } catch (reason) {
      reportError(reason);
      setRenameError(true);
      setTimeout(() => setRenameError(false), 500);
      renameInputRef.current?.focus();
      return false;
    }
  };

  const create = async (kind: CloudItemKind, parentId: string | null = null) => {
    const baseName = kind === "document" ? "Untitled" : "New Folder";
    for (let counter = 1; counter <= 100; counter += 1) {
      const numberedName = counter === 1 ? baseName : `${baseName} ${counter}`;
      const name = kind === "document" ? `${numberedName}.md` : numberedName;
      try {
        const item = await tree.create(kind, name, parentId);
        if (item.parent_id) setExpandedFolders((current) => new Set(current).add(item.parent_id as string));
        startRename(item);
        if (item.kind === "document") onSelectDocument(item);
        return;
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        if (!message.includes("already exists")) {
          reportError(reason);
          return;
        }
      }
    }
    setNotification(`Could not choose a name for the new Cloud ${kind}.`);
  };

  const duplicate = async (item: VisibleCloudItem) => {
    try {
      await tree.duplicate(item.id);
    } catch (reason) {
      reportError(reason);
    }
  };

  const confirmTrash = async () => {
    if (!pendingTrash) return;
    const removedIds = collectDescendantIds(tree.items, pendingTrash.id);
    try {
      await tree.trash(pendingTrash.id);
      onItemsDeleted?.(removedIds);
      setPendingTrash(null);
    } catch (reason) {
      reportError(reason);
    }
  };

  const confirmLeave = async () => {
    if (!pendingLeave) return;
    const removedIds = collectDescendantIds(tree.items, pendingLeave.id);
    try {
      await tree.leave(pendingLeave.id);
      onItemsDeleted?.(removedIds);
      setPendingLeave(null);
    } catch (reason) {
      reportError(reason);
    }
  };

  const projectPath = `cloud/${tree.workspace?.id ?? "workspace"}`;
  const selectedItem = selectedId ? tree.items.find((item) => item.id === selectedId) : null;
  const activePath = selectedItem ? cloudTreeNodePath(tree.items, selectedItem, projectPath) : null;
  const itemProps = {
    allItems: tree.items,
    selectedId,
    onSelectDocument,
    onCreate: create,
    onDuplicate: duplicate,
    onStartRename: startRename,
    onRequestTrash: setPendingTrash,
    onRequestLeave: setPendingLeave,
    expandedFolders,
    setExpandedFolders,
    renamingId,
    renameName,
    setRenameName,
    renameError,
    renameInputRef,
    onFinishRename: finishRename,
    onCancelRename: () => setRenamingId(null),
    projectPath,
  };

  return (
    <section className="flex h-full flex-col border-r border-border bg-sidebar">
      <div data-sidebar-chrome className="flex items-center justify-between px-4 pb-2 pt-1">
        <span className="text-[10px] font-medium uppercase text-ring" style={{ letterSpacing: "1.2px" }}>
          Ghost
        </span>
        <div className="flex items-center gap-2">
          {!tree.guest ? (
            <button
              type="button"
              className="cursor-pointer text-[16px] leading-none text-ring transition-colors hover:text-sidebar-foreground"
              title="New note in Notes"
              onClick={() => void create("document")}
            >
              +
            </button>
          ) : null}
          <button
            type="button"
            className="cursor-pointer text-ring transition-colors hover:text-sidebar-foreground"
            title="Refresh"
            onClick={() => void tree.reload()}
          >
            <RefreshCw className={`size-3.5 ${tree.loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {tree.loading && tree.items.length === 0 ? (
        <p className="px-4 py-1 text-xs text-ring">Loading Cloud…</p>
      ) : null}
      <FileTreeKeyboard
        activePath={activePath}
        ariaLabel="Cloud documents"
        onFocusEditor={onFocusEditor}
        className="flex-1 overflow-y-auto px-1 outline-none"
      >
        {!tree.guest ? (
          <div data-cloud-section="cloud">
            <SidebarSectionHeader label="Cloud" />
            {!tree.loading && tree.roots.length === 0 ? (
              <SidebarMutedRow>Nothing in Cloud yet. Sync a folder from your Mac, or press + to start Notes.</SidebarMutedRow>
            ) : null}
            {tree.roots.map((item) => (
              <CloudTreeItem key={item.id} {...itemProps} item={item} depth={0} />
            ))}
          </div>
        ) : null}
        {tree.shared.length > 0 || tree.guest ? (
          <div data-cloud-section="shared">
            <SidebarSectionHeader label="Shared" />
            {tree.shared.length === 0 && !tree.loading ? (
              <SidebarMutedRow>Notes people share with you appear here.</SidebarMutedRow>
            ) : null}
            {tree.shared.map((item) => (
              <CloudTreeItem key={item.id} {...itemProps} item={item} depth={0} />
            ))}
          </div>
        ) : null}
      </FileTreeKeyboard>
      {accountLabel ? (
        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2 text-[11px] text-ring">
          <span className="truncate" title={accountLabel}>{accountLabel}</span>
          {onSignOut ? (
            <button type="button" className="cursor-pointer hover:text-sidebar-foreground" onClick={onSignOut}>
              {tree.guest ? "Sign in" : "Sign out"}
            </button>
          ) : null}
        </div>
      ) : null}
      <SidebarTrashDialog
        open={pendingTrash !== null}
        kind={pendingTrash?.kind === "folder" ? "folder" : "file"}
        name={pendingTrash?.name ?? ""}
        description={pendingTrash
          ? `“${pendingTrash.name}”${pendingTrash.kind === "folder" ? " and its contents" : ""} will be removed from Cloud.`
          : ""}
        onOpenChange={(open) => { if (!open) setPendingTrash(null); }}
        onConfirm={() => void confirmTrash()}
      />
      <SidebarTrashDialog
        open={pendingLeave !== null}
        kind={pendingLeave?.kind === "folder" ? "folder" : "file"}
        name={pendingLeave?.name ?? ""}
        title={pendingLeave ? `Leave “${pendingLeave.name}”?` : ""}
        description={pendingLeave
          ? `You will no longer see it. ${pendingLeave.shared_by ?? "The owner"} keeps it and can share it again.`
          : ""}
        confirmLabel="Leave"
        onOpenChange={(open) => { if (!open) setPendingLeave(null); }}
        onConfirm={() => void confirmLeave()}
      />
      <AppNotification message={notification} onDismiss={() => setNotification(null)} />
    </section>
  );
}

interface CloudTreeItemProps {
  item: VisibleCloudItem;
  allItems: VisibleCloudItem[];
  selectedId: string | null;
  onSelectDocument(item: VisibleCloudItem): void;
  onCreate(kind: CloudItemKind, parentId: string | null): Promise<void>;
  onDuplicate(item: VisibleCloudItem): Promise<void>;
  onStartRename(item: VisibleCloudItem): void;
  onRequestTrash(item: VisibleCloudItem): void;
  onRequestLeave(item: VisibleCloudItem): void;
  expandedFolders: Set<string>;
  setExpandedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  renamingId: string | null;
  renameName: string;
  setRenameName(name: string): void;
  renameError: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onFinishRename(item: VisibleCloudItem): Promise<boolean>;
  onCancelRename(): void;
  projectPath: string;
  depth: number;
}

function CloudTreeItem(props: CloudTreeItemProps) {
  const {
    item,
    allItems,
    selectedId,
    onSelectDocument,
    onCreate,
    onDuplicate,
    onStartRename,
    onRequestTrash,
    onRequestLeave,
    expandedFolders,
    setExpandedFolders,
    renamingId,
    renameName,
    setRenameName,
    renameError,
    renameInputRef,
    onFinishRename,
    onCancelRename,
    projectPath,
    depth,
  } = props;
  const children = allItems.filter((candidate) => candidate.parent_id === item.id);
  const expanded = item.kind === "folder" && expandedFolders.has(item.id);
  const canEdit = item.access_role !== "viewer";
  const isSharedRoot = item.shared_root_id === item.id;
  // A synced root is renamed from the Mac; its name is the folder's name.
  const canRename = canEdit && !(item.parent_id === null && item.root_kind !== null);
  const toggle = () => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };
  const createParentId = item.kind === "folder" ? item.id : item.parent_id;
  // Creating inside a shared folder is fine for an editor; making a sibling
  // of a shared root is not, because that parent belongs to someone else.
  const canCreateInside = item.kind === "folder" ? canEdit : canEdit && !isSharedRoot;
  const canDuplicate = canEdit && !isSharedRoot;
  const nodePath = cloudTreeNodePath(allItems, item, projectPath);
  const parentItem = item.parent_id
    ? allItems.find((candidate) => candidate.id === item.parent_id) ?? null
    : null;
  const parentPath = parentItem ? cloudTreeNodePath(allItems, parentItem, projectPath) : null;
  const containsSelected = selectedId
    ? collectDescendantIds(allItems, item.id).includes(selectedId)
    : false;
  const { isFocused, nodeProps, restoreTreeFocus, focusTreePath } = useFileTreeNode({
    path: nodePath,
    projectPath,
    label: item.name,
    kind: item.kind === "document" ? "file" : "folder",
    parentPath,
    expanded,
    expand: item.kind === "folder" ? () => {
      if (!expanded) toggle();
    } : undefined,
    collapse: item.kind === "folder" ? () => {
      if (expanded) toggle();
    } : undefined,
    actions: {
      activate: item.kind === "document" ? () => onSelectDocument(item) : toggle,
      preview: item.kind === "document" ? () => onSelectDocument(item) : undefined,
      rename: canRename ? () => onStartRename(item) : undefined,
      duplicate: canDuplicate ? () => onDuplicate(item) : undefined,
      trash: isSharedRoot ? () => onRequestLeave(item) : canEdit ? () => onRequestTrash(item) : undefined,
      newFile: canCreateInside ? () => onCreate("document", createParentId) : undefined,
      newFolder: canCreateInside ? () => onCreate("folder", createParentId) : undefined,
    },
  });
  const restoreAfterRename = async () => {
    if (await onFinishRename(item)) {
      requestAnimationFrame(() => { void focusTreePath(nodePath, projectPath); });
    }
  };
  const cancelRename = () => {
    onCancelRename();
    requestAnimationFrame(() => { void focusTreePath(nodePath, projectPath); });
  };
  const menu = (
    <SidebarTreeContextMenu
      kind={item.kind === "document" ? "file" : "folder"}
      expanded={expanded}
      actions={{
        open: item.kind === "document" ? () => onSelectDocument(item) : undefined,
        toggle: item.kind === "folder" ? toggle : undefined,
        newFile: canCreateInside ? () => { void onCreate("document", createParentId); } : undefined,
        newFolder: canCreateInside ? () => { void onCreate("folder", createParentId); } : undefined,
        duplicate: canDuplicate ? () => { void onDuplicate(item); } : undefined,
        rename: canRename ? () => onStartRename(item) : undefined,
        trash: canEdit && !isSharedRoot ? () => onRequestTrash(item) : undefined,
        leave: isSharedRoot ? () => onRequestLeave(item) : undefined,
      }}
    />
  );
  const descendants = children.map((child) => (
    <CloudTreeItem key={child.id} {...props} item={child} depth={depth + 1} />
  ));
  const label = isSharedRoot && item.shared_by ? `${item.name}` : item.name;

  if (renamingId === item.id) {
    return (
      <SidebarTreeRenameItem
        kind={item.kind === "document" ? "file" : "folder"}
        indent={SIDEBAR_INDENT_BASE + depth * SIDEBAR_INDENT_STEP + SIDEBAR_FILE_EXTRA_INDENT}
        depth={depth}
        expanded={expanded}
        inputRef={renameInputRef}
        value={renameName}
        onChange={(event) => setRenameName(event.target.value)}
        isRoot={item.kind === "folder" && depth === 0}
        dotColor={containsSelected ? "var(--ghost-amber)" : "var(--muted-foreground)"}
        onBlur={() => void restoreAfterRename()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void restoreAfterRename();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            cancelRename();
          }
        }}
        error={renameError}
      >
        {descendants}
      </SidebarTreeRenameItem>
    );
  }

  if (item.kind === "document") {
    return (
      <SidebarFileTreeItem
        label={label}
        indent={SIDEBAR_INDENT_BASE + depth * SIDEBAR_INDENT_STEP + SIDEBAR_FILE_EXTRA_INDENT}
        active={selectedId === item.id}
        focused={isFocused}
        onActivate={() => {
          onSelectDocument(item);
          requestAnimationFrame(restoreTreeFocus);
        }}
        menu={menu}
        containerProps={{
          ...nodeProps,
          title: isSharedRoot && item.shared_by ? `Shared by ${item.shared_by}` : undefined,
        }}
      />
    );
  }

  return (
    <SidebarFolderTreeItem
      label={label}
      depth={depth}
      expanded={expanded}
      isRoot={depth === 0}
      rootId={nodePath}
      active={depth > 0 && !expanded && containsSelected}
      focused={isFocused}
      activeRootCollapsed={depth === 0 && !expanded && containsSelected}
      dotColor={containsSelected ? "var(--ghost-amber)" : "var(--muted-foreground)"}
      onActivate={() => {
        toggle();
        requestAnimationFrame(restoreTreeFocus);
      }}
      menu={menu}
      containerProps={{
        ...nodeProps,
        title: isSharedRoot && item.shared_by ? `Shared by ${item.shared_by}` : undefined,
      }}
    >
      {descendants}
    </SidebarFolderTreeItem>
  );
}

function collectDescendantIds(items: CloudItem[], rootId: string): string[] {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (item.parent_id && ids.has(item.parent_id) && !ids.has(item.id)) {
        ids.add(item.id);
        changed = true;
      }
    }
  }
  return Array.from(ids);
}

function cloudTreeNodePath(items: CloudItem[], item: CloudItem, projectPath: string): string {
  return `${projectPath}/${cloudItemPath(items, item).map((ancestor) => ancestor.id).join("/")}`;
}

function focusCloudEditor() {
  document.querySelector<HTMLElement>("[data-ghost-editor-root] [contenteditable=true]")?.focus();
}
