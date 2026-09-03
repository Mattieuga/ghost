import type { SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { decodeBase64, encodeBase64 } from "@/cloud/collaboration/base64";
import { fetchCloudDocumentHeads } from "@/cloud/cloud-sharing";
import { createHeadlessMarkdownEditor } from "@/components/editor/markdown-schema";
import { serializeMarkdownDocument } from "@/components/editor/markdown-source";
import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import { commitIndexPass, readGhostFolder, type PersistenceHandle } from "@/lib/mirror/adoption";
import type { GhostIndexEntry } from "@/lib/mirror/ghost-index";
import type { MirrorFs } from "@/lib/mirror/mirror-fs";

/**
 * Cloud to disk for documents that are not open. An open document's session
 * receives updates live and its writer mirrors them; a closed one has no
 * session, so this pass asks Cloud for each document's latest update ID,
 * pulls what is new into the local store, and rewrites the file when the
 * file is still where Ghost left it. A file changed on disk meanwhile is
 * left alone: the next open merges it three ways.
 */
export interface CloudUpdateRow {
  id: number;
  update: string;
}

export interface CloudPullDeps {
  fs: MirrorFs;
  client: SupabaseClient;
  openPersistence(rootId: string, documentId: string, document: Y.Doc): Promise<PersistenceHandle>;
  /** Files an editor is handling live are left to it. */
  isOpen?: (absolutePath: string) => boolean;
  /** Durable updates after `afterId`, oldest first. Defaults to the updates table. */
  fetchUpdates?: (documentId: string, afterId: number) => Promise<CloudUpdateRow[]>;
  serialize?: (document: Y.Doc) => string;
}

export interface CloudPullResult {
  /** Relative paths rewritten from Cloud. */
  written: string[];
  /** Relative paths with new Cloud updates that were not written: open, or changed on disk. */
  deferred: string[];
  checked: number;
}

const PAGE = 500;

export async function fetchCloudUpdates(
  client: SupabaseClient,
  documentId: string,
  afterId: number,
): Promise<CloudUpdateRow[]> {
  const rows: CloudUpdateRow[] = [];
  let cursor = afterId;
  for (;;) {
    const { data, error } = await client
      .from("cloud_document_updates")
      .select("id, update")
      .eq("document_id", documentId)
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`Could not load Cloud updates: ${error.message}`);
    const batch = ((data ?? []) as Array<{ id: number | string; update: string }>)
      .map((row) => ({ id: Number(row.id), update: row.update }));
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
    cursor = batch[batch.length - 1].id;
  }
}

export function serializeYjsDocument(document: Y.Doc): string {
  const editor = createHeadlessMarkdownEditor({ collaboration: document });
  try {
    return serializeMarkdownDocument(editor);
  } finally {
    editor.destroy();
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

function parentDir(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

async function pullOne(
  deps: CloudPullDeps,
  root: TrackedRoot,
  relativePath: string,
  entry: GhostIndexEntry,
  cloudId: string,
): Promise<{ entry: GhostIndexEntry; written: boolean }> {
  const absolutePath = `${root.path}/${relativePath}`;
  const cursor = entry.cloudCursor ?? 0;
  const fetchUpdates = deps.fetchUpdates ?? ((id, after) => fetchCloudUpdates(deps.client, id, after));
  const rows = await fetchUpdates(cloudId, cursor);
  const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : cursor;

  const document = new Y.Doc();
  const persistence = await deps.openPersistence(root.id, entry.documentId, document);
  try {
    // An unopened store looks empty; nothing may be written from it.
    if (persistence.status === "unavailable") return { entry, written: false };
    const before = Y.encodeStateVector(document);
    for (const row of rows) Y.applyUpdate(document, decodeBase64(row.update), "cloud-pull");
    const after = Y.encodeStateVector(document);
    const diskHash = await deps.fs.hashFile(absolutePath).catch(() => null);
    // A file is written from Cloud only when the index says it has never
    // been on disk. A file that was there and is gone was deleted on
    // purpose; root reconciliation carries that deletion to Cloud, and
    // writing it back here would undo it.
    const neverOnDisk = entry.contentHash === null && entry.mirrorVersion === null;
    const missingOnDisk = diskHash === null;
    if (missingOnDisk && !neverOnDisk) return { entry, written: false };
    const grew = !sameBytes(before, after);
    if (!grew && !missingOnDisk) return { entry: { ...entry, cloudCursor: nextCursor }, written: false };

    // Only overwrite a file Ghost wrote last. Anything else waits for the
    // next open, where ingestion merges disk and document.
    if (!missingOnDisk && entry.contentHash !== null && diskHash !== entry.contentHash) {
      return { entry: { ...entry, cloudCursor: nextCursor }, written: false };
    }

    const markdown = (deps.serialize ?? serializeYjsDocument)(document);
    if (missingOnDisk) await deps.fs.ensureDir(parentDir(absolutePath));
    let version;
    try {
      version = await deps.fs.writeText(absolutePath, markdown, {
        expectedVersion: missingOnDisk ? null : entry.mirrorVersion,
        force: missingOnDisk || entry.mirrorVersion === null,
      });
    } catch {
      return { entry: { ...entry, cloudCursor: nextCursor }, written: false };
    }
    return {
      written: true,
      entry: {
        ...entry,
        contentHash: await deps.fs.hashText(markdown),
        mirrorVersion: version,
        mirrorStateVector: encodeBase64(after),
        cloudCursor: nextCursor,
      },
    };
  } finally {
    await persistence.destroy().catch(() => undefined);
    document.destroy();
  }
}

/** Pull new Cloud updates into every closed document of an uploaded root. */
export async function pullCloudChanges(deps: CloudPullDeps, root: TrackedRoot): Promise<CloudPullResult> {
  const { metadata, index } = await readGhostFolder(deps.fs, root.path);
  const cloudRootId = root.cloudRootId ?? metadata?.cloudRootId ?? null;
  if (!cloudRootId) return { written: [], deferred: [], checked: 0 };

  const snapshot = structuredClone(index);
  const candidates = Object.entries(index.documents).map(([relativePath, entry]) => ({
    relativePath,
    entry,
    cloudId: entry.cloudDocumentId ?? entry.documentId,
  }));
  if (candidates.length === 0) return { written: [], deferred: [], checked: 0 };
  const heads = await fetchCloudDocumentHeads(deps.client, candidates.map((candidate) => candidate.cloudId));

  const written: string[] = [];
  const deferred: string[] = [];
  let dirty = false;
  for (const { relativePath, entry, cloudId } of candidates) {
    const head = heads.get(cloudId);
    if (head === undefined) continue;
    const neverOnDisk = entry.mirrorVersion === null && entry.contentHash === null;
    if (head <= (entry.cloudCursor ?? 0) && !neverOnDisk) continue;
    if (deps.isOpen?.(`${root.path}/${relativePath}`)) {
      deferred.push(relativePath);
      continue;
    }
    const outcome = await pullOne(deps, root, relativePath, entry, cloudId);
    index.documents[relativePath] = outcome.entry;
    dirty = true;
    (outcome.written ? written : deferred).push(relativePath);
  }
  if (dirty) await commitIndexPass(deps.fs, root.path, snapshot, index);
  return { written, deferred, checked: candidates.length };
}
