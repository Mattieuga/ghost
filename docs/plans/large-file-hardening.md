# Large-file hardening plan

- Created: 2026-08-24
- Architecture: [`../adrs/0002-bounded-large-file-loading.md`](../adrs/0002-bounded-large-file-loading.md)
- Parent roadmap: [`file-viewer-roadmap.md`](file-viewer-roadmap.md)

## Goal

Opening, previewing, editing, saving, reloading, or incidentally inspecting a
large file must remain responsive. Ghost degrades optional capabilities before
editability, never mounts an editable partial document, and bounds binary
working sets according to their delivery and decode behavior.

## Phase 0: CSV rendering containment

Status: Implemented and manually verified 2026-08-24

- Virtualize fixed-height CSV body rows with bounded overscan.
- Avoid `Math.max(...largeArray)`, full body slices, and whole-table row clones.
- Keep stable bounded column widths and sticky headers.

Acceptance checks:

- The 5,000-row CSV fixture opens without a long main-thread stall.
- Fewer than 60 body rows are mounted for a normal-height viewport.
- Scrolling and jumping to the end preserves correct row numbering and editing.
- Small CSV editing and the source/table toggle still round-trip content.

## Phase 1: Streaming CodeMirror save foundation

Status: Implemented; automated verification and manual 100 MiB edit/save trial complete

- Stop calling `doc.toString()` from the CodeMirror transaction listener.
- Track dirty state and schedule one coalesced save without capturing a complete
  document string on every edit.
- Add native begin/append/commit/abort save-session commands with bounded
  chunks, uniquely created temporary files, serialized writes, cancellation,
  cleanup, metadata preservation, sync, and atomic replacement.
- Stream a CodeMirror snapshot to that session instead of sending one complete
  new string through IPC.
- Replace complete expected-content IPC with a compact native version token
  based on canonical/file identity, size, and precise modification time.
- Preserve the existing complete-string path for normal Tiptap documents until
  rich-document loading receives its own profile.
- Use a longer idle interval for large snapshots and keep at most one save in
  flight.

Acceptance checks:

- One edit to a large CodeMirror fixture never calls `doc.toString()` merely to
  schedule autosave.
- A streamed Unicode document round-trips byte-for-byte across chunk boundaries,
  including astral characters and CRLF.
- Save failure, cancellation, and conflict leave the original untouched and no
  completed temporary file behind.
- External replacement is detected without sending the original document body
  back to Rust.
- Rapid edits coalesce; explicit save waits for or supersedes scheduled work
  without concurrent writes.
- Existing small code, CSV source, SVG source, and unknown-text saves retain
  rename, reload, save-status, and extended-metadata behavior.

## Phase 2: Metadata gate and editable large-source mode

Status: Implemented and revised after manual large-fixture testing 2026-08-24;
17 MiB and controlled 100 MiB edit/save retests passed

- Resolve canonical metadata and a resource profile before any complete source
  read in both main and accessory windows.
- Add a streaming UTF-8 source reader with bounded chunks, exact boundary
  handling, modification signatures, cancellation, and explicit encoding
  errors.
- Transfer editable source chunks over raw octet-stream IPC rather than JSON
  strings while retaining the separate exact native structure inspection.
- Add a reduced CodeMirror configuration above 20 MiB, 300,000 lines, or a
  200 KiB line:
  no language parsing/highlighting, folding, wrapping, bracket helpers,
  document-wide decorations, or eager result counting.
- Preserve viewport editing, selection, undo/redo, line navigation, incremental
  find, explicit save, and coalesced autosave.
- Route large Markdown from Tiptap to exact editable source using encoded-size
  and bounded structure estimates. Route large CSV/TSV from table to source and
  large SVG from split rendering to source.
- Resolve large unknown text after a bounded probe without returning one
  complete string; keep binary unknowns unsupported.
- Make focus reload metadata-first so it cannot bypass the resolved profile.
- Show a concise large-file notice that explains which optional features were
  disabled.
- Keep live header statistics on an independent budget: calculate all modes
  eagerly only through 1 MiB, calculate only the selected mode through 2 MiB,
  then show inspected size and original line count without flattening reduced
  CodeMirror documents.

Acceptance checks:

- Source through 128 MiB, 5,000,000 lines, and an 8 MiB maximum line opens in
  reduced editable mode without whole-file string IPC; source beyond any of
  those ceilings takes the bounded read-only path.
- The first useful viewport appears without waiting for syntax highlighting or
  other optional whole-document analysis.
- A 100 MiB Markdown file opens in reduced editable source mode without invoking Tiptap.
- Large CSV opens as source while the verified 5,000-row fixture retains its
  virtualized table.
- Multibyte UTF-8 split at any read boundary is displayed and saved exactly
  once; invalid encodings fail safely.
- Manual 76–100 MiB fixtures invalidated the original 256 MiB CodeMirror
  ceiling. After isolating statistics and HMR reload defects, a complete 100 MiB
  application pass validated the current 128 MiB boundary; the completed stock
  TextKit 2 benchmark did not justify replacing CodeMirror.
- Rename, external replacement, deletion, and focus reload keep the same
  resolved profile and never overwrite a conflict.
- Editing and autosaving the 17 MiB/315k-line CSV does not terminate WebKit now
  that its incidental statistics path is bounded.
- Repo-local fixtures are excluded from Tailwind scanning and Vite watching so
  a successful save cannot be mistaken for a renderer crash via development
  HMR reload.

## Phase 3: Extreme-text inspection

Status: Implemented; automated verification and a 300 MiB CSV manual pass complete,
manual multi-gigabyte pass pending

- Add a `large-text` read-only viewer only for content above the
  benchmark-validated in-memory editor ceiling.
- Add bounded native UTF-8 window reads with byte/line position, line-boundary
  context, hard request limits, and external-change detection.
- Add first/previous/next/last navigation, line virtualization, focused keyboard
  controls, and Open Externally.
- Add cancellable native streaming Find that returns offsets and loads the
  matching window.
- Ensure partial models never enter save, replace, statistics, or export flows.

Acceptance checks:

- Peak WebView memory does not scale with total file size while paging through
  a multi-gigabyte sparse or generated text fixture.
- A line longer than one window produces an explicit bounded segment rather
  than an unbounded read.
- Command-F reaches matches near the beginning and end without copying the
  complete file.
- Replacing, truncating, deleting, or renaming the file invalidates stale
  windows coherently.
- No control can edit or save a partial large-file window.

## Phase 4: Asset-backed images and fonts

Status: Implemented; automated verification complete, manual image matrix pending

- Reuse the exact canonical runtime asset grant used by media for ordinary
  images and fonts instead of complete `number[]` IPC payloads.
- Read image dimensions, frame count, and format before selecting a decode
  path; apply orientation in the native thumbnail path.
- Load ordinary images from their asset URL within a decoded-memory budget.
- Generate a viewport-appropriate native ImageIO or Quick Look thumbnail for
  oversized images with a hard maximum pixel size and Open Original
  Externally.
- Keep ICNS conversion behind explicit input/output and pixel limits.
- Retain a generous encoded-byte safety ceiling for fonts and preserve the
  existing specimen controls.

Acceptance checks:

- Large JPEG/PNG/TIFF and font fixtures do not create full byte-array IPC
  payloads.
- A highly compressed image whose decoded bitmap exceeds the working-set budget
  displays a bounded thumbnail without decoding the full bitmap in the WebView.
- Orientation, animation policy, dimensions, replacement refresh, and ordinary
  image quality remain correct.
- ICNS continues to select and render its best representation within bounds.

## Phase 5: PDFKit prototype

Status: Implemented; automated verification and 200 MiB single-page manual pass complete

- Build a time-boxed inline macOS PDFKit `PDFView` prototype and feed it a file
  URL rather than complete byte IPC.
- Test ordinary, 100 MiB image-heavy, thousand-page, large-vector, encrypted,
  linked, selectable, form, and annotated documents.
- Measure time to first page, rapid scroll, zoom latency/quality, peak and
  steady memory, search/copy, keyboard focus, accessibility, replacement,
  resizing, theme integration, and implementation complexity.
- Record whether PDFKit meets the primary-renderer bar before Phase 6. Prototype
  Quick Look or optimized PDF.js only later if PDFKit fails or leaves a
  material gap.

Acceptance checks:

- The prototype proves whether a native view can coexist with the Tauri
  WKWebView without unacceptable z-order, focus, resize, or toolbar behavior.
- Results include reproducible fixtures and measurements rather than relying
  only on subjective comparison with Preview.
- PDFKit materially improves the Ghost experience; if it does not, Phase 6
  remains blocked while the ADR is amended with the next prototype.

## Phase 6: Bounded PDFKit implementation

Status: Implemented; core navigation, Find, zoom, and 200 MiB manual checks passed

- Productionize PDFKit behind the existing PDF descriptor so callers do not
  gain backend-specific branches.
- Preserve continuous navigation, trackpad zoom, page position, selection/copy,
  Find integration, replacement refresh, and keyboard focus.
- Bound the visible rendering working set, release offscreen resources, and
  surface malformed, encrypted, or unsupported document failures safely.
- Remove the current whole-byte IPC and eager all-page canvas rendering path.

Acceptance checks:

- A 100 MiB PDF reaches its first page without a complete JavaScript byte-array
  copy.
- A thousand-page document never mounts or rasterizes every page at once.
- Scrolling, zoom, Find, copy, rename/replacement, and ordinary small PDFs pass
  the shared viewer regression suite.
- PDFKit failure retains Open Externally and cannot destabilize the active
  editor.

## Phase 7: Auxiliary read and decode budgets

Status: Implemented and audited 2026-08-24

- Change Command Palette previews to a bounded prefix with a visible
  truncation label.
- Add streaming implementations or safe ceilings to explicit Copy As/export
  actions.
- Audit native commands and frontend `invoke` calls for remaining complete
  text or byte reads.
- Publish tuned feature, editor, pixel, canvas, font, and incidental-read
  budgets in the supported-formats guide.

Acceptance checks:

- Merely highlighting a large file in Command Palette cannot read it in full.
- A pathological explicit copy/export request fails usefully or streams without
  destabilizing the active editor.
- Repository search finds no unreviewed whole-file IPC path.

## Deferred

- Patch-only source saves after bounded snapshot saving is proven.
- A disk-backed editable model above CodeMirror's validated in-memory ceiling.
- Native row checkpoints and a structured table for very large CSV/TSV.
- Non-UTF-8 transcoding and round-trip encoding preservation.
- Incremental hex viewing for large binary files.
- Cross-platform PDF parity if Ghost expands beyond macOS.

## Large editable backend benchmark

Status: Completed 2026-08-24; stock TextKit 2 rejected

- Compare stock TextKit 2 and Ghost's reduced CodeMirror state in fresh
  processes with the 17, 50, 76, and 100 MiB fixtures.
- Measure load/decode, state attachment, first layout, end navigation, midpoint
  edit, full no-match search, save traversal, and resident memory.
- Keep the benchmark harnesses in `scripts/` and the measured table and caveats
  in ADR 0002.

Result:

- Stock TextKit 2 reached 1.14 GiB RSS for the 17 MiB/315k-line fixture and
  7.26 GiB for the 100 MiB/2.69m-line fixture. First layout ranged from 3.75 to
  33.78 seconds, so it is not a safe large-file backend by itself.
- CodeMirror's document tree, reduced state extensions, midpoint edit, and save
  traversal stayed fast. Its benchmark excludes WKWebView rendering and Tauri
  IPC, so it did not itself justify a higher ceiling; the later full application
  pass validated the current 128 MiB boundary with a 100 MiB fixture.
- The next prototype must combine a disk-backed piece table or mapped-file
  source with a bounded visible window. TextKit 2 remains eligible only as a
  renderer for that bounded window, not as the owner of the complete file.
- Neon, SourceView, TextViewPlus, STTextView, and CodeEditTextView were reviewed.
  Only CodeEditTextView replaced the relevant layout machinery, but its 17 MiB
  fixture still exceeded 26 seconds and 695 MiB during attachment. Stop the
  native-library investigation here; none is a justified near-term migration.
