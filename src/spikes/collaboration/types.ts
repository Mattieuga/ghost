import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

export type CollaborationRole = "editor" | "viewer";
export type ConnectionStatus = "connecting" | "connected" | "disconnected";
export type SynchronizationStatus = "loading" | "synced" | "error";
export type DurabilityStatus = "loading" | "saved" | "pending" | "saving" | "error" | "read-only";

export interface CollaborationSnapshot {
  connection: ConnectionStatus;
  synchronization: SynchronizationStatus;
  durability: DurabilityStatus;
  role: CollaborationRole;
  pendingUpdates: number;
  lastError: string | null;
}

export interface CollaborationAdapter {
  readonly document: Y.Doc;
  readonly awareness: Awareness;
  readonly role: CollaborationRole;

  getSnapshot(): CollaborationSnapshot;
  subscribe(listener: (snapshot: CollaborationSnapshot) => void): () => void;
  flush(): Promise<void>;
  destroy(): Promise<void>;
}

export class CollaborationAccessError extends Error {
  readonly userId: string;

  constructor(userId: string) {
    super("This prototype user has not been assigned to the collaboration room.");
    this.name = "CollaborationAccessError";
    this.userId = userId;
  }
}
