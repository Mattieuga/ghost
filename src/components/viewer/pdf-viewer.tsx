import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Maximize2, Minus, Plus, Search, X } from "lucide-react";
import { OpenExternalButton } from "@/components/viewer/open-external-button";
import type { FileVersionToken } from "@/lib/source-document";

let nextPdfViewId = 0;

interface PdfNativeState {
  page_count: number;
  current_page: number;
  scale_factor: number;
  locked: boolean;
}

interface PdfViewerProps {
  filePath: string;
}

export function PdfViewer({ filePath }: PdfViewerProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [nativeState, setNativeState] = useState<PdfNativeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [matchIndex, setMatchIndex] = useState<number | null>(null);
  const [searching, setSearching] = useState(false);
  const findInputRef = useRef<HTMLInputElement>(null);
  const activeViewIdRef = useRef<string | null>(null);
  const searchRequestRef = useRef(0);
  const [revision, setRevision] = useState(0);

  const frame = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let mounted = false;
    const surface = surfaceRef.current;
    if (!surface) return;
    const sequence = ++nextPdfViewId;
    const generation = Date.now() * 1000 + sequence;
    const viewId = `pdf-${generation}`;
    activeViewIdRef.current = viewId;
    setNativeState(null);
    setError(null);

    const mount = async () => {
      const bounds = frame();
      if (!bounds) return;
      try {
        const state = await invoke<PdfNativeState>("show_pdf_view", {
          path: filePath,
          viewId,
          generation,
          ...bounds,
        });
        mounted = true;
        if (cancelled) {
          await invoke("hide_pdf_view", { viewId }).catch(() => undefined);
          return;
        }
        setNativeState(state);
        setError(null);
      } catch (reason) {
        if (!cancelled) {
          if (activeViewIdRef.current === viewId) activeViewIdRef.current = null;
          setError(String(reason));
        }
      }
    };
    void mount();

    let resizeTimer: number | null = null;
    const updateFrame = () => {
      if (!mounted) return;
      if (resizeTimer !== null) cancelAnimationFrame(resizeTimer);
      resizeTimer = requestAnimationFrame(() => {
        resizeTimer = null;
        const bounds = frame();
        if (bounds) void invoke("update_pdf_view_frame", { viewId, ...bounds });
      });
    };
    const observer = new ResizeObserver(updateFrame);
    observer.observe(surface);
    window.addEventListener("resize", updateFrame);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("resize", updateFrame);
      if (resizeTimer !== null) cancelAnimationFrame(resizeTimer);
      if (activeViewIdRef.current === viewId) activeViewIdRef.current = null;
      void invoke("hide_pdf_view", { viewId });
    };
  }, [filePath, frame, revision]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let signature: string | null = null;

    const refresh = async () => {
      try {
        const version = await invoke<FileVersionToken>("get_file_version", { path: filePath });
        if (cancelled) return;
        const nextSignature = JSON.stringify(version);
        if (signature === null) {
          signature = nextSignature;
          if (activeViewIdRef.current === null) {
            setRevision((value) => value + 1);
          }
        } else if (signature !== nextSignature) {
          signature = nextSignature;
          setRevision((value) => value + 1);
        }
      } catch (reason) {
        if (cancelled || signature === null) return;
        signature = null;
        const viewId = activeViewIdRef.current;
        if (viewId) await invoke("hide_pdf_view", { viewId }).catch(() => undefined);
        if (activeViewIdRef.current === viewId) activeViewIdRef.current = null;
        setNativeState(null);
        setError(`Unable to refresh PDF: ${String(reason)}`);
      }
    };

    void refresh();
    void listen<string>("fs-change", (event) => {
      const changedPath = event.payload;
      if (changedPath !== filePath && !filePath.startsWith(`${changedPath}/`)) return;
      void refresh();
    }).then((stopListening) => {
      if (cancelled) stopListening();
      else unlisten = stopListening;
    });
    const handleFocus = () => { void refresh(); };
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("focus", handleFocus);
    };
  }, [filePath]);

  useEffect(() => {
    if (!nativeState) return;
    const timer = window.setInterval(() => {
      const viewId = activeViewIdRef.current;
      if (!viewId) return;
      void invoke<PdfNativeState>("get_pdf_view_state", { viewId })
        .then((state) => {
          if (activeViewIdRef.current === viewId) setNativeState(state);
        })
        .catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, [Boolean(nativeState)]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.__ghostViewerFind = () => {
      setFindOpen(true);
      requestAnimationFrame(() => findInputRef.current?.focus());
      return true;
    };
    return () => { delete window.__ghostViewerFind; };
  }, []);

  const action = useCallback(async (name: string, page?: number) => {
    const viewId = activeViewIdRef.current;
    if (!viewId) return;
    try {
      const state = await invoke<PdfNativeState>("pdf_view_action", { viewId, action: name, page });
      if (activeViewIdRef.current === viewId) setNativeState(state);
    } catch (reason) {
      // The native surface sits above WebKit, so a DOM error overlay cannot
      // safely replace it after mount. A stale action is non-fatal; lifecycle
      // errors are handled by the mount path and external-open fallback.
      console.error("PDFKit action failed", reason);
    }
  }, []);

  const search = useCallback(async (requestedIndex = 0) => {
    if (!query) return;
    const viewId = activeViewIdRef.current;
    if (!viewId) return;
    const requestId = ++searchRequestRef.current;
    setSearching(true);
    try {
      const result = await invoke<{ count: number; current_index: number | null }>("search_pdf_view", {
        viewId,
        query,
        matchIndex: Math.max(0, requestedIndex),
      });
      if (activeViewIdRef.current !== viewId || searchRequestRef.current !== requestId) return;
      setMatchCount(result.count);
      setMatchIndex(result.current_index);
      const state = await invoke<PdfNativeState>("get_pdf_view_state", { viewId });
      if (activeViewIdRef.current === viewId && searchRequestRef.current === requestId) {
        setNativeState(state);
      }
    } catch (reason) {
      if (activeViewIdRef.current !== viewId || searchRequestRef.current !== requestId) return;
      setMatchCount(null);
      setMatchIndex(null);
      console.error("PDFKit search failed", reason);
    } finally {
      if (activeViewIdRef.current === viewId && searchRequestRef.current === requestId) {
        setSearching(false);
      }
    }
  }, [query]);

  const selectMatch = useCallback((offset: number) => {
    if (!matchCount) {
      void search(0);
      return;
    }
    const current = matchIndex ?? 0;
    void search((current + offset + matchCount) % matchCount);
  }, [matchCount, matchIndex, search]);

  return (
    <div
      className="flex h-full flex-col pt-12 outline-none"
      data-viewer-focus-target
      tabIndex={0}
      onFocus={(event) => {
        if (event.target === event.currentTarget) void action("focus");
      }}
    >
      {findOpen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background px-3 py-2">
          <input ref={findInputRef} value={query} onChange={(event) => {
            searchRequestRef.current += 1;
            setSearching(false);
            setQuery(event.target.value);
            setMatchCount(null);
            setMatchIndex(null);
            const viewId = activeViewIdRef.current;
            if (viewId) {
              void invoke("search_pdf_view", { viewId, query: "", matchIndex: 0 }).catch(() => undefined);
            }
          }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); selectMatch(event.shiftKey ? -1 : 1); } if (event.key === "Escape") setFindOpen(false); }} placeholder="Find in PDF…" className="h-7 min-w-56 rounded border border-border bg-muted/30 px-2 text-sm outline-none focus:border-ring" />
          <button onClick={() => void search(0)} disabled={!query || searching} className="rounded px-2 py-1 text-xs hover:bg-muted disabled:opacity-40">{searching ? "Searching…" : "Find"}</button>
          {matchCount !== null && <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">{matchCount && matchIndex !== null ? `${matchIndex + 1} of ${matchCount}` : "No matches"}</span>}
          <button title="Previous match (Shift-Return)" aria-label="Previous PDF match" onClick={() => selectMatch(-1)} disabled={!matchCount || searching} className="rounded p-1 hover:bg-muted disabled:opacity-30"><ChevronUp className="size-4" /></button>
          <button title="Next match (Return)" aria-label="Next PDF match" onClick={() => selectMatch(1)} disabled={!matchCount || searching} className="rounded p-1 hover:bg-muted disabled:opacity-30"><ChevronDown className="size-4" /></button>
          <div className="flex-1" />
          <button onClick={() => setFindOpen(false)} className="rounded p-1 hover:bg-muted"><X className="size-4" /></button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={surfaceRef} className="absolute inset-0" />
        {!nativeState && !error && <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">Loading PDFKit…</div>}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background px-8 text-center">
            <span className="max-w-md text-sm text-destructive">Unable to preview PDF: {error}</span>
            <OpenExternalButton filePath={filePath} />
          </div>
        )}
      </div>

      <div className="flex h-10 shrink-0 items-center justify-center gap-2 border-t border-border bg-background px-4 text-[11px] text-muted-foreground">
        <button onClick={() => void action("previous")} disabled={!nativeState || nativeState.current_page <= 1} className="rounded p-1 hover:bg-muted hover:text-foreground disabled:opacity-30"><ChevronLeft className="size-4" /></button>
        <span className="min-w-20 text-center tabular-nums">{nativeState ? `${nativeState.current_page} / ${nativeState.page_count}` : "—"}</span>
        <button onClick={() => void action("next")} disabled={!nativeState || nativeState.current_page >= nativeState.page_count} className="rounded p-1 hover:bg-muted hover:text-foreground disabled:opacity-30"><ChevronRight className="size-4" /></button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button onClick={() => void action("zoom-out")} className="rounded p-1 hover:bg-muted hover:text-foreground"><Minus className="size-4" /></button>
        <span className="min-w-11 text-center tabular-nums">{nativeState ? `${Math.round(nativeState.scale_factor * 100)}%` : "—"}</span>
        <button onClick={() => void action("zoom-in")} className="rounded p-1 hover:bg-muted hover:text-foreground"><Plus className="size-4" /></button>
        <button title="Fit page" onClick={() => void action("fit")} className="rounded p-1 hover:bg-muted hover:text-foreground"><Maximize2 className="size-4" /></button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button onClick={() => { setFindOpen(true); requestAnimationFrame(() => findInputRef.current?.focus()); }} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted hover:text-foreground"><Search className="size-3.5" /> Find</button>
      </div>
    </div>
  );
}
