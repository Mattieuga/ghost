import type * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type {
  CloudCollaborationSession,
  CloudCollaborationSnapshot,
} from "@/cloud/collaboration/types";

export interface LocalSessionUser {
  name: string;
  color: string;
}

/**
 * A collaboration session with no network: one editor, one Yjs document,
 * and a local store. Mirrored roots use it before an account exists, and
 * the editor cannot tell it apart from a cloud session.
 */
export class LocalCollaborationSession implements CloudCollaborationSession {
  readonly document: Y.Doc;
  readonly awareness: Awareness;
  readonly role = "editor" as const;
  private readonly listeners = new Set<(snapshot: CloudCollaborationSnapshot) => void>();
  private readonly snapshot: CloudCollaborationSnapshot = {
    connection: "disconnected",
    synchronization: "synced",
    durability: "saved",
    role: "editor",
    pendingUpdates: 0,
    lastError: null,
  };

  constructor(document: Y.Doc, user: LocalSessionUser = { name: "You", color: "#ff7145" }) {
    this.document = document;
    this.awareness = new Awareness(document);
    this.awareness.setLocalStateField("user", user);
  }

  getSnapshot(): CloudCollaborationSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: CloudCollaborationSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async flush(): Promise<void> {
    // Durability for a local session is the disk mirror, owned by MirrorWriter.
  }

  async destroy(): Promise<void> {
    this.awareness.destroy();
    this.listeners.clear();
  }
}
