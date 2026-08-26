import { SupabaseProvider } from "@supabase-labs/y-supabase";
import type {
  RealtimeChannel,
  RealtimeChannelSendResponse,
  SupabaseClient,
} from "@supabase/supabase-js";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { decodeBase64, encodeBase64 } from "@/cloud/collaboration/base64";
import {
  CloudAccessError,
  type CloudCollaborationSession,
  type CloudCollaborationSnapshot,
  type CloudDocumentRole,
} from "@/cloud/collaboration/types";

// y-supabase applies received updates with this exact origin. Keep the value
// aligned so a remote edit is not appended to the durable log again as if it
// were a new local edit.
const REMOTE_ORIGIN = "remote";
const UPDATE_EVENT = "y-supabase-update";
const STATE_VECTOR_EVENT = "y-supabase-state-vector";
const AWARENESS_EVENT = "y-supabase-awareness";
const STORE_DELAY_MS = 120;

interface UpdateRow {
  id: number;
  update: string;
}

export interface SupabaseCloudAdapterOptions {
  client: SupabaseClient;
  document: Y.Doc;
  documentId: string;
  user: { name: string; color: string };
}

/**
 * Retained collaboration boundary. Realtime is private and acknowledged;
 * durable state is an append-only Yjs update log protected independently by
 * Postgres RLS.
 */
export class SupabaseCloudAdapter implements CloudCollaborationSession {
  readonly document: Y.Doc;
  readonly awareness: Awareness;
  readonly role: CloudDocumentRole;

  private readonly client: SupabaseClient;
  private readonly documentId: string;
  private readonly clientId = crypto.randomUUID();
  private readonly channelTargets = new WeakMap<RealtimeChannel, RealtimeChannel>();
  private readonly listeners = new Set<(snapshot: CloudCollaborationSnapshot) => void>();
  private readonly handleOnline = () => { void this.flush().catch(() => undefined); };
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
  private snapshot: CloudCollaborationSnapshot;

  private constructor(options: SupabaseCloudAdapterOptions, role: CloudDocumentRole) {
    this.client = options.client;
    this.document = options.document;
    this.documentId = options.documentId;
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

  static async create(options: SupabaseCloudAdapterOptions): Promise<SupabaseCloudAdapter> {
    const role = await this.loadRole(options.client, options.documentId);
    if (!role) throw new CloudAccessError();

    const serverDocument = await this.loadServerDocument(options.client, options.documentId);
    Y.applyUpdate(options.document, Y.encodeStateAsUpdate(serverDocument), REMOTE_ORIGIN);

    const adapter = new SupabaseCloudAdapter(options, role);
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
    documentId: string,
  ): Promise<CloudDocumentRole | null> {
    const { data, error } = await client.rpc("cloud_document_role", {
      target_document_id: documentId,
    });
    if (error) throw new Error(`Could not load Cloud document access: ${error.message}`);
    if (data === "owner" || data === "editor") return "editor";
    if (data === "viewer") return "viewer";
    return null;
  }

  private static async loadServerDocument(
    client: SupabaseClient,
    documentId: string,
  ): Promise<Y.Doc> {
    const { data, error } = await client
      .from("cloud_document_updates")
      .select("id, update")
      .eq("document_id", documentId)
      .order("id", { ascending: true })
      .returns<UpdateRow[]>();
    if (error) throw new Error(`Could not load Cloud document updates: ${error.message}`);

    const serverDocument = new Y.Doc();
    for (const row of data ?? []) Y.applyUpdate(serverDocument, decodeBase64(row.update));
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
      `ghost-cloud:${this.documentId}`,
      this.document,
      realtimeClient,
      {
        awareness: this.awareness,
        broadcastThrottleMs: 0,
        autoReconnect: true,
        reconnectDelay: 500,
        maxReconnectDelay: 10_000,
      },
    );
    this.provider.on("status", (connection) => this.updateSnapshot({ connection }));
    this.provider.on("error", (error) => this.updateSnapshot({ lastError: error.message }));
  }

  private createPrivateChannel(name: string): RealtimeChannel {
    const channel = this.client.channel(name, {
      config: { private: true, broadcast: { ack: true } },
    });
    const send = channel.send.bind(channel);
    const privateChannel = new Proxy(channel, {
      get: (target, property) => {
        if (property === "send") {
          return (
            args: Parameters<RealtimeChannel["send"]>[0],
            options?: Parameters<RealtimeChannel["send"]>[1],
          ): Promise<RealtimeChannelSendResponse> => {
            if (this.role === "viewer" && this.isYjsWriteEvent(args.event)) {
              return Promise.resolve("ok");
            }
            const result = send(args, options);
            void result.then((status) => {
              if (status !== "ok") {
                this.updateSnapshot({ lastError: `Realtime was not acknowledged (${status}).` });
              }
            }).catch((reason: unknown) => {
              this.updateSnapshot({
                lastError: reason instanceof Error ? reason.message : "Realtime failed.",
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
    this.flushPromise = this.flushPendingUpdates().finally(() => { this.flushPromise = null; });
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

      const { error } = await this.client.from("cloud_document_updates").upsert({
        document_id: this.documentId,
        client_id: this.clientId,
        client_sequence: this.nextSequence,
        update: encodeBase64(merged),
      }, {
        onConflict: "document_id,client_id,client_sequence",
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

  getSnapshot(): CloudCollaborationSnapshot { return { ...this.snapshot }; }

  subscribe(listener: (snapshot: CloudCollaborationSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private updateSnapshot(update: Partial<CloudCollaborationSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...update };
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.flush().catch(() => undefined);
    this.destroyed = true;
    this.document.off("update", this.handleDocumentUpdate);
    window.removeEventListener("online", this.handleOnline);
    this.provider?.destroy();
    this.awareness.destroy();
    this.listeners.clear();
  }
}
