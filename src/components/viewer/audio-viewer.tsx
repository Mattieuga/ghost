import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { FileAudio } from "lucide-react";
import { useMediaAsset } from "@/hooks/use-media-asset";
import { useMediaPlayback } from "@/hooks/use-media-playback";
import { formatMediaDuration, formatMediaFileSize } from "@/lib/media";
import { MediaControls } from "@/components/viewer/media-controls";
import { OpenExternalButton } from "@/components/viewer/open-external-button";

interface AudioViewerProps {
  filePath: string;
  displayName?: string;
}

export function AudioViewer({ filePath, displayName }: AudioViewerProps) {
  const asset = useMediaAsset(filePath);
  const playback = useMediaPlayback<HTMLAudioElement>({
    sourceUrl: asset.sourceUrl,
    kind: "audio",
  });
  const playerRef = useRef<HTMLDivElement>(null);
  const [showLoading, setShowLoading] = useState(false);

  const fileName = displayName ?? filePath.split("/").pop() ?? filePath;
  const extension = filePath.split(".").pop()?.toUpperCase() ?? "AUDIO";

  useEffect(() => {
    setShowLoading(false);
    if (!asset.loading) return;

    const timer = window.setTimeout(() => setShowLoading(true), 100);
    return () => window.clearTimeout(timer);
  }, [asset.loading, filePath]);

  const handleKeyboardPlayback = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    // Shortcuts apply only when the viewer card itself has focus, so the rest
    // of Ghost and each individual control retain their own key handling.
    if (event.target !== event.currentTarget) return;

    if (event.key === " ") {
      event.preventDefault();
      playback.togglePlayback();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      playback.seekBy(event.key === "ArrowLeft" ? -5 : 5);
    }
  }, [playback]);

  const displayError = asset.error || playback.error;

  const focusPlayerFromSurface = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (target instanceof Element) {
      const interactiveTarget = target.closest<HTMLElement>(
        "audio, button, a, input, select, textarea, [tabindex]:not([tabindex='-1'])",
      );
      if (interactiveTarget && interactiveTarget !== playerRef.current) return;
    }
    playerRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <div
      data-audio-surface
      className="flex h-full flex-col pt-12"
      onMouseDown={focusPlayerFromSurface}
    >
      <div className="flex flex-1 items-center justify-center p-8">
        <div
          ref={playerRef}
          data-viewer-focus-target
          role="group"
          aria-label={`Audio player for ${fileName}`}
          tabIndex={0}
          onKeyDown={handleKeyboardPlayback}
          className="w-full max-w-xl rounded-xl border border-border bg-card/30 p-7 outline-none transition-colors focus-visible:border-ring"
        >
          <div className="mb-7 flex items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-border bg-background/60 text-ghost-amber">
              <FileAudio className="size-6" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-base font-medium text-foreground">{fileName}</div>
              <div className="mt-1 text-[11px] uppercase tracking-wider text-ring">
                {extension} audio
              </div>
            </div>
          </div>

          <div data-audio-body className="flex min-h-36 flex-col justify-center">
            {asset.sourceUrl && (
              <audio
                ref={playback.mediaRef}
                preload="metadata"
                className="hidden"
                {...playback.mediaEventHandlers}
              />
            )}

            {asset.loading ? (
              showLoading ? (
                <div className="text-center text-sm text-muted-foreground">Loading audio…</div>
              ) : null
            ) : asset.sourceUrl && !displayError ? (
              <>
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
                />

                <div className="mt-4 flex items-center justify-between gap-4 text-[11px] text-ring">
                  <span>{playback.duration === null ? "Duration unavailable" : formatMediaDuration(playback.duration)}</span>
                  {asset.sizeBytes !== null && <span>{formatMediaFileSize(asset.sizeBytes)}</span>}
                </div>
                <div className="mt-5 text-center text-[11px] text-muted-foreground/60">
                  Space to play or pause · ←/→ to seek 5 seconds
                </div>
              </>
            ) : null}

            {displayError && (
              <div className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center">
                <p className="text-sm text-destructive">{displayError}</p>
                <OpenExternalButton filePath={filePath} />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
