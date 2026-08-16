import { useState, useEffect, useCallback, useRef } from "react";
import { load } from "@tauri-apps/plugin-store";
import { open } from "@tauri-apps/plugin-dialog";

const STORE_KEY = "tracked-folders";
const COLLAPSED_KEY = "collapsed-folders";

export function useTrackedFolders() {
  const [folders, setFolders] = useState<string[]>([]);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const storeRef = useRef<Awaited<ReturnType<typeof load>> | null>(null);

  useEffect(() => {
    load("settings.json", { defaults: {}, autoSave: true }).then(async (store) => {
      storeRef.current = store;
      const saved = await store.get<string[]>(STORE_KEY);
      const collapsed = await store.get<string[]>(COLLAPSED_KEY);
      setFolders(saved ?? []);
      setCollapsedFolders(new Set(collapsed ?? []));
      setLoading(false);
    });
  }, []);

  const persistFolders = useCallback((newFolders: string[]) => {
    storeRef.current?.set(STORE_KEY, newFolders);
  }, []);

  const persistCollapsed = useCallback((collapsed: Set<string>) => {
    storeRef.current?.set(COLLAPSED_KEY, [...collapsed]);
  }, []);

  const addFolder = useCallback(async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select a folder to track",
    });
    if (selected && typeof selected === "string") {
      setFolders((prev) => {
        if (prev.includes(selected)) return prev;
        const next = [...prev, selected];
        persistFolders(next);
        return next;
      });
    }
  }, [persistFolders]);

  const addFolderByPath = useCallback((path: string) => {
    setFolders((prev) => {
      if (prev.includes(path)) return prev;
      const next = [...prev, path];
      persistFolders(next);
      return next;
    });
  }, [persistFolders]);

  const removeFolder = useCallback(
    (path: string) => {
      setFolders((prev) => {
        const next = prev.filter((f) => f !== path);
        persistFolders(next);
        return next;
      });
      setCollapsedFolders((prev) => {
        const next = new Set(prev);
        if (next.delete(path)) persistCollapsed(next);
        return next;
      });
    },
    [persistFolders, persistCollapsed]
  );

  const renameFolder = useCallback(
    (oldPath: string, newPath: string) => {
      setFolders((prev) => {
        const next = prev.map((folder) => folder === oldPath ? newPath : folder);
        persistFolders(next);
        return next;
      });
      setCollapsedFolders((prev) => {
        if (!prev.has(oldPath)) return prev;
        const next = new Set(prev);
        next.delete(oldPath);
        next.add(newPath);
        persistCollapsed(next);
        return next;
      });
    },
    [persistFolders, persistCollapsed]
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
      setFolders((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        persistFolders(next);
        return next;
      });
    },
    [persistFolders]
  );

  const isFolderOpen = useCallback(
    (path: string) => !collapsedFolders.has(path),
    [collapsedFolders]
  );

  return { folders, loading, addFolder, addFolderByPath, removeFolder, renameFolder, reorderFolders, setFolderOpen, isFolderOpen };
}
