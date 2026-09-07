import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { ArrowLeftRight, Maximize2 } from "lucide-react";
import { useArchiveManifest } from "@/hooks/use-archive-manifest";
import { comicPages, readComicBookmark, saveComicBookmark } from "@/lib/comic";
import type { ArchivePreviewArtifact } from "@/components/viewer/archive-entry-preview";
import { BookReaderControls, bookControlClass, restoreBookFocus } from "@/components/viewer/book-reader-controls";
import { OpenExternalButton } from "@/components/viewer/open-external-button";

export function ComicViewer({ filePath }: { filePath: string }) {
  const { manifest, loading, error: manifestError } = useArchiveManifest(filePath);
  const pages = useMemo(() => comicPages(manifest?.entries ?? []), [manifest]);
  const [bookmark, setBookmark] = useState(() => readComicBookmark(filePath));
  const current = Math.max(0, pages.findIndex(page => page.path === bookmark.page));
  const pagePath = pages[current]?.path;
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageReady, setPageReady] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 1, height: 1 });
  const [bounds, setBounds] = useState({ width: 1, height: 1 });
  const readerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() => setBounds({ width: Math.max(1, viewport.clientWidth - 32), height: Math.max(1, viewport.clientHeight - 32) }));
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pagePath) return;
    let cancelled = false;
    let artifact: ArchivePreviewArtifact | null = null;
    let thumbnail: string | null = null;
    const requestId = `comic-${crypto.randomUUID()}`;
    setSource(null); setError(null); setPageReady(false);
    viewportRef.current?.scrollTo(0, 0);
    const release = () => {
      if (artifact) void invoke("release_archive_preview", { token: artifact.token }).catch(() => {});
      if (thumbnail) URL.revokeObjectURL(thumbnail);
      artifact = null; thumbnail = null;
    };
    const prepare = async () => {
      artifact = await invoke<ArchivePreviewArtifact>("materialize_archive_entry", { archivePath: filePath, entryPath: pagePath, requestId });
      if (cancelled) { release(); return; }
      if (!artifact.mime_type?.startsWith("image/") || artifact.mime_type === "image/svg+xml") {
        throw new Error("This page is not a supported image");
      }
      // The archive cache owns the temporary file; grant only that exact asset.
      await invoke("prepare_media_asset", { path: artifact.path });
      if (cancelled) return;
      const inspection = await invoke<{ width: number; height: number; needs_thumbnail: boolean }>("inspect_image", { path: artifact.path });
      if (cancelled) return;
      setDimensions(inspection);
      let url = convertFileSrc(artifact.path);
      if (inspection.needs_thumbnail) {
        const bytes = await invoke<number[]>("read_image_thumbnail", { path: artifact.path, maxPixelSize: 3072 });
        if (cancelled) return;
        thumbnail = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        url = thumbnail;
      }
      setSource(url);
    };
    const pending = prepare();
    void pending.catch(reason => { if (!cancelled) { setError(String(reason)); release(); } });
    return () => {
      cancelled = true;
      void invoke("cancel_archive_preview", { requestId }).catch(() => {});
      // Do not release a temporary image while native inspection is reading it.
      void pending.catch(() => {}).finally(release);
    };
  }, [filePath, pagePath, manifest]);

  const save = (next: typeof bookmark) => { setBookmark(next); saveComicBookmark(filePath, next); };
  const select = (target: string, control?: HTMLElement) => {
    if (!pages.some(page => page.path === target)) return;
    save({ ...bookmark, page: target });
    restoreBookFocus(readerRef.current, null, control);
  };
  const turn = (delta: number) => { if (pages[current + delta]) select(pages[current + delta].path); };
  const failure = manifestError || error || (!loading && !pages.length ? "This archive has no supported image pages" : null);
  const scale = Math.min(bounds.width / dimensions.width, bounds.height / dimensions.height) * bookmark.zoom / 100;

  return <div ref={readerRef} className="flex h-full flex-col pt-12 outline-none" tabIndex={0} data-viewer-focus-target data-comic-path={filePath}
    onKeyDown={event => {
      if (event.target !== event.currentTarget || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        turn((event.key === "ArrowRight") !== bookmark.rtl ? 1 : -1);
      }
    }}>
    <div className="relative min-h-0 flex-1">
      <div ref={viewportRef} className="absolute inset-0 overflow-auto" onMouseDown={() => readerRef.current?.focus({ preventScroll: true })}>
        {source && <div className="flex min-h-full min-w-full p-4" style={{ width: Math.max(bounds.width + 32, dimensions.width * scale + 32), height: Math.max(bounds.height + 32, dimensions.height * scale + 32) }}>
          <img key={source} src={source} alt={`Page ${current + 1}`} draggable={false}
            className="m-auto max-w-none shrink-0" style={{ width: dimensions.width * scale, height: dimensions.height * scale }}
            onLoad={() => setPageReady(true)} onError={() => setError("This comic page could not be decoded")} />
        </div>}
      </div>
      {(!pageReady || loading) && !failure && <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background text-sm text-muted-foreground">Opening page…</div>}
      {failure && <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background p-8 text-center"><p className="max-w-md text-sm text-muted-foreground">Unable to preview comic: {failure}</p><OpenExternalButton filePath={filePath} /></div>}
    </div>
    <BookReaderControls options={pages.map((page, index) => ({ href: page.path, label: `${index + 1}. ${page.path.split("/").pop()}` }))}
      selected={pagePath ?? ""} onSelect={select} contentsLabel="Pages"
      disabled={loading || !pages.length} atStart={current === 0} atEnd={current === pages.length - 1}
      onPrevious={() => turn(-1)} onNext={() => turn(1)} progress={pages.length ? `${current + 1} / ${pages.length}` : "—"}
      scale={{ value: bookmark.zoom, min: 100, max: 300, zoom: true, change: delta => save({ ...bookmark, zoom: Math.max(100, Math.min(300, bookmark.zoom + delta)) }) }}>
      <button aria-label="Fit page" title="Fit page" className={bookControlClass} onClick={() => save({ ...bookmark, zoom: 100 })}><Maximize2 className="size-3.5" /></button>
      <button aria-label="Read right to left" aria-pressed={bookmark.rtl} title={bookmark.rtl ? "Reading right to left" : "Reading left to right"}
        className={`${bookControlClass} ${bookmark.rtl ? "bg-muted text-foreground" : ""}`} onClick={() => save({ ...bookmark, rtl: !bookmark.rtl })}><ArrowLeftRight className="size-3.5" /></button>
    </BookReaderControls>
  </div>;
}
