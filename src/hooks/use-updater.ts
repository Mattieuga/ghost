import { useState, useEffect, useCallback, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";

export type UpdateState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "error"
  | "up-to-date";

interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

export interface UpdateInfo {
  state: UpdateState;
  version: string | null;
  progress: DownloadProgress;
  error: string | null;
  dismissed: boolean;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  dismissUpdate: () => void;
}

interface SaveFlushResult {
  requestId: string;
  label: string;
  ok: boolean;
  error?: string;
}

async function flushAccessoryWindows(): Promise<void> {
  const labels = await invoke<string[]>("list_editor_windows");
  if (labels.length === 0) return;

  const requestId = `update-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const waitingFor = new Set(labels);
  const failures: string[] = [];
  let complete!: () => void;
  const completed = new Promise<void>((resolve) => { complete = resolve; });
  const unlisten = await listen<SaveFlushResult>("save-flush-result", (event) => {
    const result = event.payload;
    if (result.requestId !== requestId || !waitingFor.delete(result.label)) return;
    if (!result.ok) failures.push(`${result.label}: ${result.error ?? "save failed"}`);
    if (waitingFor.size === 0) complete();
  });

  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.all(labels.map((label) => emitTo(label, "request-save-flush", requestId)));
    await Promise.race([
      completed,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Timed out waiting for another Ghost window to save")),
          10_000,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    unlisten();
  }

  if (failures.length > 0) {
    throw new Error(`Update paused because a document could not be saved (${failures.join("; ")})`);
  }
}

export function useUpdater(): UpdateInfo {
  const [state, setState] = useState<UpdateState>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({ downloaded: 0, total: null });
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const updateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null);

  const checkForUpdate = useCallback(async () => {
    setState("checking");
    setError(null);
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setVersion(update.version);
        setState("available");
      } else {
        setState("up-to-date");
      }
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Update check failed");
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;

    setState("downloading");
    setProgress({ downloaded: 0, total: null });

    try {
      await window.__ghostFlushSave?.();
      await flushAccessoryWindows();

      let downloaded = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setProgress({ downloaded: 0, total: event.data.contentLength ?? null });
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          setProgress((prev) => ({ ...prev, downloaded }));
        } else if (event.event === "Finished") {
          setState("installing");
        }
      });

      await relaunch();
    } catch (err) {
      setState("error");
      setError(err instanceof Error ? err.message : "Update failed");
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setDismissed(true);
  }, []);

  // Auto-check on mount with 5-second delay, then every 24 hours
  useEffect(() => {
    const silentCheck = () => {
      checkForUpdate().catch(() => setState("idle"));
    };
    const initial = setTimeout(silentCheck, 5000);
    const daily = setInterval(silentCheck, 24 * 60 * 60 * 1000);
    return () => { clearTimeout(initial); clearInterval(daily); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    state,
    version,
    progress,
    error,
    dismissed,
    checkForUpdate,
    installUpdate,
    dismissUpdate,
  };
}
