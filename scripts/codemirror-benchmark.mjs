import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { EditorState, Text } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { SearchCursor, search, searchKeymap } from "@codemirror/search";
import { drawSelection, keymap, lineNumbers } from "@codemirror/view";

const path = process.argv[2];
const needle = process.argv[3] ?? "the";
if (!path) {
  process.stderr.write("usage: node codemirror-benchmark.mjs FILE [NEEDLE]\n");
  process.exit(2);
}

const stages = {};
const record = (name, start) => {
  stages[name] = {
    milliseconds: performance.now() - start,
    residentBytes: process.memoryUsage().rss,
  };
};

const byteCount = fs.statSync(path).size;
const fd = fs.openSync(path, "r");
const decoder = new TextDecoder("utf-8", { fatal: true });
const buffer = Buffer.allocUnsafe(2 * 1024 * 1024);
let document = Text.empty;
let fileOffset = 0;
let pendingCarriageReturn = false;
let start = performance.now();
while (fileOffset < byteCount) {
  const count = fs.readSync(fd, buffer, 0, buffer.length, fileOffset);
  if (count === 0) break;
  fileOffset += count;
  let decoded = decoder.decode(buffer.subarray(0, count), { stream: fileOffset < byteCount });
  if (pendingCarriageReturn) {
    decoded = `\r${decoded}`;
    pendingCarriageReturn = false;
  }
  // Ghost's native source reader never splits CRLF across IPC chunks. Keep
  // this standalone reader equivalent so a boundary cannot create two lines.
  if (fileOffset < byteCount && decoded.endsWith("\r")) {
    decoded = decoded.slice(0, -1);
    pendingCarriageReturn = true;
  }
  const normalized = decoded.replace(/\r\n|\r/g, "\n");
  document = document.append(Text.of(normalized.split("\n")));
}
if (pendingCarriageReturn) document = document.append(Text.of(["", ""]));
fs.closeSync(fd);
record("loadDocument", start);

start = performance.now();
let state = EditorState.create({
  doc: document,
  // Match Ghost's reduced large-source state. This intentionally excludes
  // language parsing, highlighting, folding, wrapping, brackets, and eager
  // result counting. EditorView layout is not part of this process-isolated
  // model benchmark.
  extensions: [
    EditorState.lineSeparator.of("\n"),
    lineNumbers(),
    drawSelection(),
    history(),
    search({ top: true }),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
    ]),
  ],
});
record("attach", start);

start = performance.now();
state.doc.lineAt(state.doc.length);
record("navigateEnd", start);

start = performance.now();
state = state.update({ changes: { from: Math.floor(state.doc.length / 2), insert: "x" } }).state;
record("edit", start);

start = performance.now();
const cursor = new SearchCursor(state.doc, needle, 0, state.doc.length, (value) => value.toLowerCase());
const found = !cursor.next().done;
record("search", start);

start = performance.now();
let traversedUnits = 0;
const iterator = state.doc.iter();
while (!iterator.next().done) traversedUnits += iterator.lineBreak ? 1 : iterator.value.length;
record("saveTraversal", start);

process.stdout.write(`${JSON.stringify({
  backend: "codemirror-large-state",
  file: path,
  bytes: byteCount,
  utf16Units: state.doc.length,
  stages,
  searchFound: found,
  traversedUnits,
})}\n`);
