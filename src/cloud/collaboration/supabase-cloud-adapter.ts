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
const DURABLE_UPDATE_EVENT = "ghost-cloud-durable-update";
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
  onRoleVerified?: (role: CloudDocumentRole) => void | Promise<void>;
  onAccessRevoked?: () => void | Promise<void>;
}

/**
 * Retained collaboration boundary. Realtime is private and acknowledged;
 * durable state is an append-only Yjs update log protected independently by
 * Postgres RLS.
 */
export class SupabaseCloudAdapter implements CloudCollaborationSession {
  readonly document: Y.Doc;
  readonly awareness: Awareness;

  private readonly client: SupabaseClient;
  private readonly documentId: string;
  private readonly onRoleVerified?: SupabaseCloudAdapterOptions["onRoleVerified"];
  private readonly onAccessRevoked?: SupabaseCloudAdapterOptions["onAccessRevoked"];
  private readonly clientId = crypto.randomUUID();
  private readonly channelTargets = new WeakMap<RealtimeChannel, RealtimeChannel>();
  private readonly listeners = new Set<(snapshot: CloudCollaborationSnapshot) => void>();
  private readonly handleOnline = () => {
    if (this.serverHydrated) {
      void this.recoverConnectivity().catch(() => undefined);
    } else {
      void this.ensureNetworkBootstrap();
    }
  };
  private readonly handleFocus = () => {
    if (!this.serverHydrated) void this.ensureNetworkBootstrap();
  };
  private readonly handleDocumentUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE_ORIGIN || this.role === "viewer" || this.destroyed) return;
    if (!this.serverHydrated) {
      this.hasPreHydrationChanges = true;
      this.updateSnapshot({ durability: "pending", pendingUpdates: 1, lastError: null });
      return;
    }
    this.pendingUpdates.push(update);
    this.updateSnapshot({
      durability: "pending",
      pendingUpdates: this.pendingUpdates.length,
      lastError: null,
    });
    this.scheduleFlush();
  };

  private provider: SupabaseProvider | null = null;
  private realtimeChannel: RealtimeChannel | null = null;
  private pendingUpdates: Uint8Array[] = [];
  private pendingDurableSignal = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromise: Promise<void> | null = null;
  private reconcilePromise: Promise<void> | null = null;
  private bootstrapPromise: Promise<void> | null = null;
  private reconcileRequested = false;
  private lastDurableUpdateId: number;
  private currentRole: CloudDocumentRole;
  private serverHydrated: boolean;
  private hasPreHydrationChanges = false;
  private nextSequence = 1;
  private destroyed = false;
  private snapshot: CloudCollaborationSnapshot;

  private constructor(
    options: SupabaseCloudAdapterOptions,
    role: CloudDocumentRole,
    lastDurableUpdateId: number,
    serverHydrated: boolean,
  ) {
    this.client = options.client;
    this.document = options.document;
    this.documentId = options.documentId;
    this.onRoleVerified = options.onRoleVerified;
    this.onAccessRevoked = options.onAccessRevoked;
    this.lastDurableUpdateId = lastDurableUpdateId;
    this.currentRole = role;
    this.serverHydrated = serverHydrated;
    this.awareness = new Awareness(this.document);
    this.awareness.setLocalStateField("user", options.user);
    this.snapshot = {
      connection: serverHydrated || navigator.onLine ? "connecting" : "disconnected",
      synchronization: serverHydrated || navigator.onLine ? "loading" : "offline",
      durability: role === "viewer" ? "read-only" : serverHydrated ? "saved" : "loading",
      role,
      pendingUpdates: 0,
      lastError: null,
    };
  }

  static async create(options: SupabaseCloudAdapterOptions): Promise<SupabaseCloudAdapter> {
    const role = await this.loadRole(options.client, options.documentId);
    if (!role) throw new CloudAccessError();

    const serverState = await this.loadServerDocument(options.client, options.documentId);
    Y.applyUpdate(options.document, Y.encodeStateAsUpdate(serverState.document), REMOTE_ORIGIN);

    const adapter = new SupabaseCloudAdapter(options, role, serverState.lastUpdateId, true);
    if (role === "editor") {
      const localOnly = Y.encodeStateAsUpdate(
        options.document,
        Y.encodeStateVector(serverState.document),
      );
      if (localOnly.length > 2) {
        adapter.pendingUpdates.push(localOnly);
        adapter.updateSnapshot({ durability: "pending", pendingUpdates: 1 });
        await adapter.flush().catch(() => undefined);
      }
    }
    serverState.document.destroy();

    adapter.activate();
    adapter.notifyRoleVerified(role);
    adapter.connectRealtime();
    return adapter;
  }

  /**
   * Returns synchronously after IndexedDB has loaded. Supabase authorization,
   * durable catch-up, and Realtime connection continue in the background.
   */
  static createFromCache(
    options: SupabaseCloudAdapterOptions,
    cachedRole: CloudDocumentRole,
  ): SupabaseCloudAdapter {
    const adapter = new SupabaseCloudAdapter(options, cachedRole, 0, false);
    adapter.activate();
    void adapter.ensureNetworkBootstrap();
    return adapter;
  }

  get role(): CloudDocumentRole {
    return this.currentRole;
  }

  private activate(): void {
    this.document.on("update", this.handleDocumentUpdate);
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("focus", this.handleFocus);
  }

  private notifyRoleVerified(role: CloudDocumentRole): void {
    void Promise.resolve(this.onRoleVerified?.(role)).catch(() => undefined);
  }

  private async ensureNetworkBootstrap(): Promise<void> {
    if (this.destroyed || this.serverHydrated) return;
    if (this.bootstrapPromise) return this.bootstrapPromise;
    this.bootstrapPromise = this.bootstrapFromCache().catch(async (reason: unknown) => {
      if (this.destroyed) return;
      if (reason instanceof CloudAccessError) {
        this.currentRole = "viewer";
        this.updateSnapshot({
          connection: "disconnected",
          synchronization: "error",
          durability: "read-only",
          role: "viewer",
          pendingUpdates: 0,
          lastError: reason.message,
        });
        await this.onAccessRevoked?.();
        return;
      }
      this.updateSnapshot({
        connection: "disconnected",
        synchronization: "offline",
        durability: this.role === "viewer"
          ? "read-only"
          : this.hasPreHydrationChanges ? "pending" : "loading",
        pendingUpdates: this.hasPreHydrationChanges ? 1 : 0,
        lastError: null,
      });
    }).finally(() => {
      this.bootstrapPromise = null;
    });
    return this.bootstrapPromise;
  }

  private async bootstrapFromCache(): Promise<void> {
    this.updateSnapshot({
      connection: "connecting",
      synchronization: "loading",
      durability: this.role === "viewer" ? "read-only" : "loading",
      lastError: null,
    });
    const verifiedRole = await SupabaseCloudAdapter.loadRole(this.client, this.documentId);
    if (this.destroyed) return;
    if (!verifiedRole) throw new CloudAccessError();

    this.currentRole = verifiedRole;
    this.updateSnapshot({ role: verifiedRole });
    this.notifyRoleVerified(verifiedRole);

    const serverState = await SupabaseCloudAdapter.loadServerDocument(
      this.client,
      this.documentId,
    );
    if (this.destroyed) {
      serverState.document.destroy();
      return;
    }
    Y.applyUpdate(this.document, Y.encodeStateAsUpdate(serverState.document), REMOTE_ORIGIN);
    const localOnly = Y.encodeStateAsUpdate(
      this.document,
      Y.encodeStateVector(serverState.document),
    );
    this.lastDurableUpdateId = serverState.lastUpdateId;
    this.serverHydrated = true;
    this.hasPreHydrationChanges = false;
    serverState.document.destroy();

    if (verifiedRole === "editor" && localOnly.length > 2) {
      this.pendingUpdates.push(localOnly);
      this.updateSnapshot({ durability: "pending", pendingUpdates: 1 });
    } else if (verifiedRole === "viewer") {
      this.pendingUpdates = [];
      this.updateSnapshot({
        durability: "read-only",
        pendingUpdates: 0,
        lastError: localOnly.length > 2
          ? "Cloud access is now read-only; locally cached edits were not uploaded."
          : null,
      });
    } else {
      this.updateSnapshot({ durability: "saved", pendingUpdates: 0 });
    }

    this.connectRealtime();
    await this.flush().catch(() => undefined);
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
  ): Promise<{ document: Y.Doc; lastUpdateId: number }> {
    const { data, error } = await client
      .from("cloud_document_updates")
      .select("id, update")
      .eq("document_id", documentId)
      .order("id", { ascending: true })
      .returns<UpdateRow[]>();
    if (error) throw new Error(`Could not load Cloud document updates: ${error.message}`);

    const serverDocument = new Y.Doc();
    for (const row of data ?? []) Y.applyUpdate(serverDocument, decodeBase64(row.update));
    return {
      document: serverDocument,
      lastUpdateId: data && data.length > 0 ? data[data.length - 1].id : 0,
    };
  }

  private connectRealtime(): void {
    if (this.provider || this.destroyed || !this.serverHydrated) return;
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
    this.provider.on("status", (connection) => {
      this.updateSnapshot({
        connection,
        synchronization: connection === "connected"
          ? "loading"
          : connection === "disconnected"
            ? "offline"
            : "loading",
      });
      if (connection === "connected") {
        void this.recoverConnectivity().catch(() => undefined);
      }
    });
    this.provider.on("error", (error) => this.updateSnapshot({ lastError: error.message }));
  }

  private createPrivateChannel(name: string): RealtimeChannel {
    const channel = this.client.channel(name, {
      config: { private: true, broadcast: { ack: true } },
    });
    this.realtimeChannel = channel;
    channel.on("broadcast", { event: DURABLE_UPDATE_EVENT }, () => {
      void this.reconcileDurableUpdates().catch(() => undefined);
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

  private async recoverConnectivity(): Promise<void> {
    if (!this.serverHydrated) {
      await this.ensureNetworkBootstrap();
      return;
    }
    await this.flush();
    await this.reconcileDurableUpdates();
    await this.sendDurableSignal();
  }

  private async reconcileDurableUpdates(): Promise<void> {
    if (this.destroyed || !this.serverHydrated) return;
    this.reconcileRequested = true;
    if (this.reconcilePromise) return this.reconcilePromise;

    this.reconcilePromise = (async () => {
      while (this.reconcileRequested && !this.destroyed) {
        this.reconcileRequested = false;
        this.updateSnapshot({ synchronization: "loading" });

        let query = this.client
          .from("cloud_document_updates")
          .select("id, update")
          .eq("document_id", this.documentId);
        if (this.lastDurableUpdateId > 0) {
          query = query.gt("id", this.lastDurableUpdateId);
        }
        const { data, error } = await query
          .order("id", { ascending: true })
          .returns<UpdateRow[]>();
        if (error) {
          this.updateSnapshot({
            synchronization: "error",
            lastError: `Could not catch up Cloud changes: ${error.message}`,
          });
          throw new Error(error.message);
        }

        for (const row of data ?? []) {
          Y.applyUpdate(this.document, decodeBase64(row.update), REMOTE_ORIGIN);
          this.lastDurableUpdateId = Math.max(this.lastDurableUpdateId, row.id);
        }
      }
      this.updateSnapshot({
        synchronization: "synced",
        lastError: this.snapshot.durability === "error" ? this.snapshot.lastError : null,
      });
    })().finally(() => {
      this.reconcilePromise = null;
    });
    return this.reconcilePromise;
  }

  private async sendDurableSignal(): Promise<void> {
    if (
      !this.pendingDurableSignal
      || this.destroyed
      || this.snapshot.connection !== "connected"
      || !this.realtimeChannel
    ) return;

    try {
      const status = await this.realtimeChannel.send({
        type: "broadcast",
        event: DURABLE_UPDATE_EVENT,
        payload: { timestamp: Date.now() },
      });
      if (status !== "ok") {
        this.updateSnapshot({ lastError: `Cloud catch-up signal was not acknowledged (${status}).` });
        return;
      }
      this.pendingDurableSignal = false;
    } catch (reason) {
      this.updateSnapshot({
        lastError: reason instanceof Error
          ? `Could not announce durable Cloud changes: ${reason.message}`
          : "Could not announce durable Cloud changes.",
      });
    }
  }

  async flush(): Promise<void> {
    if (
      this.role === "viewer"
      || this.destroyed
      || !this.serverHydrated
      || this.pendingUpdates.length === 0
    ) return;
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
      this.pendingDurableSignal = true;
      await this.sendDurableSignal();
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
    window.removeEventListener("focus", this.handleFocus);
    this.provider?.destroy();
    this.realtimeChannel = null;
    this.awareness.destroy();
    this.listeners.clear();
  }
}
