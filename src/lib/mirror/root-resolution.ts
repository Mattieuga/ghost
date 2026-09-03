import type { TrackedRoot } from "@/hooks/use-tracked-folders";
import type { SyncCandidate } from "@/lib/mirror/preflight";

/** Where a mirrored root stands after its bookmark is resolved. */
export type RootResolution =
  | { kind: "ok"; path: string; moved: boolean; bookmarkStale: boolean }
  /** Still there, but it now breaks a rule, such as being inside a repository. */
  | { kind: "paused"; path: string; reason: string }
  /** Its volume is not mounted. It comes back when the disk does. */
  | { kind: "unavailable"; path: string }
  /** Neither the bookmark nor the last path leads anywhere. */
  | { kind: "missing"; path: string };

export interface RootResolutionFs {
  resolveBookmark(bookmark: string): Promise<{ path: string; stale: boolean }>;
  isDirectory(path: string): Promise<boolean>;
  /** Cheap facts for the paused check; the scan below the root is not needed. */
  inspect(path: string): Promise<Pick<SyncCandidate, "ancestorVcs" | "syncService" | "ancestorManaged">>;
  /** Mounted volume names under `/Volumes`. */
  mountedVolumes(): Promise<string[]>;
}

function folderName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

export function volumeOf(path: string): string | null {
  const match = path.match(/^\/Volumes\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Resolve a mirrored root on launch and on focus. The bookmark wins over the
 * remembered path; a folder that moved is followed silently. A missing local
 * folder never deletes cloud content, so the outcomes here only change what
 * the sidebar shows.
 */
export async function resolveMirroredRoot(
  root: TrackedRoot,
  fs: RootResolutionFs,
): Promise<RootResolution> {
  let path: string | null = null;
  let bookmarkStale = false;

  if (root.bookmark) {
    try {
      const resolved = await fs.resolveBookmark(root.bookmark);
      if (await fs.isDirectory(resolved.path)) {
        path = resolved.path;
        bookmarkStale = resolved.stale;
      }
    } catch {
      // Fall through to the remembered path.
    }
  }
  if (path === null && await fs.isDirectory(root.path)) {
    path = root.path;
    bookmarkStale = root.bookmark !== undefined;
  }

  if (path === null) {
    const volume = volumeOf(root.path);
    if (volume && !(await fs.mountedVolumes()).includes(volume)) {
      return { kind: "unavailable", path: root.path };
    }
    return { kind: "missing", path: root.path };
  }

  const facts = await fs.inspect(path);
  if (facts.ancestorVcs.length > 0) {
    const hit = facts.ancestorVcs[0];
    const owner = hit.marker === ".git" ? "a Git repository" : "version control";
    return {
      kind: "paused",
      path,
      reason: `${folderName(path)} is now inside ${owner} (${folderName(hit.path)}). Sync is paused until it is moved out or the repository is removed.`,
    };
  }

  return { kind: "ok", path, moved: path !== root.path, bookmarkStale };
}
