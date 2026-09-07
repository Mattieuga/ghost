import type { VisibleCloudItem } from "@/cloud/cloud-sharing";
import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import { commitIndexPass, readGhostFolder } from "@/lib/mirror/adoption";
import type { CloudPullDeps } from "@/lib/mirror/cloud-pull";
import type { GhostIndex } from "@/lib/mirror/ghost-index";
import { isSafeSharedName } from "@/lib/mirror/shared-root";

/**
 * Cloud to disk for an uploaded root's structure. A note renamed, moved,
 * trashed, or created on the web is reflected in the files here: the index
 * entry follows the Cloud item, the file moves with it, a trashed note goes
 * to the Trash, and a new note gets an entry the pull then writes. Runs on
 * the reconciliation queue after disk-to-Cloud reconciliation, so a change
 * made on this Mac always reaches Cloud before Cloud is read back.
 */
export interface CloudTreePlan {
  /** Relative path to the Cloud document that belongs there. */
  documents: Record<string, VisibleCloudItem>;
  /** Relative directory to the Cloud folder it mirrors. */
  folders: Record<string, string>;
}

export function planCloudTree(visible: VisibleCloudItem[], cloudRootId: string): CloudTreePlan | null {
  const root = visible.find((item) => item.id === cloudRootId && item.access_role === "owner");
  if (!root) return null;
  const children = new Map<string, VisibleCloudItem[]>();
  for (const item of visible) {
    if (item.access_role !== "owner" || !item.parent_id) continue;
    const list = children.get(item.parent_id) ?? [];
    list.push(item);
    children.set(item.parent_id, list);
  }
  const plan: CloudTreePlan = { documents: {}, folders: {} };
  const place = (parentId: string, prefix: string) => {
    for (const child of children.get(parentId) ?? []) {
      if (!isSafeSharedName(child.name)) continue;
      const relativePath = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.kind === "document") {
        plan.documents[relativePath] = child;
      } else {
        plan.folders[relativePath] = child.id;
        place(child.id, relativePath);
      }
    }
  };
  place(root.id, "");
  return plan;
}

export interface CloudTreeSyncResult {
  moved: Array<{ from: string; to: string }>;
  removed: string[];
  added: string[];
  /** Moves not made because the file is open; the editor's owner applies them. */
  pendingOpen: Array<{ from: string; to: string }>;
}

const NOTHING: CloudTreeSyncResult = { moved: [], removed: [], added: [], pendingOpen: [] };

export async function syncCloudTreeToDisk(
  deps: CloudPullDeps,
  root: TrackedRoot,
  visible: VisibleCloudItem[],
): Promise<CloudTreeSyncResult> {
  const { fs } = deps;
  const isOpen = deps.isOpen ?? (() => false);
  const { metadata, index } = await readGhostFolder(fs, root.path);
  const cloudRootId = root.cloudRootId ?? metadata?.cloudRootId ?? null;
  if (!cloudRootId) return NOTHING;
  const plan = planCloudTree(visible, cloudRootId);
  if (!plan) return NOTHING;

  const snapshot = structuredClone(index);
  const next: GhostIndex = { ...index, documents: { ...index.documents }, folders: { ...index.folders } };
  const visibleIds = new Set(visible.map((item) => item.id));
  for (const [dir, id] of Object.entries(next.folders)) if (!visibleIds.has(id)) delete next.folders[dir];
  Object.assign(next.folders, plan.folders);

  const pathByCloudId = new Map<string, string>();
  for (const [path, entry] of Object.entries(index.documents)) {
    if (entry.cloudDocumentId) pathByCloudId.set(entry.cloudDocumentId, path);
  }

  const moved: Array<{ from: string; to: string }> = [];
  const pendingOpen: Array<{ from: string; to: string }> = [];
  const added: string[] = [];
  for (const [relativePath, item] of Object.entries(plan.documents)) {
    const current = pathByCloudId.get(item.id);
    if (current === undefined) {
      if (next.documents[relativePath]) continue; // a local note not yet in Cloud sits there
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
    if (current === relativePath) continue;
    const entry = index.documents[current];
    // A rename made here while signed out has not reached Cloud yet; it wins.
    if (entry.cloudStale || next.documents[relativePath]) continue;
    if (isOpen(`${root.path}/${current}`)) {
      pendingOpen.push({ from: current, to: relativePath });
      continue;
    }
    try {
      const to = `${root.path}/${relativePath}`;
      await fs.ensureDir(to.slice(0, to.lastIndexOf("/")));
      await fs.movePath(`${root.path}/${current}`, to);
    } catch {
      continue;
    }
    delete next.documents[current];
    next.documents[relativePath] = entry;
    moved.push({ from: current, to: relativePath });
  }

  const removed: string[] = [];
  const planned = new Set(Object.values(plan.documents).map((item) => item.id));
  for (const [relativePath, entry] of Object.entries(index.documents)) {
    if (!entry.cloudDocumentId || planned.has(entry.cloudDocumentId)) continue;
    if (entry.cloudStale || isOpen(`${root.path}/${relativePath}`)) continue;
    await fs.trashPath(`${root.path}/${relativePath}`).catch(() => undefined);
    delete next.documents[relativePath];
    removed.push(relativePath);
  }

  if (moved.length || added.length || removed.length || JSON.stringify(next.folders) !== JSON.stringify(index.folders)) {
    await commitIndexPass(fs, root.path, snapshot, next);
  }
  return { moved, removed, added, pendingOpen };
}
