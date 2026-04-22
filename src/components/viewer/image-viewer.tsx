import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
const MIME_MAP: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", bmp: "image/bmp", ico: "image/x-icon",
};

interface ImageViewerProps {
  filePath: string;
}

export function ImageViewer({ filePath }: ImageViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    invoke<number[]>("read_file_bytes", { path: filePath }).then((data) => {
      const ext = filePath.split(".").pop()?.toLowerCase() ?? "png";
      const blob = new Blob([new Uint8Array(data)], { type: MIME_MAP[ext] || "image/png" });
      const url = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      setFileSize(blob.size);
      urlRef.current = url;
      setBlobUrl(url);
    });

    return () => {
      cancelled = true;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [filePath]);

  const fileName = filePath.split("/").pop() ?? filePath;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Image */}
      <div className="flex-1 flex items-center justify-center p-8 pt-16 min-h-0">
        {blobUrl ? (
          <img
            src={blobUrl}
            alt={fileName}
            className="max-w-full max-h-full object-contain rounded-md"
            onLoad={(e) => {
              const img = e.currentTarget;
              setDimensions({ w: img.naturalWidth, h: img.naturalHeight });
            }}
          />
        ) : (
          <span className="text-sm text-muted-foreground">Loading...</span>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-center gap-4 px-4 py-3 text-[11px] text-ring shrink-0">
        {dimensions && <span>{dimensions.w} × {dimensions.h}</span>}
        {fileSize !== null && <span>{formatSize(fileSize)}</span>}
      </div>
    </div>
  );
}
