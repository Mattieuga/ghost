import * as Y from "yjs";
import { COLLABORATION_FIELD, createHeadlessMarkdownEditor } from "@/components/editor/markdown-schema";
import { parseMarkdownDocument } from "@/components/editor/frontmatter";
import { decodeBase64, encodeBase64 } from "@/cloud/collaboration/base64";
import { markdownMatchesDocument } from "@/lib/mirror/ingestion";
import {
  emptyGhostIndex,
  ghostDirPath,
  ghostFolderFilePath,
  ghostIndexFilePath,
  parseGhostFolderMetadata,
  parseGhostIndex,
  reconcileIndexWithDisk,
  relativeToRoot,
  serializeGhostFolderMetadata,
  serializeGhostIndex,
  type GhostFolderMetadata,
  type GhostIndex,
  type GhostIndexEntry,
} from "@/lib/mirror/ghost-index";
import type { MirrorFs } from "@/lib/mirror/mirror-fs";
import type { MirrorRecord } from "@/lib/mirror/mirror-writer";

export interface PersistenceHandle {
  status: "ready" | "unavailable";
  destroy(): Promise<void>;
}

export interface AdoptionDeps {
  fs: MirrorFs;
  /** Open the local Yjs store for one document and wait for it to load. */
  openPersistence(rootId: string, documentId: string, document: Y.Doc): Promise<PersistenceHandle>;
  newDocumentId(): string;
  now(): Date;
  /**
   * True when a Cloud session will load the document right after adoption.
   * A document the index marks as in Cloud is then not seeded from disk
   * into an empty store, because that would insert the text a second time
   * next to the server's copy.
   */
  hydrateFromCloud?: boolean;
}

/** The store could not be opened; nothing may be decided from an empty document. */
export class LocalStoreUnavailableError extends Error {
  constructor(message: string | null) {
    super(message ?? "The local document store is unavailable.");
    this.name = "LocalStoreUnavailableError";
  }
}

export function defaultDocumentId(): string {
  return crypto.randomUUID();
}

export async function readGhostFolder(
  fs: MirrorFs,
  root: string,
): Promise<{ metadata: GhostFolderMetadata | null; index: GhostIndex }> {
  const [metadataText, indexText] = await Promise.all([
    fs.readText(ghostFolderFilePath(root)).catch(() => null),
    fs.readText(ghostIndexFilePath(root)).catch(() => null),
  ]);
  return {
    metadata: metadataText ? parseGhostFolderMetadata(metadataText) : null,
    index: indexText ? parseGhostIndex(indexText) : emptyGhostIndex(),
  };
}

export async function writeGhostIndex(fs: MirrorFs, root: string, index: GhostIndex): Promise<void> {
  await fs.ensureDir(ghostDirPath(root));
  await fs.writeText(ghostIndexFilePath(root), serializeGhostIndex(index), {
    expectedVersion: null,
    force: true,
  });
}

export async function writeGhostFolderMetadata(
  fs: MirrorFs,
  root: string,
  metadata: GhostFolderMetadata,
): Promise<void> {
  await fs.ensureDir(ghostDirPath(root));
  await fs.writeText(ghostFolderFilePath(root), serializeGhostFolderMetadata(metadata), {
    expectedVersion: null,
    force: true,
  });
}

/** Serialize index writes per root so two documents cannot clobber each other. */
const indexQueues = new Map<string, Promise<unknown>>();

/**
 * One read-modify-write of a root's index, queued behind every other write
 * to it. Every writer goes through here so a pass that took seconds cannot
 * overwrite what the editor recorded meanwhile.
 */
export function mutateGhostIndex(
  fs: MirrorFs,
  root: string,
  mutate: (index: GhostIndex) => GhostIndex | void,
): Promise<GhostIndex> {
  const previous = indexQueues.get(root) ?? Promise.resolve();
  const next = previous.then(async () => {
    const { index } = await readGhostFolder(fs, root);
    const result = mutate(index) ?? index;
    await writeGhostIndex(fs, root, result);
    return result;
  });
  indexQueues.set(root, next.catch(() => undefined));
  return next;
}

/** The Cloud fields an entry carries that a writer's record never sets. */
function cloudFieldsOf(entry: GhostIndexEntry | undefined): Partial<GhostIndexEntry> {
  if (!entry) return {};
  return {
    ...(entry.cloudDocumentId ? { cloudDocumentId: entry.cloudDocumentId } : {}),
    ...(entry.cloudCursor !== undefined ? { cloudCursor: entry.cloudCursor } : {}),
    ...(entry.cloudStale ? { cloudStale: true } : {}),
  };
}

export function updateGhostIndexEntry(
  fs: MirrorFs,
  root: string,
  relativePath: string,
  entry: GhostIndexEntry,
): Promise<void> {
  return mutateGhostIndex(fs, root, (index) => {
    const existing = index.documents[relativePath];
    index.documents[relativePath] = existing?.documentId === entry.documentId
      ? { ...cloudFieldsOf(existing), ...entry }
      : entry;
  }).then(() => undefined);
}

function sameRecord(a: GhostIndexEntry, b: GhostIndexEntry): boolean {
  return a.contentHash === b.contentHash
    && a.mirrorStateVector === b.mirrorStateVector
    && JSON.stringify(a.mirrorVersion) === JSON.stringify(b.mirrorVersion);
}

/**
 * Commit the result of a pass that started from `snapshot`. A path the pass
 * left alone keeps whatever the editor recorded meanwhile; a path the pass
 * changed takes the pass's values; a path the pass removed goes; a path that
 * appeared meanwhile stays.
 */
export function commitIndexPass(
  fs: MirrorFs,
  root: string,
  snapshot: GhostIndex,
  result: GhostIndex,
): Promise<GhostIndex> {
  return mutateGhostIndex(fs, root, (current) => {
    const merged: GhostIndex = { ...result, documents: {} };
    for (const [path, entry] of Object.entries(result.documents)) {
      const live = current.documents[path];
      const before = snapshot.documents[path];
      if (live && before && live.documentId === entry.documentId && sameRecord(before, entry)) {
        merged.documents[path] = {
          ...entry,
          contentHash: live.contentHash,
          mirrorVersion: live.mirrorVersion,
          mirrorStateVector: live.mirrorStateVector,
          ...(entry.cloudCursor === before.cloudCursor && live.cloudCursor !== undefined
            ? { cloudCursor: live.cloudCursor }
            : {}),
          ...(!entry.cloudDocumentId && live.cloudDocumentId ? { cloudDocumentId: live.cloudDocumentId } : {}),
        };
      } else {
        merged.documents[path] = entry;
      }
    }
    for (const [path, live] of Object.entries(current.documents)) {
      if (!(path in result.documents) && !(path in snapshot.documents)) merged.documents[path] = live;
    }
    return merged;
  });
}

/**
 * Move an index entry to a new relative path, keeping its document. Returns
 * the entry, or null when nothing was there or the destination already has
 * another document. With `cloudStale`, the next signed-in pass renames or
 * moves the Cloud item to match.
 */
export async function relocateIndexEntry(
  fs: MirrorFs,
  root: string,
  fromRelative: string,
  toRelative: string,
  options: { cloudStale?: boolean } = {},
): Promise<GhostIndexEntry | null> {
  let moved: GhostIndexEntry | null = null;
  await mutateGhostIndex(fs, root, (index) => {
    const entry = index.documents[fromRelative];
    if (!entry) return;
    const occupant = index.documents[toRelative];
    if (occupant && occupant.documentId !== entry.documentId) return;
    delete index.documents[fromRelative];
    moved = { ...entry, ...(options.cloudStale && entry.cloudDocumentId ? { cloudStale: true } : {}) };
    index.documents[toRelative] = moved;
  });
  return moved;
}

/**
 * Find the entry a file at `relativePath` was renamed from: one with the
 * same content hash whose own file is gone. Used when a note opens under a
 * name the index does not know, before minting a new document.
 */
export async function locateRenamedEntry(
  fs: MirrorFs,
  root: string,
  index: GhostIndex,
  relativePath: string,
  contentHash: string,
): Promise<string | null> {
  for (const [path, entry] of Object.entries(index.documents)) {
    if (path === relativePath || entry.contentHash !== contentHash) continue;
    const present = await fs.hashFile(`${root}/${path}`).then(() => true).catch(() => false);
    if (!present) return path;
  }
  return null;
}

/** Forget that a root's documents are in Cloud, for a fresh upload under another account. */
export async function forgetCloudMarks(fs: MirrorFs, root: string): Promise<void> {
  await mutateGhostIndex(fs, root, (index) => {
    for (const [path, entry] of Object.entries(index.documents)) {
      const { cloudDocumentId: _id, cloudCursor: _cursor, cloudStale: _stale, ...rest } = entry;
      index.documents[path] = rest;
    }
    index.folders = {};
  });
  const { metadata } = await readGhostFolder(fs, root);
  if (metadata?.cloudRootId) await writeGhostFolderMetadata(fs, root, { ...metadata, cloudRootId: null });
}

export function recordToIndexEntry(documentId: string, record: MirrorRecord): GhostIndexEntry {
  return {
    documentId,
    contentHash: record.contentHash,
    mirrorVersion: record.version,
    mirrorStateVector: record.stateVector ? encodeBase64(record.stateVector) : null,
  };
}

export function indexEntryToRecord(entry: GhostIndexEntry): MirrorRecord {
  return {
    version: entry.mirrorVersion,
    stateVector: entry.mirrorStateVector ? decodeBase64(entry.mirrorStateVector) : null,
    contentHash: entry.contentHash,
  };
}

function fragmentIsEmpty(document: Y.Doc): boolean {
  return document.getXmlFragment(COLLABORATION_FIELD).length === 0;
}

/** Parse Markdown into an empty Yjs document through the shared schema. */
export function seedDocumentFromMarkdown(document: Y.Doc, markdown: string): void {
  const editor = createHeadlessMarkdownEditor({ collaboration: document });
  try {
    editor.commands.setContent(parseMarkdownDocument(editor, markdown), { emitUpdate: false });
  } finally {
    editor.destroy();
  }
}

export interface AdoptedDocument {
  documentId: string;
  entry: GhostIndexEntry;
  /** True when the local store already held this document and was kept. */
  keptExisting: boolean;
}

/**
 * Make one Markdown file a mirrored document. A fresh document is seeded
 * from disk and its record marks the disk as current. If the local store
 * already holds content for this ID, it is kept, and the disk is recorded as
 * current only when it matches, so a divergent file is handled as a conflict
 * on open rather than merged into duplicate content.
 */
export async function adoptDocument(
  deps: AdoptionDeps,
  root: string,
  rootId: string,
  relativePath: string,
  existing: GhostIndexEntry | null,
): Promise<AdoptedDocument> {
  const absolutePath = `${root}/${relativePath}`;
  const documentId = existing?.documentId ?? deps.newDocumentId();
  const document = new Y.Doc();
  const persistence = await deps.openPersistence(rootId, documentId, document);
  try {
    if (persistence.status === "unavailable") {
      throw new LocalStoreUnavailableError((persistence as { message?: string | null }).message ?? null);
    }
    const [content, version, contentHash] = await Promise.all([
      deps.fs.readText(absolutePath),
      deps.fs.getVersion(absolutePath),
      deps.fs.hashFile(absolutePath),
    ]);

    if (fragmentIsEmpty(document) && existing?.cloudDocumentId && deps.hydrateFromCloud) {
      // The store is empty but the document lives in Cloud: let the session
      // bring it down, then ingestion compares the file to it.
      return {
        documentId,
        keptExisting: true,
        entry: { ...existing, contentHash, mirrorVersion: null, mirrorStateVector: null },
      };
    }

    if (fragmentIsEmpty(document)) {
      seedDocumentFromMarkdown(document, content);
      return {
        documentId,
        keptExisting: false,
        entry: {
          documentId,
          contentHash,
          mirrorVersion: version,
          mirrorStateVector: encodeBase64(Y.encodeStateVector(document)),
        },
      };
    }

    const editor = createHeadlessMarkdownEditor({ collaboration: document });
    let matches = false;
    try {
      matches = markdownMatchesDocument(editor, content);
    } finally {
      editor.destroy();
    }
    return {
      documentId,
      keptExisting: true,
      entry: matches
        ? {
          documentId,
          contentHash,
          mirrorVersion: version,
          mirrorStateVector: encodeBase64(Y.encodeStateVector(document)),
        }
        : { documentId, contentHash, mirrorVersion: null, mirrorStateVector: null },
    };
  } finally {
    await persistence.destroy().catch(() => undefined);
    document.destroy();
  }
}

export interface FolderAdoption {
  metadata: GhostFolderMetadata;
  index: GhostIndex;
  adopted: string[];
  renamed: Array<{ from: string; to: string }>;
  removed: string[];
}

/**
 * Make a folder mirrored: write `.ghost/folder.json` if missing, reconcile
 * the index with the Markdown files on disk, adopt every file the index did
 * not know, and write the index back.
 */
export async function adoptFolder(
  deps: AdoptionDeps,
  root: string,
  rootId: string,
): Promise<FolderAdoption> {
  const { metadata: existingMetadata, index: existingIndex } = await readGhostFolder(deps.fs, root);
  const metadata = existingMetadata ?? {
    version: 1 as const,
    rootId,
    cloudRootId: null,
    createdAt: deps.now().toISOString(),
  };
  if (!existingMetadata) await writeGhostFolderMetadata(deps.fs, root, metadata);

  const files = await deps.fs.listMarkdownFiles(root);
  const onDisk = await Promise.all(files.map(async (absolutePath) => ({
    relativePath: relativeToRoot(root, absolutePath) ?? absolutePath,
    contentHash: await deps.fs.hashFile(absolutePath),
  })));
  const reconciliation = reconcileIndexWithDisk(existingIndex, onDisk);
  const index = reconciliation.index;

  for (const relativePath of reconciliation.added) {
    const adopted = await adoptDocument(deps, root, rootId, relativePath, null);
    index.documents[relativePath] = adopted.entry;
  }
  await writeGhostIndex(deps.fs, root, index);

  return {
    metadata,
    index,
    adopted: reconciliation.added,
    renamed: reconciliation.renamed,
    removed: reconciliation.removed,
  };
}
