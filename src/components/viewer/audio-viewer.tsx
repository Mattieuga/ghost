import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import {
  Check,
  FileAudio,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { useMediaAsset } from "@/hooks/use-media-asset";
import {
  formatMediaDuration,
  formatMediaFileSize,
  mediaPlaybackError,
} from "@/lib/media";
import { OpenExternalButton } from "@/components/viewer/open-external-button";
import { PlaybackSpeedGauge } from "@/components/viewer/playback-speed-gauge";

interface AudioViewerProps {
  filePath: string;
}

const PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2] as const;
const CONTROL_BUTTON_CLASS = "flex size-7 shrink-0 items-center justify-center rounded-full text-foreground outline-none transition-colors hover:bg-white/[0.08] focus-visible:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-ring";

function formatPlaybackRate(rate: number): string {
  return `${rate}×`;
}

function VolumeLevelIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) {
    return <VolumeX data-volume-level="muted" className="size-[18px]" aria-hidden="true" />;
  }
  if (volume < 0.34) {
    return <Volume data-volume-level="low" className="size-[18px]" aria-hidden="true" />;
  }
  if (volume < 0.67) {
    return <Volume1 data-volume-level="medium" className="size-[18px]" aria-hidden="true" />;
  }
  return <Volume2 data-volume-level="high" className="size-[18px]" aria-hidden="true" />;
}

export function AudioViewer({ filePath }: AudioViewerProps) {
  const asset = useMediaAsset(filePath);
  const playerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const releasingRef = useRef(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [showLoading, setShowLoading] = useState(false);

  const fileName = filePath.split("/").pop() ?? filePath;
  const extension = fileName.split(".").pop()?.toUpperCase() ?? "AUDIO";

  useEffect(() => {
    const audio = audioRef.current;
    setDuration(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setPlaybackError(null);
    if (!audio || !asset.sourceUrl) return;

    releasingRef.current = false;
    audio.src = asset.sourceUrl;
    audio.load();

    return () => {
      releasingRef.current = true;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [asset.sourceUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    setShowLoading(false);
    if (!asset.loading) return;

    const timer = window.setTimeout(() => setShowLoading(true), 100);
    return () => window.clearTimeout(timer);
  }, [asset.loading, filePath]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !asset.sourceUrl) return;

    if (audio.paused) {
      void audio.play().catch(() => {
        setPlaybackError("Audio playback could not start.");
      });
    } else {
      audio.pause();
    }
  }, [asset.sourceUrl]);

  const seekBy = useCallback((offset: number) => {
    const audio = audioRef.current;
    if (!audio || !asset.sourceUrl) return;

    const upperBound = Number.isFinite(audio.duration)
      ? audio.duration
      : Number.MAX_SAFE_INTEGER;
    const nextTime = Math.min(upperBound, Math.max(0, audio.currentTime + offset));
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, [asset.sourceUrl]);

  const handleKeyboardPlayback = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    // These shortcuts apply only when the viewer card itself has focus, so the
    // rest of Ghost and each individual control retain their own key handling.
    if (event.target !== event.currentTarget) return;

    if (event.key === " ") {
      event.preventDefault();
      togglePlayback();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      seekBy(event.key === "ArrowLeft" ? -5 : 5);
    }
  }, [seekBy, togglePlayback]);

  const handleMediaError = useCallback(() => {
    if (releasingRef.current) return;
    setPlaybackError(mediaPlaybackError(audioRef.current?.error?.code));
  }, []);

  const displayError = asset.error || playbackError;
  const seekProgress = duration && duration > 0
    ? Math.min(100, (currentTime / duration) * 100)
    : 0;
  const volumeProgress = muted ? 0 : volume * 100;
  const rangeStyle = (progress: number) => ({
    "--ghost-range-progress": `${progress}%`,
  }) as CSSProperties;

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
            {asset.loading ? (
              showLoading ? (
                <div className="text-center text-sm text-muted-foreground">Loading audio…</div>
              ) : null
            ) : asset.sourceUrl ? (
              <>
                <div className="ghost-audio-control-shell">
                  <audio
                    ref={audioRef}
                    preload="metadata"
                    className="hidden"
                    onLoadedMetadata={(event) => {
                      const nextDuration = event.currentTarget.duration;
                      setDuration(Number.isFinite(nextDuration) ? nextDuration : null);
                      setCurrentTime(event.currentTarget.currentTime);
                      setPlaybackError(null);
                    }}
                    onDurationChange={(event) => {
                      const nextDuration = event.currentTarget.duration;
                      if (Number.isFinite(nextDuration)) setDuration(nextDuration);
                    }}
                    onRateChange={(event) => {
                      setPlaybackRate(event.currentTarget.playbackRate);
                    }}
                    onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    onVolumeChange={(event) => {
                      setVolume(event.currentTarget.volume);
                      setMuted(event.currentTarget.muted);
                    }}
                    onError={handleMediaError}
                  />

                  <div
                    role="group"
                    aria-label={`Playback controls for ${fileName}`}
                    className="ghost-audio-controls"
                  >
                    <button
                      type="button"
                      aria-label="Back 15 seconds"
                      title="Back 15 seconds"
                      className={`${CONTROL_BUTTON_CLASS} ghost-audio-skip`}
                      onClick={() => seekBy(-15)}
                    >
                      <span className="relative flex size-5 items-center justify-center">
                        <RotateCcw className="size-[18px]" aria-hidden="true" />
                        <span className="absolute pt-px text-[6px] font-bold" aria-hidden="true">15</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      aria-label={isPlaying ? "Pause" : "Play"}
                      title={isPlaying ? "Pause" : "Play"}
                      className={CONTROL_BUTTON_CLASS}
                      onClick={togglePlayback}
                    >
                      {isPlaying ? (
                        <Pause className="size-[18px] fill-current" aria-hidden="true" />
                      ) : (
                        <Play className="size-[18px] fill-current" aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      aria-label="Forward 15 seconds"
                      title="Forward 15 seconds"
                      className={`${CONTROL_BUTTON_CLASS} ghost-audio-skip`}
                      onClick={() => seekBy(15)}
                    >
                      <span className="relative flex size-5 items-center justify-center">
                        <RotateCw className="size-[18px]" aria-hidden="true" />
                        <span className="absolute pt-px text-[6px] font-bold" aria-hidden="true">15</span>
                      </span>
                    </button>

                    <span className="ghost-audio-current-time w-12 shrink-0 text-right text-[11px] tabular-nums text-foreground">
                      {formatMediaDuration(currentTime)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={duration ?? 0}
                      step="any"
                      value={duration === null ? 0 : Math.min(currentTime, duration)}
                      disabled={duration === null || duration <= 0}
                      aria-label="Seek audio"
                      aria-valuetext={`${formatMediaDuration(currentTime)} of ${duration === null ? "unknown" : formatMediaDuration(duration)}`}
                      className="ghost-audio-range min-w-12 flex-1"
                      style={rangeStyle(seekProgress)}
                      onChange={(event) => {
                        const nextTime = Number(event.currentTarget.value);
                        if (audioRef.current) audioRef.current.currentTime = nextTime;
                        setCurrentTime(nextTime);
                      }}
                    />
                    <span className="w-12 shrink-0 text-[11px] tabular-nums text-foreground">
                      {duration === null ? "--:--" : formatMediaDuration(duration)}
                    </span>

                    <button
                      type="button"
                      aria-label={muted ? "Unmute" : "Mute"}
                      title={muted ? "Unmute" : "Mute"}
                      className={CONTROL_BUTTON_CLASS}
                      onClick={() => {
                        const audio = audioRef.current;
                        if (!audio) return;
                        const nextMuted = !audio.muted;
                        audio.muted = nextMuted;
                        setMuted(nextMuted);
                      }}
                    >
                      <VolumeLevelIcon volume={volume} muted={muted} />
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={muted ? 0 : volume}
                      aria-label="Volume"
                      aria-valuetext={`${Math.round(volumeProgress)} percent`}
                      className="ghost-audio-range ghost-audio-volume-range w-14 shrink-0"
                      style={rangeStyle(volumeProgress)}
                      onChange={(event) => {
                        const nextVolume = Number(event.currentTarget.value);
                        const audio = audioRef.current;
                        if (audio) {
                          audio.volume = nextVolume;
                          audio.muted = false;
                        }
                        setVolume(nextVolume);
                        setMuted(false);
                      }}
                    />

                    <DropdownMenuPrimitive.Root>
                      <DropdownMenuPrimitive.Trigger asChild>
                      <button
                        type="button"
                        aria-label={`Playback speed, ${formatPlaybackRate(playbackRate)}`}
                        title={`Playback speed: ${formatPlaybackRate(playbackRate)}`}
                        className={CONTROL_BUTTON_CLASS}
                      >
                        <PlaybackSpeedGauge rate={playbackRate} className="block size-[18px]" />
                      </button>
                      </DropdownMenuPrimitive.Trigger>
                      <DropdownMenuPrimitive.Portal>
                        <DropdownMenuPrimitive.Content
                          side="top"
                          align="end"
                          sideOffset={8}
                          collisionPadding={12}
                          className="z-50 min-w-36 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl shadow-black/40"
                        >
                          <DropdownMenuPrimitive.Label className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                            Playback speed
                          </DropdownMenuPrimitive.Label>
                          <DropdownMenuPrimitive.RadioGroup
                            value={String(playbackRate)}
                            onValueChange={(value) => setPlaybackRate(Number(value))}
                          >
                            {PLAYBACK_RATES.map((rate) => (
                              <DropdownMenuPrimitive.RadioItem
                                key={rate}
                                value={String(rate)}
                                className="relative flex cursor-pointer select-none items-center rounded-md py-1.5 pr-8 pl-2 text-sm outline-none focus:bg-white/[0.08]"
                              >
                                {formatPlaybackRate(rate)}
                                <DropdownMenuPrimitive.ItemIndicator className="absolute right-2 inline-flex items-center justify-center">
                                  <Check className="size-4 text-ghost-amber" aria-hidden="true" />
                                </DropdownMenuPrimitive.ItemIndicator>
                              </DropdownMenuPrimitive.RadioItem>
                            ))}
                          </DropdownMenuPrimitive.RadioGroup>
                        </DropdownMenuPrimitive.Content>
                      </DropdownMenuPrimitive.Portal>
                    </DropdownMenuPrimitive.Root>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-4 text-[11px] text-ring">
                  <span>{duration === null ? "Duration unavailable" : formatMediaDuration(duration)}</span>
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
