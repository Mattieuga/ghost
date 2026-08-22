export function formatMediaFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatMediaDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const remainingSeconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

export function versionedMediaAssetUrl(
  assetUrl: string,
  modifiedMs: number,
  revision: number,
): string {
  const separator = assetUrl.includes("?") ? "&" : "?";
  return `${assetUrl}${separator}ghost-media=${modifiedMs}-${revision}`;
}

export function mediaPlaybackError(code: number | undefined): string {
  switch (code) {
    case 1:
      return "Audio playback was interrupted.";
    case 2:
      return "The audio file could not be read.";
    case 3:
      return "WebKit could not decode this audio file.";
    case 4:
      return "This audio format or codec is not supported by WebKit.";
    default:
      return "The audio file could not be played.";
  }
}
