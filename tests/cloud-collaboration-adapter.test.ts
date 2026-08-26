// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { decodeBase64, encodeBase64 } from "../src/cloud/collaboration/base64";
import { SupabaseCloudAdapter } from "../src/cloud/collaboration/supabase-cloud-adapter";
import { CloudAccessError } from "../src/cloud/collaboration/types";

type EffectiveRole = "owner" | "editor" | "viewer" | null;

function createFakeBackend(role: EffectiveRole, initialUpdates: string[] = []) {
  const persisted = [...initialUpdates];
  const channelOptions: Array<Record<string, unknown> | undefined> = [];
  const sentEvents: string[] = [];
  let removedChannels = 0;
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    returns: async () => ({
      data: persisted.map((update, index) => ({ id: index + 1, update })),
      error: null,
    }),
    upsert: async (row: { update: string }) => {
      persisted.push(row.update);
      return { error: null };
    },
  };
  const client = {
    rpc: async () => ({ data: role, error: null }),
    from: () => query,
    channel: (_name: string, options?: Record<string, unknown>) => {
      channelOptions.push(options);
      const channel = {
        on: () => channel,
        subscribe: (callback: (status: string) => void) => {
          callback("SUBSCRIBED");
          return channel;
        },
        send: async (args: { event: string }) => {
          sentEvents.push(args.event);
          return "ok";
        },
        unsubscribe: async () => "ok",
      };
      return channel as unknown as RealtimeChannel;
    },
    removeChannel: async () => { removedChannels += 1; return "ok"; },
  } as unknown as SupabaseClient;
  return {
    client,
    persisted,
    channelOptions,
    sentEvents,
    removedChannels: () => removedChannels,
  };
}

const OPTIONS = {
  documentId: "10000000-0000-4000-8000-000000000001",
  user: { name: "Alice", color: "#ff7145" },
};

describe("production Cloud collaboration adapter", () => {
  it("loads durable Yjs updates before connecting", async () => {
    const source = new Y.Doc();
    source.getText("probe").insert(0, "from Supabase");
    const backend = createFakeBackend("viewer", [encodeBase64(Y.encodeStateAsUpdate(source))]);
    const document = new Y.Doc();

    const session = await SupabaseCloudAdapter.create({ ...OPTIONS, client: backend.client, document });
    expect(document.getText("probe").toString()).toBe("from Supabase");
    expect(session.getSnapshot().durability).toBe("read-only");
    await session.destroy();
  });

  it("maps owners to editors and uses private acknowledged realtime", async () => {
    const backend = createFakeBackend("owner");
    const document = new Y.Doc();
    const session = await SupabaseCloudAdapter.create({ ...OPTIONS, client: backend.client, document });
    document.getText("probe").insert(0, "shared edit");
    await session.flush();

    expect(session.role).toBe("editor");
    expect(backend.channelOptions[0]).toMatchObject({
      config: { private: true, broadcast: { ack: true } },
    });
    expect(backend.persisted).toHaveLength(1);
    expect(backend.sentEvents).toContain("y-supabase-update");
    await session.destroy();
    expect(backend.removedChannels()).toBe(1);
  });

  it("does not persist viewer mutations", async () => {
    const backend = createFakeBackend("viewer");
    const document = new Y.Doc();
    const session = await SupabaseCloudAdapter.create({ ...OPTIONS, client: backend.client, document });
    document.getText("probe").insert(0, "tampered viewer");
    await session.flush();

    expect(backend.persisted).toHaveLength(0);
    expect(backend.sentEvents).toHaveLength(0);
    await session.destroy();
  });

  it("rejects users without an effective role", async () => {
    const backend = createFakeBackend(null);
    await expect(SupabaseCloudAdapter.create({
      ...OPTIONS,
      client: backend.client,
      document: new Y.Doc(),
    })).rejects.toBeInstanceOf(CloudAccessError);
  });

  it("round-trips arbitrary binary updates", () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 254, 255]);
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
  });
});
