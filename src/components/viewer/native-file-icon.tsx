import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { File } from "lucide-react";

interface NativeFileIconProps {
  filePath: string;
  className?: string;
}

/** Finder's icon when macOS has one, with Ghost's generic glyph as fallback. */
export function NativeFileIcon({ filePath, className = "size-16" }: NativeFileIconProps) {
  const [iconUrl, setIconUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIconUrl(null);
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }

    void invoke<number[] | null>("read_file_icon", { path: filePath, pixelSize: 128 })
      .then((bytes) => {
        if (cancelled || !bytes?.length) return;
        const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        urlRef.current = url;
        setIconUrl(url);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, [filePath]);

  return iconUrl ? (
    <img src={iconUrl} alt="" className={`${className} object-contain drop-shadow-md`} />
  ) : (
    <File className={`${className} text-ring`} strokeWidth={1} />
  );
}
