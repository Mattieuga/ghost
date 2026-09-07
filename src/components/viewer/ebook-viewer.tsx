import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Book, Navigation } from "foliate-js";
import type { Paginator } from "foliate-js/paginator.js";
import { useMediaAsset } from "@/hooks/use-media-asset";
import { applyBookTheme } from "@/lib/book-document";
import { flattenEbookContents, loadEbook, readEbookBookmark, saveEbookBookmark } from "@/lib/ebook";
import { withEpubTimeout } from "@/lib/epub";
import { BookReaderControls, restoreBookFocus } from "@/components/viewer/book-reader-controls";
import { OpenExternalButton } from "@/components/viewer/open-external-button";

interface ReaderLocation { index: number; page: number; total: number; atStart: boolean; atEnd: boolean }

export function EbookViewer({ filePath }: { filePath: string }) {
  const asset = useMediaAsset(filePath);
  const readerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<{ book: Book; renderer: Paginator } | null>(null);
  const bookmarkRef = useRef(readEbookBookmark(filePath));
  const navigatingRef = useRef(false);
  const pendingRef = useRef<Promise<unknown> | null>(null);
  const [fontSize, setFontSize] = useState(bookmarkRef.current.fontSize);
  const [toc, setToc] = useState<Array<{ href: string; label: string; index: number }>>([]);
  const [location, setLocation] = useState<ReaderLocation | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionRef = useRef<(target: string) => void>(() => {});

  const navigate = useCallback((target: string, control?: HTMLElement) => {
    const engine = engineRef.current;
    if (!engine || navigatingRef.current) return;
    const { book, renderer } = engine;
    const focusedFrame = surfaceRef.current?.contains(document.activeElement) ? document.activeElement : null;
    navigatingRef.current = true;
    setBusy(true);
    const operation = (async () => {
      if (target === "next") await renderer.next();
      else if (target === "previous") await renderer.prev();
      else {
        const resolved = target.startsWith("section:") ? { index: Number(target.slice(8)) } : await book.resolveHref(target);
        if (!resolved || !book.sections[resolved.index]) throw new Error("This chapter link is unavailable");
        await renderer.goTo(resolved);
      }
    })();
    pendingRef.current = operation;
    void withEpubTimeout(operation).catch(reason => {
      if (engineRef.current === engine) setError(String(reason));
    }).finally(() => {
      if (engineRef.current !== engine) return;
      navigatingRef.current = false;
      setBusy(false);
      restoreBookFocus(readerRef.current, focusedFrame, control);
    });
  }, []);
  actionRef.current = navigate;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || asset.loading) return;
    let cancelled = false;
    let book: Book | null = null;
    let renderer: Paginator | null = null;
    let theme: MutationObserver | null = null;
    let initialized = false;
    setReady(false); setBusy(false); setError(null); setLocation(null); setToc([]);
    const dispose = () => {
      theme?.disconnect();
      renderer?.destroy();
      renderer?.remove();
      book?.destroy();
      renderer = null; book = null;
    };
    const load = async () => {
      if (asset.error) throw new Error(asset.error);
      const [bytes, { Paginator: FoliatePaginator }, CFI] = await Promise.all([
        invoke<ArrayBuffer>("read_ebook", { path: filePath }),
        import("foliate-js/paginator.js"), import("foliate-js/epubcfi.js"),
      ]);
      if (cancelled) return;
      book = await loadEbook(bytes, filePath, reason => { if (!cancelled) setError(String(reason)); });
      if (cancelled) return;
      const currentBook = book;
      renderer = new FoliatePaginator();
      const currentRenderer = renderer;
      Object.assign(renderer.style, { width: "100%", height: "100%", display: "block" });
      renderer.setAttribute("flow", "paginated");
      renderer.setAttribute("max-column-count", "1");
      renderer.setAttribute("margin", "24px");
      renderer.setAttribute("gap", "8%");
      surface.append(renderer);
      renderer.open(book);
      engineRef.current = { book, renderer };
      navigatingRef.current = false;

      const applyTheme = () => {
        const size = bookmarkRef.current.fontSize;
        currentRenderer.setStyles(`html { font-size: ${size}% !important; } body { font-size: 1rem !important; line-height: 1.65 !important; } img, svg { max-width: 100%; }`);
        for (const { doc } of currentRenderer.getContents()) applyBookTheme(doc);
      };
      theme = new MutationObserver(applyTheme);
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
      renderer.addEventListener("load", event => {
        if (cancelled) return;
        const { doc } = (event as CustomEvent<{ doc: Document }>).detail;
        applyBookTheme(doc);
        doc.documentElement.setAttribute("aria-label", book?.metadata?.title || "Book chapter");
        const keydown = (event: KeyboardEvent) => {
          if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault(); event.stopImmediatePropagation();
            const right = event.key === "ArrowRight";
            actionRef.current(right !== (currentBook.dir === "rtl") ? "next" : "previous");
          }
        };
        doc.addEventListener("keydown", keydown, true);
        const followLink = (event: Event) => {
          if (event.type === "keydown" && (event as KeyboardEvent).key !== "Enter") return;
          const anchor = (event.target as Element | null)?.closest?.("[data-ghost-epub-href]");
          if (!anchor) return;
          event.preventDefault(); event.stopImmediatePropagation();
          actionRef.current(anchor.getAttribute("data-ghost-epub-href")!);
        };
        doc.addEventListener("click", followLink, true);
        doc.addEventListener("keydown", followLink, true);
      });
      renderer.addEventListener("relocate", event => {
        if (cancelled) return;
        const next = (event as CustomEvent<{ index: number; range: Range; fraction: number }>).detail;
        const range = next.range.cloneRange();
        range.collapse(true);
        bookmarkRef.current = { ...bookmarkRef.current, section: next.index, cfi: CFI.fromRange(range), fraction: next.fraction };
        saveEbookBookmark(filePath, bookmarkRef.current);
        setLocation({ index: next.index, page: Math.max(1, currentRenderer.page), total: Math.max(1, currentRenderer.pages - 2), atStart: currentRenderer.atStart, atEnd: currentRenderer.atEnd });
      });
      const contents = flattenEbookContents(book.toc ?? []);
      const resolved = await Promise.all(contents.map(async item => {
        try { return { ...item, index: (await currentBook.resolveHref(item.href)).index }; }
        catch { return { ...item, index: -1 }; }
      }));
      if (cancelled) return;
      const valid = resolved.filter(item => !!currentBook.sections[item.index]);
      setToc(valid.length ? valid : book.sections.flatMap((section, index) => section.linear === "no" ? [] : [{ href: `section:${index}`, label: `Chapter ${index + 1}`, index }]));
      applyTheme();
      const saved = bookmarkRef.current;
      const target: Navigation = { index: currentBook.sections[saved.section] ? saved.section : 0, anchor: saved.fraction };
      if (saved.cfi) target.anchor = doc => {
        try { return CFI.toRange(doc, CFI.parse(saved.cfi!)); } catch { return saved.fraction; }
      };
      await withEpubTimeout(renderer.goTo(target));
      if (!cancelled) setReady(true);
    };
    const loading = load();
    pendingRef.current = loading;
    void loading.catch(reason => { if (!cancelled) { setError(String(reason)); engineRef.current = null; dispose(); } }).finally(() => {
      initialized = true;
      if (cancelled) dispose();
    });
    return () => {
      cancelled = true;
      theme?.disconnect();
      engineRef.current = null;
      if (initialized) void Promise.resolve(pendingRef.current).catch(() => {}).finally(dispose);
    };
  }, [asset.error, asset.loading, asset.sourceUrl, filePath]);

  const changeFontSize = (delta: number) => {
    const next = Math.min(160, Math.max(80, fontSize + delta));
    setFontSize(next);
    bookmarkRef.current = { ...bookmarkRef.current, fontSize: next };
    saveEbookBookmark(filePath, bookmarkRef.current);
    engineRef.current?.renderer.setStyles(`html { font-size: ${next}% !important; } body { font-size: 1rem !important; line-height: 1.65 !important; } img, svg { max-width: 100%; }`);
  };
  return <div ref={readerRef} className="flex h-full flex-col pt-12 outline-none" tabIndex={0} data-viewer-focus-target data-ebook-path={filePath}
    onKeyDown={event => {
      if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        navigate((event.key === "ArrowRight") !== (engineRef.current?.book.dir === "rtl") ? "next" : "previous");
      }
    }}>
    <div className="relative min-h-0 flex-1">
      <div ref={surfaceRef} className="absolute inset-0 mx-auto max-w-4xl" />
      {!ready && !error && <div role="status" className="absolute inset-0 flex items-center justify-center bg-background text-sm text-muted-foreground">Opening book…</div>}
      {error && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background p-8 text-center"><p className="max-w-md text-sm text-muted-foreground">Unable to preview book: {error}</p><OpenExternalButton filePath={filePath} /></div>}
    </div>
    <BookReaderControls options={toc} selected={toc.find(item => item.index === location?.index)?.href ?? ""} onSelect={navigate}
      disabled={!ready || busy || !!error} atStart={location?.atStart} atEnd={location?.atEnd}
      onPrevious={() => navigate("previous")} onNext={() => navigate("next")}
      progress={location ? `${location.page} / ${location.total} in chapter` : "—"}
      scale={{ value: fontSize, min: 80, max: 160, change: changeFontSize }} />
  </div>;
}
