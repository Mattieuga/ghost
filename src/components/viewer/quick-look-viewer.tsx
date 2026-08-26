import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { OpenExternalButton } from "@/components/viewer/open-external-button";
import type { FileVersionToken } from "@/lib/source-document";

let nextQuickLookViewId = 0;

interface QuickLookViewerProps {
  filePath: string;
}

export function QuickLookViewer({ filePath }: QuickLookViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const activeViewIdRef = useRef<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const frame = useCallback(() => {
    const surface = surfaceRef.current;
    if (!surface) return null;
    const rect = surface.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  }, []);

  const action = useCallback((name: "focus" | "refresh") => {
    const viewId = activeViewIdRef.current;
    if (!viewId) return;
    void invoke("quick_look_view_action", { viewId, action: name }).catch((reason) => {
      console.error(`Quick Look ${name} failed`, reason);
    });
  }, []);

  const focusPreview = useCallback(() => {
    action("focus");
  }, [action]);

  // QLPreviewView creates its provider-specific content asynchronously. If
  // the viewer still owns focus, retry after loading so the document child —
  // rather than the outer Quick Look wrapper — receives selection and keys.
  useEffect(() => {
    if (!mounted) return;
    const timers = [100, 400, 900].map((delay) => window.setTimeout(() => {
      if (document.activeElement === rootRef.current) focusPreview();
    }, delay));
    return () => timers.forEach(window.clearTimeout);
  }, [mounted, focusPreview]);

  useEffect(() => {
    let cancelled = false;
    let nativeMounted = false;
    const surface = surfaceRef.current;
    if (!surface) return;

    const sequence = ++nextQuickLookViewId;
    const generation = Date.now() * 1000 + sequence;
    const viewId = `quick-look-${generation}`;
    activeViewIdRef.current = viewId;
    setMounted(false);
    setError(null);

    const mount = async () => {
      const bounds = frame();
      if (!bounds) return;
      try {
        await invoke("show_quick_look_view", {
          path: filePath,
          viewId,
          generation,
          ...bounds,
        });
        nativeMounted = true;
        if (cancelled) {
          await invoke("hide_quick_look_view", { viewId }).catch(() => undefined);
          return;
        }
        setMounted(true);
        updateFrame();
      } catch (reason) {
        if (!cancelled) {
          if (activeViewIdRef.current === viewId) activeViewIdRef.current = null;
          setError(String(reason));
        }
      }
    };
    void mount();

    let resizeFrame: number | null = null;
    const updateFrame = () => {
      if (!nativeMounted) return;
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        const bounds = frame();
        if (bounds) {
          void invoke("update_quick_look_view_frame", { viewId, ...bounds }).catch(() => undefined);
        }
      });
    };
    const observer = new ResizeObserver(updateFrame);
    observer.observe(surface);
    window.addEventListener("resize", updateFrame);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("resize", updateFrame);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      if (activeViewIdRef.current === viewId) activeViewIdRef.current = null;
      void invoke("hide_quick_look_view", { viewId }).catch(() => undefined);
    };
  }, [filePath, frame, revision]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let signature: string | null = null;

    const refresh = async () => {
      try {
        const version = await invoke<FileVersionToken>("get_file_version", { path: filePath });
        if (cancelled) return;
        const nextSignature = JSON.stringify(version);
        if (signature === null) {
          signature = nextSignature;
          if (activeViewIdRef.current === null) setRevision((value) => value + 1);
        } else if (signature !== nextSignature) {
          signature = nextSignature;
          if (activeViewIdRef.current) action("refresh");
          else setRevision((value) => value + 1);
        }
      } catch (reason) {
        if (cancelled || signature === null) return;
        signature = null;
        const viewId = activeViewIdRef.current;
        if (viewId) await invoke("hide_quick_look_view", { viewId }).catch(() => undefined);
        if (activeViewIdRef.current === viewId) activeViewIdRef.current = null;
        setMounted(false);
        setError(`Unable to refresh document preview: ${String(reason)}`);
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
    });
    const handleFocus = () => { void refresh(); };
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      unlisten?.();
      window.removeEventListener("focus", handleFocus);
    };
  }, [filePath, action]);

  return (
    <div
      ref={rootRef}
      className="flex h-full flex-col pt-12 outline-none"
      data-viewer-focus-target
      tabIndex={0}
      onFocus={(event) => {
        if (event.target === event.currentTarget) focusPreview();
      }}
    >
      <div className="relative min-h-0 flex-1">
        <div ref={surfaceRef} className="absolute inset-0" />
        {!mounted && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Loading Quick Look…
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-background px-8 text-center">
            <span className="max-w-md text-sm text-destructive">
              Unable to preview document: {error}
            </span>
            <OpenExternalButton filePath={filePath} />
          </div>
        )}
      </div>
    </div>
  );
}
