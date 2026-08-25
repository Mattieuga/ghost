import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, X } from "lucide-react";
import type { SourceInspection } from "@/lib/resource-policy";
import { formatSourceSize } from "@/lib/resource-policy";
import { OpenExternalButton } from "@/components/viewer/open-external-button";
import { textHighlightRange } from "@/lib/large-text";
import { performanceNow, type FileOpenPerformanceTrace } from "@/lib/open-performance";

const WINDOW_BYTES = 512 * 1024;

interface TextWindow {
  text: string;
  offset: number;
  next_offset: number;
  eof: boolean;
  starts_mid_line: boolean;
  ends_mid_line: boolean;
  diagnostics?: {
    elapsed_us: number;
    bytes_read: number;
  };
}

interface SearchResult {
  offsets: number[];
  reached_end: boolean;
  cancelled: boolean;
}

interface LargeTextViewerProps {
  filePath: string;
  inspection: SourceInspection;
  openPerformance?: FileOpenPerformanceTrace | null;
}

export function LargeTextViewer({ filePath, inspection, openPerformance }: LargeTextViewerProps) {
  const [windowData, setWindowData] = useState<TextWindow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<number[]>([]);
  const [matchIndex, setMatchIndex] = useState(0);
  const [reachedEnd, setReachedEnd] = useState<boolean | null>(null);
  const [searching, setSearching] = useState(false);
  const requestRef = useRef(0);
  const searchIdRef = useRef(0);
  const activeSearchRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const activeMarkRef = useRef<HTMLElement>(null);
  const initialTracePendingRef = useRef(openPerformance !== null && openPerformance !== undefined);

  const cancelSearch = useCallback(() => {
    const searchId = activeSearchRef.current;
    activeSearchRef.current = null;
    setSearching(false);
    if (searchId !== null) {
      void invoke("cancel_large_text_search", { searchId });
    }
  }, []);

  useLayoutEffect(() => {
    openPerformance?.markViewerStarted();
  }, [openPerformance]);

  const loadWindow = useCallback(async (offset: number) => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const windowStarted = performanceNow();
      const result = await invoke<TextWindow>("read_text_window", {
        path: filePath,
        offset: Math.max(0, Math.min(offset, inspection.size_bytes)),
        maxBytes: WINDOW_BYTES,
        expectedVersion: inspection.version,
      });
      if (requestId !== requestRef.current) return;
      if (initialTracePendingRef.current) {
        const roundTripMs = performanceNow() - windowStarted;
        const nativeMs = (result.diagnostics?.elapsed_us ?? 0) / 1000;
        if (result.diagnostics) {
          openPerformance?.recordViewer(
            "Native text-window read",
            nativeMs,
            `${result.diagnostics.bytes_read.toLocaleString()} bytes`,
          );
          openPerformance?.recordViewer(
            "Text-window bridge + serialization",
            roundTripMs - nativeMs,
            "round trip minus native command time",
          );
        } else {
          openPerformance?.recordViewer("Text-window read round trip", roundTripMs);
        }
        openPerformance?.markViewCreated();
      }
      setWindowData(result);
    } catch (reason) {
      if (requestId === requestRef.current) setError(String(reason));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [filePath, inspection, openPerformance]);

  useEffect(() => {
    if (!windowData || !initialTracePendingRef.current) return;
    let secondFrame = 0;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        initialTracePendingRef.current = false;
        openPerformance?.finishAfterFirstPaint();
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame) cancelAnimationFrame(secondFrame);
    };
  }, [openPerformance, windowData]);

  useEffect(() => {
    void loadWindow(0);
    return () => { requestRef.current += 1; };
  }, [loadWindow]);

  useEffect(() => {
    window.__ghostViewerFind = () => {
      setFindOpen(true);
      requestAnimationFrame(() => searchInputRef.current?.focus());
      return true;
    };
    return () => { delete window.__ghostViewerFind; };
  }, []);

  useEffect(() => () => {
    const searchId = activeSearchRef.current;
    activeSearchRef.current = null;
    if (searchId !== null) {
      void invoke("cancel_large_text_search", { searchId });
    }
  }, []);

  const runSearch = useCallback(async () => {
    if (!query) return;
    if (activeSearchRef.current !== null) {
      void invoke("cancel_large_text_search", { searchId: activeSearchRef.current });
    }
    const searchId = `${getCurrentWindow().label}-${Date.now()}-${++searchIdRef.current}`;
    activeSearchRef.current = searchId;
    setSearching(true);
    setError(null);
    try {
      const result = await invoke<SearchResult>("search_large_text", {
        searchId,
        path: filePath,
        query,
        expectedVersion: inspection.version,
        maxResults: 200,
      });
      if (activeSearchRef.current !== searchId || result.cancelled) return;
      setMatches(result.offsets);
      setMatchIndex(0);
      setReachedEnd(result.reached_end);
      if (result.offsets[0] !== undefined) {
        await loadWindow(Math.max(0, result.offsets[0] - Math.floor(WINDOW_BYTES / 3)));
      }
    } catch (reason) {
      if (activeSearchRef.current === searchId) setError(String(reason));
    } finally {
      if (activeSearchRef.current === searchId) {
        activeSearchRef.current = null;
        setSearching(false);
      }
    }
  }, [filePath, inspection, loadWindow, query]);

  const selectMatch = useCallback((index: number) => {
    if (!matches.length) return;
    const next = (index + matches.length) % matches.length;
    setMatchIndex(next);
    void loadWindow(Math.max(0, matches[next] - Math.floor(WINDOW_BYTES / 3)));
  }, [loadWindow, matches]);

  const currentStart = windowData?.offset ?? 0;
  const currentEnd = windowData?.next_offset ?? 0;
  const activeHighlight = useMemo(() => {
    const matchOffset = matches[matchIndex];
    if (!windowData || matchOffset === undefined) return null;
    return textHighlightRange(windowData.text, windowData.offset, matchOffset, query);
  }, [matchIndex, matches, query, windowData]);

  useEffect(() => {
    if (!activeHighlight) return;
    requestAnimationFrame(() => {
      activeMarkRef.current?.scrollIntoView({ block: "center", inline: "nearest" });
    });
  }, [activeHighlight, windowData]);

  return (
    <div
      className="flex h-full flex-col pt-12 outline-none"
      data-viewer-focus-target
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.metaKey && event.key === "ArrowUp") {
          event.preventDefault();
          void loadWindow(0);
        } else if (event.metaKey && event.key === "ArrowDown") {
          event.preventDefault();
          void loadWindow(Math.max(0, inspection.size_bytes - WINDOW_BYTES));
        } else if (event.key === "PageUp") {
          event.preventDefault();
          void loadWindow(Math.max(0, currentStart - WINDOW_BYTES));
        } else if (event.key === "PageDown") {
          event.preventDefault();
          void loadWindow(currentEnd);
        }
      }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
        <button title="Beginning" onClick={() => void loadWindow(0)} className="rounded p-1 hover:bg-muted hover:text-foreground"><ChevronsLeft className="size-4" /></button>
        <button title="Previous window" disabled={currentStart === 0} onClick={() => void loadWindow(Math.max(0, currentStart - WINDOW_BYTES))} className="rounded p-1 hover:bg-muted hover:text-foreground disabled:opacity-30"><ChevronLeft className="size-4" /></button>
        <span className="min-w-40 text-center tabular-nums">{currentStart.toLocaleString()}–{currentEnd.toLocaleString()} of {inspection.size_bytes.toLocaleString()} bytes</span>
        <button title="Next window" disabled={windowData?.eof} onClick={() => void loadWindow(currentEnd)} className="rounded p-1 hover:bg-muted hover:text-foreground disabled:opacity-30"><ChevronRight className="size-4" /></button>
        <button title="End" disabled={windowData?.eof} onClick={() => void loadWindow(Math.max(0, inspection.size_bytes - WINDOW_BYTES))} className="rounded p-1 hover:bg-muted hover:text-foreground disabled:opacity-30"><ChevronsRight className="size-4" /></button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button onClick={() => { setFindOpen(true); requestAnimationFrame(() => searchInputRef.current?.focus()); }} className="flex items-center gap-1 rounded px-2 py-1 hover:bg-muted hover:text-foreground"><Search className="size-3.5" /> Find</button>
        <div className="flex-1" />
        <span>
          {formatSourceSize(inspection.size_bytes)} · {inspection.line_count.toLocaleString()}
          {inspection.line_count_complete ? "" : "+"} lines · read only
        </span>
        <OpenExternalButton filePath={filePath} />
      </div>

      {findOpen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
          <input ref={searchInputRef} value={query} onChange={(event) => { cancelSearch(); setQuery(event.target.value); setMatches([]); setMatchIndex(0); setReachedEnd(null); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); if (matches.length) selectMatch(matchIndex + (event.shiftKey ? -1 : 1)); else void runSearch(); } if (event.key === "Escape") { cancelSearch(); setFindOpen(false); } }} placeholder="Find in file…" className="h-7 min-w-52 rounded border border-border bg-muted/30 px-2 text-sm outline-none focus:border-ring" />
          <button onClick={() => void runSearch()} disabled={!query || searching} className="rounded px-2 py-1 text-xs hover:bg-muted disabled:opacity-40">{searching ? "Searching…" : "Find"}</button>
          {matches.length > 0 ? (<><span className="text-xs text-muted-foreground">{matchIndex + 1} of {matches.length}{reachedEnd === false ? "+" : ""}</span><button onClick={() => selectMatch(matchIndex - 1)} className="rounded px-2 py-1 text-xs hover:bg-muted">Previous</button><button onClick={() => selectMatch(matchIndex + 1)} className="rounded px-2 py-1 text-xs hover:bg-muted">Next</button></>) : reachedEnd !== null && !searching ? <span className="text-xs text-muted-foreground">No matches</span> : null}
          <div className="flex-1" />
          <button onClick={() => { cancelSearch(); setFindOpen(false); }} className="rounded p-1 hover:bg-muted"><X className="size-4" /></button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-background px-4 py-3 font-mono text-[13px] leading-relaxed">
        {error ? <div className="flex h-full items-center justify-center text-sm text-destructive">{error}</div> : loading && !windowData ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading text window…</div> : (<>{windowData?.starts_mid_line && <div className="mb-2 text-[10px] text-ring">… continued from previous window</div>}<pre className="whitespace-pre font-inherit text-foreground">{windowData && activeHighlight ? <>{windowData.text.slice(0, activeHighlight.start)}<mark ref={activeMarkRef} className="rounded-sm bg-ghost-amber/35 text-foreground outline outline-1 outline-ghost-amber/80">{windowData.text.slice(activeHighlight.start, activeHighlight.end)}</mark>{windowData.text.slice(activeHighlight.end)}</> : windowData?.text}</pre>{windowData?.ends_mid_line && <div className="mt-2 text-[10px] text-ring">continued in next window …</div>}</>)}
      </div>
    </div>
  );
}
