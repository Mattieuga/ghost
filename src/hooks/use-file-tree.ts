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
  let changed = false;
  const next = entries.map((entry) => {
    if (entry.path === parentPath) {
      changed = true;
      return { ...entry, children };
    }
    if (entry.is_directory && entry.children && parentPath.startsWith(entry.path + "/")) {
      const nextChildren = mergeChildren(entry.children, parentPath, children);
      if (nextChildren !== entry.children) {
        changed = true;
        return { ...entry, children: nextChildren };
      }
    }
    return entry;
  });
  return changed ? next : entries;
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((left, right) => {
    if (left.is_directory !== right.is_directory) return left.is_directory ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

function preserveLoadedDescendants(
  freshEntries: FileEntry[],
  previousEntries: FileEntry[],
  loadedDirectories: Set<string>,
): FileEntry[] {
  const previousByPath = new Map(previousEntries.map((entry) => [entry.path, entry]));
  return freshEntries.map((entry) => {
    if (!entry.is_directory || !loadedDirectories.has(entry.path)) return entry;
    const previous = previousByPath.get(entry.path);
    return previous?.is_directory
      ? { ...entry, children: previous.children ?? [] }
      : entry;
  });
}

function parentDirectory(path: string): string | null {
  const separator = path.lastIndexOf("/");
  return separator > 0 ? path.slice(0, separator) : null;
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function updateDirectory(
  dataByFolder: Record<string, FolderData>,
  folders: string[],
  directoryPath: string,
  update: (entries: FileEntry[]) => FileEntry[],
): Record<string, FolderData> {
  for (const root of folders) {
    const data = dataByFolder[root];
    if (!data) continue;
    if (directoryPath === root) {
      const entries = update(data.entries);
      return entries === data.entries
        ? dataByFolder
        : { ...dataByFolder, [root]: { ...data, entries } };
    }
    if (directoryPath.startsWith(`${root}/`)) {
      const entries = mergeChildren(data.entries, directoryPath, update(
        findDirectoryChildren(data.entries, directoryPath) ?? [],
      ));
      return entries === data.entries
        ? dataByFolder
        : { ...dataByFolder, [root]: { ...data, entries } };
    }
  }
  return dataByFolder;
}

function findDirectoryChildren(entries: FileEntry[], directoryPath: string): FileEntry[] | null {
  for (const entry of entries) {
    if (entry.path === directoryPath && entry.is_directory) return entry.children ?? [];
    if (entry.is_directory && entry.children && directoryPath.startsWith(`${entry.path}/`)) {
      const match = findDirectoryChildren(entry.children, directoryPath);
      if (match) return match;
    }
  }
  return null;
}

function retargetEntry(entry: FileEntry, oldPath: string, newPath: string): FileEntry {
  const path = entry.path === oldPath
    ? newPath
    : entry.path.startsWith(`${oldPath}/`)
      ? `${newPath}${entry.path.slice(oldPath.length)}`
      : entry.path;
  return {
    ...entry,
    name: entry.path === oldPath ? fileName(newPath) : entry.name,
    path,
    children: entry.children?.map((child) => retargetEntry(child, oldPath, newPath)) ?? null,
  };
}

function retargetEntries(
  entries: FileEntry[],
  oldPath: string,
  newPath: string,
  includeFile: boolean,
): FileEntry[] {
  let changed = false;
  const next: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.path === oldPath) {
      changed = true;
      if (entry.is_directory || includeFile) next.push(retargetEntry(entry, oldPath, newPath));
      continue;
    }
    if (entry.is_directory && entry.children && oldPath.startsWith(`${entry.path}/`)) {
      const children = retargetEntries(entry.children, oldPath, newPath, includeFile);
      if (children !== entry.children) {
        changed = true;
        next.push({ ...entry, children });
        continue;
      }
    }
    next.push(entry);
  }
  return changed ? sortEntries(next) : entries;
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
  const directoryRefreshes = useRef(new Map<string, number>());

  const foldersKey = JSON.stringify(folders);
  const extensionsKey = JSON.stringify(extensions);

  const fetchAll = useCallback(() => {
    let cancelled = false;

    const previouslyLoaded = new Set(loadedDirs.current);
    const nextLoadedDirs = new Set<string>();

    Promise.all(
      folders.map(async (folder) => {
        try {
          const entries = await invoke<FileEntry[]>("read_directory", {
            path: folder,
            extensions,
            max_depth: 1,
            showHidden: showHiddenFiles,
          });
          nextLoadedDirs.add(folder);
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
      // Re-expand all previously loaded subdirectories in parallel and merge
      // them before publishing the new tree. Publishing the shallow roots
      // first temporarily unmounted every expanded row and made refreshes
      // visibly jump, especially while creating or renaming a file.
      const subDirs = [...previouslyLoaded]
        .filter((d) => !folders.includes(d))
        .sort((left, right) => left.split("/").length - right.split("/").length);
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
              nextLoadedDirs.add(dir);
              return { dir, children };
            } catch {
              return null;
            }
          })
        );
        if (cancelled) return;
        for (const result of subResults) {
          if (!result) continue;
          const { dir, children } = result;
          for (const [root, data] of Object.entries(next)) {
            if (dir === root || dir.startsWith(root + "/")) {
              next[root] = {
                ...data,
                entries: dir === root ? children : mergeChildren(data.entries, dir, children),
              };
            }
          }
        }
      }
      if (cancelled) return;
      loadedDirs.current = nextLoadedDirs;
      setDataByFolder(next);
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

  const insertEntry = useCallback((path: string, isDirectory: boolean) => {
    const directoryPath = parentDirectory(path);
    if (!directoryPath) return;
    loadedDirs.current.add(directoryPath);
    directoryRefreshes.current.set(
      directoryPath,
      (directoryRefreshes.current.get(directoryPath) ?? 0) + 1,
    );
    const entry: FileEntry = {
      name: fileName(path),
      path,
      is_directory: isDirectory,
      children: isDirectory ? [] : null,
    };
    setDataByFolder((previous) => updateDirectory(
      previous,
      folders,
      directoryPath,
      (entries) => sortEntries([...entries.filter((item) => item.path !== path), entry]),
    ));
  }, [foldersKey]);

  const renameEntry = useCallback((oldPath: string, newPath: string) => {
    const oldDirectory = parentDirectory(oldPath);
    const newDirectory = parentDirectory(newPath);
    if (!oldDirectory || !newDirectory || oldDirectory !== newDirectory) return;
    directoryRefreshes.current.set(
      oldDirectory,
      (directoryRefreshes.current.get(oldDirectory) ?? 0) + 1,
    );
    const extension = fileName(newPath).includes(".")
      ? fileName(newPath).slice(fileName(newPath).lastIndexOf(".") + 1)
      : "";
    const includeFile = extensions.length === 0 || extensions.includes(extension);
    setDataByFolder((previous) => updateDirectory(
      previous,
      folders,
      oldDirectory,
      (entries) => retargetEntries(entries, oldPath, newPath, includeFile),
    ));
  }, [extensionsKey, foldersKey]);

  const refreshDirectory = useCallback((directoryPath: string) => {
    const refresh = async (path: string, allowParentFallback: boolean): Promise<void> => {
      const generation = (directoryRefreshes.current.get(path) ?? 0) + 1;
      directoryRefreshes.current.set(path, generation);
      try {
        const children = await invoke<FileEntry[]>("read_directory", {
          path,
          extensions,
          max_depth: 1,
          showHidden: showHiddenFiles,
        });
        if (directoryRefreshes.current.get(path) !== generation) return;
        loadedDirs.current.add(path);
        setDataByFolder((previous) => updateDirectory(
          previous,
          folders,
          path,
          (entries) => preserveLoadedDescendants(children, entries, loadedDirs.current),
        ));
      } catch {
        loadedDirs.current.delete(path);
        if (!allowParentFallback) return;
        const root = [...folders]
          .filter((folder) => path === folder || path.startsWith(`${folder}/`))
          .sort((left, right) => right.length - left.length)[0];
        if (!root || path === root) return;
        let parent = parentDirectory(path);
        while (parent && parent !== root && !loadedDirs.current.has(parent)) {
          parent = parentDirectory(parent);
        }
        if (parent && (parent === root || parent.startsWith(`${root}/`))) {
          await refresh(parent, false);
        }
      }
    };
    return refresh(directoryPath, true);
  }, [extensionsKey, foldersKey, showHiddenFiles]);

  const refreshPath = useCallback((changedPath: string) => {
    const root = [...folders]
      .filter((folder) => changedPath === folder || changedPath.startsWith(`${folder}/`))
      .sort((left, right) => right.length - left.length)[0];
    if (!root) return;

    let directoryPath = changedPath;
    while (directoryPath !== root && !loadedDirs.current.has(directoryPath)) {
      const parent = parentDirectory(directoryPath);
      if (!parent || !parent.startsWith(root)) {
        directoryPath = root;
        break;
      }
      directoryPath = parent;
    }
    void refreshDirectory(directoryPath);
  }, [foldersKey, refreshDirectory]);

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

  return {
    flatFiles,
    getEntries,
    getError,
    expandFolder,
    insertEntry,
    renameEntry,
    refreshPath,
    isSkippedDir,
  };
}
