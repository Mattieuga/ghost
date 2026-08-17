import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

const MIN_SCALE = 0.5;
const MAX_SCALE = 4;
const PINCH_SETTLE_MS = 100;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

interface PdfViewerProps {
  filePath: string;
}

export function PdfViewer({ filePath }: PdfViewerProps) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderTasksRef = useRef<Map<number, pdfjsLib.RenderTask>>(new Map());
  const scaleRef = useRef(scale);
  const pinchScaleRef = useRef(scale);
  const pinchTimerRef = useRef<number | null>(null);
  const pinchAnchorRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    invoke<number[]>("read_file_bytes", { path: filePath }).then(async (data) => {
      if (cancelled) return;
      try {
        const doc = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise;
        if (cancelled) { doc.destroy(); return; }
        setPdf(doc);
        setCurrentPage(1);
        setError(null);
      } catch {
        if (!cancelled) setError("Failed to load PDF");
      }
    });

    return () => {
      cancelled = true;
      setPdf((prev) => { prev?.destroy(); return null; });
      renderTasksRef.current.forEach((task) => task.cancel());
      renderTasksRef.current.clear();
    };
  }, [filePath]);

  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdf) return;
    const canvas = canvasRefs.current.get(pageNum);
    if (!canvas) return;

    const previousTask = renderTasksRef.current.get(pageNum);
    if (previousTask) {
      previousTask.cancel();
      try {
        await previousTask.promise;
      } catch {
        // Cancellation is expected when the zoom level changes.
      }
    }

    // A newer zoom request superseded this callback while it was waiting for
    // the previous render to finish.
    if (scaleRef.current !== scale || canvasRefs.current.get(pageNum) !== canvas) return;

    let renderTask: pdfjsLib.RenderTask | null = null;
    try {
      const page = await pdf.getPage(pageNum);
      if (scaleRef.current !== scale || canvasRefs.current.get(pageNum) !== canvas) return;
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      renderTask = page.render({ canvasContext: ctx, viewport });
      renderTasksRef.current.set(pageNum, renderTask);
      await renderTask.promise;
    } catch (e) {
      if (e instanceof pdfjsLib.RenderingCancelledException) return;
      console.warn(`Failed to render page ${pageNum}:`, e);
    } finally {
      if (renderTask && renderTasksRef.current.get(pageNum) === renderTask) {
        renderTasksRef.current.delete(pageNum);
      }
    }
  }, [pdf, scale]);

  const commitScale = useCallback((requestedScale: number) => {
    if (pinchTimerRef.current !== null) {
      window.clearTimeout(pinchTimerRef.current);
      pinchTimerRef.current = null;
    }
    const nextScale = clampScale(requestedScale);
    const previousScale = scaleRef.current;
    const pages = pagesRef.current;
    const container = containerRef.current;
    const visualZoom = Number.parseFloat(pages?.style.zoom || "1") || 1;
    const visualScale = previousScale * visualZoom;
    const canvasRatio = nextScale / previousScale;

    // Preserve the live pinch preview while replacing CSS zoom with correctly
    // sized canvases. PDF.js then refreshes their backing pixels at full DPR.
    canvasRefs.current.forEach((canvas) => {
      const width = Number.parseFloat(canvas.style.width);
      const height = Number.parseFloat(canvas.style.height);
      if (Number.isFinite(width)) canvas.style.width = `${width * canvasRatio}px`;
      if (Number.isFinite(height)) canvas.style.height = `${height * canvasRatio}px`;
    });
    if (pages) pages.style.zoom = "1";

    if (container) {
      const anchor = pinchAnchorRef.current ?? {
        x: container.clientWidth / 2,
        y: container.clientHeight / 2,
      };
      const visualRatio = nextScale / visualScale;
      container.scrollLeft = (container.scrollLeft + anchor.x) * visualRatio - anchor.x;
      container.scrollTop = (container.scrollTop + anchor.y) * visualRatio - anchor.y;
    }

    scaleRef.current = nextScale;
    pinchScaleRef.current = nextScale;
    pinchAnchorRef.current = null;
    setScale(nextScale);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const pages = pagesRef.current;
    if (!container || !pages || !pdf) return;

    const handleWheel = (event: WheelEvent) => {
      // macOS WebKit reports trackpad pinch gestures as control-modified
      // wheel events. Ordinary two-finger scrolling remains untouched.
      if (!event.ctrlKey) return;
      event.preventDefault();

      const rect = container.getBoundingClientRect();
      const anchor = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      const previousPinchScale = pinchScaleRef.current;
      const nextPinchScale = clampScale(
        previousPinchScale * Math.exp(-event.deltaY * 0.01)
      );
      if (nextPinchScale === previousPinchScale) return;

      const incrementalRatio = nextPinchScale / previousPinchScale;
      pages.style.zoom = String(nextPinchScale / scaleRef.current);
      container.scrollLeft =
        (container.scrollLeft + anchor.x) * incrementalRatio - anchor.x;
      container.scrollTop =
        (container.scrollTop + anchor.y) * incrementalRatio - anchor.y;

      pinchScaleRef.current = nextPinchScale;
      pinchAnchorRef.current = anchor;
      if (pinchTimerRef.current !== null) window.clearTimeout(pinchTimerRef.current);
      pinchTimerRef.current = window.setTimeout(() => {
        pinchTimerRef.current = null;
        commitScale(pinchScaleRef.current);
      }, PINCH_SETTLE_MS);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
      if (pinchTimerRef.current !== null) {
        window.clearTimeout(pinchTimerRef.current);
        pinchTimerRef.current = null;
      }
      pages.style.zoom = "1";
    };
  }, [pdf, commitScale]);

  const setCanvasRef = useCallback((pageNum: number, el: HTMLCanvasElement | null) => {
    if (el) {
      canvasRefs.current.set(pageNum, el);
      renderPage(pageNum);
    } else {
      canvasRefs.current.delete(pageNum);
    }
  }, [renderPage]);

  const setPageRef = useCallback((pageNum: number, el: HTMLDivElement | null) => {
    if (el) pageRefs.current.set(pageNum, el);
    else pageRefs.current.delete(pageNum);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdf) return;

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const num = Number(entry.target.getAttribute("data-page"));
          if (num) setCurrentPage(num);
        }
      }
    }, { root: container, threshold: 0.5 });

    pageRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [pdf, scale]);

  const scrollToPage = useCallback((pageNum: number) => {
    const el = pageRefs.current.get(pageNum);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const totalPages = pdf?.numPages ?? 0;

  return (
    <div className="flex flex-col h-full pt-12">
      {error ? (
        <div className="flex items-center justify-center flex-1">
          <span className="text-sm text-destructive">{error}</span>
        </div>
      ) : pdf ? (
        <>
          <div ref={containerRef} className="flex-1 overflow-auto min-h-0">
            <div ref={pagesRef} className="flex flex-col items-center gap-4 p-4">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((num) => (
                <div
                  key={num}
                  ref={(el) => setPageRef(num, el)}
                  data-page={num}
                >
                  <canvas ref={(el) => setCanvasRef(num, el)} />
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-3 px-4 py-2 text-[11px] text-ring shrink-0">
            <button
              className="hover:text-foreground disabled:opacity-30"
              disabled={currentPage <= 1}
              onClick={() => scrollToPage(currentPage - 1)}
            >
              ← Prev
            </button>
            <span>{currentPage} / {totalPages}</span>
            <button
              className="hover:text-foreground disabled:opacity-30"
              disabled={currentPage >= totalPages}
              onClick={() => scrollToPage(currentPage + 1)}
            >
              Next →
            </button>
            <span className="mx-2 text-border">|</span>
            <button className="hover:text-foreground" onClick={() => commitScale(pinchScaleRef.current - 0.25)}>−</button>
            <span>{Math.round(scale * 100)}%</span>
            <button className="hover:text-foreground" onClick={() => commitScale(pinchScaleRef.current + 0.25)}>+</button>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center flex-1">
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      )}
    </div>
  );
}
