import { SupabaseProvider } from "@supabase-labs/y-supabase";
import type {
  RealtimeChannel,
  RealtimeChannelSendResponse,
  SupabaseClient,
} from "@supabase/supabase-js";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { decodeBase64, encodeBase64 } from "./base64";
import {
  CollaborationAccessError,
  type CollaborationAdapter,
  type CollaborationRole,
  type CollaborationSnapshot,
} from "./types";

const UPSTREAM_REVISION = "@supabase-labs/y-supabase@0.1.0 (cec1e3b900a51cfe0d58a94b4bcd16815f75caed)";
const REMOTE_ORIGIN = "remote";
const UPDATE_EVENT = "y-supabase-update";
const STATE_VECTOR_EVENT = "y-supabase-state-vector";
const AWARENESS_EVENT = "y-supabase-awareness";
const STORE_DELAY_MS = 120;

interface UpdateRow {
  id: number;
  update: string;
}

interface MemberRow {
  role: CollaborationRole;
}

export interface SupabaseCollaborationAdapterOptions {
  client: SupabaseClient;
  document: Y.Doc;
  roomId: string;
  userId: string;
  user: {
    name: string;
    color: string;
  };
}

/**
 * Disposable Phase 0 adapter around the reviewed y-supabase release.
 *
 * The upstream provider supplies Yjs state-vector sync and awareness. This
 * boundary forces private, acknowledged Realtime channels and adds an
 * append-only Postgres durability path because the upstream whole-state
 * upsert cannot expose a trustworthy "saved" state under concurrent writers.
 */
export class SupabaseCollaborationAdapter implements CollaborationAdapter {
  readonly document: Y.Doc;
  readonly awareness: Awareness;
  readonly role: CollaborationRole;

  private readonly client: SupabaseClient;
  private readonly roomId: string;
  private readonly clientId = crypto.randomUUID();
  private readonly channelTargets = new WeakMap<RealtimeChannel, RealtimeChannel>();
  private readonly listeners = new Set<(snapshot: CollaborationSnapshot) => void>();
  private readonly handleOnline = () => {
    void this.flush().catch(() => undefined);
  };
  private readonly handleDocumentUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN || this.role === "viewer" || this.destroyed) return;
    this.pendingUpdates.push(update);
    this.updateSnapshot({
      durability: "pending",
      pendingUpdates: this.pendingUpdates.length,
      lastError: null,
    });
    this.scheduleFlush();
  };

  private provider: SupabaseProvider | null = null;
  private pendingUpdates: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private nextSequence = 1;
  private destroyed = false;
  private snapshot: CollaborationSnapshot;

  private constructor(
    options: SupabaseCollaborationAdapterOptions,
    role: CollaborationRole,
  ) {
    this.client = options.client;
    this.document = options.document;
    this.roomId = options.roomId;
    this.role = role;
    this.awareness = new Awareness(this.document);
    this.awareness.setLocalStateField("user", options.user);
    this.snapshot = {
      connection: "connecting",
      synchronization: "synced",
      durability: role === "viewer" ? "read-only" : "saved",
      role,
      pendingUpdates: 0,
      lastError: null,
    };
  }

  static async create(
    options: SupabaseCollaborationAdapterOptions,
  ): Promise<SupabaseCollaborationAdapter> {
    const role = await this.loadRole(options.client, options.roomId, options.userId);
    if (!role) throw new CollaborationAccessError(options.userId);

    const serverDocument = await this.loadServerDocument(options.client, options.roomId);
    Y.applyUpdate(
      options.document,
      Y.encodeStateAsUpdate(serverDocument),
      REMOTE_ORIGIN,
    );

    const adapter = new SupabaseCollaborationAdapter(options, role);

    // Recover changes that exist only in IndexedDB before joining Realtime.
    if (role === "editor") {
      const localOnly = Y.encodeStateAsUpdate(
        options.document,
        Y.encodeStateVector(serverDocument),
      );
      if (localOnly.length > 2) {
        adapter.pendingUpdates.push(localOnly);
        adapter.updateSnapshot({ durability: "pending", pendingUpdates: 1 });
        await adapter.flush().catch(() => undefined);
      }
    }

    adapter.document.on("update", adapter.handleDocumentUpdate);
    window.addEventListener("online", adapter.handleOnline);
    adapter.connectRealtime();
    return adapter;
  }

  private static async loadRole(
    client: SupabaseClient,
    roomId: string,
    userId: string,
  ): Promise<CollaborationRole | null> {
    const { data, error } = await client
      .from("collaboration_spike_members")
      .select("role")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .maybeSingle<MemberRow>();

    if (error) throw new Error(`Could not load collaboration access: ${error.message}`);
    return data?.role ?? null;
  }

  private static async loadServerDocument(
    client: SupabaseClient,
    roomId: string,
  ): Promise<Y.Doc> {
    const { data, error } = await client
      .from("collaboration_spike_updates")
      .select("id, update")
      .eq("room_id", roomId)
      .order("id", { ascending: true })
      .returns<UpdateRow[]>();

    if (error) throw new Error(`Could not load collaborative updates: ${error.message}`);

    const serverDocument = new Y.Doc();
    for (const row of data ?? []) {
      Y.applyUpdate(serverDocument, decodeBase64(row.update));
    }
    return serverDocument;
  }

  private connectRealtime(): void {
    const realtimeClient = {
      channel: (name: string) => this.createPrivateChannel(name),
      removeChannel: (channel: RealtimeChannel) => this.client.removeChannel(
        this.channelTargets.get(channel) ?? channel,
      ),
    } as SupabaseClient;

    this.provider = new SupabaseProvider(
      `ghost-spike:${this.roomId}`,
      this.document,
      realtimeClient,
      {
        awareness: this.awareness,
        // Cursor awareness may reference Yjs items created by the same
        // keystroke. Delaying the document update while sending awareness
        // immediately makes remote carets disappear until that item arrives.
        broadcastThrottleMs: 0,
        autoReconnect: true,
        reconnectDelay: 500,
        maxReconnectDelay: 10_000,
      },
    );
    this.provider.on("status", (status) => {
      this.updateSnapshot({ connection: status });
    });
    this.provider.on("error", (error) => {
      this.updateSnapshot({ lastError: error.message });
    });
  }

  private createPrivateChannel(name: string): RealtimeChannel {
    const channel = this.client.channel(name, {
      config: {
        private: true,
        broadcast: { ack: true },
      },
    });
    const send = channel.send.bind(channel);

    const privateChannel = new Proxy(channel, {
      get: (target, property) => {
        if (property === "send") {
          return (
            args: Parameters<RealtimeChannel["send"]>[0],
            opts?: Parameters<RealtimeChannel["send"]>[1],
          ): Promise<RealtimeChannelSendResponse> => {
            if (this.role === "viewer" && this.isYjsWriteEvent(args.event)) {
              return Promise.resolve("ok");
            }

            const result = send(args, opts);
            void result.then((status) => {
              if (status !== "ok") {
                this.updateSnapshot({
                  lastError: `Realtime broadcast was not acknowledged (${status}).`,
                });
              }
            }).catch((error: unknown) => {
              this.updateSnapshot({
                lastError: error instanceof Error ? error.message : "Realtime broadcast failed.",
              });
            });
            return result;
          };
        }

        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    this.channelTargets.set(privateChannel, channel);
    return privateChannel;
  }

  private isYjsWriteEvent(event: string): boolean {
    return event === UPDATE_EVENT || event === STATE_VECTOR_EVENT || event === AWARENESS_EVENT;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush().catch(() => undefined);
    }, STORE_DELAY_MS);
  }

  async flush(): Promise<void> {
    if (this.role === "viewer" || this.destroyed || this.pendingUpdates.length === 0) return;
    if (this.flushPromise) return this.flushPromise;

    this.flushPromise = this.flushPendingUpdates().finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  private async flushPendingUpdates(): Promise<void> {
    while (this.pendingUpdates.length > 0 && !this.destroyed) {
      const batch = this.pendingUpdates.splice(0);
      const merged = batch.length === 1 ? batch[0] : Y.mergeUpdates(batch);
      this.updateSnapshot({
        durability: "saving",
        pendingUpdates: batch.length,
        lastError: null,
      });

      const { error } = await this.client
        .from("collaboration_spike_updates")
        .upsert({
          room_id: this.roomId,
          client_id: this.clientId,
          client_sequence: this.nextSequence,
          update: encodeBase64(merged),
        }, {
          onConflict: "room_id,client_id,client_sequence",
          ignoreDuplicates: true,
        });

      if (error) {
        this.pendingUpdates.unshift(merged);
        this.updateSnapshot({
          durability: "error",
          pendingUpdates: this.pendingUpdates.length,
          lastError: `Could not durably store changes: ${error.message}`,
        });
        throw new Error(error.message);
      }

      this.nextSequence += 1;
      this.updateSnapshot({
        durability: this.pendingUpdates.length === 0 ? "saved" : "pending",
        pendingUpdates: this.pendingUpdates.length,
      });
    }
  }

  getSnapshot(): CollaborationSnapshot {
    return { ...this.snapshot };
  }

  subscribe(listener: (snapshot: CollaborationSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private updateSnapshot(update: Partial<CollaborationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush().catch(() => undefined);
    this.destroyed = true;
    this.document.off("update", this.handleDocumentUpdate);
    window.removeEventListener("online", this.handleOnline);
    this.provider?.destroy();
    this.provider = null;
    this.awareness.destroy();
    this.listeners.clear();
  }
}

export const Y_SUPABASE_SPIKE_REVISION = UPSTREAM_REVISION;
