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
