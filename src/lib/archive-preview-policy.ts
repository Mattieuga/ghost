export const ARCHIVE_MEDIA_PREVIEW_MAX_BYTES = 256 * 1024 * 1024;

/**
 * Filename extensions can be wrong, so only the absolute ceiling is safe to
 * enforce before native code has sniffed a bounded prefix of the entry.
 */
export function archivePreviewLimitForPath(_path: string): number {
  return ARCHIVE_MEDIA_PREVIEW_MAX_BYTES;
}

export function archivePreviewTooLargeMessage(limit: number): string {
  return `This entry is too large to preview safely (limit: ${limit / (1024 * 1024)} MiB). Extract the archive to open it.`;
}
