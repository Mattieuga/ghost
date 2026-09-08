import type { SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { encodeBase64 } from "@/cloud/collaboration/base64";
import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import { mutateGhostIndex, readGhostFolder, writeGhostFolderMetadata, type PersistenceHandle } from "@/lib/mirror/adoption";
import { isMissingSharingFunction, listVisibleCloudItems } from "@/cloud/cloud-sharing";
import { listLocalVersions } from "@/lib/mirror/local-versions";
import type { MirrorFs } from "@/lib/mirror/mirror-fs";

export interface CloudUploadDeps {
  client: SupabaseClient;
  fs: MirrorFs;
  openPersistence(rootId: string, documentId: string, document: Y.Doc): Promise<PersistenceHandle>;
  /** `~/Ghost`, so the Notes root can be anchored as such. */
  ghostFolder: string | null;
  newId?: () => string;
}

export interface CloudUploadResult {
  cloudRootId: string;
  documents: number;
  versions: number;
  /** True when the root had already been uploaded and nothing was sent. */
  alreadyUploaded: boolean;
}

export interface CloudUploadOptions {
  /**
   * Upload as a new copy under new Cloud IDs, for an account that has never
   * had this root. The local document IDs stay; the index maps each to its
   * Cloud ID.
   */
  freshIds?: boolean;
  /** Recorded in `.ghost/folder.json` as the account the Cloud copy belongs to. */
  ownerId?: string | null;
}

interface AdoptItem {
  id: string;
  parent_id: string | null;
  kind: "folder" | "document";
  name: string;
  root_kind?: "notes" | "folder";
}

const VERSION_BATCH = 100;

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** Whether an RPC error means the server has not received the synced-folders migration. */
export function isMissingServerFunction(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /could not find the function|does not exist|schema cache/i.test(message);
}

/**
 * Upload a mirrored root the first time an account exists: create the
 * folder tree with the client's IDs, push each document's Yjs state as the
 * first durable update, and send local history. Idempotent: the server
 * returns existing rows for known IDs, and the root remembers its Cloud ID.
 */
export async function uploadMirroredRoot(
  deps: CloudUploadDeps,
  root: TrackedRoot,
  options: CloudUploadOptions = {},
): Promise<CloudUploadResult> {
  const { fs, client } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const { metadata, index } = await readGhostFolder(fs, root.path);
  if (metadata?.cloudRootId && !options.freshIds) {
    return { cloudRootId: metadata.cloudRootId, documents: 0, versions: 0, alreadyUploaded: true };
  }
  const fresh = Boolean(options.freshIds);

  const isNotes = deps.ghostFolder !== null && root.path === `${deps.ghostFolder}/Notes`;
  // A Cloud has one Notes root. If the web app started it first, this Mac's
  // Notes joins it instead of asking the server for a second one.
  const cloudRootId = (isNotes && await existingNotesRootId(client)) || (fresh ? newId() : root.id);
  const items: AdoptItem[] = [{
    id: cloudRootId,
    parent_id: null,
    kind: "folder",
    name: nameOf(root.path),
    root_kind: isNotes ? "notes" : "folder",
  }];
  // Each document's Cloud ID: its own ID the first time, a new one for a copy.
  const cloudIdOf = new Map<string, string>();
  for (const entry of Object.values(index.documents)) cloudIdOf.set(entry.documentId, fresh ? newId() : entry.documentId);

  // Folders first, shallowest first, so every parent precedes its children.
  const folders = fresh ? {} : { ...index.folders };
  const folderPaths = new Set<string>();
  for (const relativePath of Object.keys(index.documents)) {
    const parts = relativePath.split("/");
    for (let depth = 1; depth < parts.length; depth += 1) folderPaths.add(parts.slice(0, depth).join("/"));
  }
  for (const folderPath of [...folderPaths].sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b))) {
    folders[folderPath] ??= newId();
    const parentPath = folderPath.includes("/") ? folderPath.slice(0, folderPath.lastIndexOf("/")) : null;
    items.push({
      id: folders[folderPath],
      parent_id: parentPath ? folders[parentPath] : cloudRootId,
      kind: "folder",
      name: nameOf(folderPath),
    });
  }
  for (const [relativePath, entry] of Object.entries(index.documents)) {
    const parentPath = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : null;
    items.push({
      id: cloudIdOf.get(entry.documentId) ?? entry.documentId,
      parent_id: parentPath ? folders[parentPath] : cloudRootId,
      kind: "document",
      name: nameOf(relativePath),
    });
  }
  if (fresh || Object.keys(folders).length !== Object.keys(index.folders ?? {}).length) {
    await mutateGhostIndex(fs, root.path, (current) => { current.folders = fresh ? folders : { ...current.folders, ...folders }; });
  }

  for (let start = 0; start < items.length; start += 500) {
    const { error } = await client.rpc("cloud_adopt_items", { items: items.slice(start, start + 500) });
    if (error) throw new Error(error.message);
  }

  const uploadClientId = newId();
  let documents = 0;
  let versions = 0;
  for (const [relativePath, entry] of Object.entries(index.documents)) {
    const cloudId = cloudIdOf.get(entry.documentId) ?? entry.documentId;
    const document = new Y.Doc();
    const persistence = await deps.openPersistence(root.id, entry.documentId, document);
    try {
      const update = Y.encodeStateAsUpdate(document);
      if (update.length > 2) {
        const { error } = await client
          .from("cloud_document_updates")
          .upsert(
            {
              document_id: cloudId,
              client_id: uploadClientId,
              client_sequence: 1,
              update: encodeBase64(update),
            },
            { onConflict: "document_id,client_id,client_sequence", ignoreDuplicates: true },
          );
        if (error) throw new Error(`${relativePath}: ${error.message}`);
      }
      documents += 1;
    } finally {
      await persistence.destroy().catch(() => undefined);
      document.destroy();
    }

    const localVersions = await listLocalVersions(
      {
        ensureDir: (path) => fs.ensureDir(path),
        writeText: async () => undefined,
        readText: (path) => fs.readText(path),
        listFiles: (dir) => fs.listFiles(dir),
        removeFile: async () => undefined,
      },
      root.path,
      entry.documentId,
    );
    const payload: Array<{ markdown: string; yjs: string; reason: string; created_at: string }> = [];
    for (const version of localVersions) {
      const [markdown, yjs] = await Promise.all([
        fs.readText(version.markdownPath).catch(() => null),
        fs.readText(version.yjsPath).catch(() => null),
      ]);
      if (markdown === null || yjs === null) continue;
      payload.push({ markdown, yjs, reason: version.reason, created_at: version.createdAt });
    }
    for (let start = 0; start < payload.length; start += VERSION_BATCH) {
      const { data, error } = await client.rpc("cloud_upload_document_versions", {
        target_document_id: cloudId,
        versions: payload.slice(start, start + VERSION_BATCH),
      });
      if (error) throw new Error(`${relativePath} history: ${error.message}`);
      versions += typeof data === "number" ? data : 0;
    }
  }

  await mutateGhostIndex(fs, root.path, (current) => {
    for (const [relativePath, entry] of Object.entries(current.documents)) {
      const cloudId = cloudIdOf.get(entry.documentId);
      if (!cloudId) continue;
      // What was sent to another account's bucket does not count here.
      const { cloudCursor: _cursor, cloudStale: _stale, cloudStaleFrom: _from, assets: _assets, ...rest } = entry;
      current.documents[relativePath] = { ...rest, cloudDocumentId: cloudId };
    }
  });
  await writeGhostFolderMetadata(fs, root.path, {
    version: 1,
    rootId: root.id,
    cloudRootId,
    cloudOwnerId: options.ownerId ?? metadata?.cloudOwnerId ?? null,
    createdAt: metadata?.createdAt ?? new Date().toISOString(),
  });

  return { cloudRootId, documents, versions, alreadyUploaded: false };
}

/**
 * Each account that has had this root in its Cloud keeps a link file under
 * `.ghost/cloud-links/`: the Cloud root, the folder IDs, and each local
 * document's Cloud ID. Switching accounts on one Mac saves the leaving
 * account's link and restores the arriving account's, so a root is never
 * uploaded twice to the same Cloud.
 */
interface CloudLink {
  version: 1;
  cloudRootId: string;
  folders: Record<string, string>;
  documents: Record<string, string>;
}

function cloudLinkPath(rootPath: string, ownerId: string): string {
  return `${rootPath}/.ghost/cloud-links/${ownerId}.json`;
}

export async function saveCloudLink(fs: MirrorFs, rootPath: string, ownerId: string): Promise<void> {
  const { metadata, index } = await readGhostFolder(fs, rootPath);
  if (!metadata?.cloudRootId) return;
  const documents: Record<string, string> = {};
  for (const entry of Object.values(index.documents)) {
    if (entry.cloudDocumentId) documents[entry.documentId] = entry.cloudDocumentId;
  }
  const link: CloudLink = { version: 1, cloudRootId: metadata.cloudRootId, folders: { ...index.folders }, documents };
  await fs.ensureDir(`${rootPath}/.ghost/cloud-links`);
  await fs.writeText(cloudLinkPath(rootPath, ownerId), `${JSON.stringify(link, null, 2)}\n`, { expectedVersion: null, force: true });
}

/** Put a saved link back. Returns the Cloud root, or null when the account has none. */
export async function restoreCloudLink(fs: MirrorFs, rootPath: string, ownerId: string): Promise<string | null> {
  let link: CloudLink;
  try {
    link = JSON.parse(await fs.readText(cloudLinkPath(rootPath, ownerId))) as CloudLink;
  } catch {
    return null;
  }
  if (!link || link.version !== 1 || typeof link.cloudRootId !== "string") return null;
  await mutateGhostIndex(fs, rootPath, (current) => {
    for (const [relativePath, entry] of Object.entries(current.documents)) {
      // Images are sent again for this account; its bucket may lack some.
      const { cloudDocumentId: _id, cloudCursor: _cursor, cloudStale: _stale, cloudStaleFrom: _from, assets: _assets, ...rest } = entry;
      const cloudId = link.documents[entry.documentId];
      current.documents[relativePath] = cloudId ? { ...rest, cloudDocumentId: cloudId } : rest;
    }
    current.folders = { ...link.folders };
  });
  const { metadata } = await readGhostFolder(fs, rootPath);
  await writeGhostFolderMetadata(fs, rootPath, {
    version: 1,
    rootId: metadata?.rootId ?? rootPath,
    cloudRootId: link.cloudRootId,
    cloudOwnerId: ownerId,
    createdAt: metadata?.createdAt ?? new Date().toISOString(),
  });
  return link.cloudRootId;
}

/**
 * Another account signed in on this Mac. The leaving account's link is
 * saved, the arriving account's is restored if it has one, and otherwise
 * the root is uploaded as a new copy under fresh IDs.
 */
export async function switchCloudOwner(
  deps: CloudUploadDeps,
  root: TrackedRoot,
  previousOwnerId: string | null,
  ownerId: string,
): Promise<CloudUploadResult> {
  if (previousOwnerId && previousOwnerId !== ownerId) await saveCloudLink(deps.fs, root.path, previousOwnerId);
  const restored = await restoreCloudLink(deps.fs, root.path, ownerId);
  if (restored) return { cloudRootId: restored, documents: 0, versions: 0, alreadyUploaded: true };
  return uploadMirroredRoot(deps, root, { freshIds: true, ownerId });
}

async function existingNotesRootId(client: SupabaseClient): Promise<string | null> {
  try {
    const items = await listVisibleCloudItems(client);
    return items.find((item) => item.parent_id === null && item.root_kind === "notes" && item.access_role === "owner")?.id ?? null;
  } catch (error) {
    if (isMissingSharingFunction(error)) return null;
    throw error;
  }
}
