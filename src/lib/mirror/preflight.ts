import type { TrackedRoot } from "@/hooks/use-tracked-folders";

/** Facts from the native `inspect_sync_candidate` command. */
export interface MarkerHit {
  path: string;
  marker: string;
}

export interface SyncCandidate {
  path: string;
  canonicalPath: string;
  home: string;
  appDataDir: string | null;
  isDirectory: boolean;
  isPackage: boolean;
  writable: boolean;
  ancestorVcs: MarkerHit[];
  ancestorManaged: MarkerHit[];
  descendantVcs: MarkerHit[];
  descendantManaged: MarkerHit[];
  syncService: string | null;
  externalVolume: boolean;
  fileCount: number;
  byteCount: number;
  markdownCount: number;
  scanTruncated: boolean;
}

export type PreflightRefusal =
  | "not-a-folder"
  | "package"
  | "version-control"
  | "protected-location"
  | "not-writable"
  | "already-synced"
  | "inside-synced-root"
  | "contains-synced-root";

export type PreflightWarning =
  | "other-sync-service"
  | "external-volume"
  | "very-large"
  | "non-markdown-files";

export interface PreflightExclusion {
  path: string;
  marker: string;
  reason: "version-control" | "managed-folder";
}

export interface PreflightResult {
  verdict: "refuse" | "allow";
  refusal: { code: PreflightRefusal; message: string } | null;
  warnings: Array<{ code: PreflightWarning; message: string }>;
  /** Folders inside the candidate that sync will skip, with a notice. */
  excluded: PreflightExclusion[];
}

export const LARGE_FILE_COUNT = 20_000;
export const LARGE_BYTE_COUNT = 2 * 1024 * 1024 * 1024;

function folderName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1) || path;
}

function isSameOrInside(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function protectedLocations(home: string, appDataDir: string | null): string[] {
  const locations = [
    "/",
    home,
    `${home}/Library`,
    `${home}/.Trash`,
    "/System",
    "/Applications",
    "/Volumes",
    "/private",
    "/usr",
    "/bin",
    "/etc",
  ];
  if (appDataDir) locations.push(appDataDir);
  return locations;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/**
 * The pre-flight rules table of ADR 0005, applied to native facts about a
 * folder. Refusals stop the flow; warnings are shown and allowed; exclusions
 * are folders sync will skip.
 */
export function evaluateSyncPreflight(
  facts: SyncCandidate,
  roots: TrackedRoot[],
): PreflightResult {
  const path = facts.canonicalPath;
  const name = folderName(path);
  const refuse = (code: PreflightRefusal, message: string): PreflightResult => ({
    verdict: "refuse",
    refusal: { code, message },
    warnings: [],
    excluded: [],
  });

  if (!facts.isDirectory) return refuse("not-a-folder", `${name} is not a folder.`);
  if (facts.isPackage) {
    return refuse("package", `${name} is a package that only looks like a folder. Ghost does not sync packages.`);
  }
  if (facts.ancestorVcs.length > 0) {
    const hit = facts.ancestorVcs[0];
    const owner = hit.marker === ".git" ? "Git" : "version control";
    return refuse(
      "version-control",
      `${owner} owns the files in ${folderName(hit.path)}, so Ghost will not sync them. `
        + "You can copy a file into Notes to share it.",
    );
  }
  for (const location of protectedLocations(facts.home, facts.appDataDir)) {
    if (path === location) {
      return refuse("protected-location", `${name} is too broad or is a system folder. Choose a folder inside it.`);
    }
  }
  if (!facts.writable) {
    return refuse("not-writable", `Ghost cannot write inside ${name}, and syncing needs to keep the files up to date.`);
  }

  const mirrored = roots.filter((root) => root.kind === "mirrored");
  const exact = mirrored.find((root) => root.path === path);
  if (exact) return refuse("already-synced", `${name} is already synced.`);
  const ancestor = mirrored.find((root) => isSameOrInside(path, root.path));
  if (ancestor) {
    return refuse(
      "inside-synced-root",
      `${name} is already synced as part of ${folderName(ancestor.path)}.`,
    );
  }
  const inside = mirrored.find((root) => isSameOrInside(root.path, path));
  if (inside) {
    return refuse(
      "contains-synced-root",
      `${folderName(inside.path)} inside ${name} is already synced. Stop syncing it first, or sync a different folder.`,
    );
  }

  const excluded: PreflightExclusion[] = [
    ...facts.descendantVcs.map((hit) => ({ ...hit, reason: "version-control" as const })),
    ...facts.descendantManaged.map((hit) => ({ ...hit, reason: "managed-folder" as const })),
  ];

  const warnings: PreflightResult["warnings"] = [];
  const managedAbove = facts.ancestorManaged[0];
  if (facts.syncService || managedAbove) {
    const service = facts.syncService
      ?? (managedAbove.marker === ".obsidian" ? "Obsidian" : "another sync app");
    warnings.push({
      code: "other-sync-service",
      message: `${name} is already synced by ${service}. Syncing it with Ghost too can create duplicate or conflicting files.`,
    });
  }
  if (facts.externalVolume) {
    warnings.push({
      code: "external-volume",
      message: `${name} is on an external or network volume and may be unavailable when it is disconnected.`,
    });
  }
  if (facts.fileCount >= LARGE_FILE_COUNT || facts.byteCount >= LARGE_BYTE_COUNT || facts.scanTruncated) {
    const count = facts.scanTruncated ? `more than ${facts.fileCount.toLocaleString()}` : facts.fileCount.toLocaleString();
    warnings.push({
      code: "very-large",
      message: `${name} holds ${count} files (${formatBytes(facts.byteCount)}). Syncing may take a while.`,
    });
  }
  const nonMarkdown = facts.fileCount - facts.markdownCount;
  if (nonMarkdown > 0) {
    warnings.push({
      code: "non-markdown-files",
      message: `${nonMarkdown.toLocaleString()} ${nonMarkdown === 1 ? "file" : "files"} in ${name} ${nonMarkdown === 1 ? "is" : "are"} not Markdown and won't sync yet.`,
    });
  }

  return { verdict: "allow", refusal: null, warnings, excluded };
}
