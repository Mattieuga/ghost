import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface PdfViewerProps {
  filePath: string;
}

export function PdfViewer({ filePath }: PdfViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    invoke<number[]>("read_file_bytes", { path: filePath }).then((data) => {
      const blob = new Blob([new Uint8Array(data)], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      urlRef.current = url;
      setBlobUrl(url);
    });

    return () => {
      cancelled = true;
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, [filePath]);

  return (
    <div className="flex flex-col h-full pt-12">
      {blobUrl ? (
        <embed
          src={blobUrl}
          type="application/pdf"
          className="w-full flex-1"
        />
      ) : (
        <div className="flex items-center justify-center flex-1">
          <span className="text-sm text-muted-foreground">Loading...</span>
        </div>
      )}
    </div>
  );
}
