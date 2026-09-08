import type { SupabaseClient } from "@supabase/supabase-js";
import * as Y from "yjs";
import { encodeBase64 } from "@/cloud/collaboration/base64";
import { parseMarkdownDocument } from "@/components/editor/frontmatter";
import { createHeadlessMarkdownEditor } from "@/components/editor/markdown-schema";
import { serializeMarkdownDocument } from "@/components/editor/markdown-source";
import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import { defaultDocumentId, mutateGhostIndex, readGhostFolder, type PersistenceHandle } from "@/lib/mirror/adoption";
import { applyDocumentAsBlockDiff } from "@/lib/mirror/block-diff";
import type { GhostIndexEntry } from "@/lib/mirror/ghost-index";
import type { MirrorFs } from "@/lib/mirror/mirror-fs";

/**
 * A note's companion images, `<stem>.assets/` beside it, mirrored to the
 * `cloud-assets` bucket under the note's Cloud ID. Push sends what changed
 * here and removes what was deleted here; pull fetches what changed there.
 * Each note's index entry remembers every file's hash and Cloud etag, so
 * nothing is sent or fetched twice.
 */
export const ASSETS_BUCKET = "cloud-assets";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "heic", "heif", "avif", "tiff", "tif"]);

export function companionAssetsDir(rootPath: string, relativePath: string): string {
  const dir = relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : "";
  return `${rootPath}${dir ? `/${dir}` : ""}/${companionAssetsName(relativePath)}`;
}

/** The name of the companion folder beside a note: its stem plus `.assets`. */
export function companionAssetsName(relativePath: string): string {
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return `${stem}.assets`;
}

/**
 * Point every mention of the `oldName` companion folder at `newName`, the
 * way the native side rewrites a file when a note is renamed: a bare
 * Markdown destination that could no longer stand bare goes in angle
 * brackets; a bracketed one, an HTML attribute, and a mention in prose are
 * replaced as they are. Kept in step with `rewrite_companion_links` in
 * `src-tauri/src/commands/fs.rs`.
 */
export function rewriteCompanionLinks(content: string, oldName: string, newName: string): string {
  if (!oldName || oldName === newName) return content;
  const wrap = /[\s()]/.test(newName);
  let out = "";
  let rest = content;
  for (let at = rest.indexOf(oldName); at >= 0; at = rest.indexOf(oldName)) {
    out += rest.slice(0, at);
    const afterOld = rest.slice(at + oldName.length);
    if (wrap && out.endsWith("](") && afterOld.startsWith("/")) {
      const end = afterOld.search(/[)\s]/);
      const stop = end < 0 ? afterOld.length : end;
      out += `<${newName}${afterOld.slice(0, stop)}>`;
      rest = afterOld.slice(stop);
    } else {
      out += newName;
      rest = afterOld;
    }
  }
  return out + rest;
}

export interface FollowRenameDeps {
  fs: MirrorFs;
  /** Present when signed in; the document's change is sent to Cloud. */
  client: SupabaseClient | null;
  openPersistence(rootId: string, documentId: string, document: Y.Doc): Promise<PersistenceHandle>;
}

/**
 * When a note's file is renamed, the native side renames its companion
 * folder and rewrites the file's image links, so the file no longer reads
 * as the document that wrote it; the next open would take that for an
 * outside edit and, with no version to merge against, make a conflict copy.
 * Bring the document up to date with the file instead, as a block diff, send
 * that to Cloud, and record the file as current. Only for a file Ghost wrote
 * last, and only when the file is exactly that rewrite: anything else is left
 * for ingestion. Returns the entry to record.
 */
export async function followCompanionRename(
  deps: FollowRenameDeps,
  root: TrackedRoot,
  entry: GhostIndexEntry,
  fromRelative: string,
  toRelative: string,
): Promise<GhostIndexEntry> {
  const oldName = companionAssetsName(fromRelative);
  const newName = companionAssetsName(toRelative);
  if (oldName === newName || entry.contentHash === null) return entry;
  const absolute = `${root.path}/${toRelative}`;
  const markdown = await deps.fs.readText(absolute);
  const fileHash = await deps.fs.hashText(markdown);
  if (fileHash === entry.contentHash) return entry;

  const document = new Y.Doc();
  const persistence = await deps.openPersistence(root.id, entry.documentId, document);
  try {
    if (persistence.status === "unavailable") return entry;
    const editor = createHeadlessMarkdownEditor({ collaboration: document });
    try {
      const expected = rewriteCompanionLinks(serializeMarkdownDocument(editor), oldName, newName);
      if (await deps.fs.hashText(expected) !== fileHash) return entry;
      const updates: Uint8Array[] = [];
      const collect = (update: Uint8Array) => { updates.push(update); };
      document.on("update", collect);
      try {
        applyDocumentAsBlockDiff(editor, parseMarkdownDocument(editor, markdown), { addToHistory: false });
      } finally {
        document.off("update", collect);
      }
      const cloudId = entry.cloudDocumentId;
      if (deps.client && cloudId && updates.length > 0) {
        const { error } = await deps.client
          .from("cloud_document_updates")
          .upsert(
            {
              document_id: cloudId,
              client_id: defaultDocumentId(),
              client_sequence: 1,
              update: encodeBase64(Y.mergeUpdates(updates)),
            },
            { onConflict: "document_id,client_id,client_sequence", ignoreDuplicates: true },
          );
        if (error) throw new Error(error.message);
      }
      return {
        ...entry,
        contentHash: fileHash,
        mirrorVersion: await deps.fs.getVersion(absolute),
        mirrorStateVector: encodeBase64(Y.encodeStateVector(document)),
      };
    } finally {
      editor.destroy();
    }
  } finally {
    await persistence.destroy().catch(() => undefined);
    document.destroy();
  }
}

function isImageName(name: string): boolean {
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  return IMAGE_EXTENSIONS.has(extension) && !name.startsWith(".");
}

function contentTypeOf(name: string): string {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  const types: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    svg: "image/svg+xml", bmp: "image/bmp", heic: "image/heic", heif: "image/heif", avif: "image/avif",
    tiff: "image/tiff", tif: "image/tiff",
  };
  return types[extension] ?? "application/octet-stream";
}

export interface AssetSyncDeps {
  fs: MirrorFs;
  client: SupabaseClient;
}

export interface AssetSyncResult {
  uploaded: string[];
  downloaded: string[];
  removedRemote: string[];
}

async function remoteEtags(client: SupabaseClient, cloudId: string): Promise<Map<string, string | null>> {
  const { data, error } = await client.storage.from(ASSETS_BUCKET).list(cloudId, { limit: 1000 });
  if (error) throw new Error(`Could not list images: ${error.message}`);
  const etags = new Map<string, string | null>();
  for (const object of data ?? []) {
    if (!object.name || object.name.endsWith("/")) continue;
    const metadata = (object as { metadata?: { eTag?: string } }).metadata;
    etags.set(object.name, metadata?.eTag ?? null);
  }
  return etags;
}

async function recordAssets(fs: MirrorFs, rootPath: string, relativePath: string, assets: GhostIndexEntry["assets"]): Promise<void> {
  await mutateGhostIndex(fs, rootPath, (index) => {
    const entry = index.documents[relativePath];
    if (!entry) return;
    index.documents[relativePath] = assets && Object.keys(assets).length > 0 ? { ...entry, assets } : (({ assets: _assets, ...rest }) => rest)(entry);
  });
}

/** Send this Mac's images for one note: new and changed files up, deleted files removed. */
export async function pushDocumentAssets(
  deps: AssetSyncDeps,
  root: TrackedRoot,
  relativePath: string,
): Promise<AssetSyncResult> {
  const { fs, client } = deps;
  const { index } = await readGhostFolder(fs, root.path);
  const entry = index.documents[relativePath];
  const cloudId = entry?.cloudDocumentId;
  if (!entry || !cloudId) return { uploaded: [], downloaded: [], removedRemote: [] };
  const dir = companionAssetsDir(root.path, relativePath);
  // A folder that is gone means its images were deleted; a folder that
  // cannot be listed means nothing, and a failed listing must not be read
  // as "all deleted" and remove every image from Cloud.
  const localNames = (await fs.isDirectory(dir))
    ? (await fs.listFiles(dir)).filter(isImageName)
    : [];
  const recorded = { ...(entry.assets ?? {}) };
  const uploaded: string[] = [];
  for (const name of localNames) {
    const path = `${dir}/${name}`;
    const hash = await fs.hashFile(path).catch(() => null);
    if (!hash) continue;
    if (recorded[name]?.hash === hash) continue;
    const bytes = await fs.readBytes(path);
    const { error } = await client.storage.from(ASSETS_BUCKET).upload(`${cloudId}/${name}`, bytes, {
      upsert: true,
      contentType: contentTypeOf(name),
    });
    if (error) throw new Error(`Could not upload ${name}: ${error.message}`);
    recorded[name] = { hash, etag: null };
    uploaded.push(name);
  }
  const removedRemote: string[] = [];
  const gone = Object.keys(recorded).filter((name) => !localNames.includes(name));
  if (gone.length > 0) {
    const { error } = await client.storage.from(ASSETS_BUCKET).remove(gone.map((name) => `${cloudId}/${name}`));
    if (error) throw new Error(`Could not remove images: ${error.message}`);
    for (const name of gone) {
      delete recorded[name];
      removedRemote.push(name);
    }
  }
  if (uploaded.length > 0) {
    // The etag identifies our own upload, so a later pull does not fetch it back.
    const etags = await remoteEtags(client, cloudId).catch(() => new Map<string, string | null>());
    for (const name of uploaded) recorded[name] = { hash: recorded[name].hash, etag: etags.get(name) ?? null };
  }
  if (uploaded.length > 0 || removedRemote.length > 0) await recordAssets(fs, root.path, relativePath, recorded);
  return { uploaded, downloaded: [], removedRemote };
}

/** Fetch images for one note that changed in Cloud, writing them beside the file. */
export async function pullDocumentAssets(
  deps: AssetSyncDeps,
  root: TrackedRoot,
  relativePath: string,
): Promise<AssetSyncResult> {
  const { fs, client } = deps;
  const { index } = await readGhostFolder(fs, root.path);
  const entry = index.documents[relativePath];
  const cloudId = entry?.cloudDocumentId;
  if (!entry || !cloudId) return { uploaded: [], downloaded: [], removedRemote: [] };
  const remote = await remoteEtags(client, cloudId);
  const recorded = { ...(entry.assets ?? {}) };
  const dir = companionAssetsDir(root.path, relativePath);
  const downloaded: string[] = [];
  for (const [name, etag] of remote) {
    if (!isImageName(name)) continue;
    const known = recorded[name];
    const present = known ? await fs.hashFile(`${dir}/${name}`).then(() => true).catch(() => false) : false;
    if (known && known.etag === etag && present) continue;
    if (known && known.etag === null && present) continue; // our own upload, etag not yet learned
    const { data, error } = await client.storage.from(ASSETS_BUCKET).download(`${cloudId}/${name}`);
    if (error || !data) throw new Error(`Could not fetch ${name}: ${error?.message ?? "no data"}`);
    const bytes = new Uint8Array(await data.arrayBuffer());
    await fs.writeBytes(`${dir}/${name}`, bytes);
    const hash = await fs.hashFile(`${dir}/${name}`);
    recorded[name] = { hash, etag };
    downloaded.push(name);
  }
  if (downloaded.length > 0) await recordAssets(fs, root.path, relativePath, recorded);
  return { uploaded: [], downloaded, removedRemote: [] };
}

/** True when Markdown references its companion folder, so a pull is worth a listing. */
export function mentionsCompanionAssets(markdown: string): boolean {
  return /\.assets\//.test(markdown);
}
