import { IndexeddbPersistence } from "y-indexeddb";
import type * as Y from "yjs";

const LOCAL_PERSISTENCE_VERSION = 1;
const LOCAL_PERSISTENCE_OPEN_TIMEOUT_MS = 5_000;

export type CloudLocalPersistenceStatus = "ready" | "unavailable";

export interface CloudLocalPersistenceHandle {
  readonly status: CloudLocalPersistenceStatus;
  readonly message: string | null;
  destroy(): Promise<void>;
  clear(): Promise<void>;
}

export function cloudLocalPersistenceKey(userId: string, documentId: string): string {
  return `ghost-cloud:v${LOCAL_PERSISTENCE_VERSION}:${userId}:${documentId}`;
}

function unavailableHandle(message: string): CloudLocalPersistenceHandle {
  return {
    status: "unavailable",
    message,
    destroy: async () => undefined,
    clear: async () => undefined,
  };
}

/**
 * Opens the account-scoped local Yjs cache before the network adapter. Loading
 * local updates first lets the adapter calculate and upload any edits that
 * survived a process or browser restart.
 */
export async function openCloudLocalPersistence(
  userId: string,
  documentId: string,
  document: Y.Doc,
): Promise<CloudLocalPersistenceHandle> {
  if (typeof indexedDB === "undefined") {
    return unavailableHandle("This browser does not provide IndexedDB.");
  }

  let persistence: IndexeddbPersistence;
  try {
    persistence = new IndexeddbPersistence(
      cloudLocalPersistenceKey(userId, documentId),
      document,
    );
  } catch (reason) {
    return unavailableHandle(
      reason instanceof Error ? reason.message : "Local document storage is unavailable.",
    );
  }

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    const databaseFailure = new Promise<never>((_resolve, reject) => {
      const databasePromise = (persistence as IndexeddbPersistence & {
        _db?: Promise<IDBDatabase>;
      })._db;
      void databasePromise?.catch(reject);
    });
    await Promise.race([
      persistence.whenSynced,
      databaseFailure,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Local document storage did not become ready.")),
          LOCAL_PERSISTENCE_OPEN_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (reason) {
    await persistence.destroy().catch(() => undefined);
    return unavailableHandle(
      reason instanceof Error ? reason.message : "Local document storage is unavailable.",
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  let closed = false;
  return {
    status: "ready",
    message: null,
    destroy: async () => {
      if (closed) return;
      closed = true;
      await persistence.destroy();
    },
    clear: async () => {
      if (closed) return;
      closed = true;
      await persistence.clearData();
    },
  };
}
