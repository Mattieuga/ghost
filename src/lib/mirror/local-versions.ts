import { ghostVersionsDirPath } from "@/lib/mirror/ghost-index";

export const LOCAL_VERSION_LIMIT = 50;

export type LocalVersionReason = "automatic" | "restore" | "restore_backup" | "external_write";

const REASONS: LocalVersionReason[] = ["automatic", "restore", "restore_backup", "external_write"];

export interface LocalVersionFile {
  /** Shared basename without extension, e.g. `2026-09-02T14-03-22.123Z-automatic`. */
  name: string;
  reason: LocalVersionReason;
  createdAt: string;
  markdownPath: string;
  yjsPath: string;
}

/** The small filesystem surface local history needs, so it can be tested with a map. */
export interface LocalVersionFs {
  ensureDir(path: string): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
  readText(path: string): Promise<string>;
  listFiles(dir: string): Promise<string[]>;
  removeFile(path: string): Promise<void>;
}

export function localVersionName(createdAt: Date, reason: LocalVersionReason): string {
  return `${createdAt.toISOString().replace(/:/g, "-")}-${reason}`;
}

export function parseLocalVersionName(name: string): { createdAt: string; reason: LocalVersionReason } | null {
  const match = name.match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)-([a-z_]+)$/);
  if (!match) return null;
  const reason = match[2] as LocalVersionReason;
  if (!REASONS.includes(reason)) return null;
  const iso = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3");
  return { createdAt: iso, reason };
}

export async function listLocalVersions(
  fs: LocalVersionFs,
  root: string,
  documentId: string,
): Promise<LocalVersionFile[]> {
  const dir = ghostVersionsDirPath(root, documentId);
  const files = await fs.listFiles(dir).catch(() => [] as string[]);
  const versions: LocalVersionFile[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const name = file.slice(0, -3);
    const parsed = parseLocalVersionName(name);
    if (!parsed) continue;
    versions.push({
      name,
      reason: parsed.reason,
      createdAt: parsed.createdAt,
      markdownPath: `${dir}/${name}.md`,
      yjsPath: `${dir}/${name}.yjs`,
    });
  }
  return versions.sort((left, right) => right.name.localeCompare(left.name));
}

export interface CaptureLocalVersionInput {
  reason: LocalVersionReason;
  markdown: string;
  /** Base64 `Y.encodeStateAsUpdate(doc)`. */
  yjsSnapshotBase64: string;
  now?: Date;
}

/**
 * Write one version to `.ghost/versions/<documentId>/`. Identical Markdown to
 * the newest version is not written twice. Old automatic versions beyond the
 * limit are pruned; restores and external writes are kept until they fall
 * off the same limit.
 */
export async function captureLocalVersion(
  fs: LocalVersionFs,
  root: string,
  documentId: string,
  input: CaptureLocalVersionInput,
): Promise<LocalVersionFile | null> {
  const dir = ghostVersionsDirPath(root, documentId);
  await fs.ensureDir(dir);
  const existing = await listLocalVersions(fs, root, documentId);
  const newest = existing[0];
  if (newest) {
    const newestMarkdown = await fs.readText(newest.markdownPath).catch(() => null);
    if (newestMarkdown === input.markdown) return null;
  }

  const name = localVersionName(input.now ?? new Date(), input.reason);
  const version: LocalVersionFile = {
    name,
    reason: input.reason,
    createdAt: parseLocalVersionName(name)?.createdAt ?? new Date().toISOString(),
    markdownPath: `${dir}/${name}.md`,
    yjsPath: `${dir}/${name}.yjs`,
  };
  await fs.writeText(version.markdownPath, input.markdown);
  await fs.writeText(version.yjsPath, input.yjsSnapshotBase64);

  const all = [version, ...existing];
  for (const stale of all.slice(LOCAL_VERSION_LIMIT)) {
    await fs.removeFile(stale.markdownPath).catch(() => undefined);
    await fs.removeFile(stale.yjsPath).catch(() => undefined);
  }
  return version;
}
