import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Search, X } from "lucide-react";
import type { FlatFileEntry } from "@/types";
import { fuzzySearch } from "@/lib/fuzzy-search";
import { useCompactMode } from "@/hooks/use-compact-mode";

interface ContentMatch {
  path: string;
  line_number: number;
  line_text: string;
  match_start: number;
  match_end: number;
}

interface SearchResults {
  matches: ContentMatch[];
  total_matches: number;
  files_searched: number;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(epochMs: number) {
  try {
    const date = new Date(epochMs);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 30) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  allFiles: FlatFileEntry[];
  recentFiles: string[];
  onFileSelect: (path: string) => void;
  folders: string[];
  extensions: string[];
}

type PaletteMode = "recent" | "files" | "content";

function getMode(query: string): PaletteMode {
  if (!query) return "recent";
  if (query.startsWith("# ") || query === "#") return "content";
  return "files";
}

function getContentQuery(query: string): string {
  return query.startsWith("# ") ? query.slice(2) : "";
}

export function CommandPalette({
  open,
  onClose,
  allFiles,
  recentFiles,
  onFileSelect,
  folders,
  extensions,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [contentResults, setContentResults] = useState<ContentMatch[]>([]);
  const [contentTotal, setContentTotal] = useState(0);
  const [contentLoading, setContentLoading] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const compact = useCompactMode();
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewMeta, setPreviewMeta] = useState<{
    size: number;
    modified: number;
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentSearchVersion = useRef(0);

  const mode = getMode(query);

  // Focus input when opening
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // File name search results
  const fileResults = useMemo(() => {
    if (mode !== "files" || !query) return [];
    return fuzzySearch(allFiles, query, (f) => f.name, 20);
  }, [query, allFiles, mode]);

  // Shared file lookup map
  const fileMap = useMemo(
    () => new Map(allFiles.map((f) => [f.path, f])),
    [allFiles]
  );

  // Recent files as FlatFileEntry items
  const recentEntries = useMemo(() => {
    if (mode !== "recent") return [];
    return recentFiles
      .map((path) => fileMap.get(path))
      .filter((f): f is FlatFileEntry => f !== undefined);
  }, [recentFiles, fileMap, mode]);

  // Build flat items list for navigation
  const items = useMemo(() => {
    const list: { type: "file" | "content"; path: string; entry?: FlatFileEntry; match?: ContentMatch }[] = [];

    if (mode === "recent") {
      for (const entry of recentEntries) {
        list.push({ type: "file", path: entry.path, entry });
      }
    } else if (mode === "files") {
      for (const r of fileResults) {
        list.push({ type: "file", path: r.item.path, entry: r.item });
      }
      for (const m of contentResults) {
        list.push({ type: "content", path: m.path, match: m });
      }
    } else if (mode === "content") {
      for (const m of contentResults) {
        list.push({ type: "content", path: m.path, match: m });
      }
    }

    return list;
  }, [mode, recentEntries, fileResults, contentResults]);

  // Clamp selected index when items change
  useEffect(() => {
    setSelectedIndex((prev) => Math.min(prev, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Content search (debounced)
  useEffect(() => {
    if (contentSearchRef.current) clearTimeout(contentSearchRef.current);

    const contentQuery =
      mode === "content" ? getContentQuery(query) : mode === "files" ? query : "";

    if (!contentQuery || contentQuery.length < 2) {
      setContentResults([]);
      setContentTotal(0);
      setContentLoading(false);
      return;
    }

    setContentLoading(true);
    const version = ++contentSearchVersion.current;

    contentSearchRef.current = setTimeout(async () => {
      try {
        const results = await invoke<SearchResults>("search_file_contents", {
          query: contentQuery,
          directories: folders,
          extensions: extensions.length > 0 ? extensions : null,
          maxResults: 50,
        });
        if (version === contentSearchVersion.current) {
          setContentResults(results.matches);
          setContentTotal(results.total_matches);
          setContentLoading(false);
        }
      } catch {
        if (version === contentSearchVersion.current) {
          setContentResults([]);
          setContentTotal(0);
          setContentLoading(false);
        }
      }
    }, 300);

    return () => {
      if (contentSearchRef.current) clearTimeout(contentSearchRef.current);
    };
  }, [query, mode, folders, extensions]);

  // Load preview for selected item
  const selectedItem = items[selectedIndex];

  useEffect(() => {
    if (!previewOpen || !selectedItem) {
      setPreviewHtml("");
      setPreviewMeta(null);
      return;
    }

    let cancelled = false;
    const path = selectedItem.path;

    const timer = setTimeout(async () => {
      try {
        const [content, meta] = await Promise.all([
          invoke<string>("read_file", { path }),
          invoke<{ size_bytes: number; modified_ms: number }>("get_file_metadata", {
            path,
          }).catch(() => null),
        ]);

        if (cancelled) return;

        // Render markdown to HTML
        try {
          const html = await invoke<string>("markdown_to_html", {
            markdown: content,
          });
          if (!cancelled) setPreviewHtml(html);
        } catch {
          const escaped = content.slice(0, 2000)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
          if (!cancelled) setPreviewHtml(`<pre>${escaped}</pre>`);
        }

        if (meta && !cancelled) {
          setPreviewMeta({ size: meta.size_bytes, modified: meta.modified_ms });
        }
      } catch {
        if (!cancelled) {
          setPreviewHtml("");
          setPreviewMeta(null);
        }
      }
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [previewOpen, selectedItem?.path]);

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector(`[data-index="${selectedIndex}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const resetState = useCallback(() => {
    setQuery("");
    setSelectedIndex(0);
    setContentResults([]);
    setContentTotal(0);
    setContentLoading(false);
    setPreviewOpen(false);
    setPreviewHtml("");
    setPreviewMeta(null);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleSelect = useCallback(
    (path: string) => {
      onFileSelect(path);
      handleClose();
    },
    [onFileSelect, handleClose]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.min(prev + 1, items.length - 1));
        return;
      }

      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();
        const item = items[selectedIndex];
        if (item) handleSelect(item.path);
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        if (e.shiftKey) {
          setPreviewOpen(false);
        } else {
          setPreviewOpen((p) => !p);
        }
        return;
      }
    },
    [items, selectedIndex, handleSelect, handleClose]
  );

  if (!open) return null;

  // Helper: get display name from path
  const getFileName = (path: string) => {
    const entry = fileMap.get(path);
    return entry?.name ?? path.substring(path.lastIndexOf("/") + 1);
  };

  const getFolderDisplay = (path: string) => {
    const entry = fileMap.get(path);
    return entry?.folderDisplay ?? "";
  };

  // Count unique files in content results
  const contentFileCount = new Set(contentResults.map((m) => m.path)).size;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/60 animate-in fade-in-0 duration-150"
        onClick={handleClose}
      />

      {/* Palette container */}
      <div
        className="fixed left-1/2 z-50 -translate-x-1/2 animate-in fade-in-0 zoom-in-95 duration-150"
        style={{ top: "min(15%, calc(100vh - 480px))", width: compact ? "calc(100vw - 1.5rem)" : (previewOpen ? 780 : 580), maxWidth: "calc(100vw - 1rem)" }}
        onKeyDown={handleKeyDown}
      >
        <div className="rounded-xl border border-border bg-popover shadow-2xl overflow-hidden flex flex-col"
          style={{ maxHeight: "min(70vh, calc(100vh - 2rem))" }}
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 h-14 border-b border-border shrink-0">
            <Search className="size-4 text-ring shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder="Search files, content, commands..."
              className="flex-1 bg-transparent text-[15px] text-foreground placeholder:text-ring outline-none"
              spellCheck={false}
            />
            <kbd className="text-[11px] font-medium text-ring select-none">esc</kbd>
          </div>

          {/* Body: result list + optional preview */}
          <div className="relative flex min-h-0 flex-1">
            {/* Result list */}
            <div
              ref={listRef}
              className={`overflow-y-auto overscroll-contain py-2 ${
                previewOpen && !compact ? "w-[320px] border-r border-border shrink-0" : "flex-1"
              }`}
              style={{ maxHeight: "calc(70vh - 56px - 40px)" }}
            >
              {/* Empty state: no results */}
              {items.length === 0 && !contentLoading && query && (
                <div className="px-4 py-8 text-center text-[13px] text-ring">
                  No results found
                </div>
              )}

              {/* Empty state: no recent files */}
              {items.length === 0 && !query && (
                <div className="px-4 py-8 text-center text-[13px] text-ring">
                  No recent files
                </div>
              )}

              {/* Section: RECENT */}
              {mode === "recent" && recentEntries.length > 0 && (
                <div className="px-4 pt-1 pb-2">
                  <span className="text-[10px] font-medium uppercase text-ghost-amber tracking-wider">
                    Recent
                  </span>
                </div>
              )}

              {/* Section: FILES */}
              {mode === "files" && fileResults.length > 0 && (
                <div className="px-4 pt-1 pb-2">
                  <span className="text-[10px] font-medium uppercase text-ghost-amber tracking-wider">
                    Files
                  </span>
                </div>
              )}

              {/* File results (recent or search) */}
              {(mode === "recent" ? recentEntries : fileResults.map((r) => r.item)).map(
                (entry, i) => {
                  return (
                    <div
                      key={entry.path}
                      data-index={i}
                      className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors ${
                        selectedIndex === i
                          ? "bg-sidebar-accent border-l-2 border-ghost-amber"
                          : "border-l-2 border-transparent hover:bg-sidebar-accent/50"
                      }`}
                      onClick={() => handleSelect(entry.path)}
                      onMouseEnter={() => setSelectedIndex(i)}
                    >
                      <span
                        className={`text-[14px] shrink-0 max-w-[60%] truncate ${
                          selectedIndex === i
                            ? "text-foreground font-medium"
                            : "text-popover-foreground"
                        }`}
                      >
                        {entry.name}
                      </span>
                      <span className="ml-auto text-[12px] text-ring truncate min-w-0">
                        {entry.folderDisplay}
                      </span>
                    </div>
                  );
                }
              )}

              {/* Section: CONTENT */}
              {mode === "files" && (contentResults.length > 0 || contentLoading) && (
                <div className="px-4 pt-4 pb-2">
                  <span className="text-[10px] font-medium uppercase text-ghost-amber tracking-wider">
                    Content
                  </span>
                  {contentLoading && (
                    <span className="ml-2 text-[10px] text-ring">searching...</span>
                  )}
                </div>
              )}

              {/* Section: MATCHES (content mode) */}
              {mode === "content" && (contentResults.length > 0 || contentLoading) && (
                <div className="px-4 pt-1 pb-2">
                  <span className="text-[10px] font-medium uppercase text-ghost-amber tracking-wider">
                    Matches — {contentTotal} results
                  </span>
                  {contentLoading && (
                    <span className="ml-2 text-[10px] text-ring">searching...</span>
                  )}
                </div>
              )}

              {/* Content results */}
              {contentResults.map((match, i) => {
                const globalIndex =
                  mode === "files" ? fileResults.length + i : i;
                const fileName = getFileName(match.path);
                const lineText = match.line_text.trim();
                const leadingWS = match.line_text.length - match.line_text.trimStart().length;
                const start = match.match_start - leadingWS;
                const end = match.match_end - leadingWS;

                return (
                  <div
                    key={`${match.path}:${match.line_number}:${i}`}
                    data-index={globalIndex}
                    className={`px-4 py-2.5 cursor-pointer transition-colors ${
                      selectedIndex === globalIndex
                        ? "bg-sidebar-accent border-l-2 border-ghost-amber"
                        : "border-l-2 border-transparent hover:bg-sidebar-accent/50"
                    }`}
                    onClick={() => handleSelect(match.path)}
                    onMouseEnter={() => setSelectedIndex(globalIndex)}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[13px] truncate ${
                          selectedIndex === globalIndex
                            ? "text-foreground font-medium"
                            : "text-popover-foreground"
                        }`}
                      >
                        {fileName}
                      </span>
                      <span className="text-[11px] text-ring">
                        :{match.line_number}
                      </span>
                    </div>
                    <div className="text-[12px] text-muted-foreground truncate mt-0.5">
                      {start > 0 && "..."}
                      {lineText.slice(0, Math.max(0, start))}
                      <span className="text-foreground font-medium">
                        {lineText.slice(Math.max(0, start), Math.max(0, end))}
                      </span>
                      {lineText.slice(Math.max(0, end))}
                      {end < lineText.length && "..."}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Preview panel */}
            {previewOpen && selectedItem && (
              <div
                className={
                  compact
                    ? "absolute inset-y-0 right-0 left-10 overflow-y-auto overscroll-contain bg-popover shadow-[-8px_0_24px_rgba(0,0,0,0.3)] border-l border-border"
                    : "flex-1 overflow-y-auto overscroll-contain"
                }
                style={{ maxHeight: "calc(70vh - 56px - 40px)" }}
              >
                <div className="p-5">
                  <div className="mb-1">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-medium uppercase text-ghost-amber tracking-wider">
                        Preview
                      </span>
                      <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => { setPreviewOpen(false); inputRef.current?.focus(); }}
                        className="text-ring hover:text-foreground transition-colors cursor-pointer p-0.5"
                        aria-label="Close preview"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    <div className="text-[14px] font-medium text-foreground">
                      {getFileName(selectedItem.path)}
                    </div>
                    <div className="text-[12px] text-ring">
                      {getFolderDisplay(selectedItem.path)}
                    </div>
                  </div>
                  <div className="mt-4 border-t border-border pt-4">
                    {previewHtml ? (
                      <div
                        className="prose prose-sm prose-invert max-w-none text-[13px] text-muted-foreground [&_h1]:text-foreground [&_h2]:text-foreground [&_h3]:text-foreground [&_strong]:text-foreground [&_img]:hidden [&_table]:hidden"
                        dangerouslySetInnerHTML={{ __html: previewHtml }}
                      />
                    ) : (
                      <div className="text-[12px] text-ring">Loading...</div>
                    )}
                  </div>
                  {previewMeta && (
                    <div className="mt-4 pt-3 border-t border-border flex items-center gap-3 text-[12px] text-ring">
                      <span>{formatSize(previewMeta.size)}</span>
                      <span>&middot;</span>
                      <span>Modified {formatDate(previewMeta.modified)}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-6 px-4 h-10 border-t border-border text-[11px] text-ring shrink-0 select-none">
            {mode === "content" && contentResults.length > 0 ? (
              <span>
                {contentTotal} matches across {contentFileCount} files
              </span>
            ) : (
              <>
                <span>
                  <kbd className="font-medium">↑↓</kbd> navigate
                </span>
                <span>
                  <kbd className="font-medium">↵</kbd> open
                </span>
                <span>
                  <kbd className="font-medium">tab</kbd> preview
                </span>
                <span>
                  <kbd className="font-medium">#</kbd> content search
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </>,
    document.body,
  );
}
