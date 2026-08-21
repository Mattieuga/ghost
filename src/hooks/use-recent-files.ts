import { useState, useEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";

const STORE_KEY = "recent-files";
const MAX_RECENT = 20;

export function useRecentFiles() {
  const [recentFiles, setRecentFiles] = useState<string[]>([]);

  useEffect(() => {
    load("settings.json", { defaults: {}, autoSave: true }).then(async (store) => {
      const saved = await store.get<string[]>(STORE_KEY);
      setRecentFiles(saved ?? []);
    });
  }, []);

  const persist = useCallback(async (files: string[]) => {
    const store = await load("settings.json", { defaults: {}, autoSave: true });
    await store.set(STORE_KEY, files);
  }, []);

  const addRecentFile = useCallback((path: string) => {
    setRecentFiles((prev) => {
      const filtered = prev.filter((p) => p !== path);
      const next = [path, ...filtered].slice(0, MAX_RECENT);
      persist(next);
      return next;
    });
  }, [persist]);

  const retargetRecentFiles = useCallback((oldPath: string, newPath: string) => {
    setRecentFiles((previous) => {
      const next = previous.map((path) => {
        if (path === oldPath) return newPath;
        if (path.startsWith(`${oldPath}/`)) return `${newPath}${path.slice(oldPath.length)}`;
        return path;
      });
      void persist(next);
      return next;
    });
  }, [persist]);

  const removeRecentFiles = useCallback((removedPath: string) => {
    setRecentFiles((previous) => {
      const next = previous.filter(
        (path) => path !== removedPath && !path.startsWith(`${removedPath}/`),
      );
      void persist(next);
      return next;
    });
  }, [persist]);

  return { recentFiles, addRecentFile, retargetRecentFiles, removeRecentFiles };
}
