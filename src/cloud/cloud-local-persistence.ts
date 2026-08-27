import { IndexeddbPersistence } from "y-indexeddb";
import type * as Y from "yjs";
import type { CloudDocumentRole } from "@/cloud/collaboration/types";

const LOCAL_PERSISTENCE_VERSION = 1;
const LOCAL_PERSISTENCE_OPEN_TIMEOUT_MS = 5_000;
const ACCESS_METADATA_KEY = "ghost-cloud-access";

export type CloudLocalPersistenceStatus = "ready" | "unavailable";

export interface CloudLocalPersistenceHandle {
  readonly status: CloudLocalPersistenceStatus;
  readonly message: string | null;
  readonly cachedRole: CloudDocumentRole | null;
  rememberRole(role: CloudDocumentRole): Promise<void>;
  destroy(): Promise<void>;
  clear(): Promise<void>;
}

interface CloudLocalAccessMetadata {
  version: 1;
  role: CloudDocumentRole;
  verifiedAt: string;
}

export function cloudLocalPersistenceKey(userId: string, documentId: string): string {
  return `ghost-cloud:v${LOCAL_PERSISTENCE_VERSION}:${userId}:${documentId}`;
}

function unavailableHandle(message: string): CloudLocalPersistenceHandle {
  return {
    status: "unavailable",
    message,
    cachedRole: null,
    rememberRole: async () => undefined,
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

  const cachedMetadata = await persistence.get(ACCESS_METADATA_KEY).catch(() => null);
  const cachedRole = parseCloudLocalAccessMetadata(cachedMetadata)?.role ?? null;
  let closed = false;
  return {
    status: "ready",
    message: null,
    cachedRole,
    rememberRole: async (role) => {
      if (closed) return;
      const metadata: CloudLocalAccessMetadata = {
        version: 1,
        role,
        verifiedAt: new Date().toISOString(),
      };
      await persistence.set(ACCESS_METADATA_KEY, JSON.stringify(metadata));
    },
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

function parseCloudLocalAccessMetadata(value: unknown): CloudLocalAccessMetadata | null {
  if (typeof value !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const metadata = parsed as Partial<CloudLocalAccessMetadata>;
  return metadata.version === 1
    && (metadata.role === "editor" || metadata.role === "viewer")
    && typeof metadata.verifiedAt === "string"
    ? metadata as CloudLocalAccessMetadata
    : null;
}
