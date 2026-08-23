import type { CSSProperties } from "react";
import {
  Check,
  Maximize2,
  Minimize2,
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
import { formatMediaDuration } from "@/lib/media";
import { PlaybackSpeedGauge } from "@/components/viewer/playback-speed-gauge";

interface MediaControlsProps {
  label: string;
  duration: number | null;
  currentTime: number;
  isPlaying: boolean;
  volume: number;
  muted: boolean;
  playbackRate: number;
  onTogglePlayback: () => void;
  onSeekTo: (time: number) => void;
  onSeekBy: (offset: number) => void;
  onToggleMuted: () => void;
  onVolumeChange: (volume: number) => void;
  onPlaybackRateChange: (rate: number) => void;
  onToggleFullscreen?: () => void;
  isFullscreen?: boolean;
  className?: string;
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

export function MediaControls({
  label,
  duration,
  currentTime,
  isPlaying,
  volume,
  muted,
  playbackRate,
  onTogglePlayback,
  onSeekTo,
  onSeekBy,
  onToggleMuted,
  onVolumeChange,
  onPlaybackRateChange,
  onToggleFullscreen,
  isFullscreen = false,
  className = "",
}: MediaControlsProps) {
  const seekProgress = duration && duration > 0
    ? Math.min(100, (currentTime / duration) * 100)
    : 0;
  const volumeProgress = muted ? 0 : volume * 100;
  const effectivelyMuted = muted || volume === 0;
  const rangeStyle = (progress: number) => ({
    "--ghost-range-progress": `${progress}%`,
  }) as CSSProperties;

  return (
    <div className={`ghost-media-control-shell ${className}`.trim()}>
      <div role="group" aria-label={label} className="ghost-media-controls">
        <button
          type="button"
          aria-label="Back 15 seconds"
          title="Back 15 seconds"
          className={`${CONTROL_BUTTON_CLASS} ghost-media-skip`}
          onClick={() => onSeekBy(-15)}
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
          onClick={onTogglePlayback}
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
          className={`${CONTROL_BUTTON_CLASS} ghost-media-skip`}
          onClick={() => onSeekBy(15)}
        >
          <span className="relative flex size-5 items-center justify-center">
            <RotateCw className="size-[18px]" aria-hidden="true" />
            <span className="absolute pt-px text-[6px] font-bold" aria-hidden="true">15</span>
          </span>
        </button>

        <span className="ghost-media-current-time w-12 shrink-0 text-right text-[11px] tabular-nums text-foreground">
          {formatMediaDuration(currentTime)}
        </span>
        <input
          type="range"
          min={0}
          max={duration ?? 0}
          step="any"
          value={duration === null ? 0 : Math.min(currentTime, duration)}
          disabled={duration === null || duration <= 0}
          aria-label="Seek media"
          aria-valuetext={`${formatMediaDuration(currentTime)} of ${duration === null ? "unknown" : formatMediaDuration(duration)}`}
          className="ghost-media-range min-w-12 flex-1"
          style={rangeStyle(seekProgress)}
          onChange={(event) => onSeekTo(Number(event.currentTarget.value))}
        />
        <span className="w-12 shrink-0 text-[11px] tabular-nums text-foreground">
          {duration === null ? "--:--" : formatMediaDuration(duration)}
        </span>

        <button
          type="button"
          aria-label={effectivelyMuted ? "Unmute" : "Mute"}
          title={effectivelyMuted ? "Unmute" : "Mute"}
          className={CONTROL_BUTTON_CLASS}
          onClick={onToggleMuted}
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
          className="ghost-media-range ghost-media-volume-range w-14 shrink-0"
          style={rangeStyle(volumeProgress)}
          onChange={(event) => onVolumeChange(Number(event.currentTarget.value))}
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
                onValueChange={(value) => onPlaybackRateChange(Number(value))}
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

        {onToggleFullscreen && (
          <button
            type="button"
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            className={CONTROL_BUTTON_CLASS}
            onClick={onToggleFullscreen}
          >
            {isFullscreen ? (
              <Minimize2 className="size-[18px]" aria-hidden="true" />
            ) : (
              <Maximize2 className="size-[18px]" aria-hidden="true" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
