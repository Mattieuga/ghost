import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  createCloudItem,
  duplicateCloudItem,
  ensureCloudWorkspace,
  listCloudItems,
  renameCloudItem,
  trashCloudItem,
  type CloudItem,
  type CloudItemKind,
  type CloudWorkspace,
} from "@/cloud/cloud-data";
import {
  acceptCloudInvitations,
  isMissingSharingFunction,
  leaveCloudItem,
  listVisibleCloudItems,
  type VisibleCloudItem,
} from "@/cloud/cloud-sharing";

/**
 * The web sidebar's model: everything the account can see, split into the
 * synced roots it owns and the items shared with it. Guests see only the
 * shared half.
 */
export interface CloudTreeState {
  workspace: CloudWorkspace | null;
  items: VisibleCloudItem[];
  /** Own synced roots at the top level, Notes first. */
  roots: VisibleCloudItem[];
  /** Items shared with the account, each the top of its own subtree. */
  shared: VisibleCloudItem[];
  notesRootId: string | null;
  guest: boolean;
  loading: boolean;
  error: string | null;
  /** Create inside a folder; with no parent, inside Notes, creating Notes first if needed. */
  create(kind: CloudItemKind, name: string, parentId?: string | null): Promise<VisibleCloudItem>;
  rename(itemId: string, name: string): Promise<VisibleCloudItem>;
  duplicate(itemId: string): Promise<CloudItem>;
  trash(itemId: string): Promise<void>;
  leave(itemId: string): Promise<void>;
  reload(): Promise<void>;
}

function isGuest(user: User | null): boolean {
  return Boolean(user && (user as User & { is_anonymous?: boolean }).is_anonymous);
}

function asVisible(item: CloudItem, parent: VisibleCloudItem | undefined): VisibleCloudItem {
  const withRoot = item as CloudItem & { root_kind?: "notes" | "folder" | null };
  return {
    ...item,
    root_kind: withRoot.root_kind ?? null,
    access_role: parent?.access_role ?? "owner",
    shared_root_id: parent?.shared_root_id ?? null,
    shared_by: parent?.shared_by ?? null,
    shared_out: false,
  };
}

function withoutSubtree(items: VisibleCloudItem[], rootId: string): VisibleCloudItem[] {
  const removed = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (item.parent_id && removed.has(item.parent_id) && !removed.has(item.id)) {
        removed.add(item.id);
        changed = true;
      }
    }
  }
  return items.filter((item) => !removed.has(item.id));
}

export function useCloudTree(client: SupabaseClient | null, user: User | null): CloudTreeState {
  const userId = user?.id ?? null;
  const guest = isGuest(user);
  const [workspace, setWorkspace] = useState<CloudWorkspace | null>(null);
  const [items, setItems] = useState<VisibleCloudItem[]>([]);
  const [loading, setLoading] = useState(Boolean(client && userId));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!client || !userId) return;
    setLoading(true);
    setError(null);
    try {
      let nextWorkspace: CloudWorkspace | null = null;
      if (!guest) {
        nextWorkspace = await ensureCloudWorkspace(client);
        await acceptCloudInvitations(client).catch((reason) => {
          if (!isMissingSharingFunction(reason)) throw reason;
        });
      }
      let nextItems: VisibleCloudItem[];
      try {
        nextItems = await listVisibleCloudItems(client);
      } catch (reason) {
        // Before the sharing migration, the workspace listing is all there is.
        if (!isMissingSharingFunction(reason) || !nextWorkspace) throw reason;
        nextItems = (await listCloudItems(client, nextWorkspace.id)).map((item) => asVisible(item, undefined));
      }
      setWorkspace(nextWorkspace);
      setItems(nextItems);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [client, guest, userId]);

  useEffect(() => { void reload(); }, [reload]);

  // The tree has no live feed yet, so coming back to the tab refreshes it.
  useEffect(() => {
    if (!client || !userId) return;
    let last = Date.now();
    const onFocus = () => {
      if (Date.now() - last < 15_000) return;
      last = Date.now();
      void reload();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [client, reload, userId]);

  const roots = useMemo(() => items
    .filter((item) => item.parent_id === null && item.access_role === "owner" && item.root_kind !== null)
    .sort((a, b) => (a.root_kind === b.root_kind ? a.name.localeCompare(b.name) : a.root_kind === "notes" ? -1 : 1)),
  [items]);
  // A shared root is a shared item whose parent is not visible: shared
  // directly, or the top of a shared subtree. An item shared both directly
  // and through an ancestor shows once, under that ancestor.
  const shared = useMemo(() => {
    const visible = new Set(items.map((item) => item.id));
    return items
      .filter((item) => item.shared_root_id !== null && !(item.parent_id && visible.has(item.parent_id)))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1));
  }, [items]);
  const notesRootId = useMemo(() => roots.find((root) => root.root_kind === "notes")?.id ?? null, [roots]);

  const create = useCallback(async (
    kind: CloudItemKind,
    name: string,
    parentId: string | null = null,
  ) => {
    if (!client) throw new Error("Ghost Cloud is not connected");
    let targetParent = parentId;
    let created: VisibleCloudItem[] = [];
    if (!targetParent) {
      if (guest) throw new Error("Sign in to create your own notes");
      if (notesRootId) {
        targetParent = notesRootId;
      } else {
        const notes = asVisible(await createCloudItem(client, "folder", "Notes", null, { rootKind: "notes" }), undefined);
        notes.root_kind = "notes";
        created = [notes];
        targetParent = notes.id;
      }
    }
    const parent = items.find((candidate) => candidate.id === targetParent) ?? created[0];
    const item = asVisible(await createCloudItem(client, kind, name, targetParent), parent);
    setItems((current) => [...current, ...created, item]);
    return item;
  }, [client, guest, items, notesRootId]);

  const rename = useCallback(async (itemId: string, name: string) => {
    if (!client) throw new Error("Ghost Cloud is not connected");
    const renamed = await renameCloudItem(client, itemId, name);
    const existing = items.find((candidate) => candidate.id === renamed.id);
    const result: VisibleCloudItem = existing ? { ...existing, ...renamed } : asVisible(renamed, undefined);
    setItems((current) => current.map((candidate) => (candidate.id === result.id ? result : candidate)));
    return result;
  }, [client, items]);

  const duplicate = useCallback(async (itemId: string) => {
    if (!client) throw new Error("Ghost Cloud is not connected");
    const item = await duplicateCloudItem(client, itemId);
    await reload();
    return item;
  }, [client, reload]);

  const trash = useCallback(async (itemId: string) => {
    if (!client) throw new Error("Ghost Cloud is not connected");
    await trashCloudItem(client, itemId);
    setItems((current) => withoutSubtree(current, itemId));
  }, [client]);

  const leave = useCallback(async (itemId: string) => {
    if (!client) throw new Error("Ghost Cloud is not connected");
    await leaveCloudItem(client, itemId);
    setItems((current) => withoutSubtree(current, itemId));
  }, [client]);

  return {
    workspace, items, roots, shared, notesRootId, guest, loading, error,
    create, rename, duplicate, trash, leave, reload,
  };
}
