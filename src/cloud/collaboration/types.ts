import type { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";

export type CloudDocumentRole = "editor" | "viewer";
export type CloudConnectionStatus = "connecting" | "connected" | "disconnected";
export type CloudSyncStatus = "loading" | "synced" | "error";
export type CloudDurabilityStatus = "loading" | "saved" | "pending" | "saving" | "error" | "read-only";

export interface CloudCollaborationSnapshot {
  connection: CloudConnectionStatus;
  synchronization: CloudSyncStatus;
  durability: CloudDurabilityStatus;
  role: CloudDocumentRole;
  pendingUpdates: number;
  lastError: string | null;
}

export interface CloudCollaborationSession {
  readonly document: Y.Doc;
  readonly awareness: Awareness;
  readonly role: CloudDocumentRole;
  getSnapshot(): CloudCollaborationSnapshot;
  subscribe(listener: (snapshot: CloudCollaborationSnapshot) => void): () => void;
  flush(): Promise<void>;
  destroy(): Promise<void>;
}

export class CloudAccessError extends Error {
  constructor() {
    super("You no longer have access to this Cloud document.");
    this.name = "CloudAccessError";
  }
}
