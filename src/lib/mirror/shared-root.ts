import { adoptCloudItems, createCloudItem } from "@/cloud/cloud-data";
import { cloudItemRole, type CloudAccessRole, type VisibleCloudItem } from "@/cloud/cloud-sharing";
import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import { adoptDocument, commitIndexPass, defaultDocumentId, readGhostFolder, writeGhostFolderMetadata } from "@/lib/mirror/adoption";
import { pullCloudChanges, type CloudPullDeps, type CloudPullResult } from "@/lib/mirror/cloud-pull";
import { emptyGhostIndex, relativeToRoot, type GhostIndex, type GhostIndexEntry } from "@/lib/mirror/ghost-index";
import { pushDocumentState } from "@/lib/mirror/root-sync";

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
  /** This account's role on each shared folder; editors may create notes inside. */
  folderRoles: Record<string, CloudAccessRole>;
}

/** The nearest shared folder at or above `dir` this account may create in, if any. */
export function editableSharedFolder(plan: Pick<SharedRootPlan, "folderRoles">, dir: string | null): string | null {
  let current = dir;
  while (current) {
    const role = plan.folderRoles[current];
    if (role) return role === "viewer" ? null : current;
    current = current.includes("/") ? current.slice(0, current.lastIndexOf("/")) : null;
  }
  return null;
}

/**
 * A name from another account's Cloud becomes a path segment on this Mac,
 * so it must be exactly one segment: no separators, no `.` or `..`, never
 * Ghost's own metadata folder, no control characters.
 */
export function isSafeSharedName(name: string): boolean {
  return name.length > 0
    && name !== "."
    && name !== ".."
    && name.toLowerCase() !== ".ghost"
    // eslint-disable-next-line no-control-regex
    && !/[/\\\u0000-\u001f]/.test(name);
}

function safeSuffix(text: string | null): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = (text ?? "").replace(/[/\\()\u0000-\u001f]/g, " ").trim();
  return cleaned || "shared";
}

function withSuffix(name: string, suffix: string, isDocument: boolean): string {
  const dot = isDocument ? name.lastIndexOf(".") : -1;
  return dot > 0 ? `${name.slice(0, dot)} (${suffix})${name.slice(dot)}` : `${name} (${suffix})`;
}

function byName(a: VisibleCloudItem, b: VisibleCloudItem): number {
  return a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1;
}

export function planSharedRoot(visible: VisibleCloudItem[]): SharedRootPlan {
  const plan: SharedRootPlan = { documents: {}, folders: {}, folderRoles: {} };
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
    plan.folderRoles[relativePath] = item.access_role;
    for (const child of (children.get(item.id) ?? []).sort(byName)) {
      if (!isSafeSharedName(child.name)) continue;
      place(child, `${relativePath}/${child.name}`);
    }
  };

  const taken = new Map<string, string>();
  for (const root of shared.filter((item) => item.shared_root_id === item.id).sort(byName)) {
    if (!isSafeSharedName(root.name)) continue;
    let name = root.name;
    const owner = taken.get(name.toLowerCase());
    if (owner && owner !== root.id) name = withSuffix(name, safeSuffix(root.shared_by), root.kind === "document");
    taken.set(name.toLowerCase(), root.id);
    place(root, name);
  }
  return plan;
}

export interface SharedRootRefresh {
  added: string[];
  removed: string[];
  moved: Array<{ from: string; to: string }>;
  /** Notes made on this Mac inside a shared folder, now in the sharer's Cloud. */
  uploaded: string[];
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

  // Notes made here inside a shared folder go to the sharer's Cloud when
  // this account may edit that folder: files the editor already claimed,
  // and files another app dropped in. Anything else stays a local file.
  const uploaded: string[] = [];
  const planned = new Set(Object.values(plan.documents).map((item) => item.id));
  const localCandidates = new Map<string, GhostIndexEntry | null>();
  for (const [relativePath, entry] of Object.entries(index.documents)) {
    if (!planned.has(entry.documentId) && !entry.cloudDocumentId) localCandidates.set(relativePath, entry);
  }
  for (const absolutePath of await fs.listMarkdownFiles(root.path)) {
    const relativePath = relativeToRoot(root.path, absolutePath);
    if (!relativePath || index.documents[relativePath] || next.documents[relativePath]) continue;
    if (editableSharedFolder(plan, parentOf(relativePath))) localCandidates.set(relativePath, null);
  }
  for (const [relativePath, existing] of localCandidates) {
    const folder = editableSharedFolder(plan, parentOf(relativePath));
    if (!folder) {
      if (existing) next.documents[relativePath] = existing;
      continue;
    }
    try {
      const parentId = await ensureSharedFolder(deps, plan, next, folder, parentOf(relativePath) as string);
      const adopted = existing
        ? { documentId: existing.documentId, entry: existing }
        : await adoptDocument(
          { fs, openPersistence: deps.openPersistence, newDocumentId: defaultDocumentId, now: () => new Date() },
          root.path,
          root.id,
          relativePath,
          null,
        );
      await adoptCloudItems(deps.client, [{ id: adopted.documentId, parent_id: parentId, kind: "document", name: nameOf(relativePath) }]);
      await pushDocumentState(deps, root, { client: deps.client, cloudRootId: SHARED_ROOT_ID, workspaceId: null }, adopted.documentId);
      next.documents[relativePath] = { ...adopted.entry, cloudDocumentId: adopted.documentId, cloudCursor: 0 };
      uploaded.push(relativePath);
    } catch (error) {
      console.warn(`Could not add ${relativePath} to the shared folder:`, error);
      if (existing) next.documents[relativePath] = existing;
    }
  }

  // A note that left the listing: gone from the share, or shared a moment
  // ago and not listed yet. The server settles it.
  const removed: string[] = [];
  for (const [relativePath, entry] of Object.entries(index.documents)) {
    if (planned.has(entry.documentId) || !entry.cloudDocumentId || next.documents[relativePath]) continue;
    const absolutePath = `${root.path}/${relativePath}`;
    if (isOpen(absolutePath)) {
      next.documents[relativePath] = entry;
      continue;
    }
    const stillShared = await cloudItemRole(deps.client, entry.cloudDocumentId).catch(() => null);
    if (stillShared) {
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
    uploaded,
    pull,
    empty: Object.keys(plan.documents).length === 0 && Object.keys(plan.folders).length === 0,
  };
}

function parentOf(relativePath: string): string | null {
  return relativePath.includes("/") ? relativePath.slice(0, relativePath.lastIndexOf("/")) : null;
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** The Cloud folder for `dir`, creating what lies between it and the nearest shared folder. */
async function ensureSharedFolder(
  deps: CloudPullDeps,
  plan: SharedRootPlan,
  index: GhostIndex,
  knownFolder: string,
  dir: string,
): Promise<string> {
  if (index.folders[dir]) return index.folders[dir];
  const parentDir = parentOf(dir);
  const parentId = parentDir === knownFolder || parentDir === null
    ? index.folders[knownFolder]
    : await ensureSharedFolder(deps, plan, index, knownFolder, parentDir);
  const created = await createCloudItem(deps.client, "folder", nameOf(dir), parentId);
  index.folders[dir] = created.id;
  plan.folders[dir] = created.id;
  plan.folderRoles[dir] = plan.folderRoles[knownFolder];
  return created.id;
}
