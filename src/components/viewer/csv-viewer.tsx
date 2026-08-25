import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { CodeEditor } from "@/components/editor/code-editor";
import type { EditorView } from "@codemirror/view";
import { Table2, FileText } from "lucide-react";
import {
  CSV_ROW_HEIGHT,
  parseCsv,
  serializeCsv,
  visibleCsvRowRange,
  type VisibleCsvRowRange,
} from "@/lib/csv";
import type { SourceDocumentSnapshot } from "@/lib/source-document";

interface CsvViewerProps {
  filePath: string;
  content: string;
  onContentChange?: (text: string) => void;
  onSourceChange: (snapshot: SourceDocumentSnapshot) => Promise<void>;
  searchTerm?: string;
  replaceTerm?: string;
  onSearchResults?: (count: number, currentIndex: number) => void;
  onEditorReady?: (view: EditorView | null) => void;
  onDirtyChange?: (dirty: boolean) => void;
  lineSeparator?: string;
}

const FALLBACK_VIEWPORT_HEIGHT = 800;

export function CsvViewer({ filePath, content, onContentChange, onSourceChange, searchTerm, replaceTerm, onSearchResults, onEditorReady, onDirtyChange, lineSeparator = "\n" }: CsvViewerProps) {
  const ext = filePath.split(".").pop()?.toLowerCase();
  const delimiter = ext === "tsv" ? "\t" : ",";

  const parsedFromProp = useMemo(() => parseCsv(content, delimiter), [content, delimiter]);
  const [rows, setRows] = useState(parsedFromProp);

  // Sync rows when content prop changes externally (e.g. focus reload)
  const lastContentRef = useRef(content);
  useEffect(() => {
    if (content !== lastContentRef.current) {
      lastContentRef.current = content;
      setRows(parsedFromProp);
    }
  }, [content, parsedFromProp]);
  const [editing, setEditing] = useState<{ row: number; col: number } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [mode, setMode] = useState<"table" | "text">("table");
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [visibleRows, setVisibleRows] = useState<VisibleCsvRowRange>({ start: 0, end: 0 });

  const header = rows[0] ?? [];
  const bodyRowCount = Math.max(0, rows.length - 1);
  const colCount = useMemo(
    () => rows.reduce((maximum, row) => Math.max(maximum, row.length), 0),
    [rows],
  );
  const columnWidths = useMemo(
    () => Array.from({ length: colCount }, (_, index) => {
      const headerLength = header[index]?.length ?? 0;
      return Math.min(320, Math.max(100, headerLength * 7 + 32));
    }),
    [colCount, header],
  );
  const tableWidth = useMemo(
    () => 48 + columnWidths.reduce((total, width) => total + width, 0),
    [columnWidths],
  );

  const updateVisibleRows = useCallback(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    const next = visibleCsvRowRange(
      scroll.scrollTop,
      scroll.clientHeight || FALLBACK_VIEWPORT_HEIGHT,
      bodyRowCount,
    );
    setVisibleRows((current) =>
      current.start === next.start && current.end === next.end ? current : next,
    );
  }, [bodyRowCount]);

  useEffect(() => {
    if (mode !== "table") return;
    updateVisibleRows();
    const scroll = scrollRef.current;
    if (!scroll || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateVisibleRows);
    observer.observe(scroll);
    return () => observer.disconnect();
  }, [mode, updateVisibleRows]);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const rowIdx = editing.row;
    const newRows = [...rows];
    const nextRow = [...(newRows[rowIdx] ?? [])];
    while (nextRow.length <= editing.col) nextRow.push("");
    nextRow[editing.col] = editValue;
    newRows[rowIdx] = nextRow;
    setRows(newRows);
    setEditing(null);
    onContentChange?.(serializeCsv(newRows, delimiter, lineSeparator));
  }, [editing, editValue, rows, delimiter, lineSeparator, onContentChange]);

  const startEdit = useCallback((row: number, col: number) => {
    const value = rows[row]?.[col] ?? "";
    setEditing({ row, col });
    setEditValue(value);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [rows]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!editing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      commitEdit();
    } else if (e.key === "Escape") {
      setEditing(null);
    } else if (e.key === "Tab") {
      e.preventDefault();
      commitEdit();
      const nextCol = e.shiftKey ? editing.col - 1 : editing.col + 1;
      if (nextCol >= 0 && nextCol < colCount) {
        startEdit(editing.row, nextCol);
      }
    }
  }, [editing, commitEdit, startEdit, colCount]);

  const isEditing = (row: number, col: number) =>
    editing?.row === row && editing?.col === col;

  const renderCell = (row: number, col: number, value: string, isHeader: boolean) => {
    if (isEditing(row, col)) {
      return (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitEdit}
          className={`bg-background border border-ghost-amber rounded px-1 py-0.5 text-[13px] outline-none w-full ${isHeader ? "font-semibold" : ""}`}
        />
      );
    }
    return <span className="truncate block">{value}</span>;
  };

  const modeToggle = (
    <div className="flex items-center px-4 py-2.5 text-[11px] text-ring shrink-0 border-t border-border bg-background">
      <div className="flex items-center rounded-md border border-border overflow-hidden">
        <button
          onClick={() => setMode("table")}
          className={`flex items-center gap-1 px-2 py-1 cursor-pointer transition-colors ${
            mode === "table" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-card-foreground"
          }`}
        >
          <Table2 className="size-3.5" />
        </button>
        <button
          onClick={() => setMode("text")}
          className={`flex items-center gap-1 px-2 py-1 cursor-pointer transition-colors ${
            mode === "text" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-card-foreground"
          }`}
        >
          <FileText className="size-3.5" />
        </button>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-4">
        <span>{bodyRowCount.toLocaleString()} rows</span>
        <span>{colCount} columns</span>
      </div>
    </div>
  );

  if (mode === "text") {
    return (
      <div className="flex flex-col h-full">
        <div className="flex-1 min-h-0">
          <CodeEditor
            content={serializeCsv(rows, delimiter, lineSeparator)}
            onContentChange={(snapshot) => {
              const text = snapshot.document.toString();
              setRows(parseCsv(text, delimiter));
              return onSourceChange(snapshot);
            }}
            activeFile={filePath}
            searchTerm={searchTerm}
            replaceTerm={replaceTerm}
            onSearchResults={onSearchResults}
            onEditorReady={onEditorReady}
            onDirtyChange={onDirtyChange}
            lineSeparator={lineSeparator}
          />
        </div>
        {modeToggle}
      </div>
    );
  }

  const range = visibleRows.end > visibleRows.start
    ? visibleRows
    : { start: 0, end: Math.min(bodyRowCount, 40) };
  const renderedBodyRows = rows.slice(range.start + 1, range.end + 1);
  const topSpacerHeight = range.start * CSV_ROW_HEIGHT;
  const bottomSpacerHeight = Math.max(0, (bodyRowCount - range.end) * CSV_ROW_HEIGHT);

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        data-csv-scroll-container
        onScroll={updateVisibleRows}
        className="flex-1 overflow-auto min-h-0 px-4 pb-4 pt-14"
      >
        <table
          className="table-fixed border-collapse text-[13px]"
          style={{ width: tableWidth }}
        >
          <colgroup>
            <col style={{ width: 48 }} />
            {columnWidths.map((width, index) => <col key={index} style={{ width }} />)}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="bg-muted text-muted-foreground text-[11px] font-medium px-3 py-2 text-right border-b border-border" style={{ width: 48 }}>#</th>
              {header.map((cell, i) => (
                <th
                  key={i}
                  className="bg-muted text-left text-card-foreground font-semibold px-3 py-2 border-b border-border cursor-pointer hover:bg-accent/50 whitespace-nowrap"
                  style={{ minWidth: 80 }}
                  onDoubleClick={() => startEdit(0, i)}
                >
                  {renderCell(0, i, cell, true)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td colSpan={colCount + 1} className="border-0 p-0" style={{ height: topSpacerHeight }} />
              </tr>
            )}
            {renderedBodyRows.map((row, visibleIndex) => {
              const bodyIndex = range.start + visibleIndex;
              const globalRow = bodyIndex + 1;
              return (
                <tr
                  key={globalRow}
                  data-csv-row-index={globalRow}
                  className={bodyIndex % 2 === 0 ? "" : "bg-muted/30"}
                  style={{ height: CSV_ROW_HEIGHT }}
                >
                  <td className="text-[11px] text-ring px-3 py-1.5 text-right border-b border-border/50 tabular-nums">{globalRow}</td>
                  {Array.from({ length: colCount }, (_, ci) => (
                    <td
                      key={ci}
                      className="px-3 py-1.5 text-card-foreground border-b border-border/50 cursor-pointer hover:bg-accent/30 whitespace-nowrap"
                      style={{ minWidth: 80 }}
                      onDoubleClick={() => startEdit(globalRow, ci)}
                    >
                      {renderCell(globalRow, ci, row[ci] ?? "", false)}
                    </td>
                  ))}
                </tr>
              );
            })}
            {bottomSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td colSpan={colCount + 1} className="border-0 p-0" style={{ height: bottomSpacerHeight }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {modeToggle}
    </div>
  );
}
