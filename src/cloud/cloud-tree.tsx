import { useEffect, useRef, useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import type { CloudItem, CloudItemKind } from "@/cloud/cloud-data";
import type { CloudTreeState } from "@/cloud/use-cloud-tree";
import { AppNotification } from "@/components/ui/app-notification";
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

export function CloudTree({
  tree,
  selectedId,
  onSelectDocument,
  onItemsDeleted,
  compact = false,
}: {
  tree: CloudTreeState;
  selectedId: string | null;
  onSelectDocument(item: CloudItem): void;
  onItemsDeleted?(itemIds: string[]): void;
  compact?: boolean;
}) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [pendingTrash, setPendingTrash] = useState<CloudItem | null>(null);
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

  const reportError = (reason: unknown) => {
    setNotification(reason instanceof Error ? reason.message : String(reason));
  };

  const startRename = (item: CloudItem) => {
    setRenameName(item.name);
    setRenameError(false);
    setRenamingId(item.id);
  };

  const finishRename = async (item: CloudItem) => {
    const nextName = renameName.trim();
    if (!nextName || nextName === item.name) {
      setRenamingId(null);
      return;
    }
    try {
      const renamed = await tree.rename(item.id, nextName);
      if (selectedId === item.id && renamed.kind === "document") onSelectDocument(renamed);
      setRenamingId(null);
    } catch (reason) {
      reportError(reason);
      setRenameError(true);
      setTimeout(() => setRenameError(false), 500);
      renameInputRef.current?.focus();
    }
  };

  const create = async (kind: CloudItemKind, parentId: string | null = null) => {
    const baseName = kind === "document" ? "Untitled" : "New Folder";
    for (let counter = 1; counter <= 100; counter += 1) {
      const numberedName = counter === 1 ? baseName : `${baseName} ${counter}`;
      const name = kind === "document" ? `${numberedName}.md` : numberedName;
      try {
        const item = await tree.create(kind, name, parentId);
        if (parentId) setExpandedFolders((current) => new Set(current).add(parentId));
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

  const duplicate = async (item: CloudItem) => {
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

  const roots = tree.items.filter((item) => item.parent_id === null);

  return (
    <section className={compact ? "border-b border-sidebar-border pb-2" : "flex h-full flex-col border-r border-border bg-sidebar"}>
      <div data-sidebar-chrome className="flex items-center justify-between px-4 pb-2 pt-1">
        <span className="text-[10px] font-medium uppercase text-ring" style={{ letterSpacing: "1.2px" }}>
          Cloud
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="cursor-pointer text-ring transition-colors hover:text-sidebar-foreground"
            title="New Cloud document"
            onClick={() => void create("document")}
          >
            <Plus className="size-3.5" />
          </button>
          <button
            type="button"
            className="cursor-pointer text-ring transition-colors hover:text-sidebar-foreground"
            title="Refresh Cloud"
            onClick={() => void tree.reload()}
          >
            <RefreshCw className={`size-3.5 ${tree.loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {tree.loading && tree.items.length === 0 ? (
        <p className="px-4 py-1 text-xs text-ring">Loading Cloud…</p>
      ) : null}
      {!tree.loading && roots.length === 0 ? (
        <div className="px-4 pb-3 text-xs leading-5 text-ring">No Cloud documents yet. Use + to create one.</div>
      ) : null}
      <div className={compact ? "max-h-56 overflow-y-auto" : "flex-1 overflow-y-auto"}>
        {roots.map((item) => (
          <CloudTreeItem
            key={item.id}
            item={item}
            allItems={tree.items}
            selectedId={selectedId}
            onSelectDocument={onSelectDocument}
            onCreate={create}
            onDuplicate={duplicate}
            onStartRename={startRename}
            onRequestTrash={setPendingTrash}
            expandedFolders={expandedFolders}
            setExpandedFolders={setExpandedFolders}
            renamingId={renamingId}
            renameName={renameName}
            setRenameName={setRenameName}
            renameError={renameError}
            renameInputRef={renameInputRef}
            onFinishRename={finishRename}
            onCancelRename={() => setRenamingId(null)}
            depth={0}
          />
        ))}
      </div>
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
      <AppNotification message={notification} onDismiss={() => setNotification(null)} />
    </section>
  );
}

interface CloudTreeItemProps {
  item: CloudItem;
  allItems: CloudItem[];
  selectedId: string | null;
  onSelectDocument(item: CloudItem): void;
  onCreate(kind: CloudItemKind, parentId: string | null): Promise<void>;
  onDuplicate(item: CloudItem): Promise<void>;
  onStartRename(item: CloudItem): void;
  onRequestTrash(item: CloudItem): void;
  expandedFolders: Set<string>;
  setExpandedFolders: React.Dispatch<React.SetStateAction<Set<string>>>;
  renamingId: string | null;
  renameName: string;
  setRenameName(name: string): void;
  renameError: boolean;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  onFinishRename(item: CloudItem): Promise<void>;
  onCancelRename(): void;
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
    expandedFolders,
    setExpandedFolders,
    renamingId,
    renameName,
    setRenameName,
    renameError,
    renameInputRef,
    onFinishRename,
    onCancelRename,
    depth,
  } = props;
  const children = allItems.filter((candidate) => candidate.parent_id === item.id);
  const expanded = item.kind === "folder" && expandedFolders.has(item.id);
  const toggle = () => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      return next;
    });
  };
  const createParentId = item.kind === "folder" ? item.id : item.parent_id;
  const menu = (
    <SidebarTreeContextMenu
      kind={item.kind === "document" ? "file" : "folder"}
      expanded={expanded}
      actions={{
        open: item.kind === "document" ? () => onSelectDocument(item) : undefined,
        toggle: item.kind === "folder" ? toggle : undefined,
        newFile: () => { void onCreate("document", createParentId); },
        newFolder: () => { void onCreate("folder", createParentId); },
        duplicate: () => { void onDuplicate(item); },
        rename: () => onStartRename(item),
        trash: () => onRequestTrash(item),
      }}
    />
  );
  const descendants = children.map((child) => (
    <CloudTreeItem key={child.id} {...props} item={child} depth={depth + 1} />
  ));

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
        onBlur={() => void onFinishRename(item)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void onFinishRename(item);
          }
          if (event.key === "Escape") {
            event.preventDefault();
            onCancelRename();
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
        label={item.name}
        indent={SIDEBAR_INDENT_BASE + depth * SIDEBAR_INDENT_STEP + SIDEBAR_FILE_EXTRA_INDENT}
        active={selectedId === item.id}
        onActivate={() => onSelectDocument(item)}
        menu={menu}
      />
    );
  }

  return (
    <SidebarFolderTreeItem
      label={item.name}
      depth={depth}
      expanded={expanded}
      onActivate={toggle}
      menu={menu}
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
