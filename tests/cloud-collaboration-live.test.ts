// @vitest-environment happy-dom

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { encodeBase64 } from "../src/cloud/collaboration/base64";
import { SupabaseCloudAdapter } from "../src/cloud/collaboration/supabase-cloud-adapter";
import type { CloudCollaborationSession } from "../src/cloud/collaboration/types";

const liveConfig = process.env.GHOST_SUPABASE_URL
  && process.env.GHOST_SUPABASE_PUBLISHABLE_KEY
  && process.env.GHOST_SUPABASE_SERVICE_ROLE_KEY
  ? {
      url: process.env.GHOST_SUPABASE_URL,
      publishableKey: process.env.GHOST_SUPABASE_PUBLISHABLE_KEY,
      serviceRoleKey: process.env.GHOST_SUPABASE_SERVICE_ROLE_KEY,
    }
  : null;

const createdUserIds: string[] = [];
const sessions: CloudCollaborationSession[] = [];
const clients: SupabaseClient[] = [];
let admin: SupabaseClient | null = null;

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.destroy()));
  await Promise.all(clients.splice(0).map(async (client) => {
    await client.removeAllChannels();
    await client.auth.signOut();
  }));
  if (admin) {
    for (const userId of createdUserIds.splice(0).reverse()) {
      await admin.auth.admin.deleteUser(userId);
    }
  }
  admin = null;
});

describe.skipIf(!liveConfig)("Cloud collaboration live recovery", () => {
  it("converges durable offline edits in both arrival orders", async () => {
    if (!liveConfig) throw new Error("Live Supabase configuration is required");
    admin = createClient(liveConfig.url, liveConfig.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const suffix = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const password = `Ghost-${crypto.randomUUID()}-9aA`;
    const ownerEmail = `ghost-live-owner-${suffix}@example.com`;
    const editorEmail = `ghost-live-editor-${suffix}@example.com`;
    const ownerUser = await createConfirmedUser(admin, ownerEmail, password);
    const editorUser = await createConfirmedUser(admin, editorEmail, password);
    createdUserIds.push(ownerUser.id, editorUser.id);

    const ownerClient = await signedInClient(liveConfig.url, liveConfig.publishableKey, ownerEmail, password);
    const editorClient = await signedInClient(liveConfig.url, liveConfig.publishableKey, editorEmail, password);
    clients.push(ownerClient, editorClient);
    const { data: item, error: createError } = await ownerClient.rpc("cloud_create_item", {
      item_kind: "document",
      item_name: `Live recovery ${suffix}.md`,
      target_parent_id: null,
    });
    expect(createError).toBeNull();
    const documentId = (item as { id: string }).id;
    const { error: membershipError } = await admin.from("cloud_memberships").insert({
      item_id: documentId,
      user_id: editorUser.id,
      role: "editor",
      granted_by: ownerUser.id,
    });
    expect(membershipError).toBeNull();

    const ownerDocument = new Y.Doc();
    const editorDocument = new Y.Doc();
    const ownerSession = await SupabaseCloudAdapter.create({
      client: ownerClient,
      document: ownerDocument,
      documentId,
      user: { name: "Live owner", color: "#ff7145" },
    });
    const editorSession = await SupabaseCloudAdapter.create({
      client: editorClient,
      document: editorDocument,
      documentId,
      user: { name: "Live editor", color: "#5ba8ff" },
    });
    sessions.push(ownerSession, editorSession);
    await waitForSynced(ownerSession);
    await waitForSynced(editorSession);

    ownerDocument.getText("probe").insert(0, "baseline");
    await ownerSession.flush();
    await vi.waitFor(() => expect(editorDocument.getText("probe").toString()).toBe("baseline"), {
      timeout: 15_000,
    });

    await applyOfflineRound({
      firstClient: ownerClient,
      secondClient: editorClient,
      firstTag: "owner-first",
      secondTag: "editor-second",
      documentId,
      ownerDocument,
      editorDocument,
    });
    await applyOfflineRound({
      firstClient: editorClient,
      secondClient: ownerClient,
      firstTag: "editor-first",
      secondTag: "owner-second",
      documentId,
      ownerDocument,
      editorDocument,
    });
  }, 90_000);
});

async function createConfirmedUser(client: SupabaseClient, email: string, password: string) {
  const { data, error } = await client.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("Supabase did not create the live test user");
  return data.user;
}

async function signedInClient(url: string, key: string, email: string, password: string) {
  const client = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: `ghost-cloud-live-${crypto.randomUUID()}`,
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

async function waitForSynced(session: CloudCollaborationSession) {
  await vi.waitFor(() => {
    expect(session.getSnapshot()).toMatchObject({
      connection: "connected",
      synchronization: "synced",
    });
  }, { timeout: 15_000 });
}

async function applyOfflineRound({
  firstClient,
  secondClient,
  firstTag,
  secondTag,
  documentId,
  ownerDocument,
  editorDocument,
}: {
  firstClient: SupabaseClient;
  secondClient: SupabaseClient;
  firstTag: string;
  secondTag: string;
  documentId: string;
  ownerDocument: Y.Doc;
  editorDocument: Y.Doc;
}) {
  const baseUpdate = Y.encodeStateAsUpdate(ownerDocument);
  const baseVector = Y.encodeStateVector(ownerDocument);
  const firstOffline = new Y.Doc();
  const secondOffline = new Y.Doc();
  Y.applyUpdate(firstOffline, baseUpdate);
  Y.applyUpdate(secondOffline, baseUpdate);
  firstOffline.getText("probe").insert(firstOffline.getText("probe").length, ` [${firstTag}]`);
  secondOffline.getText("probe").insert(0, `[${secondTag}] `);

  await appendDurableUpdate(firstClient, documentId, Y.encodeStateAsUpdate(firstOffline, baseVector));
  window.dispatchEvent(new Event("online"));
  await waitForDocumentMatch(ownerDocument, editorDocument, firstTag);

  await appendDurableUpdate(secondClient, documentId, Y.encodeStateAsUpdate(secondOffline, baseVector));
  window.dispatchEvent(new Event("online"));
  await waitForDocumentMatch(ownerDocument, editorDocument, secondTag);
  expect(ownerDocument.getText("probe").toString()).toContain(firstTag);
  expect(ownerDocument.getText("probe").toString()).toContain(secondTag);
}

async function appendDurableUpdate(client: SupabaseClient, documentId: string, update: Uint8Array) {
  const { error } = await client.from("cloud_document_updates").insert({
    document_id: documentId,
    client_id: crypto.randomUUID(),
    client_sequence: 1,
    update: encodeBase64(update),
  });
  expect(error).toBeNull();
}

async function waitForDocumentMatch(first: Y.Doc, second: Y.Doc, expectedTag: string) {
  await vi.waitFor(() => {
    expect(first.getText("probe").toString()).toContain(expectedTag);
    expect(second.getText("probe").toString()).toContain(expectedTag);
    expect(second.getText("probe").toString()).toBe(first.getText("probe").toString());
    expect(Y.encodeStateVector(second)).toEqual(Y.encodeStateVector(first));
  }, { timeout: 15_000 });
}
