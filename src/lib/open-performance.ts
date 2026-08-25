import type { SourceProfile } from "@/lib/resource-policy";

interface OpenPerformanceStage {
  stage: string;
  milliseconds: number;
  detail?: string;
  phase: "loader" | "viewer";
}

interface OpenPerformanceMetadata {
  profile?: SourceProfile;
  sizeBytes?: number;
  lineCount?: number;
  chunkCount?: number;
  chunkBytes?: number;
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/**
 * Development-only trace for one source-file open. The trace follows the
 * model from native inspection through CodeMirror's first painted frame and
 * deliberately records timings and byte counts, never file contents.
 */
export class FileOpenPerformanceTrace {
  readonly startedAt = now();
  readonly label: string;
  private stages: OpenPerformanceStage[] = [];
  private metadata: OpenPerformanceMetadata = {};
  private modelReadyAt: number | null = null;
  private viewerStartedAt: number | null = null;
  private viewCreatedAt: number | null = null;
  private finished = false;

  constructor(path: string) {
    this.label = basename(path);
  }

  record(stage: string, milliseconds: number, detail?: string): void {
    this.stages.push({
      stage,
      milliseconds: Math.max(0, milliseconds),
      detail,
      phase: "loader",
    });
  }

  recordViewer(stage: string, milliseconds: number, detail?: string): void {
    this.stages.push({
      stage,
      milliseconds: Math.max(0, milliseconds),
      detail,
      phase: "viewer",
    });
  }

  setSourceMetadata(profile: SourceProfile, sizeBytes: number, lineCount: number): void {
    this.metadata = { ...this.metadata, profile, sizeBytes, lineCount };
  }

  setChunkMetadata(chunkCount: number, chunkBytes: number): void {
    this.metadata = { ...this.metadata, chunkCount, chunkBytes };
  }

  markModelReady(): void {
    this.modelReadyAt = now();
    const accounted = this.stages
      .filter((stage) => stage.phase === "loader")
      .reduce((total, stage) => total + stage.milliseconds, 0);
    const other = this.modelReadyAt - this.startedAt - accounted;
    if (other > 0.05) this.record("Other loader overhead", other);
  }

  markViewerStarted(): void {
    // React Strict Mode intentionally remounts effects in development. Keep
    // only the final mount's viewer timings while preserving loader timings.
    this.stages = this.stages.filter((stage) => stage.phase !== "viewer");
    this.viewerStartedAt = now();
    this.viewCreatedAt = null;
    if (this.modelReadyAt !== null) {
      this.recordViewer("React handoff to viewer", this.viewerStartedAt - this.modelReadyAt);
    }
  }

  markViewCreated(): void {
    this.viewCreatedAt = now();
  }

  finishAfterFirstPaint(): void {
    if (this.finished) return;
    this.finished = true;
    const finishedAt = now();
    if (this.viewCreatedAt !== null) {
      this.recordViewer("CodeMirror view to first paint", finishedAt - this.viewCreatedAt);
    }

    const rows = this.stages.map(({ stage, milliseconds, detail }) => ({
      stage,
      ms: Number(milliseconds.toFixed(2)),
      detail: detail ?? "",
    }));
    const summary = {
      file: this.label,
      profile: this.metadata.profile,
      sizeMiB: this.metadata.sizeBytes === undefined
        ? undefined
        : Number((this.metadata.sizeBytes / (1024 * 1024)).toFixed(2)),
      lines: this.metadata.lineCount,
      chunks: this.metadata.chunkCount,
      chunkMiB: this.metadata.chunkBytes === undefined
        ? undefined
        : Number((this.metadata.chunkBytes / (1024 * 1024)).toFixed(2)),
      loaderMs: this.modelReadyAt === null
        ? undefined
        : Number((this.modelReadyAt - this.startedAt).toFixed(2)),
      totalToFirstPaintMs: Number((finishedAt - this.startedAt).toFixed(2)),
    };

    console.group(`[ghost:open-performance] ${this.label}`);
    console.info("Summary", summary);
    console.table(rows);
    console.info("Copyable trace", { summary, stages: rows });
    console.groupEnd();
  }
}

export function createFileOpenPerformanceTrace(path: string): FileOpenPerformanceTrace | null {
  return import.meta.env.DEV ? new FileOpenPerformanceTrace(path) : null;
}

export function performanceNow(): number {
  return now();
}
