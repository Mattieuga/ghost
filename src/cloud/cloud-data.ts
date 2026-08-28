import type { SupabaseClient } from "@supabase/supabase-js";

export type CloudItemKind = "folder" | "document";

export interface CloudWorkspace {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface CloudItem {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  kind: CloudItemKind;
  name: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function throwDataError(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

export async function ensureCloudWorkspace(client: SupabaseClient): Promise<CloudWorkspace> {
  const { data, error } = await client.rpc("cloud_ensure_workspace");
  throwDataError("Could not prepare your Cloud workspace", error);
  if (!data) throw new Error("Supabase did not return a Cloud workspace");
  return data as CloudWorkspace;
}

export async function listCloudItems(
  client: SupabaseClient,
  workspaceId: string,
): Promise<CloudItem[]> {
  const { data, error } = await client
    .from("cloud_items")
    .select("id, workspace_id, parent_id, kind, name, created_by, created_at, updated_at, deleted_at")
    .eq("workspace_id", workspaceId)
    .is("deleted_at", null)
    .order("kind", { ascending: true })
    .order("name", { ascending: true });
  throwDataError("Could not load Cloud items", error);
  return (data ?? []) as CloudItem[];
}

export async function createCloudItem(
  client: SupabaseClient,
  kind: CloudItemKind,
  name: string,
  parentId: string | null,
): Promise<CloudItem> {
  const { data, error } = await client.rpc("cloud_create_item", {
    item_kind: kind,
    item_name: name,
    target_parent_id: parentId,
  });
  throwDataError(`Could not create the Cloud ${kind}`, error);
  if (!data) throw new Error(`Supabase did not return the created Cloud ${kind}`);
  return data as CloudItem;
}

export async function renameCloudItem(
  client: SupabaseClient,
  itemId: string,
  name: string,
): Promise<CloudItem> {
  const { data, error } = await client.rpc("cloud_rename_item", {
    target_item_id: itemId,
    item_name: name,
  });
  throwDataError("Could not rename the Cloud item", error);
  if (!data) throw new Error("Supabase did not return the renamed Cloud item");
  return data as CloudItem;
}

export function cloudItemPath(items: CloudItem[], item: CloudItem): CloudItem[] {
  const byId = new Map(items.map((candidate) => [candidate.id, candidate]));
  const path: CloudItem[] = [item];
  const visited = new Set([item.id]);
  let parentId = item.parent_id;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent || visited.has(parent.id)) break;
    path.unshift(parent);
    visited.add(parent.id);
    parentId = parent.parent_id;
  }
  return path;
}
