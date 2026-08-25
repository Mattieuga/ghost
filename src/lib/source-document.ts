import type { Text } from "@codemirror/state";

export interface FileVersionToken {
  canonical_path: string;
  size_bytes: number;
  modified_ns: string;
  device_id: string | null;
  file_id: string | null;
}

/** Immutable CodeMirror snapshot plus the file's original line separator. */
export interface SourceDocumentSnapshot {
  document: Text;
  lineSeparator: string;
}

// Large documents still use bounded JSON IPC, but 1 MiB units avoid hundreds
// of round trips near the in-memory editor ceiling.
const SOURCE_SAVE_CHUNK_UNITS = 1024 * 1024;

function endsWithHighSurrogate(value: string): boolean {
  if (!value) return false;
  const code = value.charCodeAt(value.length - 1);
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * Iterate a CodeMirror tree without flattening it. CodeMirror stores line
 * breaks structurally, so replace iterator breaks with the file's selected
 * separator and never split an astral character across JSON IPC messages.
 */
export function* iterateSourceChunks(
  snapshot: SourceDocumentSnapshot,
  maxUnits = SOURCE_SAVE_CHUNK_UNITS,
): Generator<string> {
  if (maxUnits < 2) throw new Error("Source-save chunks must hold at least two UTF-16 units");

  let buffer = "";
  const iterator = snapshot.document.iter();
  while (!iterator.next().done) {
    const value = iterator.lineBreak ? snapshot.lineSeparator : iterator.value;
    let offset = 0;
    while (offset < value.length) {
      const capacity = maxUnits - buffer.length;
      let end = Math.min(value.length, offset + capacity);
      if (end < value.length && endsWithHighSurrogate(value.slice(offset, end))) end -= 1;
      if (end === offset) {
        if (buffer) {
          yield buffer;
          buffer = "";
          continue;
        }
        end = Math.min(value.length, offset + 2);
      }
      buffer += value.slice(offset, end);
      offset = end;
      if (buffer.length >= maxUnits) {
        yield buffer;
        buffer = "";
      }
    }
  }
  if (buffer) yield buffer;
}

export function detectLineSeparator(content: string): string {
  const match = content.match(/\r\n|\r|\n/);
  return match?.[0] ?? "\n";
}
