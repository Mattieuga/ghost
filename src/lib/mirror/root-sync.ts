import type { SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { encodeBase64 } from "@/cloud/collaboration/base64";
import {
  adoptCloudItems,
  createCloudItem,
  listCloudItems,
  moveCloudItem,
  renameCloudItem,
  trashCloudItem,
} from "@/cloud/cloud-data";
import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import {
  adoptDocument,
  commitIndexPass,
  defaultDocumentId,
  LocalStoreUnavailableError,
  mutateGhostIndex,
  readGhostFolder,
  relocateIndexEntry,
  type PersistenceHandle,
} from "@/lib/mirror/adoption";
import {
  reconcileIndexWithDisk,
  relativeToRoot,
  type GhostIndex,
} from "@/lib/mirror/ghost-index";
import type { MirrorFs } from "@/lib/mirror/mirror-fs";

/**
 * Keeps a mirrored root's index and its Cloud tree in step with the files on
 * disk: a deleted file goes to Cloud Trash, a renamed or moved file keeps
 * its document, and a new file is adopted and created in Cloud. Runs on
 * launch and whenever the watcher reports a change below the root.
 */
export interface RootSyncDeps {
  fs: MirrorFs;
  /** Present when signed in. Cloud calls happen only for uploaded roots. */
  client: SupabaseClient | null;
  openPersistence(rootId: string, documentId: string, document: Y.Doc): Promise<PersistenceHandle>;
  newDocumentId?: () => string;
  /** Files an editor is handling live are left to it. */
  isOpen?: (absolutePath: string) => boolean;
}

export interface RootSyncResult {
  added: string[];
  removed: string[];
  renamed: Array<{ from: string; to: string }>;
  /** Documents put into Cloud on this pass: new files, and older entries never marked. */
  uploaded: string[];
  /** Whether Cloud was updated too. */
  cloud: boolean;
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function parentOf(relativePath: string): string | null {
  return relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : null;
}

function isAlreadyExists(error: unknown): boolean {
  return /already exists/i.test(error instanceof Error ? error.message : String(error));
}

function isNotFound(error: unknown): boolean {
  return /not found/i.test(error instanceof Error ? error.message : String(error));
}

interface CloudContext {
  client: SupabaseClient;
  cloudRootId: string;
  workspaceId: string | null;
}

/** The Cloud folder for a relative directory, creating missing ancestors. */
async function ensureCloudFolder(
  deps: RootSyncDeps,
  cloud: CloudContext,
  index: GhostIndex,
  relativeDir: string | null,
): Promise<string> {
  if (!relativeDir) return cloud.cloudRootId;
  const known = index.folders[relativeDir];
  if (known) return known;
  const parentId = await ensureCloudFolder(deps, cloud, index, parentOf(relativeDir));
  const id = (deps.newDocumentId ?? defaultDocumentId)();
  try {
    await createCloudItem(cloud.client, "folder", nameOf(relativeDir), parentId, { itemId: id });
    index.folders[relativeDir] = id;
    return id;
  } catch (error) {
    if (!isAlreadyExists(error) || !cloud.workspaceId) throw error;
    // A folder with that name exists from another device or an earlier run.
    const items = await listCloudItems(cloud.client, cloud.workspaceId);
    const match = items.find((item) => item.kind === "folder"
      && item.parent_id === parentId
      && item.name.toLowerCase() === nameOf(relativeDir).toLowerCase());
    if (!match) throw error;
    index.folders[relativeDir] = match.id;
    return match.id;
  }
}

async function pushDocumentState(deps: RootSyncDeps, root: TrackedRoot, cloud: CloudContext, documentId: string): Promise<void> {
  const document = new Y.Doc();
  const persistence = await deps.openPersistence(root.id, documentId, document);
  try {
    const update = Y.encodeStateAsUpdate(document);
    if (update.length <= 2) return;
    const { error } = await cloud.client
      .from("cloud_document_updates")
      .upsert(
        {
          document_id: documentId,
          client_id: (deps.newDocumentId ?? defaultDocumentId)(),
          client_sequence: 1,
          update: encodeBase64(update),
        },
        { onConflict: "document_id,client_id,client_sequence", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
  } finally {
    await persistence.destroy().catch(() => undefined);
    document.destroy();
  }
}

/**
 * Make sure one adopted document exists in Cloud under its own ID, creating
 * ancestors as needed and pushing its state the first time. Idempotent
 * through the index's `cloudDocumentId`.
 */
export async function ensureCloudDocument(
  deps: RootSyncDeps,
  root: TrackedRoot,
  relativePath: string,
  documentId: string,
): Promise<boolean> {
  const cloudRootId = root.cloudRootId;
  if (!deps.client || !cloudRootId) return false;
  const { index } = await readGhostFolder(deps.fs, root.path);
  const entry = index.documents[relativePath];
  if (entry?.cloudDocumentId) return false;
  const cloud: CloudContext = { client: deps.client, cloudRootId, workspaceId: null };
  await putDocumentInCloud(deps, root, cloud, index, relativePath, documentId);
  await mutateGhostIndex(deps.fs, root.path, (current) => {
    const live = current.documents[relativePath];
    if (live && live.documentId === documentId) current.documents[relativePath] = { ...live, cloudDocumentId: documentId };
    current.folders = { ...index.folders, ...current.folders };
  });
  return true;
}

/** Put a Cloud item where its file now is: the right folder, the right name. */
async function placeInCloud(
  deps: RootSyncDeps,
  cloud: CloudContext,
  index: GhostIndex,
  relativePath: string,
  cloudId: string,
): Promise<void> {
  const parentId = await ensureCloudFolder(deps, cloud, index, parentOf(relativePath));
  try {
    await moveCloudItem(cloud.client, cloudId, parentId);
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
  try {
    await renameCloudItem(cloud.client, cloudId, nameOf(relativePath));
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
  }
}

/**
 * A file Ghost itself renamed or moved keeps its document: the index entry
 * follows it at once, and Cloud follows when signed in, or on the next
 * signed-in pass otherwise. Returns false when the index had no entry.
 */
export async function relocateDocument(
  deps: RootSyncDeps,
  root: TrackedRoot,
  fromRelative: string,
  toRelative: string,
): Promise<boolean> {
  const { metadata } = await readGhostFolder(deps.fs, root.path);
  const cloudRootId = root.cloudRootId ?? metadata?.cloudRootId ?? null;
  const cloud: CloudContext | null = deps.client && cloudRootId
    ? { client: deps.client, cloudRootId, workspaceId: null }
    : null;
  const entry = await relocateIndexEntry(deps.fs, root.path, fromRelative, toRelative, {
    cloudStale: Boolean(cloudRootId) && !cloud,
  });
  if (!entry) return false;
  const cloudId = entry.cloudDocumentId ?? (cloudRootId ? entry.documentId : null);
  if (!cloud || !cloudId) return true;
  const { index } = await readGhostFolder(deps.fs, root.path);
  try {
    await placeInCloud(deps, cloud, index, toRelative, cloudId);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
  await mutateGhostIndex(deps.fs, root.path, (current) => {
    current.folders = { ...index.folders, ...current.folders };
    const live = current.documents[toRelative];
    if (live?.cloudStale) {
      const { cloudStale: _stale, ...rest } = live;
      current.documents[toRelative] = rest;
    }
  });
  return true;
}

async function putDocumentInCloud(
  deps: RootSyncDeps,
  root: TrackedRoot,
  cloud: CloudContext,
  index: GhostIndex,
  relativePath: string,
  documentId: string,
): Promise<void> {
  const parentId = await ensureCloudFolder(deps, cloud, index, parentOf(relativePath));
  await adoptCloudItems(cloud.client, [{ id: documentId, parent_id: parentId, kind: "document", name: nameOf(relativePath) }]);
  await pushDocumentState(deps, root, cloud, documentId);
}

export async function reconcileMirroredRoot(
  deps: RootSyncDeps,
  root: TrackedRoot,
): Promise<RootSyncResult> {
  const { fs } = deps;
  const { metadata, index } = await readGhostFolder(fs, root.path);
  const cloudRootId = root.cloudRootId ?? metadata?.cloudRootId ?? null;
  const cloud: CloudContext | null = deps.client && cloudRootId
    ? { client: deps.client, cloudRootId, workspaceId: null }
    : null;
  const isOpen = deps.isOpen ?? (() => false);
  // Roots uploaded before the index tracked Cloud IDs used the document ID
  // as the Cloud ID, so that is the fallback for an uploaded root.
  const cloudIdOf = (entry: { documentId: string; cloudDocumentId?: string }) => (
    entry.cloudDocumentId ?? (cloudRootId ? entry.documentId : null)
  );

  const files = await fs.listMarkdownFiles(root.path);
  const onDisk = await Promise.all(files.map(async (absolutePath) => ({
    relativePath: relativeToRoot(root.path, absolutePath) ?? absolutePath,
    contentHash: await fs.hashFile(absolutePath),
  })));
  // What this pass started from, so the commit can tell its own changes
  // from what the editor recorded meanwhile.
  const snapshot = structuredClone(index);
  const reconciliation = reconcileIndexWithDisk(index, onDisk);
  const next = reconciliation.index;

  // An uploaded root's deletions and renames reach Cloud only while signed
  // in. Until then the index keeps the old entries, so the next signed-in
  // pass sees the same difference and carries it over.
  const deferToCloud = Boolean(cloudRootId) && !cloud;

  const removed: string[] = [];
  for (const relativePath of reconciliation.removed) {
    const entry = index.documents[relativePath];
    if (isOpen(`${root.path}/${relativePath}`) || deferToCloud) {
      next.documents[relativePath] = entry;
      continue;
    }
    const cloudId = cloudIdOf(entry);
    if (cloud && cloudId) {
      try {
        await trashCloudItem(cloud.client, cloudId);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    removed.push(relativePath);
  }

  const renamed: Array<{ from: string; to: string }> = [];
  for (const move of reconciliation.renamed) {
    const entry = next.documents[move.to];
    renamed.push(move);
    if (deferToCloud) {
      // The file keeps its new place; Cloud catches up on the next signed-in pass.
      if (cloudIdOf(entry)) next.documents[move.to] = { ...entry, cloudStale: true };
      continue;
    }
    const cloudId = cloudIdOf(entry);
    if (!cloud || !cloudId) continue;
    const fromParent = parentOf(move.from);
    const toParent = parentOf(move.to);
    try {
      if (fromParent !== toParent) {
        const parentId = await ensureCloudFolder(deps, cloud, next, toParent);
        await moveCloudItem(cloud.client, cloudId, parentId);
      }
      if (nameOf(move.from) !== nameOf(move.to)) {
        await renameCloudItem(cloud.client, cloudId, nameOf(move.to));
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  // Renames and moves made while signed out reach Cloud now.
  if (cloud) {
    for (const [relativePath, entry] of Object.entries(next.documents)) {
      if (!entry.cloudStale) continue;
      const cloudId = cloudIdOf(entry);
      if (cloudId) {
        try {
          await placeInCloud(deps, cloud, next, relativePath, cloudId);
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }
      const { cloudStale: _stale, ...rest } = entry;
      next.documents[relativePath] = rest;
    }
  }

  const added: string[] = [];
  for (const relativePath of reconciliation.added) {
    if (isOpen(`${root.path}/${relativePath}`)) continue;
    let adopted;
    try {
      adopted = await adoptDocument(
        {
          fs,
          openPersistence: deps.openPersistence,
          newDocumentId: deps.newDocumentId ?? defaultDocumentId,
          now: () => new Date(),
        },
        root.path,
        root.id,
        relativePath,
        null,
      );
    } catch (error) {
      // Without a store nothing can be decided; the next pass tries again.
      if (error instanceof LocalStoreUnavailableError) continue;
      throw error;
    }
    next.documents[relativePath] = adopted.entry;
    added.push(relativePath);
  }

  // Every document the index does not mark as in Cloud goes there now: the
  // files adopted above, files adopted while signed out, and entries from
  // before the mark existed. Adoption is idempotent for known IDs.
  const uploaded: string[] = [];
  if (cloud) {
    for (const [relativePath, entry] of Object.entries(next.documents)) {
      if (entry.cloudDocumentId || isOpen(`${root.path}/${relativePath}`)) continue;
      await putDocumentInCloud(deps, root, cloud, next, relativePath, entry.documentId);
      next.documents[relativePath] = { ...entry, cloudDocumentId: entry.documentId };
      uploaded.push(relativePath);
    }
  }

  await commitIndexPass(fs, root.path, snapshot, next);
  return { added, removed, renamed, uploaded, cloud: cloud !== null };
}
