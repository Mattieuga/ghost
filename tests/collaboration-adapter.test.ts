// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";

import { decodeBase64, encodeBase64 } from "../src/spikes/collaboration/base64";
import { SupabaseCollaborationAdapter } from "../src/spikes/collaboration/supabase-adapter";
import { CollaborationAccessError, type CollaborationRole } from "../src/spikes/collaboration/types";

interface FakeBackend {
  client: SupabaseClient;
  channelOptions: Array<Record<string, unknown> | undefined>;
  persisted: string[];
  sentEvents: string[];
  removedChannels: number;
}

function createFakeBackend(
  role: CollaborationRole | null,
  initialUpdates: string[] = [],
): FakeBackend {
  const channelOptions: Array<Record<string, unknown> | undefined> = [];
  const persisted = [...initialUpdates];
  const sentEvents: string[] = [];
  const backend: FakeBackend = {
    client: null as unknown as SupabaseClient,
    channelOptions,
    persisted,
    sentEvents,
    removedChannels: 0,
  };

  const createQuery = (table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      maybeSingle: async () => ({
        data: role ? { role } : null,
        error: null,
      }),
      returns: async () => ({
        data: table === "collaboration_spike_updates"
          ? persisted.map((update, index) => ({ id: index + 1, update }))
          : [],
        error: null,
      }),
      upsert: async (row: { update: string }) => {
        persisted.push(row.update);
        return { error: null };
      },
    };
    return query;
  };

  backend.client = {
    from: (table: string) => createQuery(table),
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
    removeChannel: async () => {
      backend.removedChannels += 1;
      return "ok";
    },
  } as unknown as SupabaseClient;

  return backend;
}

const OPTIONS = {
  roomId: "00000000-0000-4000-8000-000000000001",
  userId: "10000000-0000-4000-8000-000000000001",
  user: { name: "Alice", color: "#ff6b35" },
};

describe("Supabase collaboration spike adapter", () => {
  it("round-trips arbitrary binary Yjs payloads through base64", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
  });

  it("loads the append-only server state before connecting", async () => {
    const source = new Y.Doc();
    source.getText("probe").insert(0, "persisted");
    const backend = createFakeBackend("viewer", [encodeBase64(Y.encodeStateAsUpdate(source))]);
    const document = new Y.Doc();

    const adapter = await SupabaseCollaborationAdapter.create({
      ...OPTIONS,
      client: backend.client,
      document,
    });

    expect(document.getText("probe").toString()).toBe("persisted");
    expect(adapter.getSnapshot().durability).toBe("read-only");
    await adapter.destroy();
  });

  it("uses private acknowledged channels and durably appends editor updates", async () => {
    const backend = createFakeBackend("editor");
    const document = new Y.Doc();
    const adapter = await SupabaseCollaborationAdapter.create({
      ...OPTIONS,
      client: backend.client,
      document,
    });

    document.getText("probe").insert(0, "hello multiplayer");
    await adapter.flush();

    expect(backend.channelOptions[0]).toMatchObject({
      config: { private: true, broadcast: { ack: true } },
    });
    expect(backend.persisted).toHaveLength(1);

    const restored = new Y.Doc();
    Y.applyUpdate(restored, decodeBase64(backend.persisted[0]));
    expect(restored.getText("probe").toString()).toBe("hello multiplayer");
    expect(adapter.getSnapshot()).toMatchObject({ durability: "saved", pendingUpdates: 0 });
    await adapter.destroy();
    expect(backend.removedChannels).toBe(1);
  });

  it("does not send or persist mutations from the viewer adapter", async () => {
    const backend = createFakeBackend("viewer");
    const document = new Y.Doc();
    const adapter = await SupabaseCollaborationAdapter.create({
      ...OPTIONS,
      client: backend.client,
      document,
    });

    document.getText("probe").insert(0, "modified client attempt");
    await adapter.flush();

    expect(backend.persisted).toHaveLength(0);
    expect(backend.sentEvents).toHaveLength(0);
    expect(adapter.getSnapshot().durability).toBe("read-only");
    await adapter.destroy();
  });

  it("rejects authenticated users without an explicit membership", async () => {
    const backend = createFakeBackend(null);

    await expect(SupabaseCollaborationAdapter.create({
      ...OPTIONS,
      client: backend.client,
      document: new Y.Doc(),
    })).rejects.toBeInstanceOf(CollaborationAccessError);
  });
});
