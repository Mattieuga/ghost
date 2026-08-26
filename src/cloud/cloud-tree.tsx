import { FileText, Folder, LogOut, Plus, RefreshCw } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CloudItem, CloudItemKind } from "@/cloud/cloud-data";
import type { CloudTreeState } from "@/cloud/use-cloud-tree";

export function CloudTree({
  client,
  tree,
  selectedId,
  onSelectDocument,
  compact = false,
}: {
  client: SupabaseClient;
  tree: CloudTreeState;
  selectedId: string | null;
  onSelectDocument(item: CloudItem): void;
  compact?: boolean;
}) {
  const create = async (kind: CloudItemKind, parentId: string | null = null) => {
    const fallback = kind === "document" ? "Untitled.md" : "New Folder";
    const name = window.prompt(`Name this Cloud ${kind}:`, fallback)?.trim();
    if (!name) return;
    try {
      const item = await tree.create(kind, name, parentId);
      if (item.kind === "document") onSelectDocument(item);
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const roots = tree.items.filter((item) => item.parent_id === null);

  return (
    <section className={compact ? "border-b border-sidebar-border pb-2" : "flex h-full flex-col border-r border-border bg-sidebar"}>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ring">Cloud</span>
        <div className="flex items-center gap-1">
          <button type="button" className="rounded p-1 text-ring hover:text-foreground" title="New Cloud document" onClick={() => void create("document")}>
            <Plus className="size-3.5" />
          </button>
          <button type="button" className="rounded p-1 text-ring hover:text-foreground" title="New Cloud folder" onClick={() => void create("folder")}>
            <Folder className="size-3.5" />
          </button>
          <button type="button" className="rounded p-1 text-ring hover:text-foreground" title="Refresh Cloud" onClick={() => void tree.reload()}>
            <RefreshCw className="size-3.5" />
          </button>
          <button type="button" className="rounded p-1 text-ring hover:text-foreground" title="Sign out of Cloud" onClick={() => void client.auth.signOut()}>
            <LogOut className="size-3.5" />
          </button>
        </div>
      </div>

      {tree.loading ? <p className="px-3 py-2 text-xs text-ring">Loading Cloud…</p> : null}
      {tree.error ? <p className="px-3 py-2 text-xs leading-5 text-destructive">{tree.error}</p> : null}
      {!tree.loading && !tree.error && roots.length === 0 ? (
        <div className="px-3 pb-3 text-xs leading-5 text-ring">
          No Cloud documents yet. Use + to create one.
        </div>
      ) : null}
      <div className={compact ? "max-h-56 overflow-y-auto px-1" : "flex-1 overflow-y-auto px-1"}>
        {roots.map((item) => (
          <CloudTreeItem
            key={item.id}
            item={item}
            allItems={tree.items}
            selectedId={selectedId}
            onSelectDocument={onSelectDocument}
            onCreate={create}
            depth={0}
          />
        ))}
      </div>
    </section>
  );
}

function CloudTreeItem({
  item,
  allItems,
  selectedId,
  onSelectDocument,
  onCreate,
  depth,
}: {
  item: CloudItem;
  allItems: CloudItem[];
  selectedId: string | null;
  onSelectDocument(item: CloudItem): void;
  onCreate(kind: CloudItemKind, parentId: string | null): Promise<void>;
  depth: number;
}) {
  const children = allItems.filter((candidate) => candidate.parent_id === item.id);
  const Icon = item.kind === "folder" ? Folder : FileText;
  return (
    <div>
      <div
        className={`group flex h-7 items-center gap-1.5 rounded px-2 text-xs ${
          selectedId === item.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/60"
        }`}
        style={{ paddingLeft: `${8 + depth * 14}px` }}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => { if (item.kind === "document") onSelectDocument(item); }}
        >
          <Icon className="size-3.5 shrink-0" />
          <span className="truncate">{item.name}</span>
        </button>
        {item.kind === "folder" ? (
          <button
            type="button"
            className="invisible rounded p-0.5 text-ring group-hover:visible"
            title={`New document in ${item.name}`}
            onClick={() => void onCreate("document", item.id)}
          >
            <Plus className="size-3" />
          </button>
        ) : null}
      </div>
      {children.map((child) => (
        <CloudTreeItem
          key={child.id}
          item={child}
          allItems={allItems}
          selectedId={selectedId}
          onSelectDocument={onSelectDocument}
          onCreate={onCreate}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}
