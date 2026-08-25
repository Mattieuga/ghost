export const CSV_ROW_HEIGHT = 32;

const HEADER_AND_TOP_PADDING = 90;
const OVERSCAN_ROWS = 12;

export interface VisibleCsvRowRange {
  start: number;
  end: number;
}

/** Parse CSV/TSV without dropping blank records or legacy CR line endings. */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  let recordTouched = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      recordTouched = true;
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      inQuotes = true;
      recordTouched = true;
    } else if (character === delimiter) {
      current.push(field);
      field = "";
      recordTouched = true;
    } else if (character === "\n" || character === "\r") {
      current.push(field);
      rows.push(current);
      current = [];
      field = "";
      recordTouched = false;
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      field += character;
      recordTouched = true;
    }
  }

  if (recordTouched || current.length > 0 || field.length > 0) {
    current.push(field);
    rows.push(current);
  }
  return rows;
}

/** Serialize edited rows with the file's original line separator. */
export function serializeCsv(
  rows: string[][],
  delimiter: string,
  lineSeparator = "\n",
): string {
  return rows.map((row) => row.map((cell) => {
    if (
      cell.includes(delimiter)
      || cell.includes('"')
      || cell.includes("\n")
      || cell.includes("\r")
    ) {
      return `"${cell.replace(/"/g, '""')}"`;
    }
    return cell;
  }).join(delimiter)).join(lineSeparator);
}

/** Return the bounded row window the CSV table should mount for one viewport. */
export function visibleCsvRowRange(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
): VisibleCsvRowRange {
  if (rowCount <= 0) return { start: 0, end: 0 };
  const bodyTop = Math.max(0, scrollTop - HEADER_AND_TOP_PADDING);
  const bodyBottom = Math.max(0, scrollTop + viewportHeight - HEADER_AND_TOP_PADDING);
  const firstVisible = Math.min(rowCount - 1, Math.floor(bodyTop / CSV_ROW_HEIGHT));
  const lastVisible = Math.min(rowCount, Math.ceil(bodyBottom / CSV_ROW_HEIGHT));
  return {
    start: Math.max(0, firstVisible - OVERSCAN_ROWS),
    end: Math.min(rowCount, Math.max(firstVisible + 1, lastVisible + OVERSCAN_ROWS)),
  };
}
