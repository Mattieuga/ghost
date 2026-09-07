import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { BookOpen, ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import type { Book, Contents, Location, Rendition } from "epubjs";
import type Section from "epubjs/types/section";
import { useMediaAsset } from "@/hooks/use-media-asset";
import { OpenExternalButton } from "@/components/viewer/open-external-button";
import {
  applyEpubTheme, destroyEpubBook, flattenEpubContents, prepareEpubDocument,
  readEpubBookmark, saveEpubBookmark, withEpubTimeout,
} from "@/lib/epub";

export function EpubViewer({ filePath }: { filePath: string }) {
  const asset = useMediaAsset(filePath);
  const readerRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const renditionRef = useRef<Rendition | null>(null);
  const bookmarkRef = useRef(readEpubBookmark(filePath));
  const [fontSize, setFontSize] = useState(bookmarkRef.current.fontSize);
  const [title, setTitle] = useState(filePath.split("/").pop() ?? "EPUB");
  const [author, setAuthor] = useState("");
  const [toc, setToc] = useState<Array<{ href: string; label: string }>>([]);
  const [location, setLocation] = useState<Location | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionRef = useRef<(action: "next" | "previous" | string) => void>(() => undefined);

  const navigate = useCallback((target: string) => {
    const rendition = renditionRef.current;
    if (!rendition) return;
    const focusedFrame = surfaceRef.current?.contains(document.activeElement)
      ? document.activeElement : null;
    setBusy(true);
    const operation = target === "next" ? rendition.next()
      : target === "previous" ? rendition.prev() : rendition.display(target);
    void withEpubTimeout(operation).catch((reason) => {
      if (renditionRef.current === rendition) setError(String(reason));
    }).finally(() => {
      if (renditionRef.current !== rendition) return;
      setBusy(false);
      // Crossing a chapter destroys its focused iframe. Keep keyboard reading
      // on the stable viewer, without taking focus from another app control.
      if (focusedFrame && !focusedFrame.isConnected && document.activeElement === document.body) {
        readerRef.current?.focus({ preventScroll: true });
      }
    });
  }, []);
  actionRef.current = navigate;

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    let cancelled = false;
    let book: Book | null = null;
    let initialized = false;
    let resize: ResizeObserver | null = null;
    let theme: MutationObserver | null = null;
    setReady(false);
    setBusy(false);
    setError(null);
    setLocation(null);
    setToc([]);

    const dispose = () => {
      resize?.disconnect();
      theme?.disconnect();
      if (book) {
        if (renditionRef.current === book.rendition) renditionRef.current = null;
        destroyEpubBook(book);
        book = null;
      }
    };

    const load = async () => {
      if (asset.loading) return;
      if (asset.error) throw new Error(asset.error);
      const [bytes, { Book: EpubBook }] = await Promise.all([
        invoke<ArrayBuffer>("read_epub", { path: filePath }),
        import("epubjs"),
      ]);
      if (cancelled) return;
      book = new EpubBook({
        replacements: "blobUrl",
        // All content must come from this local ZIP, including styles/fonts.
        requestMethod: async () => { throw new Error("Remote EPUB resources are disabled"); },
      });
      book.spine.hooks.content.register(prepareEpubDocument);
      // EPUB.js leaves a detached rejection (and loaded.navigation pending)
      // when the optional TOC is missing or malformed. Fall back to the spine.
      const loadNavigation = book.loadNavigation.bind(book);
      book.loadNavigation = (packaging) => loadNavigation(packaging).catch(() =>
        loadNavigation(new DOMParser().parseFromString("<package/>", "text/xml")));
      await withEpubTimeout(book.open(bytes, "binary"));
      await withEpubTimeout(book.opened);
      if (cancelled) return;
      if (!book.spine.first()) throw new Error("This EPUB has no readable chapters");

      const metadata = await book.loaded.metadata;
      setTitle(metadata.title || filePath.split("/").pop() || "EPUB");
      setAuthor(metadata.creator || "");
      const navigation = await withEpubTimeout(book.loaded.navigation);
      let contents = flattenEpubContents(navigation.toc, book.packaging.navPath || book.packaging.ncxPath);
      if (!contents.length) {
        contents = [];
        book.spine.each((section: Section) => {
          if (section.linear) contents.push({ href: section.href, label: `Chapter ${contents.length + 1}` });
        });
      }
      if (cancelled) return;
      setToc(contents);
      const rendition = book.renderTo(surface, {
        width: "100%", height: "100%", flow: "paginated", spread: "none",
        // WebKit requires this for Ghost-owned DOM event listeners. Book
        // scripts remain forbidden by the chapter's script-src 'none' CSP,
        // installed before rendering; active content is also removed.
        allowScriptedContent: true,
      });
      renditionRef.current = rendition;
      const applyTheme = () => {
        // EPUB.js's declaration incorrectly types this as a single Contents.
        for (const contents of rendition.getContents() as unknown as Contents[]) {
          applyEpubTheme(contents.document);
        }
      };
      rendition.themes.default({
        body: { "line-height": "1.65 !important" },
        "img, svg": { "max-width": "100%" },
      });
      rendition.themes.fontSize(`${bookmarkRef.current.fontSize}%`);
      theme = new MutationObserver(applyTheme);
      theme.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] });
      rendition.on("relocated", (next: Location) => {
        if (cancelled) return;
        setLocation(next);
        bookmarkRef.current = { ...bookmarkRef.current, cfi: next.start.cfi, href: next.start.href };
        saveEpubBookmark(filePath, bookmarkRef.current);
      });
      rendition.on("keydown", (event: KeyboardEvent) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          actionRef.current(event.key === "ArrowRight" ? "next" : "previous");
        }
      });
      rendition.hooks.content.register((contents: Contents) => {
        applyEpubTheme(contents.document);
        contents.document.documentElement.setAttribute("aria-label", metadata.title || "EPUB chapter");
        // Ghost handles links; there is no native href to navigate the frame.
        const followLink = (event: Event) => {
          if (event.type === "keydown" && (event as KeyboardEvent).key !== "Enter") return;
          const anchor = (event.target as Element | null)?.closest?.("a[data-ghost-epub-href], area[data-ghost-epub-href]");
          if (!anchor) return;
          event.preventDefault();
          event.stopImmediatePropagation();
          if (!book || cancelled) return;
          const base = contents.document.querySelector("base")?.getAttribute("href");
          const target = new URL(anchor.getAttribute("data-ghost-epub-href")!, base || window.location.href);
          actionRef.current(book.path.relative(target.pathname) + target.hash);
        };
        contents.document.addEventListener("click", followLink, true);
        contents.document.addEventListener("keydown", followLink, true);
      });
      const saved = bookmarkRef.current;
      try {
        await withEpubTimeout(rendition.display(saved.cfi || saved.href));
      } catch (reason) {
        if (!saved.cfi && !saved.href) throw reason;
        // A replacement book may have invalidated the old CFI.
        await withEpubTimeout(rendition.display());
      }
      if (cancelled) return;
      let width = surface.clientWidth;
      let height = surface.clientHeight;
      resize = new ResizeObserver(() => {
        const nextWidth = surface.clientWidth;
        const nextHeight = surface.clientHeight;
        if (nextWidth && nextHeight && (nextWidth !== width || nextHeight !== height)) {
          width = nextWidth;
          height = nextHeight;
          rendition.resize(width, height);
        }
      });
      resize.observe(surface);
      setReady(true);
    };

    void load().catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      dispose();
    }).finally(() => {
      initialized = true;
      if (cancelled) dispose();
    });
    return () => {
      cancelled = true;
      resize?.disconnect();
      theme?.disconnect();
      renditionRef.current = null;
      // Let a pending book open settle before destroying its internal queues.
      if (initialized) dispose();
    };
  }, [asset.error, asset.loading, asset.sourceUrl, filePath]);

  const changeFontSize = (delta: number) => {
    const next = Math.min(160, Math.max(80, fontSize + delta));
    setFontSize(next);
    bookmarkRef.current = { ...bookmarkRef.current, fontSize: next };
    saveEpubBookmark(filePath, bookmarkRef.current);
    renditionRef.current?.themes.fontSize(`${next}%`);
  };
  const selectedChapter = toc.find((item) => item.href.split("#")[0] === location?.start.href)?.href ?? "";
  const controlClass = "rounded p-1.5 hover:bg-muted focus-visible:outline focus-visible:outline-ring disabled:opacity-30";

  return (
    <div ref={readerRef} className="flex h-full flex-col pt-12 outline-none" tabIndex={0} data-viewer-focus-target data-epub-path={filePath}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
          event.preventDefault();
          navigate(event.key === "ArrowRight" ? "next" : "previous");
        }
      }}>
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-3">
        <BookOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-foreground">{title}</div>
          {author && <div className="truncate text-xs text-muted-foreground">{author}</div>}
        </div>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">EPUB</span>
      </div>
      <div className="relative min-h-0 flex-1">
        <div ref={surfaceRef} className="absolute inset-0 mx-auto max-w-4xl" />
        {!ready && !error && <div role="status" className="absolute inset-0 flex items-center justify-center bg-background text-sm text-muted-foreground">Opening book…</div>}
        {error && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background p-8 text-center">
          <p className="max-w-md text-sm text-muted-foreground">Unable to preview EPUB: {error}</p>
          <OpenExternalButton filePath={filePath} />
        </div>}
      </div>
      <div className="flex shrink-0 flex-col items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground sm:flex-row">
        <select aria-label="Table of contents" value={selectedChapter} disabled={!ready || busy || !!error}
          onChange={(event) => navigate(event.target.value)}
          className="w-full min-w-0 flex-1 truncate rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-ring">
          <option value="" disabled>Contents</option>
          {toc.map((item, index) => <option key={`${item.href}:${index}`} value={item.href}>{item.label}</option>)}
        </select>
        <div className="flex shrink-0 items-center justify-center gap-1">
        <button aria-label="Previous page" title="Previous page (Left arrow)" className={controlClass} disabled={!ready || busy || !!error || location?.atStart} onClick={() => navigate("previous")}><ChevronLeft className="size-4" /></button>
        <span className="min-w-24 text-center text-[11px] tabular-nums" aria-live="polite">{location ? `${location.start.displayed.page} / ${location.start.displayed.total} in chapter` : "—"}</span>
        <button aria-label="Next page" title="Next page (Right arrow)" className={controlClass} disabled={!ready || busy || !!error || location?.atEnd} onClick={() => navigate("next")}><ChevronRight className="size-4" /></button>
        <span className="mx-1 h-4 w-px bg-border" />
        <button aria-label="Smaller text" className={controlClass} disabled={!ready || !!error || fontSize <= 80} onClick={() => changeFontSize(-10)}><Minus className="size-3.5" /></button>
        <span className="w-8 text-center text-[11px] tabular-nums">{fontSize}%</span>
        <button aria-label="Larger text" className={controlClass} disabled={!ready || !!error || fontSize >= 160} onClick={() => changeFontSize(10)}><Plus className="size-3.5" /></button>
        </div>
      </div>
    </div>
  );
}
