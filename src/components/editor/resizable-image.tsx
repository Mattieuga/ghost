import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// Module-level blob URL cache: path -> { url, refCount }
const blobCache = new Map<string, { url: string; refCount: number }>();

function sampleCornerLuminance(img: HTMLImageElement): "light" | "dark" {
  try {
    const canvas = document.createElement("canvas");
    const size = 20;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "dark";

    const sx = Math.max(0, img.naturalWidth - size);
    const sy = Math.max(0, img.naturalHeight - size);
    const sw = Math.min(size, img.naturalWidth);
    const sh = Math.min(size, img.naturalHeight);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    const data = ctx.getImageData(0, 0, sw, sh).data;
    let total = 0;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      total += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      count++;
    }
    return (total / count) > 128 ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const { src, alt, width } = node.attrs;
  const imgRef = useRef<HTMLImageElement>(null);
  const [resizing, setResizing] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [lineColor, setLineColor] = useState("rgba(0,0,0,0.5)");

  // Resolve local image paths to blob URLs (with cache)
  useEffect(() => {
    if (!src) return;

    // Remote URLs and data URIs can be used directly
    if (src.startsWith("http") || src.startsWith("data:") || src.startsWith("blob:")) {
      setResolvedSrc(src);
      return;
    }

    // Validate: only allow .images/ relative paths for local resolution
    if (!src.startsWith(".images/")) {
      setResolvedSrc(null);
      return;
    }

    const activeFile = window.__ghostActiveFile;
    if (!activeFile) return;

    const dir = activeFile.substring(0, activeFile.lastIndexOf("/"));
    const absolutePath = `${dir}/${src}`;

    // Check cache first
    const cached = blobCache.get(absolutePath);
    if (cached) {
      cached.refCount++;
      setResolvedSrc(cached.url);
      return () => {
        cached.refCount--;
        if (cached.refCount <= 0) {
          URL.revokeObjectURL(cached.url);
          blobCache.delete(absolutePath);
        }
      };
    }

    let revoked = false;
    invoke<number[]>("read_file_bytes", { path: absolutePath })
      .then((data) => {
        if (revoked) return;
        const ext = src.split(".").pop()?.toLowerCase() || "png";
        const mimeMap: Record<string, string> = {
          png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
          gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
          bmp: "image/bmp", ico: "image/x-icon",
        };
        const blob = new Blob([new Uint8Array(data)], { type: mimeMap[ext] || "image/png" });
        const url = URL.createObjectURL(blob);
        blobCache.set(absolutePath, { url, refCount: 1 });
        setResolvedSrc(url);
      })
      .catch(() => {
        setResolvedSrc(null);
      });

    return () => {
      revoked = true;
      const entry = blobCache.get(absolutePath);
      if (entry) {
        entry.refCount--;
        if (entry.refCount <= 0) {
          URL.revokeObjectURL(entry.url);
          blobCache.delete(absolutePath);
        }
      }
      setResolvedSrc(null);
    };
  }, [src]);

  const handleImageLoad = useCallback(() => {
    if (!imgRef.current) return;
    const brightness = sampleCornerLuminance(imgRef.current);
    setLineColor(brightness === "light" ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.7)");
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setResizing(true);

      const startX = e.clientX;
      const startWidth = imgRef.current?.offsetWidth ?? 400;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX;
        const newWidth = Math.max(100, startWidth + delta);
        updateAttributes({ width: newWidth });
      };

      const onMouseUp = () => {
        setResizing(false);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [updateAttributes]
  );

  return (
    <NodeViewWrapper className="ghost-image-wrapper" data-drag-handle>
      <div
        className={`ghost-image-container ${selected ? "selected" : ""}`}
        style={{ width: `${width || 300}px`, maxWidth: "100%" }}
      >
        {resolvedSrc ? (
          <img
            ref={imgRef}
            src={resolvedSrc}
            alt={alt || ""}
            draggable={false}
            onLoad={handleImageLoad}
          />
        ) : (
          <div className="ghost-image-placeholder" />
        )}
        {/* Resize handle — 3 diagonal lines, color adapts to image */}
        <div
          className={`ghost-image-resize-handle ${resizing ? "active" : ""}`}
          onMouseDown={handleMouseDown}
        >
          <svg viewBox="0 0 14 14" fill="none">
            <line x1="12.5" y1="5.5" x2="5.5" y2="12.5" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="12.5" y1="8.5" x2="8.5" y2="12.5" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" />
            <line x1="12.5" y1="11.5" x2="11.5" y2="12.5" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      </div>
    </NodeViewWrapper>
  );
}
