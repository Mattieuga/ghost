import { useState, useEffect, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileEntry, FlatFileEntry } from "@/types";

function flattenEntries(
  entries: FileEntry[],
  folderRoot: string
): FlatFileEntry[] {
  const result: FlatFileEntry[] = [];

  function walk(items: FileEntry[]) {
    for (const entry of items) {
      if (entry.is_directory) {
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

interface FolderData {
  entries: FileEntry[];
  error: string | null;
}

/**
 * Single source of truth for file tree data across all tracked folders.
 * Returns both hierarchical entries (for sidebar) and flat list (for search).
 */
export function useFileTree(
  folders: string[],
  extensions: string[],
  refreshTrigger: number
) {
  const [dataByFolder, setDataByFolder] = useState<Record<string, FolderData>>({});

  const foldersKey = JSON.stringify(folders);
  const extensionsKey = JSON.stringify(extensions);

  const fetchAll = useCallback(() => {
    let cancelled = false;

    Promise.all(
      folders.map(async (folder) => {
        try {
          const entries = await invoke<FileEntry[]>("read_directory", {
            path: folder,
            extensions,
          });
          return { folder, entries, error: null };
        } catch (err) {
          return { folder, entries: [] as FileEntry[], error: String(err) };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const next: Record<string, FolderData> = {};
      for (const r of results) {
        next[r.folder] = { entries: r.entries, error: r.error };
      }
      setDataByFolder(next);
    });

    return () => { cancelled = true; };
  }, [foldersKey, extensionsKey]);

  useEffect(() => {
    return fetchAll();
  }, [fetchAll, refreshTrigger]);

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

  return { flatFiles, getEntries, getError };
}
