import type { FileVersionToken } from "@/lib/source-document";

/**
 * The hidden `.ghost/` folder inside every mirrored root. It makes the folder
 * self-describing: which root it is, which document each file is, and what
 * Ghost last wrote there. It is never listed, searched, watched for
 * ingestion, or synced.
 */
export const GHOST_DIR = ".ghost";
export const GHOST_FOLDER_FILE = "folder.json";
export const GHOST_INDEX_FILE = "index.json";
export const GHOST_VERSIONS_DIR = "versions";

export interface GhostFolderMetadata {
  version: 1;
  rootId: string;
  cloudRootId: string | null;
  createdAt: string;
}

export interface GhostIndexEntry {
  documentId: string;
  /** Hash of the file as Ghost last saw it, for rename detection. */
  contentHash: string | null;
  /** Version token recorded at the last mirror write or ingestion. */
  mirrorVersion: FileVersionToken | null;
  /** Base64 Yjs state vector recorded alongside `mirrorVersion`. */
  mirrorStateVector: string | null;
  /** Set once the document exists in Cloud under this ID. */
  cloudDocumentId?: string;
  /** ID of the last Cloud update pulled into the local store while closed. */
  cloudCursor?: number;
  /** The file was renamed or moved while signed out; Cloud still has the old name or place. */
  cloudStale?: boolean;
}

export interface GhostIndex {
  version: 1;
  /** Keyed by path relative to the root, always with `/` separators. */
  documents: Record<string, GhostIndexEntry>;
  /** Stable IDs for folders inside the root, assigned when they are uploaded. */
  folders: Record<string, string>;
}

export function emptyGhostIndex(): GhostIndex {
  return { version: 1, documents: {}, folders: {} };
}

export function ghostDirPath(root: string): string {
  return `${root}/${GHOST_DIR}`;
}

export function ghostFolderFilePath(root: string): string {
  return `${ghostDirPath(root)}/${GHOST_FOLDER_FILE}`;
}

export function ghostIndexFilePath(root: string): string {
  return `${ghostDirPath(root)}/${GHOST_INDEX_FILE}`;
}

export function ghostVersionsDirPath(root: string, documentId: string): string {
  return `${ghostDirPath(root)}/${GHOST_VERSIONS_DIR}/${documentId}`;
}

export function relativeToRoot(root: string, absolutePath: string): string | null {
  if (absolutePath === root) return "";
  const prefix = root.endsWith("/") ? root : `${root}/`;
  return absolutePath.startsWith(prefix) ? absolutePath.slice(prefix.length) : null;
}

export function isInsideGhostDir(relativePath: string): boolean {
  return relativePath === GHOST_DIR || relativePath.startsWith(`${GHOST_DIR}/`);
}

/** Extensions Ghost treats as Markdown, lower case. Mirrors `classifyFile`. */
export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mkd", "mdown", "mkdn", "mdwn"] as const;

export function isMarkdownPath(path: string): boolean {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(`.${extension}`));
}

export function parseGhostIndex(text: string): GhostIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return emptyGhostIndex();
  }
  if (!parsed || typeof parsed !== "object") return emptyGhostIndex();
  const candidate = parsed as Partial<GhostIndex>;
  if (candidate.version !== 1 || !candidate.documents || typeof candidate.documents !== "object") {
    return emptyGhostIndex();
  }
  const documents: Record<string, GhostIndexEntry> = {};
  for (const [path, entry] of Object.entries(candidate.documents)) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Partial<GhostIndexEntry>;
    if (typeof value.documentId !== "string" || !value.documentId) continue;
    documents[path] = {
      documentId: value.documentId,
      contentHash: typeof value.contentHash === "string" ? value.contentHash : null,
      mirrorVersion: value.mirrorVersion && typeof value.mirrorVersion === "object"
        ? value.mirrorVersion as FileVersionToken
        : null,
      mirrorStateVector: typeof value.mirrorStateVector === "string" ? value.mirrorStateVector : null,
      ...(typeof value.cloudDocumentId === "string" && value.cloudDocumentId
        ? { cloudDocumentId: value.cloudDocumentId }
        : {}),
      ...(typeof value.cloudCursor === "number" && Number.isFinite(value.cloudCursor)
        ? { cloudCursor: value.cloudCursor }
        : {}),
      ...(value.cloudStale === true ? { cloudStale: true } : {}),
    };
  }
  const folders: Record<string, string> = {};
  if (candidate.folders && typeof candidate.folders === "object") {
    for (const [path, id] of Object.entries(candidate.folders)) {
      if (typeof id === "string" && id) folders[path] = id;
    }
  }
  return { version: 1, documents, folders };
}

export function serializeGhostIndex(index: GhostIndex): string {
  const ordered: Record<string, GhostIndexEntry> = {};
  for (const path of Object.keys(index.documents).sort()) ordered[path] = index.documents[path];
  const folders: Record<string, string> = {};
  for (const path of Object.keys(index.folders ?? {}).sort()) folders[path] = index.folders[path];
  return `${JSON.stringify({ version: 1, documents: ordered, folders }, null, 2)}\n`;
}

export function parseGhostFolderMetadata(text: string): GhostFolderMetadata | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Partial<GhostFolderMetadata>;
  if (candidate.version !== 1 || typeof candidate.rootId !== "string" || !candidate.rootId) return null;
  return {
    version: 1,
    rootId: candidate.rootId,
    cloudRootId: typeof candidate.cloudRootId === "string" ? candidate.cloudRootId : null,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date(0).toISOString(),
  };
}

export function serializeGhostFolderMetadata(metadata: GhostFolderMetadata): string {
  return `${JSON.stringify(metadata, null, 2)}\n`;
}

export interface DiskMarkdownFile {
  relativePath: string;
  contentHash: string;
}

export interface IndexReconciliation {
  /** Files on disk that the index did not know. */
  added: string[];
  /** Index entries whose file is gone and was not matched to a new path. */
  removed: string[];
  /** Index entries whose file moved: same content, new path. */
  renamed: Array<{ from: string; to: string }>;
  /** The index after applying renames and removals. Added files are not in it yet. */
  index: GhostIndex;
}

/**
 * Match the index against what is on disk. A file that disappeared while a
 * new file with the same content appeared is a rename, so its document ID
 * survives. Anything else is an add or a remove.
 */
export function reconcileIndexWithDisk(
  index: GhostIndex,
  files: DiskMarkdownFile[],
): IndexReconciliation {
  const onDisk = new Map(files.map((file) => [file.relativePath, file]));
  const missing = Object.keys(index.documents).filter((path) => !onDisk.has(path)).sort();
  const unknown = files.filter((file) => !index.documents[file.relativePath])
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  const renamed: Array<{ from: string; to: string }> = [];
  const claimed = new Set<string>();
  const removed: string[] = [];
  for (const path of missing) {
    const hash = index.documents[path].contentHash;
    const match = hash
      ? unknown.find((file) => file.contentHash === hash && !claimed.has(file.relativePath))
      : undefined;
    if (match) {
      claimed.add(match.relativePath);
      renamed.push({ from: path, to: match.relativePath });
    } else {
      removed.push(path);
    }
  }

  const documents: Record<string, GhostIndexEntry> = {};
  for (const [path, entry] of Object.entries(index.documents)) {
    if (missing.includes(path)) continue;
    documents[path] = entry;
  }
  for (const move of renamed) documents[move.to] = index.documents[move.from];

  return {
    added: unknown.filter((file) => !claimed.has(file.relativePath)).map((file) => file.relativePath),
    removed,
    renamed,
    index: { version: 1, documents, folders: { ...(index.folders ?? {}) } },
  };
}
