import type { Editor } from "@tiptap/core";
import { parseMarkdownDocument } from "@/components/editor/frontmatter";
import type { FileVersionToken } from "@/lib/source-document";

/**
 * What to do when a mirrored Markdown file changes on disk. This is the
 * whole external-write policy of ADR 0005, as a pure decision so the watcher
 * handler, the later MCP server, and the cloud write API all agree.
 */
export type IngestionVerdict =
  /** Ghost's own mirror write, or nothing new. Do nothing. */
  | { kind: "ignore"; reason: "own-write" | "unchanged" }
  /** Only formatting differs. Mark the disk copy current and never echo. */
  | { kind: "record-disk" }
  /** The document is unchanged since the last mirror. Replace it after a checkpoint. */
  | { kind: "replace" }
  /** Both sides changed. Keep the document, write the disk copy beside it. */
  | { kind: "conflict" };

export interface IngestionInput {
  /** Version of the file as it is on disk now. */
  diskVersion: FileVersionToken | null;
  /** Version recorded at Ghost's last mirror write or ingestion. */
  mirrorVersion: FileVersionToken | null;
  /** `Y.encodeStateVector(doc)` now. */
  documentStateVector: Uint8Array;
  /** State vector recorded at Ghost's last mirror write or ingestion. */
  mirrorStateVector: Uint8Array | null;
  /** Whether the parsed disk content equals the current document. */
  documentsEquivalent: boolean;
}

/** Same bytes on disk, wherever the file now lives. */
export function fileVersionsEqual(left: FileVersionToken, right: FileVersionToken): boolean {
  return left.size_bytes === right.size_bytes
    && left.modified_ns === right.modified_ns
    && left.device_id === right.device_id
    && left.file_id === right.file_id;
}

export function stateVectorsEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function decideIngestion(input: IngestionInput): IngestionVerdict {
  if (input.diskVersion && input.mirrorVersion
    && fileVersionsEqual(input.diskVersion, input.mirrorVersion)) {
    return { kind: "ignore", reason: "own-write" };
  }
  if (input.documentsEquivalent) return { kind: "record-disk" };
  // Without a recorded state vector there is no way to know whether the
  // document moved on since the last mirror. Losing nothing beats guessing.
  if (!input.mirrorStateVector) return { kind: "conflict" };
  if (stateVectorsEqual(input.documentStateVector, input.mirrorStateVector)) {
    return { kind: "replace" };
  }
  return { kind: "conflict" };
}

/**
 * Whether Markdown text parses to the editor's current document. Compares
 * parsed documents, not bytes, because the serializer is not identity
 * preserving and an agent's formatting must never trigger a rewrite.
 */
export function markdownMatchesDocument(editor: Editor, markdown: string): boolean {
  try {
    const parsed = editor.schema.nodeFromJSON(parseMarkdownDocument(editor, markdown));
    return parsed.eq(editor.state.doc);
  } catch {
    return false;
  }
}

/** File name for the disk side of a conflict, beside the original. */
export function conflictCopyName(fileName: string, when: Date = new Date()): string {
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())} `
    + `${pad(when.getHours())}.${pad(when.getMinutes())}`;
  return `${stem} (conflict ${stamp})${extension}`;
}
