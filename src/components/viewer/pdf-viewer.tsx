import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

interface PdfViewerProps {
  filePath: string;
}

export function PdfViewer({ filePath }: PdfViewerProps) {
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.5);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderingRef = useRef(new Set<number>());

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
      renderingRef.current.clear();
    };
  }, [filePath]);

  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdf) return;
    const canvas = canvasRefs.current.get(pageNum);
    if (!canvas || renderingRef.current.has(pageNum)) return;

    renderingRef.current.add(pageNum);
    try {
      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;
      canvas.width = viewport.width * dpr;
      canvas.height = viewport.height * dpr;
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (e) {
      if (e instanceof pdfjsLib.RenderingCancelledException) return;
      console.warn(`Failed to render page ${pageNum}:`, e);
    }
    renderingRef.current.delete(pageNum);
  }, [pdf, scale]);

  useEffect(() => {
    if (!pdf) return;
    canvasRefs.current.clear();
    renderingRef.current.clear();
  }, [pdf, scale]);

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
            <div className="flex flex-col items-center gap-4 p-4">
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
            <button className="hover:text-foreground" onClick={() => setScale((s) => Math.max(0.5, s - 0.25))}>−</button>
            <span>{Math.round(scale * 100)}%</span>
            <button className="hover:text-foreground" onClick={() => setScale((s) => Math.min(4, s + 0.25))}>+</button>
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
