import { invoke } from "@tauri-apps/api/core";
import type { FileEntry } from "@/types";
import type { FileVersionToken } from "@/lib/source-document";
import { GHOST_DIR, isMarkdownPath, MARKDOWN_EXTENSIONS } from "@/lib/mirror/ghost-index";
import type { SyncCandidate } from "@/lib/mirror/preflight";

/**
 * Directories never adopted or watched inside a mirrored root. Mirrors
 * `IGNORED_DIRECTORIES` in `src-tauri/src/watcher.rs`.
 */
export const MIRROR_IGNORED_DIRECTORIES = new Set([
  GHOST_DIR, ".git", ".hg", ".svn", ".jj", ".sl", ".bzr", ".fossil", "_darcs", ".pijul",
  "node_modules", ".venv", "target", "dist", "build", ".cache", "DerivedData", "Pods",
]);

export interface ResolvedBookmark {
  path: string;
  stale: boolean;
}

/** Structured payload of the `fs-event` Tauri event from `watcher.rs`. */
export interface FsEvent {
  kind: "create" | "modify" | "remove" | "rename" | "other";
  path: string;
  from: string | null;
}

/**
 * Everything the mirror engine asks the filesystem for, behind one interface
 * so the engine can be tested with an in-memory implementation.
 */
export interface MirrorFs {
  readText(path: string): Promise<string>;
  getVersion(path: string): Promise<FileVersionToken>;
  writeText(
    path: string,
    content: string,
    options: { expectedVersion: FileVersionToken | null; force: boolean },
  ): Promise<FileVersionToken>;
  hashText(text: string): Promise<string>;
  hashFile(path: string): Promise<string>;
  writeConflictCopy(path: string, content: string, label: string): Promise<string>;
  ensureDir(path: string): Promise<void>;
  listFiles(dir: string): Promise<string[]>;
  removeGhostFile(path: string): Promise<void>;
  /** Absolute paths of every Markdown file below `root`, skipping ignored folders. */
  listMarkdownFiles(root: string): Promise<string[]>;
  createBookmark(path: string): Promise<string>;
  resolveBookmark(bookmark: string): Promise<ResolvedBookmark>;
  isDirectory(path: string): Promise<boolean>;
  inspectSyncCandidate(path: string, options?: { deep?: boolean }): Promise<SyncCandidate>;
  mountedVolumes(): Promise<string[]>;
  /** Remove `<root>/.ghost` entirely, when sync stops. */
  removeGhostDir(root: string): Promise<void>;
  linkIntoRepository(folder: string, repository: string, linkName?: string): Promise<RepositoryLink>;
  /** Copy a file and its companion assets into a folder; returns the new path. */
  copyFileInto(source: string, targetDir: string): Promise<string>;
  /** Move or rename a file to an absolute path whose directory exists. */
  movePath(from: string, to: string): Promise<void>;
  /** Move a file or folder to the macOS Trash. */
  trashPath(path: string): Promise<void>;
}

export interface RepositoryLink {
  linkPath: string;
  excludePath: string;
  linkCreated: boolean;
  excludeAdded: boolean;
}

function flattenMarkdown(entries: FileEntry[], into: string[]): void {
  for (const entry of entries) {
    if (entry.is_directory) {
      if (MIRROR_IGNORED_DIRECTORIES.has(entry.name)) continue;
      if (entry.children) flattenMarkdown(entry.children, into);
    } else if (isMarkdownPath(entry.name)) {
      into.push(entry.path);
    }
  }
}

export const tauriMirrorFs: MirrorFs = {
  readText: (path) => invoke<string>("read_file", { path }),
  getVersion: (path) => invoke<FileVersionToken>("get_file_version", { path }),
  writeText: (path, content, options) => invoke<FileVersionToken>("write_file", {
    path,
    content,
    expectedContent: null,
    expectedVersion: options.expectedVersion,
    force: options.force,
  }),
  hashText: (text) => invoke<string>("hash_text_content", { text }),
  hashFile: (path) => invoke<string>("hash_file", { path }),
  writeConflictCopy: (path, content, label) => invoke<string>("write_conflict_copy", { path, content, label }),
  ensureDir: (path) => invoke<void>("ensure_directory", { path }),
  listFiles: (dir) => invoke<string[]>("list_directory_files", { path: dir }),
  removeGhostFile: (path) => invoke<void>("remove_ghost_metadata_file", { path }),
  listMarkdownFiles: async (root) => {
    const entries = await invoke<FileEntry[]>("read_directory", {
      path: root,
      extensions: [...MARKDOWN_EXTENSIONS],
      maxDepth: 64,
      showHidden: false,
    });
    const files: string[] = [];
    flattenMarkdown(entries, files);
    return files.sort();
  },
  createBookmark: (path) => invoke<string>("create_folder_bookmark", { path }),
  resolveBookmark: (bookmark) => invoke<ResolvedBookmark>("resolve_folder_bookmark", { bookmark }),
  isDirectory: (path) => invoke<boolean>("is_directory", { path }),
  inspectSyncCandidate: (path, options) => invoke<SyncCandidate>("inspect_sync_candidate", { path, deep: options?.deep ?? true }),
  mountedVolumes: () => invoke<string[]>("mounted_volumes"),
  removeGhostDir: (root) => invoke<void>("remove_ghost_metadata_dir", { root }),
  linkIntoRepository: (folder, repository, linkName) => invoke<RepositoryLink>(
    "link_folder_into_repository",
    { folder, repository, linkName: linkName ?? null },
  ),
  copyFileInto: (source, targetDir) => invoke<string>("copy_file_into", { source, targetDir }),
  movePath: async (from, to) => {
    const fromDir = from.slice(0, from.lastIndexOf("/"));
    const toDir = to.slice(0, to.lastIndexOf("/"));
    const toName = to.slice(to.lastIndexOf("/") + 1);
    let current = from;
    if (fromDir !== toDir) current = await invoke<string>("move_file", { filePath: from, targetDir: toDir, force: false });
    if (current.slice(current.lastIndexOf("/") + 1) !== toName) {
      await invoke<string>("rename_file", { oldPath: current, newName: toName });
    }
  },
  trashPath: (path) => invoke<void>("delete_file", { path }),
};
