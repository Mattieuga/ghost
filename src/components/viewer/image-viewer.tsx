import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useMediaAsset } from "@/hooks/use-media-asset";
import { OpenExternalButton } from "@/components/viewer/open-external-button";

interface ImageInspection {
  width: number;
  height: number;
  frame_count: number;
  estimated_decoded_bytes: number;
  needs_thumbnail: boolean;
  format: string | null;
}

interface ImageViewerProps {
  filePath: string;
  displayName?: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageViewer({ filePath, displayName }: ImageViewerProps) {
  const asset = useMediaAsset(filePath);
  const [inspection, setInspection] = useState<ImageInspection | null>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const thumbnailRef = useRef<string | null>(null);
  const fileName = displayName ?? filePath.split("/").pop() ?? filePath;

  useEffect(() => {
    if (!asset.sourceUrl) return;
    let cancelled = false;
    setInspection(null);
    setPreviewError(null);
    setThumbnailUrl(null);
    if (thumbnailRef.current) {
      URL.revokeObjectURL(thumbnailRef.current);
      thumbnailRef.current = null;
    }

    const prepare = async () => {
      try {
        const details = await invoke<ImageInspection>("inspect_image", { path: filePath });
        if (cancelled) return;
        setInspection(details);
        if (!details.needs_thumbnail) return;

        const data = await invoke<number[]>("read_image_thumbnail", {
          path: filePath,
          maxPixelSize: 3072,
        });
        const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: "image/png" }));
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        thumbnailRef.current = url;
        setThumbnailUrl(url);
      } catch (reason) {
        if (!cancelled) setPreviewError(String(reason));
      }
    };
    void prepare();

    return () => {
      cancelled = true;
      if (thumbnailRef.current) {
        URL.revokeObjectURL(thumbnailRef.current);
        thumbnailRef.current = null;
      }
    };
  }, [asset.sourceUrl, filePath]);

  const source = inspection?.needs_thumbnail ? thumbnailUrl : asset.sourceUrl;
  const error = asset.error ?? previewError;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center p-8 pt-16">
        {error ? (
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <span className="text-sm text-destructive">Unable to preview image: {error}</span>
            <OpenExternalButton filePath={filePath} />
          </div>
        ) : source ? (
          <img src={source} alt={fileName} className="max-h-full max-w-full rounded-md object-contain" />
        ) : (
          <span className="text-sm text-muted-foreground">Loading…</span>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-center gap-4 px-4 py-3 text-[11px] text-ring">
        {inspection && <span>{inspection.width} × {inspection.height}</span>}
        {asset.sizeBytes !== null && <span>{formatSize(asset.sizeBytes)}</span>}
        {inspection && inspection.frame_count > 1 && <span>{inspection.frame_count} frames</span>}
        {inspection?.needs_thumbnail && <span>bounded preview · original not decoded</span>}
      </div>
    </div>
  );
}
