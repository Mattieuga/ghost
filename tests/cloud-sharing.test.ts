import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createCloudShareLink,
  fetchCloudDocumentHeads,
  getCloudItemSharing,
  listVisibleCloudItems,
  redeemCloudShareLink,
  revokeCloudAccess,
  shareCloudItem,
  shareLinkUrl,
  shareTokenFromUrl,
} from "../src/cloud/cloud-sharing";

function fakeClient(responses: Record<string, unknown>) {
  const calls: Array<{ name: string; args: unknown }> = [];
  const rpc = vi.fn(async (name: string, args?: unknown) => {
    calls.push({ name, args });
    return { data: responses[name] ?? null, error: null };
  });
  return { client: { rpc } as unknown as SupabaseClient, calls };
}

describe("cloud sharing client", () => {
  it("shares by email and routes revocation to the member or the invitation", async () => {
    const { client, calls } = fakeClient({
      cloud_share_item: { kind: "invited", invitation_id: "inv-1", email: "wife@example.com", role: "editor" },
    });
    const outcome = await shareCloudItem(client, "item-1", "Wife@Example.com", "editor");
    expect(outcome.kind).toBe("invited");
    await revokeCloudAccess(client, "item-1", { invitationId: "inv-1" });
    await revokeCloudAccess(client, "item-1", { userId: "user-2" });
    expect(calls.map((call) => call.args)).toEqual([
      { target_item_id: "item-1", member_email: "Wife@Example.com", member_role: "editor" },
      { target_item_id: "item-1", member_user_id: null, invitation_id: "inv-1" },
      { target_item_id: "item-1", member_user_id: "user-2", invitation_id: null },
    ]);
  });

  it("returns the raw token once and builds a fragment URL from it", async () => {
    const { client } = fakeClient({
      cloud_create_share_link: { id: "link-1", token: "abc_-xyz", role: "viewer", created_at: "t", expires_at: null },
    });
    const link = await createCloudShareLink(client, "item-1", "viewer");
    const url = shareLinkUrl(link.token, "https://ghosteditor.app/app");
    expect(url).toBe("https://ghosteditor.app/app#share=abc_-xyz");
    expect(shareTokenFromUrl(url)).toBe("abc_-xyz");
    expect(shareTokenFromUrl("https://ghosteditor.app/app")).toBeNull();
    expect(shareTokenFromUrl("https://ghosteditor.app/app?code=pkce#other=1")).toBeNull();
  });

  it("separates the item from the role when redeeming a link", async () => {
    const { client, calls } = fakeClient({
      cloud_redeem_share_link: { id: "item-9", kind: "document", name: "Plan.md", parent_id: null, role: "editor" },
    });
    const { item, role } = await redeemCloudShareLink(client, "tok");
    expect(role).toBe("editor");
    expect(item).toEqual({ id: "item-9", kind: "document", name: "Plan.md", parent_id: null });
    expect(calls[0].args).toEqual({ raw_token: "tok" });
  });

  it("sorts visible items folders first and fills missing sharing lists", async () => {
    const { client } = fakeClient({
      cloud_list_visible_items: [
        { id: "b", kind: "document", name: "b.md" },
        { id: "a", kind: "document", name: "a.md" },
        { id: "f", kind: "folder", name: "z" },
      ],
      cloud_item_sharing: { members: [{ user_id: "u", email: "x@y.z", display_name: null, role: "viewer", created_at: "t" }] },
    });
    expect((await listVisibleCloudItems(client)).map((item) => item.id)).toEqual(["f", "a", "b"]);
    const sharing = await getCloudItemSharing(client, "f");
    expect(sharing.members).toHaveLength(1);
    expect(sharing.invitations).toEqual([]);
    expect(sharing.links).toEqual([]);
  });

  it("batches document heads and returns numbers", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => `doc-${index}`);
    const { client, calls } = fakeClient({
      cloud_document_heads: [{ document_id: "doc-1", last_update_id: "42" }],
    });
    const heads = await fetchCloudDocumentHeads(client, ids);
    expect(calls).toHaveLength(2);
    expect((calls[0].args as { document_ids: string[] }).document_ids).toHaveLength(200);
    expect(heads.get("doc-1")).toBe(42);
  });
});
