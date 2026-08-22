import { useEffect, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { versionedMediaAssetUrl } from "@/lib/media";

interface PreparedMediaAsset {
  canonical_path: string;
  size_bytes: number;
  modified_ms: number;
}

export interface MediaAssetState {
  sourceUrl: string | null;
  sizeBytes: number | null;
  modifiedMs: number | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: MediaAssetState = {
  sourceUrl: null,
  sizeBytes: null,
  modifiedMs: null,
  loading: true,
  error: null,
};

/**
 * Prepare one exact file for Tauri's range-capable asset protocol. Metadata
 * checks on filesystem events and window focus refresh replaced media without
 * repeatedly remounting an unchanged source.
 */
export function useMediaAsset(filePath: string): MediaAssetState {
  const [state, setState] = useState<MediaAssetState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let requestId = 0;
    let revision = 0;
    let signature: string | null = null;
    let canonicalPath: string | null = null;

    setState(INITIAL_STATE);

    const refresh = async (force: boolean) => {
      const currentRequest = ++requestId;
      try {
        const metadata = await invoke<PreparedMediaAsset>("prepare_media_asset", {
          path: filePath,
        });
        if (cancelled || currentRequest !== requestId) return;

        canonicalPath = metadata.canonical_path;
        const nextSignature = `${metadata.canonical_path}:${metadata.size_bytes}:${metadata.modified_ms}`;
        if (!force && signature === nextSignature) return;

        signature = nextSignature;
        revision += 1;
        const sourceUrl = versionedMediaAssetUrl(
          convertFileSrc(metadata.canonical_path),
          metadata.modified_ms,
          revision,
        );
        setState({
          sourceUrl,
          sizeBytes: metadata.size_bytes,
          modifiedMs: metadata.modified_ms,
          loading: false,
          error: null,
        });
      } catch (reason) {
        if (cancelled || currentRequest !== requestId) return;
        // A later focus/event check must be able to recover even if the restored
        // file happens to have the same size and timestamp as the last success.
        signature = null;
        setState({
          sourceUrl: null,
          sizeBytes: null,
          modifiedMs: null,
          loading: false,
          error: reason instanceof Error ? reason.message : String(reason),
        });
      }
    };

    void refresh(false);
    void listen<string>("fs-change", (event) => {
      const changedPath = event.payload;
      void refresh(changedPath === filePath || changedPath === canonicalPath);
    }).then((stopListening) => {
      if (cancelled) stopListening();
      else unlisten = stopListening;
    }).catch(() => {
      // Focus refresh remains available if the watcher listener cannot attach.
    });

    const handleFocus = () => { void refresh(false); };
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      requestId += 1;
      unlisten?.();
      window.removeEventListener("focus", handleFocus);
    };
  }, [filePath]);

  return state;
}
