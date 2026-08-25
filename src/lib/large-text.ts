export interface TextHighlightRange {
  start: number;
  end: number;
}

function utf8Width(codePoint: number): number {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function utf16IndexAtUtf8Offset(text: string, targetBytes: number): number | null {
  if (targetBytes < 0) return null;
  let bytes = 0;
  let index = 0;
  while (index < text.length) {
    if (bytes === targetBytes) return index;
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;
    bytes += utf8Width(codePoint);
    if (bytes > targetBytes) return null;
    index += codePoint > 0xffff ? 2 : 1;
  }
  return bytes === targetBytes ? index : null;
}

/** Map native byte offsets back to a safe UTF-16 range in one loaded window. */
export function textHighlightRange(
  text: string,
  windowOffset: number,
  matchOffset: number,
  query: string,
): TextHighlightRange | null {
  const relativeStart = matchOffset - windowOffset;
  const queryBytes = new TextEncoder().encode(query).length;
  const start = utf16IndexAtUtf8Offset(text, relativeStart);
  const end = utf16IndexAtUtf8Offset(text, relativeStart + queryBytes);
  if (start === null || end === null || start === end) return null;
  return { start, end };
}
