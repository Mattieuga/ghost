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
  options: { itemId?: string; rootKind?: "notes" | "folder" } = {},
): Promise<CloudItem> {
  // The optional arguments exist only after the synced-folders migration, so
  // they are sent only when a caller asks for them.
  const { data, error } = await client.rpc("cloud_create_item", {
    item_kind: kind,
    item_name: name,
    target_parent_id: parentId,
    ...(options.itemId ? { target_item_id: options.itemId } : {}),
    ...(options.rootKind ? { target_root_kind: options.rootKind } : {}),
  });
  throwDataError(`Could not create the Cloud ${kind}`, error);
  if (!data) throw new Error(`Supabase did not return the created Cloud ${kind}`);
  return data as CloudItem;
}

export interface CloudAdoptItem {
  id: string;
  parent_id: string | null;
  kind: CloudItemKind;
  name: string;
  root_kind?: "notes" | "folder";
}

/**
 * Create items under client IDs, parents first. Known IDs return their
 * existing row and a name collision is renamed server-side, so this is the
 * safe way to put a document that already has an ID into Cloud.
 */
export async function adoptCloudItems(client: SupabaseClient, items: CloudAdoptItem[]): Promise<void> {
  for (let start = 0; start < items.length; start += 500) {
    const { error } = await client.rpc("cloud_adopt_items", { items: items.slice(start, start + 500) });
    throwDataError("Could not add to Cloud", error);
  }
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

export async function duplicateCloudItem(
  client: SupabaseClient,
  itemId: string,
): Promise<CloudItem> {
  const { data, error } = await client.rpc("cloud_duplicate_item", {
    target_item_id: itemId,
  });
  throwDataError("Could not duplicate the Cloud item", error);
  if (!data) throw new Error("Supabase did not return the duplicated Cloud item");
  return data as CloudItem;
}

export async function trashCloudItem(
  client: SupabaseClient,
  itemId: string,
): Promise<void> {
  const { error } = await client.rpc("cloud_trash_item", {
    target_item_id: itemId,
  });
  throwDataError("Could not move the Cloud item to Trash", error);
}

export async function moveCloudItem(
  client: SupabaseClient,
  itemId: string,
  parentId: string | null,
): Promise<CloudItem> {
  const { data, error } = await client.rpc("cloud_move_item", {
    target_item_id: itemId,
    target_parent_id: parentId,
  });
  throwDataError("Could not move the Cloud item", error);
  if (!data) throw new Error("Supabase did not return the moved Cloud item");
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
