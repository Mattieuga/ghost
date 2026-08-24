import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  ArrowLeft,
  ChevronRight,
  Eye,
  File,
  FileSearch,
  Folder,
  Link2,
  Loader2,
  PackageOpen,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { OpenExternalButton } from "@/components/viewer/open-external-button";
import {
  ArchiveEntryPreview,
  type ArchivePreviewArtifact,
} from "@/components/viewer/archive-entry-preview";
import { useArchiveManifest } from "@/hooks/use-archive-manifest";
import {
  allDirectoryIds,
  archiveContainerLabel,
  buildArchiveTree,
  flattenArchiveTree,
  type ArchiveTreeNode,
} from "@/lib/archive";
import { formatMediaFileSize } from "@/lib/media";

interface ArchiveViewerProps {
  filePath: string;
}

interface ArchiveExtraction {
  output_path: string;
}

interface EntryPreviewState {
  node: ArchiveTreeNode;
  artifact: ArchivePreviewArtifact | null;
  loading: boolean;
  error: string | null;
}

function filterTree(nodes: ArchiveTreeNode[], query: string): ArchiveTreeNode[] {
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    const children = filterTree(node.children, query);
    if (!node.path.toLocaleLowerCase().includes(query) && children.length === 0) return [];
    return [{ ...node, children }];
  });
}

function formatArchiveDate(modifiedMs: number | null): string {
  if (modifiedMs === null) return "—";
  const date = new Date(modifiedMs);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function archiveParent(filePath: string): string | undefined {
  const separator = filePath.lastIndexOf("/");
  return separator > 0 ? filePath.slice(0, separator) : undefined;
}

export function ArchiveViewer({ filePath }: ArchiveViewerProps) {
  const { manifest, loading, error } = useArchiveManifest(filePath);
  const treeRef = useRef<HTMLDivElement>(null);
  const previewPaneRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const previewRequestRef = useRef<string | null>(null);
  const previewArtifactRef = useRef<ArchivePreviewArtifact | null>(null);
  const previewCounterRef = useRef(0);
  const manifestSignatureRef = useRef<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractionStatus, setExtractionStatus] = useState<string | null>(null);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [entryPreview, setEntryPreview] = useState<EntryPreviewState | null>(null);

  const fileName = filePath.split("/").pop() ?? filePath;
  const roots = useMemo(() => buildArchiveTree(manifest?.entries ?? []), [manifest]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredRoots = useMemo(
    () => filterTree(roots, normalizedQuery),
    [normalizedQuery, roots],
  );
  const searchExpansion = useMemo(() => allDirectoryIds(filteredRoots), [filteredRoots]);
  const visibleRows = useMemo(
    () => flattenArchiveTree(filteredRoots, normalizedQuery ? searchExpansion : expanded),
    [expanded, filteredRoots, normalizedQuery, searchExpansion],
  );
  const selectedNode = useMemo(
    () => visibleRows.find(({ node }) => node.id === selectedId)?.node ?? null,
    [selectedId, visibleRows],
  );

  const closeEntryPreview = useCallback((restoreTreeFocus = false) => {
    const requestId = previewRequestRef.current;
    previewRequestRef.current = null;
    if (requestId) {
      void invoke("cancel_archive_preview", { requestId }).catch(() => {});
    }
    const artifact = previewArtifactRef.current;
    previewArtifactRef.current = null;
    if (artifact) {
      void invoke("release_archive_preview", { token: artifact.token }).catch(() => {});
    }
    setEntryPreview(null);
    if (restoreTreeFocus) {
      window.requestAnimationFrame(() => treeRef.current?.focus({ preventScroll: true }));
    }
  }, []);

  const previewEntry = useCallback((node: ArchiveTreeNode) => {
    if (node.kind !== "file") return;
    closeEntryPreview(false);
    const requestId = `archive-preview-${Date.now()}-${++previewCounterRef.current}`;
    previewRequestRef.current = requestId;
    setEntryPreview({ node, artifact: null, loading: true, error: null });
    window.requestAnimationFrame(() => {
      if (window.matchMedia?.("(max-width: 767px)").matches) {
        previewPaneRef.current?.focus({ preventScroll: true });
      }
    });

    void invoke<ArchivePreviewArtifact>("materialize_archive_entry", {
      archivePath: filePath,
      entryPath: node.path,
      requestId,
    }).then((artifact) => {
      if (previewRequestRef.current !== requestId) {
        void invoke("release_archive_preview", { token: artifact.token }).catch(() => {});
        return;
      }
      previewRequestRef.current = null;
      previewArtifactRef.current = artifact;
      setEntryPreview({ node, artifact, loading: false, error: null });
    }).catch((reason) => {
      if (previewRequestRef.current !== requestId) return;
      previewRequestRef.current = null;
      const message = reason instanceof Error ? reason.message : String(reason);
      setEntryPreview({ node, artifact: null, loading: false, error: message });
    });
  }, [closeEntryPreview, filePath]);

  useEffect(() => {
    if (roots.length === 1 && roots[0].kind === "directory") {
      setExpanded(new Set([roots[0].id]));
    } else {
      setExpanded(new Set());
    }
    setSelectedId(null);
  }, [manifest, roots]);

  useEffect(() => {
    if (!manifest) {
      manifestSignatureRef.current = null;
      closeEntryPreview(false);
      return;
    }
    const signature = `${manifest.archive_size_bytes}:${manifest.modified_ms}`;
    if (manifestSignatureRef.current && manifestSignatureRef.current !== signature) {
      closeEntryPreview(false);
    }
    manifestSignatureRef.current = signature;
  }, [closeEntryPreview, manifest]);

  useEffect(() => () => {
    const requestId = previewRequestRef.current;
    if (requestId) void invoke("cancel_archive_preview", { requestId }).catch(() => {});
    const artifact = previewArtifactRef.current;
    if (artifact) {
      void invoke("release_archive_preview", { token: artifact.token }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (visibleRows.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visibleRows.some(({ node }) => node.id === selectedId)) {
      setSelectedId(visibleRows[0].node.id);
    }
  }, [selectedId, visibleRows]);

  useEffect(() => {
    treeRef.current
      ?.querySelector<HTMLElement>("[data-archive-selected='true']")
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  useEffect(() => {
    const focusArchiveSearch = () => {
      const search = searchRef.current;
      if (!search) return false;
      search.focus();
      search.select();
      return true;
    };
    window.__ghostViewerFind = focusArchiveSearch;
    return () => {
      if (window.__ghostViewerFind === focusArchiveSearch) delete window.__ghostViewerFind;
    };
  }, []);

  const toggleDirectory = useCallback((node: ArchiveTreeNode) => {
    if (node.kind !== "directory" || normalizedQuery) return;
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  }, [normalizedQuery]);

  const handleTreeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey && event.key.toLocaleLowerCase() === "f") {
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
      return;
    }
    if (visibleRows.length === 0) return;

    const currentIndex = Math.max(0, visibleRows.findIndex(({ node }) => node.id === selectedId));
    const current = visibleRows[currentIndex];
    let nextIndex = currentIndex;

    switch (event.key) {
      case "ArrowDown":
        nextIndex = Math.min(visibleRows.length - 1, currentIndex + 1);
        break;
      case "ArrowUp":
        nextIndex = Math.max(0, currentIndex - 1);
        break;
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = visibleRows.length - 1;
        break;
      case "ArrowRight":
        if (current.node.kind === "directory" && !normalizedQuery) {
          if (!expanded.has(current.node.id)) toggleDirectory(current.node);
          else if (visibleRows[currentIndex + 1]?.depth === current.depth + 1) nextIndex = currentIndex + 1;
        }
        break;
      case "ArrowLeft":
        if (current.node.kind === "directory" && expanded.has(current.node.id) && !normalizedQuery) {
          toggleDirectory(current.node);
        } else if (current.node.parentId) {
          const parentIndex = visibleRows.findIndex(({ node }) => node.id === current.node.parentId);
          if (parentIndex >= 0) nextIndex = parentIndex;
        }
        break;
      case "Enter":
      case " ":
        if (current.node.kind === "directory") toggleDirectory(current.node);
        else if (current.node.kind === "file") previewEntry(current.node);
        break;
      default:
        return;
    }

    event.preventDefault();
    setSelectedId(visibleRows[nextIndex].node.id);
  }, [expanded, normalizedQuery, previewEntry, selectedId, toggleDirectory, visibleRows]);

  const handleExtract = useCallback(async () => {
    setExtractionError(null);
    setExtractionStatus(null);
    let destination: string | string[] | null;
    try {
      destination = await open({
        directory: true,
        multiple: false,
        canCreateDirectories: true,
        defaultPath: archiveParent(filePath),
        title: `Choose where to extract ${fileName}`,
      });
    } catch (reason) {
      setExtractionError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    if (!destination || typeof destination !== "string") return;

    setExtracting(true);
    try {
      const result = await invoke<ArchiveExtraction>("extract_archive", {
        archivePath: filePath,
        destinationParent: destination,
      });
      const outputName = result.output_path.split("/").pop() ?? result.output_path;
      setExtractionStatus(`Extracted to ${outputName}`);
      try {
        await invoke("reveal_in_finder", { path: result.output_path });
      } catch {
        setExtractionError(`Extracted successfully, but Finder could not reveal ${outputName}.`);
      }
    } catch (reason) {
      setExtractionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExtracting(false);
    }
  }, [fileName, filePath]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 pt-12 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Reading archive…
      </div>
    );
  }

  if (error || !manifest) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 pt-12 text-center">
        <Archive className="size-14 text-ring" strokeWidth={1.25} aria-hidden="true" />
        <div>
          <div className="text-sm font-medium text-foreground">Unable to preview {fileName}</div>
          <p className="mt-2 max-w-lg text-xs leading-relaxed text-muted-foreground">{error}</p>
        </div>
        <OpenExternalButton filePath={filePath} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col pt-12">
      <div className="flex shrink-0 flex-wrap items-center gap-4 border-b border-border px-6 py-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card/50 text-ghost-amber">
          <Archive className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{fileName}</div>
          <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ring">
            {archiveContainerLabel(filePath)} · {manifest.entry_count.toLocaleString()} entries
          </div>
        </div>
        <div className="min-w-0 text-right text-[10px] text-muted-foreground">
          {extractionStatus && <div className="truncate text-ghost-green">{extractionStatus}</div>}
          {extractionError && <div className="max-w-72 truncate text-destructive" title={extractionError}>{extractionError}</div>}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={extracting}
          onClick={() => { void handleExtract(); }}
        >
          {extracting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <PackageOpen aria-hidden="true" />}
          {extracting ? "Extracting…" : "Extract…"}
        </Button>
      </div>

      <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-3">
        <div className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              setQuery("");
              treeRef.current?.focus({ preventScroll: true });
            }}
            type="search"
            aria-label="Search archive entries"
            placeholder="Search archive"
            className="h-8 w-full rounded-md border border-border bg-background pr-8 pl-8 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-ring"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear archive search"
              className="absolute top-1/2 right-2 flex size-5 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              onClick={() => { setQuery(""); searchRef.current?.focus(); }}
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {normalizedQuery ? `${visibleRows.filter(({ node }) => node.kind !== "directory").length} matches` : "⌘F to search"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={selectedNode?.kind !== "file"}
          onClick={() => { if (selectedNode) previewEntry(selectedNode); }}
          aria-label="Preview selected archive entry"
        >
          <Eye aria-hidden="true" />
          <span className="hidden sm:inline">Preview</span>
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <section
          aria-label="Archive entries"
          className={`${entryPreview ? "hidden md:flex" : "flex"} min-w-0 flex-1 flex-col md:w-[42%] md:max-w-[34rem] md:flex-none md:border-r md:border-border`}
        >
          <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_6rem] border-b border-border px-6 py-2 text-[10px] uppercase tracking-wider text-muted-foreground sm:grid-cols-[minmax(0,1fr)_8rem_6rem]">
            <span>Name</span>
            <span className="hidden sm:block">Modified</span>
            <span className="col-start-2 text-right sm:col-start-3">Size</span>
          </div>

          <div
            ref={treeRef}
            data-viewer-focus-target
            role="tree"
            aria-label={`Contents of ${fileName}`}
            tabIndex={0}
            onKeyDown={handleTreeKeyDown}
            className="min-h-0 flex-1 overflow-auto px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60"
          >
            {visibleRows.length === 0 ? (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                {normalizedQuery ? "No matching entries" : "This archive is empty"}
              </div>
            ) : visibleRows.map(({ node, depth }) => {
              const isDirectory = node.kind === "directory";
              const isExpanded = normalizedQuery ? true : expanded.has(node.id);
              const selected = node.id === selectedId;
              return (
                <div
                  key={node.id}
                  role="treeitem"
                  aria-level={depth + 1}
                  aria-expanded={isDirectory ? isExpanded : undefined}
                  aria-selected={selected}
                  data-archive-selected={selected}
                  className={`grid h-8 cursor-default grid-cols-[minmax(0,1fr)_6rem] items-center rounded-md px-3 text-xs sm:grid-cols-[minmax(0,1fr)_8rem_6rem] ${selected ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50"}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setSelectedId(node.id);
                    if (isDirectory) toggleDirectory(node);
                    treeRef.current?.focus({ preventScroll: true });
                  }}
                  onDoubleClick={() => {
                    if (node.kind === "file") previewEntry(node);
                  }}
                >
                  <div className="flex min-w-0 items-center gap-1.5" style={{ paddingLeft: `${depth * 16}px` }}>
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {isDirectory ? (
                        <ChevronRight className={`size-3.5 transition-transform ${isExpanded ? "rotate-90" : ""}`} aria-hidden="true" />
                      ) : null}
                    </span>
                    {isDirectory ? (
                      <Folder className="size-3.5 shrink-0 text-ghost-amber" aria-hidden="true" />
                    ) : node.kind === "symlink" ? (
                      <Link2 className="size-3.5 shrink-0 text-ghost-green" aria-hidden="true" />
                    ) : (
                      <File className="size-3.5 shrink-0 text-ring" aria-hidden="true" />
                    )}
                    <span className="truncate" title={node.path}>{node.name}</span>
                    {node.linkTarget && <span className="truncate text-muted-foreground">→ {node.linkTarget}</span>}
                  </div>
                  <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                    {formatArchiveDate(node.modifiedMs)}
                  </span>
                  <span className="col-start-2 text-right text-[11px] tabular-nums text-muted-foreground sm:col-start-3">
                    {node.kind === "file" && node.sizeBytes !== null
                      ? formatMediaFileSize(node.sizeBytes)
                      : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        <section
          ref={previewPaneRef}
          tabIndex={-1}
          aria-label="Archive entry preview"
          onKeyDown={(event) => {
            if (event.key === "Escape" && !document.fullscreenElement) {
              event.preventDefault();
              event.stopPropagation();
              closeEntryPreview(true);
            }
          }}
          className={`${entryPreview ? "flex" : "hidden md:flex"} min-h-0 min-w-0 flex-1 flex-col bg-background/40`}
        >
          {entryPreview ? (
            <>
              <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => closeEntryPreview(true)}
                  aria-label="Close archive entry preview"
                >
                  <ArrowLeft className="md:hidden" aria-hidden="true" />
                  <X className="hidden md:block" aria-hidden="true" />
                  <span className="md:hidden">Back</span>
                </Button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground" title={entryPreview.node.path}>
                    {entryPreview.node.path}
                  </div>
                  <div className="mt-0.5 truncate text-[9px] uppercase tracking-wider text-ring">
                    {entryPreview.artifact?.mime_type ?? "Read-only archive preview"}
                  </div>
                </div>
                {entryPreview.artifact && (
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatMediaFileSize(entryPreview.artifact.size_bytes)}
                  </span>
                )}
              </div>
              <div className="min-h-0 flex-1">
                {entryPreview.loading ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                    <Loader2 className="size-6 animate-spin text-ghost-amber" aria-hidden="true" />
                    <div>
                      <div className="text-sm text-foreground">Preparing preview…</div>
                      <div className="mt-1 text-xs text-muted-foreground">Decompressing into Ghost’s temporary cache</div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => closeEntryPreview(true)}>
                      Cancel
                    </Button>
                  </div>
                ) : entryPreview.error ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
                    <FileSearch className="size-12 text-ring" strokeWidth={1.25} aria-hidden="true" />
                    <div>
                      <div className="text-sm font-medium text-foreground">Unable to preview this entry</div>
                      <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
                        {entryPreview.error}
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => previewEntry(entryPreview.node)}>
                      Try Again
                    </Button>
                  </div>
                ) : entryPreview.artifact ? (
                  <ArchiveEntryPreview artifact={entryPreview.artifact} />
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <FileSearch className="size-12 text-ring" strokeWidth={1.25} aria-hidden="true" />
              <div className="text-sm font-medium text-foreground">Preview an archive entry</div>
              <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                Select a file, then press Space or Enter. Ghost will decompress it into a bounded temporary cache.
              </p>
            </div>
          )}
        </section>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-6 py-2.5 text-[10px] text-muted-foreground">
        <span>{formatMediaFileSize(manifest.archive_size_bytes)} compressed</span>
        <span>
          {manifest.total_uncompressed_bytes === null
            ? "Uncompressed size unavailable"
            : `${formatMediaFileSize(manifest.total_uncompressed_bytes)} uncompressed`}
        </span>
      </div>
    </div>
  );
}
