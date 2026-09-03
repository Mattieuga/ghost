import type { VisibleCloudItem } from "@/cloud/cloud-sharing";
import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import { commitIndexPass, readGhostFolder, writeGhostFolderMetadata } from "@/lib/mirror/adoption";
import { pullCloudChanges, type CloudPullDeps, type CloudPullResult } from "@/lib/mirror/cloud-pull";
import { emptyGhostIndex, type GhostIndex } from "@/lib/mirror/ghost-index";

/**
 * The Shared root mirrors what other people shared with this account into
 * `~/Ghost/Shared`. It is flat: a shared document sits directly inside, a
 * shared folder brings its subtree. Two shares with one name are told apart
 * by the sharer's name. Its documents are Cloud documents under their own
 * IDs, so the editor opens them through a Cloud session like any uploaded
 * note, and the Mac never creates Cloud items from this root.
 */
export const SHARED_ROOT_ID = "shared";
export const SHARED_FOLDER_NAME = "Shared";

export interface SharedRootPlan {
  /** Relative path to the Cloud document it mirrors. */
  documents: Record<string, VisibleCloudItem>;
  /** Relative directory to the Cloud folder it mirrors. */
  folders: Record<string, string>;
}

function withSuffix(name: string, suffix: string, isDocument: boolean): string {
  const dot = isDocument ? name.lastIndexOf(".") : -1;
  return dot > 0 ? `${name.slice(0, dot)} (${suffix})${name.slice(dot)}` : `${name} (${suffix})`;
}

function byName(a: VisibleCloudItem, b: VisibleCloudItem): number {
  return a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1;
}

export function planSharedRoot(visible: VisibleCloudItem[]): SharedRootPlan {
  const plan: SharedRootPlan = { documents: {}, folders: {} };
  const shared = visible.filter((item) => item.shared_root_id !== null);
  const children = new Map<string, VisibleCloudItem[]>();
  for (const item of shared) {
    if (!item.parent_id) continue;
    const list = children.get(item.parent_id) ?? [];
    list.push(item);
    children.set(item.parent_id, list);
  }
  const place = (item: VisibleCloudItem, relativePath: string) => {
    if (item.kind === "document") {
      plan.documents[relativePath] = item;
      return;
    }
    plan.folders[relativePath] = item.id;
    for (const child of (children.get(item.id) ?? []).sort(byName)) place(child, `${relativePath}/${child.name}`);
  };

  const taken = new Map<string, string>();
  for (const root of shared.filter((item) => item.shared_root_id === item.id).sort(byName)) {
    let name = root.name;
    const owner = taken.get(name.toLowerCase());
    if (owner && owner !== root.id) name = withSuffix(name, root.shared_by ?? "shared", root.kind === "document");
    taken.set(name.toLowerCase(), root.id);
    place(root, name);
  }
  return plan;
}

export interface SharedRootRefresh {
  added: string[];
  removed: string[];
  moved: Array<{ from: string; to: string }>;
  pull: CloudPullResult;
  /** True when nothing is shared any more and the root can be hidden. */
  empty: boolean;
}

/**
 * Bring the Shared root's index and files in line with what is visible,
 * then pull content for every closed document. Files for shares that ended
 * go to the Trash.
 */
export async function refreshSharedRoot(
  deps: CloudPullDeps,
  root: TrackedRoot,
  visible: VisibleCloudItem[],
): Promise<SharedRootRefresh> {
  const { fs } = deps;
  const isOpen = deps.isOpen ?? (() => false);
  const plan = planSharedRoot(visible);
  await fs.ensureDir(root.path);
  const { metadata, index } = await readGhostFolder(fs, root.path);
  if (!metadata) {
    await writeGhostFolderMetadata(fs, root.path, {
      version: 1,
      rootId: root.id,
      cloudRootId: SHARED_ROOT_ID,
      createdAt: new Date().toISOString(),
    });
  }

  const next: GhostIndex = { ...emptyGhostIndex(), folders: plan.folders };
  const currentPathById = new Map(Object.entries(index.documents).map(([path, entry]) => [entry.documentId, path]));
  const added: string[] = [];
  const moved: Array<{ from: string; to: string }> = [];
  for (const [relativePath, item] of Object.entries(plan.documents)) {
    const currentPath = currentPathById.get(item.id);
    if (currentPath === undefined) {
      next.documents[relativePath] = {
        documentId: item.id,
        cloudDocumentId: item.id,
        contentHash: null,
        mirrorVersion: null,
        mirrorStateVector: null,
        cloudCursor: 0,
      };
      added.push(relativePath);
      continue;
    }
    const entry = index.documents[currentPath];
    if (currentPath === relativePath || isOpen(`${root.path}/${currentPath}`)) {
      // Shared files are a mirror of someone else's note: one removed by
      // hand comes back on the next pull. Leave is the way out.
      const present = await fs.hashFile(`${root.path}/${currentPath}`).then(() => true).catch(() => false);
      next.documents[currentPath] = present
        ? entry
        : { ...entry, contentHash: null, mirrorVersion: null, mirrorStateVector: null, cloudCursor: 0 };
      continue;
    }
    const from = `${root.path}/${currentPath}`;
    const to = `${root.path}/${relativePath}`;
    try {
      await fs.ensureDir(to.slice(0, to.lastIndexOf("/")));
      await fs.movePath(from, to);
      next.documents[relativePath] = entry;
      moved.push({ from: currentPath, to: relativePath });
    } catch {
      next.documents[currentPath] = entry;
    }
  }

  const removed: string[] = [];
  const planned = new Set(Object.values(plan.documents).map((item) => item.id));
  for (const [relativePath, entry] of Object.entries(index.documents)) {
    if (planned.has(entry.documentId)) continue;
    const absolutePath = `${root.path}/${relativePath}`;
    if (isOpen(absolutePath)) {
      next.documents[relativePath] = entry;
      continue;
    }
    await fs.trashPath(absolutePath).catch(() => undefined);
    removed.push(relativePath);
  }

  await commitIndexPass(fs, root.path, index, next);
  const pull = await pullCloudChanges(deps, { ...root, cloudRootId: SHARED_ROOT_ID });
  return {
    added,
    removed,
    moved,
    pull,
    empty: Object.keys(plan.documents).length === 0 && Object.keys(plan.folders).length === 0,
  };
}
