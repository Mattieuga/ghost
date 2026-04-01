import { useState, useEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import { open } from "@tauri-apps/plugin-dialog";

const STORE_KEY = "tracked-folders";

export function useTrackedFolders() {
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load("settings.json", { defaults: {}, autoSave: true }).then(async (store) => {
      const saved = await store.get<string[]>(STORE_KEY);
      setFolders(saved ?? []);
      setLoading(false);
    });
  }, []);

  const persist = useCallback(async (newFolders: string[]) => {
    const store = await load("settings.json", { defaults: {}, autoSave: true });
    await store.set(STORE_KEY, newFolders);
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
        persist(next);
        return next;
      });
    }
  }, [persist]);

  const addFolderByPath = useCallback((path: string) => {
    setFolders((prev) => {
      if (prev.includes(path)) return prev;
      const next = [...prev, path];
      persist(next);
      return next;
    });
  }, [persist]);

  const removeFolder = useCallback(
    (path: string) => {
      setFolders((prev) => {
        const next = prev.filter((f) => f !== path);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const reorderFolders = useCallback(
    (fromIndex: number, toIndex: number) => {
      setFolders((prev) => {
        const next = [...prev];
        const [moved] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, moved);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  return { folders, loading, addFolder, addFolderByPath, removeFolder, reorderFolders };
}
