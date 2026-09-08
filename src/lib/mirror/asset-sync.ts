import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import { mutateGhostIndex, readGhostFolder } from "@/lib/mirror/adoption";
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
  const name = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const stem = name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name;
  return `${rootPath}${dir ? `/${dir}` : ""}/${stem}.assets`;
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
  const localNames = (await fs.listFiles(dir).catch(() => [] as string[])).filter(isImageName);
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
