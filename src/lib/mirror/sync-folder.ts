import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import { mirrorLocalPersistenceKey, openYjsPersistence } from "@/cloud/cloud-local-persistence";
import { adoptFolder, defaultDocumentId, type FolderAdoption } from "@/lib/mirror/adoption";
import type { MirrorFs, RepositoryLink } from "@/lib/mirror/mirror-fs";
import { evaluateSyncPreflight, type PreflightResult, type SyncCandidate } from "@/lib/mirror/preflight";

export interface SyncPreparation {
  facts: SyncCandidate;
  result: PreflightResult;
}

/** Gather facts and apply the rules table. Nothing is changed. */
export async function prepareSync(
  fs: MirrorFs,
  path: string,
  roots: TrackedRoot[],
): Promise<SyncPreparation> {
  const facts = await fs.inspectSyncCandidate(path);
  return { facts, result: evaluateSyncPreflight(facts, roots) };
}

export interface SyncOutcome {
  adoption: FolderAdoption;
  bookmark: string | undefined;
}

/**
 * Make a root mirrored: adopt every Markdown file and store a bookmark.
 * Uploading to Cloud, when signed in, happens after this in the account
 * layer. The caller marks the root's kind.
 */
export async function performSync(fs: MirrorFs, root: TrackedRoot): Promise<SyncOutcome> {
  const adoption = await adoptFolder(
    {
      fs,
      openPersistence: (rootId, documentId, document) => (
        openYjsPersistence(mirrorLocalPersistenceKey(rootId, documentId), document)
      ),
      newDocumentId: defaultDocumentId,
      now: () => new Date(),
    },
    root.path,
    root.id,
  );
  const bookmark = await fs.createBookmark(root.path).catch(() => undefined);
  return { adoption, bookmark };
}

/** Files stay as plain Markdown; only Ghost's metadata folder is removed. */
export async function stopSyncing(fs: MirrorFs, root: TrackedRoot): Promise<void> {
  await fs.removeGhostDir(root.path);
}

export function linkIntoRepository(
  fs: MirrorFs,
  root: TrackedRoot,
  repository: string,
): Promise<RepositoryLink> {
  return fs.linkIntoRepository(root.path, repository, "notes");
}

export function describeSyncOutcome(root: TrackedRoot, outcome: SyncOutcome): string {
  const name = root.path.slice(root.path.lastIndexOf("/") + 1);
  const count = Object.keys(outcome.adoption.index.documents).length;
  return `Syncing ${name}: ${count} ${count === 1 ? "note" : "notes"}.`;
}
