import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileEntry, FlatFileEntry } from "@/types";

const SKIP_DIRS = new Set([
  "node_modules", ".git", ".svn", ".hg",
  "build", "dist", "out", ".next", ".nuxt",
  "__pycache__", ".cache", ".parcel-cache",
  "target", ".build", "Pods",
  ".turbo", ".vercel", ".output",
]);

function flattenEntries(
  entries: FileEntry[],
  folderRoot: string
): FlatFileEntry[] {
  const result: FlatFileEntry[] = [];

  function walk(items: FileEntry[]) {
    for (const entry of items) {
      if (entry.is_directory) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (entry.children) walk(entry.children);
      } else {
        const dir = entry.path.substring(0, entry.path.lastIndexOf("/"));
        const rootName = folderRoot.substring(folderRoot.lastIndexOf("/") + 1);
        const relative = dir.substring(folderRoot.length);
        const folderDisplay = relative ? rootName + relative : rootName;

        result.push({
          name: entry.name,
          path: entry.path,
          folderDisplay,
        });
      }
    }
  }

  walk(entries);
  return result;
}

function mergeChildren(entries: FileEntry[], parentPath: string, children: FileEntry[]): FileEntry[] {
  return entries.map((entry) => {
    if (entry.path === parentPath) {
      return { ...entry, children };
    }
    if (entry.is_directory && entry.children && parentPath.startsWith(entry.path + "/")) {
      return { ...entry, children: mergeChildren(entry.children, parentPath, children) };
    }
    return entry;
  });
}

interface FolderData {
  entries: FileEntry[];
  error: string | null;
}

export function useFileTree(
  folders: string[],
  extensions: string[],
  refreshTrigger: number,
  showHiddenFiles = false,
) {
  const [dataByFolder, setDataByFolder] = useState<Record<string, FolderData>>({});
  const loadedDirs = useRef(new Set<string>());

  const foldersKey = JSON.stringify(folders);
  const extensionsKey = JSON.stringify(extensions);

  const fetchAll = useCallback(() => {
    let cancelled = false;

    const previouslyLoaded = new Set(loadedDirs.current);
    loadedDirs.current = new Set<string>();

    Promise.all(
      folders.map(async (folder) => {
        try {
          const entries = await invoke<FileEntry[]>("read_directory", {
            path: folder,
            extensions,
            max_depth: 1,
            showHidden: showHiddenFiles,
          });
          loadedDirs.current.add(folder);
          return { folder, entries, error: null };
        } catch (err) {
          return { folder, entries: [] as FileEntry[], error: String(err) };
        }
      })
    ).then(async (results) => {
      if (cancelled) return;
      const next: Record<string, FolderData> = {};
      for (const r of results) {
        next[r.folder] = { entries: r.entries, error: r.error };
      }
      setDataByFolder(next);

      // Re-expand all previously loaded subdirectories in parallel, then
      // merge results in a single state update to avoid N separate renders.
      const subDirs = [...previouslyLoaded].filter((d) => !folders.includes(d));
      if (subDirs.length > 0) {
        const subResults = await Promise.all(
          subDirs.map(async (dir) => {
            try {
              const children = await invoke<FileEntry[]>("read_directory", {
                path: dir,
                extensions,
                max_depth: 1,
                showHidden: showHiddenFiles,
              });
              loadedDirs.current.add(dir);
              return { dir, children };
            } catch {
              return null;
            }
          })
        );
        if (cancelled) return;
        setDataByFolder((prev) => {
          let updated = { ...prev };
          for (const result of subResults) {
            if (!result) continue;
            const { dir, children } = result;
            for (const [root, data] of Object.entries(updated)) {
              if (dir === root || dir.startsWith(root + "/")) {
                updated[root] = {
                  ...data,
                  entries: dir === root ? children : mergeChildren(data.entries, dir, children),
                };
              }
            }
          }
          return updated;
        });
      }
    });

    return () => { cancelled = true; };
  }, [foldersKey, extensionsKey, showHiddenFiles]);

  useEffect(() => {
    return fetchAll();
  }, [fetchAll, refreshTrigger]);

  const expandFolder = useCallback(async (folderPath: string) => {
    if (loadedDirs.current.has(folderPath)) return;
    loadedDirs.current.add(folderPath);

    try {
      const children = await invoke<FileEntry[]>("read_directory", {
        path: folderPath,
        extensions,
        max_depth: 1,
        showHidden: showHiddenFiles,
      });

      setDataByFolder((prev) => {
        const next: Record<string, FolderData> = {};
        for (const [root, data] of Object.entries(prev)) {
          if (folderPath === root || folderPath.startsWith(root + "/")) {
            next[root] = {
              ...data,
              entries: folderPath === root ? children : mergeChildren(data.entries, folderPath, children),
            };
          } else {
            next[root] = data;
          }
        }
        return next;
      });
    } catch {
      // Silently ignore — folder may have been deleted
    }
  }, [extensionsKey, showHiddenFiles]);

  const isSkippedDir = useCallback((name: string) => SKIP_DIRS.has(name), []);

  const flatFiles = useMemo(() => {
    const all: FlatFileEntry[] = [];
    for (const folder of folders) {
      const data = dataByFolder[folder];
      if (data?.entries) {
        all.push(...flattenEntries(data.entries, folder));
      }
    }
    return all;
  }, [dataByFolder, foldersKey]);

  const getEntries = useCallback(
    (folder: string): FileEntry[] => dataByFolder[folder]?.entries ?? [],
    [dataByFolder]
  );

  const getError = useCallback(
    (folder: string): string | null => dataByFolder[folder]?.error ?? null,
    [dataByFolder]
  );

  return { flatFiles, getEntries, getError, expandFolder, isSkippedDir };
}
