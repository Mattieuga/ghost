export type ArchiveEntryKind = "file" | "directory" | "symlink" | "other";

export interface ArchiveEntry {
  path: string;
  kind: ArchiveEntryKind;
  size_bytes: number | null;
  modified_ms: number | null;
  link_target: string | null;
}

export interface ArchiveManifest {
  archive_size_bytes: number;
  modified_ms: number;
  entry_count: number;
  total_uncompressed_bytes: number | null;
  entries: ArchiveEntry[];
}

export interface ArchiveTreeNode {
  id: string;
  name: string;
  path: string;
  kind: ArchiveEntryKind;
  sizeBytes: number | null;
  modifiedMs: number | null;
  linkTarget: string | null;
  implicit: boolean;
  parentId: string | null;
  children: ArchiveTreeNode[];
}

export interface VisibleArchiveNode {
  node: ArchiveTreeNode;
  depth: number;
}

const ARCHIVE_LABELS: ReadonlyArray<readonly [string, string]> = [
  [".tar.bz2", "BZIP2 TAR"],
  [".tar.zst", "ZSTD TAR"],
  [".tar.gz", "GZIP TAR"],
  [".tar.xz", "XZ TAR"],
  [".tbz2", "BZIP2 TAR"],
  [".cpgz", "GZIP CPIO"],
  [".tgz", "GZIP TAR"],
  [".tbz", "BZIP2 TAR"],
  [".txz", "XZ TAR"],
  [".tzst", "ZSTD TAR"],
  [".cpio", "CPIO"],
  [".zip", "ZIP"],
  [".tar", "TAR"],
  [".7z", "7-ZIP"],
  [".rar", "RAR"],
  [".bz2", "BZIP2"],
  [".gz", "GZIP"],
];

export function archiveFormatLabel(filePath: string): string {
  const lowerName = (filePath.split("/").pop() ?? filePath).toLowerCase();
  return ARCHIVE_LABELS.find(([suffix]) => lowerName.endsWith(suffix))?.[1] ?? "ARCHIVE";
}

export function archiveContainerLabel(filePath: string): string {
  const lowerName = (filePath.split("/").pop() ?? filePath).toLowerCase();
  const kind = lowerName.endsWith(".gz") && !lowerName.endsWith(".tar.gz")
    || lowerName.endsWith(".bz2") && !lowerName.endsWith(".tar.bz2")
    ? "stream"
    : "archive";
  return `${archiveFormatLabel(filePath)} ${kind}`;
}

function compareNodes(left: ArchiveTreeNode, right: ArchiveTreeNode): number {
  if (left.kind === "directory" && right.kind !== "directory") return -1;
  if (right.kind === "directory" && left.kind !== "directory") return 1;
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
}

/** Build explicit and inferred archive directories without discarding duplicate file entries. */
export function buildArchiveTree(entries: ArchiveEntry[]): ArchiveTreeNode[] {
  const roots: ArchiveTreeNode[] = [];
  const directories = new Map<string, ArchiveTreeNode>();

  const ensureDirectory = (path: string): ArchiveTreeNode => {
    const existing = directories.get(path);
    if (existing) return existing;

    const separator = path.lastIndexOf("/");
    const parentPath = separator >= 0 ? path.slice(0, separator) : "";
    const node: ArchiveTreeNode = {
      id: `directory:${path}`,
      name: separator >= 0 ? path.slice(separator + 1) : path,
      path,
      kind: "directory",
      sizeBytes: null,
      modifiedMs: null,
      linkTarget: null,
      implicit: true,
      parentId: parentPath ? `directory:${parentPath}` : null,
      children: [],
    };
    directories.set(path, node);
    if (parentPath) ensureDirectory(parentPath).children.push(node);
    else roots.push(node);
    return node;
  };

  entries.forEach((entry, index) => {
    const path = entry.path.replace(/\/$/, "");
    if (!path) return;
    const separator = path.lastIndexOf("/");
    const parentPath = separator >= 0 ? path.slice(0, separator) : "";
    const name = separator >= 0 ? path.slice(separator + 1) : path;

    if (entry.kind === "directory") {
      const directory = ensureDirectory(path);
      directory.sizeBytes = entry.size_bytes;
      directory.modifiedMs = entry.modified_ms;
      directory.linkTarget = entry.link_target;
      directory.implicit = false;
      return;
    }

    const node: ArchiveTreeNode = {
      id: `entry:${index}:${path}`,
      name,
      path,
      kind: entry.kind,
      sizeBytes: entry.size_bytes,
      modifiedMs: entry.modified_ms,
      linkTarget: entry.link_target,
      implicit: false,
      parentId: parentPath ? `directory:${parentPath}` : null,
      children: [],
    };
    if (parentPath) ensureDirectory(parentPath).children.push(node);
    else roots.push(node);
  });

  const sortRecursively = (nodes: ArchiveTreeNode[]) => {
    nodes.sort(compareNodes);
    nodes.forEach((node) => sortRecursively(node.children));
  };
  sortRecursively(roots);
  return roots;
}

export function flattenArchiveTree(
  roots: ArchiveTreeNode[],
  expanded: ReadonlySet<string>,
): VisibleArchiveNode[] {
  const visible: VisibleArchiveNode[] = [];
  const visit = (nodes: ArchiveTreeNode[], depth: number) => {
    nodes.forEach((node) => {
      visible.push({ node, depth });
      if (node.kind === "directory" && expanded.has(node.id)) {
        visit(node.children, depth + 1);
      }
    });
  };
  visit(roots, 0);
  return visible;
}

export function allDirectoryIds(roots: ArchiveTreeNode[]): Set<string> {
  const result = new Set<string>();
  const visit = (nodes: ArchiveTreeNode[]) => nodes.forEach((node) => {
    if (node.kind !== "directory") return;
    result.add(node.id);
    visit(node.children);
  });
  visit(roots);
  return result;
}
