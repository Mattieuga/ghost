import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { startBlockDrag } from "./block-drag";
import { versionedMediaAssetUrl } from "@/lib/media";

interface PreparedImageAsset {
  canonical_path: string;
  modified_ms: number;
}

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

export function ResizableImageView({ node, updateAttributes, selected, editor, getPos }: NodeViewProps) {
  const { src, alt, width } = node.attrs;
  const imgRef = useRef<HTMLImageElement>(null);
  const [resizing, setResizing] = useState(false);
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);
  const [lineColor, setLineColor] = useState("rgba(0,0,0,0.5)");

  // Resolve local paths through Tauri's exact-file asset grant. The image
  // bytes stay in the range-capable native resource path instead of becoming
  // a number[] plus Blob copy in JavaScript.
  useEffect(() => {
    if (!src) return;

    // Remote URLs and data URIs can be used directly
    if (src.startsWith("http") || src.startsWith("data:") || src.startsWith("blob:")) {
      setResolvedSrc(src);
      return;
    }

    // Reject path traversal attempts
    if (src.includes("..")) {
      setResolvedSrc(null);
      return;
    }

    // Relative path — resolve against the active file's directory
    const activeFile = window.__ghostActiveFile;
    if (!activeFile) return;

    const dir = activeFile.substring(0, activeFile.lastIndexOf("/"));
    const absolutePath = `${dir}/${src}`;

    let cancelled = false;
    invoke<PreparedImageAsset>("prepare_media_asset", { path: absolutePath })
      .then((asset) => {
        if (cancelled) return;
        setResolvedSrc(versionedMediaAssetUrl(
          convertFileSrc(asset.canonical_path),
          asset.modified_ms,
          1,
        ));
      })
      .catch(() => {
        setResolvedSrc(null);
      });

    return () => {
      cancelled = true;
      setResolvedSrc(null);
    };
  }, [src]);

  const handleImageLoad = useCallback(() => {
    if (!imgRef.current) return;
    const brightness = sampleCornerLuminance(imgRef.current);
    setLineColor(brightness === "light" ? "rgba(0,0,0,0.45)" : "rgba(255,255,255,0.7)");
  }, []);

  const handleResizeDown = useCallback(
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

  const handleDragDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const pos = typeof getPos === "function" ? getPos() : undefined;
      if (pos === undefined || !editor) return;
      startBlockDrag(editor.view, pos, node.nodeSize, e.nativeEvent, "Image");
    },
    [editor, getPos, node.nodeSize]
  );

  return (
    <NodeViewWrapper className="ghost-image-wrapper">
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
          <div style={{ height: 0 }} />
        )}

        {/* Drag handle — top-left corner, visible on hover */}
        <div
          className="ghost-image-drag-handle"
          onPointerDown={handleDragDown}
          title="Drag to move"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <circle cx="3" cy="2" r="1" /><circle cx="7" cy="2" r="1" />
            <circle cx="3" cy="5" r="1" /><circle cx="7" cy="5" r="1" />
            <circle cx="3" cy="8" r="1" /><circle cx="7" cy="8" r="1" />
          </svg>
        </div>

        {/* Resize handle — bottom-right corner */}
        <div
          className={`ghost-image-resize-handle ${resizing ? "active" : ""}`}
          onMouseDown={handleResizeDown}
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
