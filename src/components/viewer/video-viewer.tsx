import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { FileVideo } from "lucide-react";
import { useMediaAsset } from "@/hooks/use-media-asset";
import { useMediaPlayback } from "@/hooks/use-media-playback";
import { formatMediaDuration, formatMediaFileSize } from "@/lib/media";
import { MediaControls } from "@/components/viewer/media-controls";
import { OpenExternalButton } from "@/components/viewer/open-external-button";

interface VideoViewerProps {
  filePath: string;
  displayName?: string;
}

interface VideoDimensions {
  width: number;
  height: number;
}

const CONTROLS_HIDE_DELAY_MS = 2_000;

export function VideoViewer({ filePath, displayName }: VideoViewerProps) {
  const asset = useMediaAsset(filePath);
  const playerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const controlsHideTimerRef = useRef<number | null>(null);
  const fullscreenFocusFrameRef = useRef<number | null>(null);
  const wasFullscreenRef = useRef(false);
  const [dimensions, setDimensions] = useState<VideoDimensions | null>(null);
  const [showLoading, setShowLoading] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);

  const handleMetadata = useCallback((video: HTMLVideoElement) => {
    setDimensions(video.videoWidth > 0 && video.videoHeight > 0
      ? { width: video.videoWidth, height: video.videoHeight }
      : null);
  }, []);

  const playback = useMediaPlayback<HTMLVideoElement>({
    sourceUrl: asset.sourceUrl,
    kind: "video",
    onMetadata: handleMetadata,
  });

  const fileName = displayName ?? filePath.split("/").pop() ?? filePath;
  const extension = filePath.split(".").pop()?.toUpperCase() ?? "VIDEO";
  const displayError = asset.error || playback.error;

  const clearControlsHideTimer = useCallback(() => {
    if (controlsHideTimerRef.current === null) return;
    window.clearTimeout(controlsHideTimerRef.current);
    controlsHideTimerRef.current = null;
  }, []);

  const showControlsUntilIdle = useCallback(() => {
    clearControlsHideTimer();
    setControlsVisible(true);
    controlsHideTimerRef.current = window.setTimeout(() => {
      controlsHideTimerRef.current = null;
      setControlsVisible(false);
    }, CONTROLS_HIDE_DELAY_MS);
  }, [clearControlsHideTimer]);

  const hideControls = useCallback(() => {
    clearControlsHideTimer();
    setControlsVisible(false);
  }, [clearControlsHideTimer]);

  useEffect(() => {
    setDimensions(null);
  }, [asset.sourceUrl]);

  useEffect(() => {
    if (!asset.sourceUrl || displayError) {
      clearControlsHideTimer();
      setControlsVisible(true);
      return;
    }

    showControlsUntilIdle();
    return clearControlsHideTimer;
  }, [asset.sourceUrl, clearControlsHideTimer, displayError, showControlsUntilIdle]);

  useEffect(() => {
    setShowLoading(false);
    if (!asset.loading) return;

    const timer = window.setTimeout(() => setShowLoading(true), 100);
    return () => window.clearTimeout(timer);
  }, [asset.loading, filePath]);

  useEffect(() => {
    const stage = stageRef.current;
    setFullscreenSupported(Boolean(document.fullscreenEnabled && stage?.requestFullscreen));

    const handleFullscreenChange = () => {
      const nextIsFullscreen = document.fullscreenElement === stageRef.current;
      const didExitFullscreen = wasFullscreenRef.current && !nextIsFullscreen;
      wasFullscreenRef.current = nextIsFullscreen;
      setIsFullscreen(nextIsFullscreen);
      showControlsUntilIdle();

      if (didExitFullscreen) {
        if (fullscreenFocusFrameRef.current !== null) {
          window.cancelAnimationFrame(fullscreenFocusFrameRef.current);
        }
        fullscreenFocusFrameRef.current = window.requestAnimationFrame(() => {
          fullscreenFocusFrameRef.current = null;
          playerRef.current?.focus({ preventScroll: true });
        });
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      if (fullscreenFocusFrameRef.current !== null) {
        window.cancelAnimationFrame(fullscreenFocusFrameRef.current);
        fullscreenFocusFrameRef.current = null;
      }
    };
  }, [showControlsUntilIdle]);

  const toggleFullscreen = useCallback(async () => {
    const stage = stageRef.current;
    if (!stage || !fullscreenSupported) return;

    try {
      if (document.fullscreenElement === stage) await document.exitFullscreen();
      else await stage.requestFullscreen();
    } catch {
      // Never leave an inert control visible after the platform rejects it.
      setFullscreenSupported(false);
    }
  }, [fullscreenSupported]);

  const handleKeyboardPlayback = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    showControlsUntilIdle();
    if (event.target !== event.currentTarget) return;
    const key = event.key.toLowerCase();

    if (event.key === " ") {
      event.preventDefault();
      playback.togglePlayback();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      playback.seekBy(event.key === "ArrowLeft" ? -5 : 5);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      playback.setVolume(playback.volume + (event.key === "ArrowUp" ? 0.05 : -0.05));
    } else if (key === "m") {
      event.preventDefault();
      playback.toggleMuted();
    } else if (key === "f" && fullscreenSupported) {
      event.preventDefault();
      void toggleFullscreen();
    }
  }, [fullscreenSupported, playback, showControlsUntilIdle, toggleFullscreen]);

  const focusPlayerFromSurface = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element) {
      const interactiveTarget = target.closest<HTMLElement>(
        "button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      if (interactiveTarget && interactiveTarget !== playerRef.current) return;
    }
    playerRef.current?.focus({ preventScroll: true });
  }, []);

  const handleStageDoubleClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!fullscreenSupported) return;
    const target = event.target;
    if (
      target instanceof Element
      && target.closest("button, a, input, select, textarea, [role='menuitemradio']")
    ) return;
    void toggleFullscreen();
  }, [fullscreenSupported, toggleFullscreen]);

  return (
    <div
      data-video-surface
      className="flex h-full min-h-0 flex-col pt-12"
      onMouseDown={focusPlayerFromSurface}
    >
      <div className="flex min-h-0 flex-1 justify-center p-6">
        <div
          ref={playerRef}
          data-viewer-focus-target
          role="group"
          aria-label={`Video player for ${fileName}`}
          tabIndex={0}
          onKeyDown={handleKeyboardPlayback}
          className="flex min-h-0 w-full max-w-5xl flex-col outline-none"
        >
          <div className="mb-3 flex min-w-0 items-center gap-3 px-1">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card/50 text-ghost-amber">
              <FileVideo className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{fileName}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ring">
                {extension} video
              </div>
            </div>
          </div>

          <div
            ref={stageRef}
            data-video-stage
            className="ghost-video-stage relative flex min-h-44 flex-1 items-center justify-center overflow-hidden rounded-xl border border-border bg-black shadow-2xl shadow-black/30"
            onDoubleClick={handleStageDoubleClick}
            onMouseEnter={showControlsUntilIdle}
            onMouseMove={showControlsUntilIdle}
            onMouseLeave={hideControls}
            onFocusCapture={showControlsUntilIdle}
          >
            {asset.sourceUrl && (
              <video
                ref={playback.mediaRef}
                preload="metadata"
                playsInline
                className="block size-full object-contain"
                {...playback.mediaEventHandlers}
              />
            )}

            {asset.loading && showLoading && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/55">
                Loading video…
              </div>
            )}

            {asset.sourceUrl && !displayError && (
              <div
                data-video-controls
                data-controls-visible={controlsVisible}
                className="ghost-video-controls absolute inset-x-3 bottom-3 z-10"
              >
                <MediaControls
                  label={`Playback controls for ${fileName}`}
                  duration={playback.duration}
                  currentTime={playback.currentTime}
                  isPlaying={playback.isPlaying}
                  volume={playback.volume}
                  muted={playback.muted}
                  playbackRate={playback.playbackRate}
                  onTogglePlayback={playback.togglePlayback}
                  onSeekTo={playback.seekTo}
                  onSeekBy={playback.seekBy}
                  onToggleMuted={playback.toggleMuted}
                  onVolumeChange={playback.setVolume}
                  onPlaybackRateChange={playback.setPlaybackRate}
                  onToggleFullscreen={fullscreenSupported ? () => { void toggleFullscreen(); } : undefined}
                  isFullscreen={isFullscreen}
                  className="bg-card/90 backdrop-blur-md"
                />
              </div>
            )}

            {displayError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/85 p-8 text-center">
                <p className="max-w-md text-sm text-white/75">{displayError}</p>
                <OpenExternalButton filePath={filePath} />
              </div>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-1 text-[11px] text-ring">
            <div className="flex items-center gap-4">
              <span>{dimensions ? `${dimensions.width}×${dimensions.height}` : "Dimensions unavailable"}</span>
              <span>{playback.duration === null ? "Duration unavailable" : formatMediaDuration(playback.duration)}</span>
            </div>
            {asset.sizeBytes !== null && <span>{formatMediaFileSize(asset.sizeBytes)}</span>}
          </div>
          <div className="mt-2 text-center text-[10px] text-muted-foreground/55">
            Space play/pause · ←/→ seek · ↑/↓ volume · M mute{fullscreenSupported ? " · F fullscreen" : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
