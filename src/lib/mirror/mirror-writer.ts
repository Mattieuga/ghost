import * as Y from "yjs";
import type { FileVersionToken } from "@/lib/source-document";

/** What Ghost last wrote to disk, or last accepted from it. */
export interface MirrorRecord {
  version: FileVersionToken | null;
  stateVector: Uint8Array | null;
  contentHash: string | null;
  /** The Markdown on disk at this record, kept in memory for merges. */
  content?: string | null;
}

export type MirrorWriteStatus = "saved" | "pending" | "writing" | "conflict" | "error";

export interface MirrorWriterOptions {
  document: Y.Doc;
  initialRecord: MirrorRecord;
  /** Serialize the current document through the shared serializer. */
  serialize(): string;
  /** Version-checked atomic write. Must reject with a conflict on a stale token. */
  write(content: string, expectedVersion: FileVersionToken | null, force: boolean): Promise<FileVersionToken>;
  hash(content: string): Promise<string>;
  onRecord(record: MirrorRecord): void | Promise<void>;
  /** The disk moved under a write. The caller runs ingestion, which decides. */
  onConflict(): void;
  onStatus?(status: MirrorWriteStatus, error: string | null): void;
  debounceMs?: number;
}

export function isWriteConflict(error: unknown): boolean {
  if (error && typeof error === "object" && (error as { kind?: unknown }).kind === "conflict") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /changed (?:on disk|outside ghost)|conflict/i.test(message);
}

/**
 * Writes a mirrored document's Markdown to disk whenever its Yjs document
 * changes for any reason other than ingestion. The write is checked against
 * the version token only, never against expected content, because remote
 * peers change the document without touching the file.
 */
export class MirrorWriter {
  private readonly document: Y.Doc;
  private readonly options: MirrorWriterOptions;
  private currentRecord: MirrorRecord;
  private currentStatus: MirrorWriteStatus = "saved";
  private suspended = 0;
  private dirty = false;
  /** Set after a conflicting write; ingestion clears it by resolving the disk. */
  private conflicted = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = false;

  constructor(options: MirrorWriterOptions) {
    this.document = options.document;
    this.options = options;
    this.currentRecord = options.initialRecord;
  }

  get record(): MirrorRecord {
    return this.currentRecord;
  }

  get status(): MirrorWriteStatus {
    return this.currentStatus;
  }

  get hasPendingChanges(): boolean {
    return this.dirty || this.timer !== null || this.inFlight !== null;
  }

  start(): void {
    this.document.on("update", this.handleUpdate);
  }

  stop(): void {
    this.stopped = true;
    this.document.off("update", this.handleUpdate);
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Run `fn` without treating the document changes it makes as new edits. */
  runSuspended<T>(fn: () => T): T {
    this.suspended += 1;
    try {
      return fn();
    } finally {
      this.suspended -= 1;
    }
  }

  /**
   * Accept the file on disk as the current mirror of the document, after an
   * ingestion or a formatting-only change. Cancels any pending write.
   */
  markDiskCurrent(version: FileVersionToken, contentHash: string | null, content: string | null = null): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Edits typed while the disk was unresolved are still owed to the file.
    const owed = this.dirty && this.conflicted;
    this.dirty = false;
    this.conflicted = false;
    this.setRecord({
      version,
      stateVector: Y.encodeStateVector(this.document),
      contentHash,
      content,
    });
    if (owed) {
      this.dirty = true;
      this.setStatus("pending", null);
      this.schedule();
    } else {
      this.setStatus("saved", null);
    }
  }

  /**
   * Ingestion could not establish what is on disk. Writes stay held so the
   * file is never overwritten blind, and the header says why.
   */
  reportIngestionFailure(message: string): void {
    this.setStatus("error", message);
  }

  /**
   * Write now regardless of the debounce. Resolves when the disk is current,
   * or immediately after a conflict, which only ingestion can resolve.
   */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) await this.inFlight;
    if (this.dirty && !this.conflicted) await this.writeNow(false);
  }

  /** Overwrite the file with the document, used after a conflict copy is saved. */
  async forceWrite(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.inFlight) await this.inFlight;
    this.conflicted = false;
    this.dirty = true;
    await this.writeNow(true);
  }

  private readonly handleUpdate = () => {
    if (this.suspended > 0 || this.stopped) return;
    this.dirty = true;
    if (this.conflicted) return;
    this.setStatus("pending", null);
    this.schedule();
  };

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.writeNow(false);
    }, this.options.debounceMs ?? 500);
  }

  private writeNow(force: boolean): Promise<void> {
    if (this.inFlight) {
      return this.inFlight.then(() => (this.dirty ? this.writeNow(force) : undefined));
    }
    const run = (async () => {
      if (!this.dirty) return;
      if (!force && this.currentRecord.version === null) {
        // Nothing on record says the file matches the document. Only
        // ingestion can establish that, so the write waits for it rather
        // than overwriting whatever another app left there.
        if (!this.conflicted) {
          this.conflicted = true;
          this.setStatus("conflict", null);
          this.options.onConflict();
        }
        return;
      }
      this.dirty = false;
      this.setStatus("writing", null);
      const content = this.options.serialize();
      const stateVector = Y.encodeStateVector(this.document);
      try {
        const version = await this.options.write(content, this.currentRecord.version, force);
        const contentHash = await this.options.hash(content);
        this.setRecord({ version, stateVector, contentHash, content });
        if (this.dirty) {
          this.setStatus("pending", null);
          this.schedule();
        } else {
          this.setStatus("saved", null);
        }
      } catch (error) {
        this.dirty = true;
        if (isWriteConflict(error)) {
          this.conflicted = true;
          this.setStatus("conflict", null);
          this.options.onConflict();
        } else {
          this.setStatus("error", error instanceof Error ? error.message : String(error));
        }
      }
    })();
    this.inFlight = run.finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private setRecord(record: MirrorRecord): void {
    this.currentRecord = record;
    void Promise.resolve(this.options.onRecord(record)).catch(() => undefined);
  }

  private setStatus(status: MirrorWriteStatus, error: string | null): void {
    this.currentStatus = status;
    this.options.onStatus?.(status, error);
  }
}
