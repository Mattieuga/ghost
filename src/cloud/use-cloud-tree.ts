import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
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

export interface CloudTreeState {
  workspace: CloudWorkspace | null;
  items: CloudItem[];
  loading: boolean;
  error: string | null;
  create(kind: CloudItemKind, name: string, parentId?: string | null): Promise<CloudItem>;
  rename(itemId: string, name: string): Promise<CloudItem>;
  duplicate(itemId: string): Promise<CloudItem>;
  trash(itemId: string): Promise<void>;
  reload(): Promise<void>;
}

export function useCloudTree(client: SupabaseClient | null, userId: string | null): CloudTreeState {
  const [workspace, setWorkspace] = useState<CloudWorkspace | null>(null);
  const [items, setItems] = useState<CloudItem[]>([]);
  const [loading, setLoading] = useState(Boolean(client && userId));
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!client || !userId) return;
    setLoading(true);
    setError(null);
    try {
      const nextWorkspace = await ensureCloudWorkspace(client);
      const nextItems = await listCloudItems(client, nextWorkspace.id);
      setWorkspace(nextWorkspace);
      setItems(nextItems);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [client, userId]);

  useEffect(() => { void reload(); }, [reload]);

  const create = useCallback(async (
    kind: CloudItemKind,
    name: string,
    parentId: string | null = null,
  ) => {
    if (!client) throw new Error("Ghost Cloud is not connected");
    const item = await createCloudItem(client, kind, name, parentId);
    setItems((current) => [...current, item]);
    return item;
  }, [client]);

  const rename = useCallback(async (itemId: string, name: string) => {
    if (!client) throw new Error("Ghost Cloud is not connected");
    const item = await renameCloudItem(client, itemId, name);
    setItems((current) => current.map((candidate) => candidate.id === item.id ? item : candidate));
    return item;
  }, [client]);

  const duplicate = useCallback(async (itemId: string) => {
    if (!client || !workspace) throw new Error("Ghost Cloud is not connected");
    const item = await duplicateCloudItem(client, itemId);
    setItems(await listCloudItems(client, workspace.id));
    return item;
  }, [client, workspace]);

  const trash = useCallback(async (itemId: string) => {
    if (!client) throw new Error("Ghost Cloud is not connected");
    await trashCloudItem(client, itemId);
    setItems((current) => {
      const removed = new Set([itemId]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const item of current) {
          if (item.parent_id && removed.has(item.parent_id) && !removed.has(item.id)) {
            removed.add(item.id);
            changed = true;
          }
        }
      }
      return current.filter((item) => !removed.has(item.id));
    });
  }, [client]);

  return { workspace, items, loading, error, create, rename, duplicate, trash, reload };
}
