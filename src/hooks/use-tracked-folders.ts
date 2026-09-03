import { useState, useEffect, useCallback, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import { open } from "@tauri-apps/plugin-dialog";

/**
 * A sidebar root. Always a real folder on disk.
 *
 * `plain` roots are edited in place, exactly as Ghost has always worked.
 * `mirrored` roots are Ghost-owned: their Markdown is canonical in a Yjs
 * document and the file on disk is a mirror. Folders Ghost creates are
 * mirrored from birth; any other non-repository folder can be converted.
 */
export const SHARED_ROOT_ID = "shared";

export interface TrackedRoot {
  id: string;
  path: string;
  kind: "plain" | "mirrored";
  /** macOS bookmark data, base64. Present for mirrored roots. */
  bookmark?: string;
  /** Present once the root has been uploaded to Cloud. */
  cloudRootId?: string;
  /** The account that uploaded it. Another account must not sync into its Cloud copy. */
  cloudOwnerId?: string;
  /** The one root that mirrors what other people shared. */
  shared?: boolean;
}

export const ROOTS_KEY = "tracked-roots";
/** Pre-record storage: a bare list of paths. Read once for migration. */
export const LEGACY_FOLDERS_KEY = "tracked-folders";
const COLLAPSED_KEY = "collapsed-folders";

function newRootId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `root-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function plainRoot(path: string): TrackedRoot {
  return { id: newRootId(), path, kind: "plain" };
}

/** Turn the legacy path list into root records, preserving order. */
export function migrateLegacyFolders(paths: string[]): TrackedRoot[] {
  const seen = new Set<string>();
  const roots: TrackedRoot[] = [];
  for (const path of paths) {
    if (typeof path !== "string" || !path || seen.has(path)) continue;
    seen.add(path);
    roots.push(plainRoot(path));
  }
  return roots;
}

function isTrackedRoot(value: unknown): value is TrackedRoot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TrackedRoot>;
  return typeof candidate.id === "string"
    && typeof candidate.path === "string"
    && (candidate.kind === "plain" || candidate.kind === "mirrored");
}

export function useTrackedFolders() {
  const [roots, setRootsState] = useState<TrackedRoot[]>([]);
  // Mirror of `roots` for callers that need the result synchronously.
  const rootsRef = useRef<TrackedRoot[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  // True when the store held no roots at all, legacy or current. A fresh
  // install seeds the Notes folder; an emptied sidebar does not.
  const [firstRun, setFirstRun] = useState(false);
  const storeRef = useRef<Awaited<ReturnType<typeof load>> | null>(null);

  const commitRoots = useCallback((next: TrackedRoot[], persist = true) => {
    rootsRef.current = next;
    setRootsState(next);
    if (persist) storeRef.current?.set(ROOTS_KEY, next);
  }, []);

  useEffect(() => {
    load("settings.json", { defaults: {}, autoSave: true }).then(async (store) => {
      storeRef.current = store;
      const savedRoots = await store.get<unknown[]>(ROOTS_KEY);
      const legacyFolders = await store.get<string[]>(LEGACY_FOLDERS_KEY);
      const collapsed = await store.get<string[]>(COLLAPSED_KEY);

      let initial: TrackedRoot[];
      let persist = false;
      if (Array.isArray(savedRoots)) {
        initial = savedRoots.filter(isTrackedRoot);
      } else if (Array.isArray(legacyFolders)) {
        initial = migrateLegacyFolders(legacyFolders);
        persist = true;
      } else {
        initial = [];
        setFirstRun(true);
      }

      commitRoots(initial, persist);
      setCollapsedFolders(new Set(collapsed ?? []));
      setLoading(false);
    });
  }, [commitRoots]);

  const persistCollapsed = useCallback((collapsed: Set<string>) => {
    storeRef.current?.set(COLLAPSED_KEY, [...collapsed]);
  }, []);

  /** Add a plain root, or return the existing root at that path. */
  const addFolderByPath = useCallback((path: string): TrackedRoot => {
    const existing = rootsRef.current.find((root) => root.path === path);
    if (existing) return existing;
    const created = plainRoot(path);
    commitRoots([...rootsRef.current, created]);
    return created;
  }, [commitRoots]);

  /** Add the Shared root at `path`, or return it if present. */
  const ensureSharedRoot = useCallback((path: string): TrackedRoot => {
    const existing = rootsRef.current.find((root) => root.shared);
    if (existing) return existing;
    const created: TrackedRoot = { id: SHARED_ROOT_ID, path, kind: "mirrored", cloudRootId: SHARED_ROOT_ID, shared: true };
    commitRoots([...rootsRef.current, created]);
    return created;
  }, [commitRoots]);

  const addFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open a folder",
    });
    if (selected && typeof selected === "string") addFolderByPath(selected);
  }, [addFolderByPath]);

  const removeFolder = useCallback(
    (path: string) => {
      commitRoots(rootsRef.current.filter((root) => root.path !== path));
      setCollapsedFolders((prev) => {
        const next = new Set(prev);
        if (next.delete(path)) persistCollapsed(next);
        return next;
      });
    },
    [commitRoots, persistCollapsed]
  );

  const renameFolder = useCallback(
    (oldPath: string, newPath: string) => {
      commitRoots(rootsRef.current.map((root) => root.path === oldPath ? { ...root, path: newPath } : root));
      setCollapsedFolders((prev) => {
        if (!prev.has(oldPath)) return prev;
        const next = new Set(prev);
        next.delete(oldPath);
        next.add(newPath);
        persistCollapsed(next);
        return next;
      });
    },
    [commitRoots, persistCollapsed]
  );

  const setRootKind = useCallback(
    (path: string, kind: TrackedRoot["kind"], bookmark?: string) => {
      commitRoots(rootsRef.current.map((root) => root.path === path
        ? { ...root, kind, ...(bookmark ? { bookmark } : {}) }
        : root));
    },
    [commitRoots]
  );

  const updateRoot = useCallback(
    (id: string, changes: Partial<Omit<TrackedRoot, "id">>) => {
      commitRoots(rootsRef.current.map((root) => root.id === id ? { ...root, ...changes } : root));
    },
    [commitRoots]
  );

  /** A mirrored root moved or its bookmark was refreshed. */
  const updateRootPath = useCallback(
    (id: string, path: string, bookmark?: string) => {
      commitRoots(rootsRef.current.map((root) => root.id === id
        ? { ...root, path, ...(bookmark ? { bookmark } : {}) }
        : root));
    },
    [commitRoots]
  );

  const setFolderOpen = useCallback(
    (path: string, isOpen: boolean) => {
      setCollapsedFolders((prev) => {
        const next = new Set(prev);
        if (isOpen) next.delete(path);
        else next.add(path);
        persistCollapsed(next);
        return next;
      });
    },
    [persistCollapsed]
  );

  const reorderFolders = useCallback(
    (fromIndex: number, toIndex: number) => {
      const next = [...rootsRef.current];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return;
      next.splice(toIndex, 0, moved);
      commitRoots(next);
    },
    [commitRoots]
  );

  /** Persist a new order given by root IDs. Unknown IDs are ignored; unmentioned roots keep their order at the end. */
  const setRootOrder = useCallback(
    (ids: string[]) => {
      const byId = new Map(rootsRef.current.map((root) => [root.id, root]));
      const ordered: TrackedRoot[] = [];
      for (const id of ids) {
        const root = byId.get(id);
        if (root) {
          ordered.push(root);
          byId.delete(id);
        }
      }
      commitRoots([...ordered, ...byId.values()]);
    },
    [commitRoots]
  );

  const isFolderOpen = useCallback(
    (path: string) => !collapsedFolders.has(path),
    [collapsedFolders]
  );

  const [folders, setFolders] = useState<string[]>([]);
  useEffect(() => {
    setFolders((prev) => {
      const next = roots.map((root) => root.path);
      if (prev.length === next.length && prev.every((path, index) => path === next[index])) return prev;
      return next;
    });
  }, [roots]);

  return {
    roots,
    folders,
    loading,
    firstRun,
    addFolder,
    addFolderByPath,
    ensureSharedRoot,
    removeFolder,
    renameFolder,
    reorderFolders,
    setRootOrder,
    setRootKind,
    updateRoot,
    updateRootPath,
    setFolderOpen,
    isFolderOpen,
  };
}
