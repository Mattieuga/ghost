import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface FontViewerProps {
  filePath: string;
}

const DEFAULT_SAMPLE = "The quick brown fox jumps over the lazy dog.";
const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const NUMERALS = "0123456789  !? & @ # $ % ( ) [ ] { }";
let nextFontPreviewId = 0;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FontViewer({ filePath }: FontViewerProps) {
  const [fontFamily, setFontFamily] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [fontSize, setFontSize] = useState(48);
  const [sample, setSample] = useState(DEFAULT_SAMPLE);
  const [error, setError] = useState<string | null>(null);

  const fileName = filePath.split("/").pop() ?? filePath;
  const extension = fileName.split(".").pop()?.toUpperCase() ?? "FONT";
  const previewFamily = useMemo(
    () => `ghost-font-preview-${++nextFontPreviewId}`,
    [filePath]
  );

  useEffect(() => {
    let cancelled = false;
    let loadedFace: FontFace | null = null;

    setFontFamily(null);
    setFileSize(null);
    setError(null);

    invoke<{ size_bytes: number }>("get_file_metadata", { path: filePath })
      .then((metadata) => {
        if (!cancelled) setFileSize(metadata.size_bytes);
      })
      .catch(() => {});

    invoke<number[]>("read_file_bytes", { path: filePath })
      .then(async (data) => {
        const bytes = new Uint8Array(data);
        const face = new FontFace(previewFamily, bytes.buffer);
        const loaded = await face.load();
        if (cancelled) return;

        loadedFace = loaded;
        document.fonts.add(loaded);
        setFontFamily(previewFamily);
      })
      .catch((reason) => {
        if (!cancelled) setError(`Unable to load font: ${String(reason)}`);
      });

    return () => {
      cancelled = true;
      if (loadedFace) document.fonts.delete(loadedFace);
    };
  }, [filePath, previewFamily]);

  const previewStyle = fontFamily
    ? { fontFamily: `"${fontFamily}", sans-serif` }
    : undefined;

  return (
    <div className="flex h-full flex-col pt-12">
      {error ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <span className="text-sm text-destructive">{error}</span>
        </div>
      ) : fontFamily ? (
        <>
          <div className="flex-1 overflow-auto min-h-0">
            <div className="mx-auto flex max-w-4xl flex-col gap-8 px-8 py-10">
              <div className="flex items-baseline justify-between gap-4 border-b border-border pb-4">
                <div className="min-w-0">
                  <div className="truncate text-sm text-foreground">{fileName}</div>
                  <div className="mt-1 text-[11px] uppercase tracking-wider text-ring">
                    {extension} font
                  </div>
                </div>
                {fileSize !== null && (
                  <span className="shrink-0 text-[11px] text-ring">{formatSize(fileSize)}</span>
                )}
              </div>

              <div
                className="text-[112px] leading-none text-foreground"
                style={previewStyle}
              >
                Aa
              </div>

              <textarea
                value={sample}
                onChange={(event) => setSample(event.target.value)}
                spellCheck={false}
                aria-label="Editable font preview text"
                className="min-h-36 w-full resize-y rounded-md border border-border bg-transparent p-4 text-foreground outline-none transition-colors focus:border-ring"
                style={{ ...previewStyle, fontSize: `${fontSize}px`, lineHeight: 1.25 }}
              />

              <div className="space-y-5 text-foreground" style={previewStyle}>
                <div className="break-words text-3xl leading-relaxed">{UPPERCASE}</div>
                <div className="break-words text-3xl leading-relaxed">{LOWERCASE}</div>
                <div className="break-words text-2xl leading-relaxed">{NUMERALS}</div>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center justify-center gap-3 border-t border-border px-4 py-3 text-[11px] text-ring">
            <span>Preview size</span>
            <input
              type="range"
              min={16}
              max={96}
              step={1}
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.currentTarget.value))}
              aria-label="Font preview size"
              className="w-36 accent-ghost-amber"
            />
            <span className="w-9 text-right tabular-nums">{fontSize}px</span>
          </div>
        </>
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <span className="text-sm text-muted-foreground">Loading font...</span>
        </div>
      )}
    </div>
  );
}
