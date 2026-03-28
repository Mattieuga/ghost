import { useState, useEffect, useMemo } from "react";
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
        // Get relative folder path from the tracked root
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

export function useFlatFileList(
  folders: string[],
  extensions: string[],
  refreshTrigger: number
) {
  const [entriesByFolder, setEntriesByFolder] = useState<
    Record<string, FileEntry[]>
  >({});

  useEffect(() => {
    let cancelled = false;

    async function fetchAll() {
      const results: Record<string, FileEntry[]> = {};
      await Promise.all(
        folders.map(async (folder) => {
          try {
            const entries = await invoke<FileEntry[]>("read_directory", {
              path: folder,
              extensions,
            });
            results[folder] = entries;
          } catch {
            results[folder] = [];
          }
        })
      );
      if (!cancelled) setEntriesByFolder(results);
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [folders.join(","), extensions.join(","), refreshTrigger]);

  const flatFiles = useMemo(() => {
    const all: FlatFileEntry[] = [];
    for (const folder of folders) {
      const entries = entriesByFolder[folder];
      if (entries) {
        all.push(...flattenEntries(entries, folder));
      }
    }
    return all;
  }, [entriesByFolder, folders.join(",")]);

  return flatFiles;
}
