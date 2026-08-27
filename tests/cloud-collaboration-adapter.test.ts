// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
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
  const broadcastListeners = new Map<string, Array<(message: unknown) => void>>();
  let removedChannels = 0;
  let rejectDurableSignals = false;
  const client = {
    rpc: async () => ({ data: role, error: null }),
    from: () => {
      let afterId = 0;
      const query = {
        select: () => query,
        eq: () => query,
        gt: (_column: string, value: number) => { afterId = value; return query; },
        order: () => query,
        returns: async () => ({
          data: persisted
            .map((update, index) => ({ id: index + 1, update }))
            .filter((row) => row.id > afterId),
          error: null,
        }),
        upsert: async (row: { update: string }) => {
          persisted.push(row.update);
          return { error: null };
        },
      };
      return query;
    },
    channel: (_name: string, options?: Record<string, unknown>) => {
      channelOptions.push(options);
      const channel = {
        on: (
          _type: string,
          filter: { event?: string },
          callback: (message: unknown) => void,
        ) => {
          if (filter.event) {
            const listeners = broadcastListeners.get(filter.event) ?? [];
            listeners.push(callback);
            broadcastListeners.set(filter.event, listeners);
          }
          return channel;
        },
        subscribe: (callback: (status: string) => void) => {
          queueMicrotask(() => callback("SUBSCRIBED"));
          return channel;
        },
        send: async (args: { event: string }) => {
          sentEvents.push(args.event);
          if (args.event === "ghost-cloud-durable-update" && rejectDurableSignals) {
            throw new Error("simulated signal failure");
          }
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
    appendExternalUpdate: (update: string) => { persisted.push(update); },
    emitBroadcast: (event: string) => {
      for (const listener of broadcastListeners.get(event) ?? []) listener({ payload: {} });
    },
    rejectDurableSignals: () => { rejectDurableSignals = true; },
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

  it("does not echo a received remote update into the durable log", async () => {
    const backend = createFakeBackend("editor");
    const document = new Y.Doc();
    const session = await SupabaseCloudAdapter.create({ ...OPTIONS, client: backend.client, document });
    const remote = new Y.Doc();
    remote.getText("probe").insert(0, "from another client");

    Y.applyUpdate(document, Y.encodeStateAsUpdate(remote), "remote");
    await session.flush();

    expect(document.getText("probe").toString()).toBe("from another client");
    expect(backend.persisted).toHaveLength(0);
    await session.destroy();
  });

  it("pulls durable updates that were missed while realtime was unavailable", async () => {
    const backend = createFakeBackend("editor");
    const document = new Y.Doc();
    const session = await SupabaseCloudAdapter.create({ ...OPTIONS, client: backend.client, document });
    const offlinePeer = new Y.Doc();
    offlinePeer.getText("probe").insert(0, "offline peer edit");
    backend.appendExternalUpdate(encodeBase64(Y.encodeStateAsUpdate(offlinePeer)));

    backend.emitBroadcast("ghost-cloud-durable-update");

    await vi.waitFor(() => {
      expect(document.getText("probe").toString()).toBe("offline peer edit");
      expect(session.getSnapshot().synchronization).toBe("synced");
    });
    expect(backend.persisted).toHaveLength(1);
    await session.destroy();
  });

  it("keeps a committed edit saved when only its catch-up signal fails", async () => {
    const backend = createFakeBackend("editor");
    const document = new Y.Doc();
    const session = await SupabaseCloudAdapter.create({ ...OPTIONS, client: backend.client, document });
    await vi.waitFor(() => expect(session.getSnapshot().connection).toBe("connected"));
    backend.rejectDurableSignals();

    document.getText("probe").insert(0, "committed before signal failure");
    await session.flush();

    expect(backend.persisted).toHaveLength(1);
    expect(session.getSnapshot()).toMatchObject({ durability: "saved", pendingUpdates: 0 });
    expect(session.getSnapshot().lastError).toContain("simulated signal failure");
    await session.destroy();
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
