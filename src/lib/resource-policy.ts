import type { FileDescriptor } from "@/lib/file-type";
import type { FileVersionToken } from "@/lib/source-document";

export const NORMAL_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const NORMAL_SOURCE_MAX_LINES = 300_000;
export const NORMAL_SOURCE_MAX_LINE_BYTES = 200 * 1024;
// Validated with a 100 MiB manual open/edit/save pass after the statistics-
// flattening and development HMR reload defects were isolated from CodeMirror
// itself. Keep reduced features mandatory throughout this range.
export const EXTREME_SOURCE_MAX_BYTES = 128 * 1024 * 1024;
export const EXTREME_SOURCE_MAX_LINES = 5_000_000;
export const EXTREME_SOURCE_MAX_LINE_BYTES = 8 * 1024 * 1024;
export const RICH_MARKDOWN_MAX_BYTES = 4 * 1024 * 1024;
export const RICH_MARKDOWN_MAX_LINES = 100_000;
export const TABLE_CSV_MAX_BYTES = 8 * 1024 * 1024;
export const TABLE_CSV_MAX_LINES = 100_000;
export const RENDERED_HTML_MAX_BYTES = 5 * 1024 * 1024;
export const RENDERED_SVG_MAX_BYTES = 5 * 1024 * 1024;
// Text statistics are presentation metadata, not part of the editor or save
// path. Keep them on a much smaller budget than editable source so counting
// can never destabilize the WebKit content process.
export const EAGER_TEXT_STATS_MAX_BYTES = 1 * 1024 * 1024;
export const LIVE_TEXT_STATS_MAX_BYTES = 2 * 1024 * 1024;

export type SourceProfile = "normal" | "large" | "extreme";

export interface SourceInspection {
  version: FileVersionToken;
  size_bytes: number;
  line_count: number;
  line_count_complete: boolean;
  max_line_bytes: number;
  looks_textual: boolean;
  line_separator: string;
  diagnostics?: {
    elapsed_us: number;
    bytes_read: number;
  };
}

/**
 * Whether an edit may be flattened for live header statistics. Reduced and
 * windowed source documents must remain as CodeMirror trees; `documentUnits`
 * also stops statistics if a smaller file grows past the budget while open.
 */
export function shouldTrackLiveTextStats(
  profile: SourceProfile | null,
  inspection: SourceInspection | null,
  documentUnits?: number,
): boolean {
  if (profile === "large" || profile === "extreme") return false;
  if (inspection && inspection.size_bytes > LIVE_TEXT_STATS_MAX_BYTES) return false;
  if (documentUnits !== undefined && documentUnits > LIVE_TEXT_STATS_MAX_BYTES) return false;
  return true;
}

export function resolveSourceProfile(
  descriptor: FileDescriptor,
  inspection: SourceInspection,
): SourceProfile {
  if (
    inspection.size_bytes > EXTREME_SOURCE_MAX_BYTES
    || inspection.line_count > EXTREME_SOURCE_MAX_LINES
    || inspection.max_line_bytes > EXTREME_SOURCE_MAX_LINE_BYTES
    || !inspection.line_count_complete
  ) return "extreme";

  const presentationLimitExceeded =
    (descriptor.kind === "markdown" && (
      inspection.size_bytes > RICH_MARKDOWN_MAX_BYTES
      || inspection.line_count > RICH_MARKDOWN_MAX_LINES
    ))
    || (descriptor.kind === "csv" && (
      inspection.size_bytes > TABLE_CSV_MAX_BYTES
      || inspection.line_count > TABLE_CSV_MAX_LINES
    ))
    || (descriptor.kind === "html" && inspection.size_bytes > RENDERED_HTML_MAX_BYTES)
    || (descriptor.kind === "svg" && inspection.size_bytes > RENDERED_SVG_MAX_BYTES);

  if (
    presentationLimitExceeded
    || inspection.size_bytes > NORMAL_SOURCE_MAX_BYTES
    || inspection.line_count > NORMAL_SOURCE_MAX_LINES
    || inspection.max_line_bytes > NORMAL_SOURCE_MAX_LINE_BYTES
  ) return "large";

  return "normal";
}

export function formatSourceSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
