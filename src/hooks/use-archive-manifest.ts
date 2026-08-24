import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ArchiveManifest } from "@/lib/archive";

interface FileMetadata {
  size_bytes: number;
  modified_ms: number;
}

interface ArchiveManifestState {
  manifest: ArchiveManifest | null;
  loading: boolean;
  error: string | null;
}

const INITIAL_STATE: ArchiveManifestState = {
  manifest: null,
  loading: true,
  error: null,
};

function signature(metadata: FileMetadata): string {
  return `${metadata.size_bytes}:${metadata.modified_ms}`;
}

function manifestSignature(manifest: ArchiveManifest): string {
  return `${manifest.archive_size_bytes}:${manifest.modified_ms}`;
}

export function useArchiveManifest(filePath: string): ArchiveManifestState {
  const [state, setState] = useState<ArchiveManifestState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let requestId = 0;
    let currentSignature: string | null = null;

    setState(INITIAL_STATE);

    const refresh = async () => {
      const currentRequest = ++requestId;
      try {
        const manifest = await invoke<ArchiveManifest>("list_archive", { path: filePath });
        if (cancelled || currentRequest !== requestId) return;
        currentSignature = manifestSignature(manifest);
        setState({ manifest, loading: false, error: null });
      } catch (reason) {
        if (cancelled || currentRequest !== requestId) return;
        currentSignature = null;
        setState({
          manifest: null,
          loading: false,
          error: reason instanceof Error ? reason.message : String(reason),
        });
      }
    };
    void refresh();
    void listen<string>("fs-change", (event) => {
      const changedPath = event.payload;
      if (changedPath !== filePath && !filePath.startsWith(`${changedPath}/`)) return;
      void refresh();
    }).then((stopListening) => {
      if (cancelled) stopListening();
      else unlisten = stopListening;
    }).catch(() => {
      // The focus metadata check remains available if the watcher cannot attach.
    });

    const handleFocus = () => {
      void invoke<FileMetadata>("get_file_metadata", { path: filePath })
        .then((metadata) => {
          if (!cancelled && signature(metadata) !== currentSignature) void refresh();
        })
        .catch(() => {
          if (!cancelled) void refresh();
        });
    };
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
