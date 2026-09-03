import type { SupabaseClient } from "@supabase/supabase-js";
import type { CloudItem } from "@/cloud/cloud-data";

/** Client side of the sharing migration (`20260902020000_cloud_sharing.sql`). */

export type CloudShareRole = "viewer" | "editor";
export type CloudAccessRole = "owner" | CloudShareRole;

export interface VisibleCloudItem extends CloudItem {
  root_kind: "notes" | "folder" | null;
  /** The caller's effective role on this item. */
  access_role: CloudAccessRole;
  /** For items shared with the caller, the item they were shared through. */
  shared_root_id: string | null;
  /** The sharer's display name or email, for items shared with the caller. */
  shared_by: string | null;
  /** For own items, whether anyone else has access through a member, invitation, or link. */
  shared_out: boolean;
}

export interface CloudShareLink {
  id: string;
  role: CloudShareRole;
  created_at: string;
  expires_at: string | null;
}

export interface CreatedCloudShareLink extends CloudShareLink {
  /** Returned once; the server keeps only a hash. */
  token: string;
}

export interface CloudItemSharing {
  members: Array<{ user_id: string; email: string | null; display_name: string | null; role: CloudShareRole; created_at: string }>;
  invitations: Array<{ id: string; email: string; role: CloudShareRole; created_at: string }>;
  links: CloudShareLink[];
}

export type ShareOutcome =
  | { kind: "member"; user_id: string; email: string; role: CloudShareRole }
  | { kind: "invited"; invitation_id: string; email: string; role: CloudShareRole };

function fail(context: string, error: { message: string } | null): void {
  if (error) throw new Error(`${context}: ${error.message}`);
}

/** Whether an RPC error means the server has not received the sharing migration. */
export function isMissingSharingFunction(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not find the function|does not exist|schema cache/i.test(message);
}

export async function listVisibleCloudItems(client: SupabaseClient): Promise<VisibleCloudItem[]> {
  const { data, error } = await client.rpc("cloud_list_visible_items");
  fail("Could not load Cloud", error);
  return ((data ?? []) as VisibleCloudItem[]).slice().sort((a, b) => (
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1
  ));
}

export async function acceptCloudInvitations(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.rpc("cloud_accept_invitations");
  fail("Could not accept invitations", error);
  return typeof data === "number" ? data : 0;
}

export async function shareCloudItem(
  client: SupabaseClient,
  itemId: string,
  email: string,
  role: CloudShareRole,
): Promise<ShareOutcome> {
  const { data, error } = await client.rpc("cloud_share_item", {
    target_item_id: itemId,
    member_email: email,
    member_role: role,
  });
  fail("Could not share", error);
  return data as ShareOutcome;
}

export async function revokeCloudAccess(
  client: SupabaseClient,
  itemId: string,
  target: { userId: string } | { invitationId: string },
): Promise<void> {
  const { error } = await client.rpc("cloud_revoke_access", {
    target_item_id: itemId,
    member_user_id: "userId" in target ? target.userId : null,
    invitation_id: "invitationId" in target ? target.invitationId : null,
  });
  fail("Could not remove access", error);
}

export async function createCloudShareLink(
  client: SupabaseClient,
  itemId: string,
  role: CloudShareRole,
  expiresInHours: number | null = null,
): Promise<CreatedCloudShareLink> {
  const { data, error } = await client.rpc("cloud_create_share_link", {
    target_item_id: itemId,
    link_role: role,
    expires_in_hours: expiresInHours,
  });
  fail("Could not create the link", error);
  if (!data) throw new Error("Supabase did not return the share link");
  return data as CreatedCloudShareLink;
}

export async function revokeCloudShareLink(client: SupabaseClient, linkId: string): Promise<void> {
  const { error } = await client.rpc("cloud_revoke_share_link", { link_id: linkId });
  fail("Could not revoke the link", error);
}

export async function redeemCloudShareLink(
  client: SupabaseClient,
  token: string,
): Promise<{ item: CloudItem; role: CloudAccessRole }> {
  const { data, error } = await client.rpc("cloud_redeem_share_link", { raw_token: token });
  fail("Could not open the link", error);
  if (!data) throw new Error("Supabase did not return the shared item");
  const { role, ...item } = data as CloudItem & { role: CloudAccessRole };
  return { item, role };
}

export async function leaveCloudItem(client: SupabaseClient, itemId: string): Promise<void> {
  const { error } = await client.rpc("cloud_leave_item", { target_item_id: itemId });
  fail("Could not leave", error);
}

export async function getCloudItemSharing(client: SupabaseClient, itemId: string): Promise<CloudItemSharing> {
  const { data, error } = await client.rpc("cloud_item_sharing", { target_item_id: itemId });
  fail("Could not load sharing", error);
  const sharing = (data ?? {}) as Partial<CloudItemSharing>;
  return {
    members: sharing.members ?? [],
    invitations: sharing.invitations ?? [],
    links: sharing.links ?? [],
  };
}

export async function fetchCloudDocumentHeads(
  client: SupabaseClient,
  documentIds: string[],
): Promise<Map<string, number>> {
  const heads = new Map<string, number>();
  for (let start = 0; start < documentIds.length; start += 200) {
    const { data, error } = await client.rpc("cloud_document_heads", {
      document_ids: documentIds.slice(start, start + 200),
    });
    fail("Could not check Cloud for changes", error);
    for (const row of (data ?? []) as Array<{ document_id: string; last_update_id: number | string }>) {
      heads.set(row.document_id, Number(row.last_update_id));
    }
  }
  return heads;
}

export async function setCloudDisplayName(client: SupabaseClient, name: string): Promise<void> {
  const { error } = await client.rpc("cloud_set_display_name", { name });
  fail("Could not save your name", error);
}

/** The share URL for a token: the token rides in the fragment so it never reaches server logs. */
export function shareLinkUrl(token: string, webAppUrl: string): string {
  return `${webAppUrl}#share=${encodeURIComponent(token)}`;
}

/** The share token in a page URL, if any. */
export function shareTokenFromUrl(href: string): string | null {
  const hash = new URL(href).hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  const token = params.get("share");
  return token && token.length > 0 ? token : null;
}
