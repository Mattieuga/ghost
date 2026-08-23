import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { mediaPlaybackError, type MediaKind } from "@/lib/media";

interface UseMediaPlaybackOptions<T extends HTMLMediaElement> {
  sourceUrl: string | null;
  kind: MediaKind;
  onMetadata?: (media: T) => void;
}

export function useMediaPlayback<T extends HTMLMediaElement>({
  sourceUrl,
  kind,
  onMetadata,
}: UseMediaPlaybackOptions<T>) {
  const mediaRef = useRef<T>(null);
  const releasingRef = useRef(false);
  const sourceUrlRef = useRef(sourceUrl);
  const playAttemptRef = useRef(0);
  const lastAudibleVolumeRef = useRef(1);
  sourceUrlRef.current = sourceUrl;
  const [duration, setDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const media = mediaRef.current;
    playAttemptRef.current += 1;
    setDuration(null);
    setCurrentTime(0);
    setIsPlaying(false);
    setError(null);
    if (!media || !sourceUrl) return;

    releasingRef.current = false;
    media.src = sourceUrl;
    media.load();

    return () => {
      releasingRef.current = true;
      playAttemptRef.current += 1;
      media.pause();
      media.removeAttribute("src");
      media.load();
    };
  }, [sourceUrl]);

  useEffect(() => {
    if (mediaRef.current) mediaRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  const togglePlayback = useCallback(() => {
    const media = mediaRef.current;
    if (!media || !sourceUrl) return;

    if (media.paused) {
      const attemptedSource = sourceUrl;
      const attempt = ++playAttemptRef.current;
      void media.play().catch((reason: unknown) => {
        const isAbort = (
          typeof reason === "object"
          && reason !== null
          && "name" in reason
          && reason.name === "AbortError"
        );
        if (
          isAbort
          || attempt !== playAttemptRef.current
          || mediaRef.current !== media
          || sourceUrlRef.current !== attemptedSource
        ) return;
        setError(`${kind === "video" ? "Video" : "Audio"} playback could not start.`);
      });
    } else {
      playAttemptRef.current += 1;
      media.pause();
    }
  }, [kind, sourceUrl]);

  const seekTo = useCallback((time: number) => {
    const media = mediaRef.current;
    if (!media || !sourceUrl) return;

    const upperBound = Number.isFinite(media.duration)
      ? media.duration
      : Number.MAX_SAFE_INTEGER;
    const nextTime = Math.min(upperBound, Math.max(0, time));
    media.currentTime = nextTime;
    setCurrentTime(nextTime);
  }, [sourceUrl]);

  const seekBy = useCallback((offset: number) => {
    seekTo((mediaRef.current?.currentTime ?? 0) + offset);
  }, [seekTo]);

  const toggleMuted = useCallback(() => {
    const media = mediaRef.current;
    if (!media) return;

    if (media.muted || media.volume === 0) {
      if (media.volume === 0) {
        media.volume = lastAudibleVolumeRef.current;
        setVolumeState(lastAudibleVolumeRef.current);
      }
      media.muted = false;
      setMuted(false);
      return;
    }

    media.muted = true;
    setMuted(true);
  }, []);

  const setVolume = useCallback((nextVolume: number) => {
    const normalizedVolume = Math.min(1, Math.max(0, nextVolume));
    if (normalizedVolume > 0) lastAudibleVolumeRef.current = normalizedVolume;
    const media = mediaRef.current;
    if (media) {
      media.volume = normalizedVolume;
      media.muted = false;
    }
    setVolumeState(normalizedVolume);
    setMuted(false);
  }, []);

  const handleLoadedMetadata = useCallback((event: SyntheticEvent<T>) => {
    const media = event.currentTarget;
    setDuration(Number.isFinite(media.duration) ? media.duration : null);
    setCurrentTime(media.currentTime);
    setError(null);
    onMetadata?.(media);
  }, [onMetadata]);

  const handleDurationChange = useCallback((event: SyntheticEvent<T>) => {
    const nextDuration = event.currentTarget.duration;
    setDuration(Number.isFinite(nextDuration) ? nextDuration : null);
  }, []);

  const handleError = useCallback(() => {
    if (releasingRef.current) return;
    setError(mediaPlaybackError(mediaRef.current?.error?.code, kind));
  }, [kind]);

  return {
    mediaRef,
    duration,
    currentTime,
    isPlaying,
    volume,
    muted,
    playbackRate,
    error,
    togglePlayback,
    seekTo,
    seekBy,
    toggleMuted,
    setVolume,
    setPlaybackRate,
    mediaEventHandlers: {
      onLoadedMetadata: handleLoadedMetadata,
      onDurationChange: handleDurationChange,
      onRateChange: (event: SyntheticEvent<T>) => {
        setPlaybackRate(event.currentTarget.playbackRate);
      },
      onTimeUpdate: (event: SyntheticEvent<T>) => {
        setCurrentTime(event.currentTarget.currentTime);
      },
      onPlay: () => setIsPlaying(true),
      onPause: () => setIsPlaying(false),
      onEnded: () => setIsPlaying(false),
      onVolumeChange: (event: SyntheticEvent<T>) => {
        const nextVolume = event.currentTarget.volume;
        if (nextVolume > 0) lastAudibleVolumeRef.current = nextVolume;
        setVolumeState(nextVolume);
        setMuted(event.currentTarget.muted);
      },
      onError: handleError,
    },
  };
}
