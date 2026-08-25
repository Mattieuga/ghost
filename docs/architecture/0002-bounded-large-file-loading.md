# ADR 0002: Capability degradation and bounded resource handling

- Status: Accepted; implementation complete and core manual validation passed
- Date: 2026-08-24
- Extends: [`0001-extensible-file-viewers.md`](0001-extensible-file-viewers.md)
- Related plan: [`../plans/large-file-hardening.md`](../plans/large-file-hardening.md)

## Context

Ghost's positive file descriptors prevent binary formats from accidentally
entering text editors, and seekable media and archive previews already avoid
unbounded whole-file IPC. The remaining text and document paths do not resolve
a resource policy before loading.

Known Markdown, code, CSV/TSV, SVG, and plain-text files are read completely in
Rust, serialized across Tauri IPC, retained as JavaScript strings, and copied
again into Tiptap, CodeMirror, or parsed React state. Unknown files receive a
bounded text probe, but a successful probe then reads the complete file. A
100 MiB text file can therefore consume several times its on-disk size before
the editor has rendered.

CodeMirror's viewport rendering and document tree are suitable for files much
larger than ordinary notes, but Ghost currently defeats those advantages. Each
CodeMirror edit calls `doc.toString()`, autosave sends both the complete edited
document and complete expected prior document through IPC, and Rust reads the
complete disk file again before performing an atomic replacement. Large-file
editing can therefore appear responsive and then crash during autosave.

Several read-only viewers also transfer complete byte arrays through IPC.
Images and PDFs create additional typed-array, Blob, decoder, or canvas memory;
fonts are loaded into a complete JavaScript buffer. Read-only status alone does
not make a viewer safe: resource delivery, decoded size, mounted view count,
and renderer working set determine whether it remains bounded.

Ghost must never crash merely because a selected file is valid but large. It
should also preserve plain-text editing by degrading optional capabilities
before falling back to read-only inspection. No fallback may silently truncate
an editable document or imply that only a visible prefix will be saved.

## Decision

### Resolve a capability profile before content

Opening a file becomes a metadata-first decision:

1. The existing classifier identifies the format and its normal viewer.
2. The shared loader obtains canonical metadata before reading the body.
3. A resource-policy resolver chooses a capability profile using format,
   encoded bytes, line count or bounded structural estimates, and expected
   decode cost.

The resolver remains framework-independent. Main and accessory windows receive
the same resolved `FileModel`; rename, reload, search, save, and chrome behavior
consume that model rather than independently reclassifying the path.

Policy thresholds select capabilities, not a universal definition of whether
a file is editable. Byte size is appropriate for transfer budgets, line or
node count for document structure, pixel area for images, canvas area for PDF
pages, and expanded bytes for archives.

### Degrade source-text features before editability

Source-like content has three operating profiles:

| Profile | Initial trigger | Behavior |
| --- | --- | --- |
| Normal source | At or below 20 MiB, 300,000 lines, and 200 KiB per line | Current CodeMirror editing and language features |
| Large source | Above either normal trigger but below a benchmarked editor safety ceiling | Editable CodeMirror with expensive whole-document features disabled |
| Extreme source | Beyond the validated in-memory editor ceiling | Chunked read-only inspection until a disk-backed editor exists |

The 20 MiB and 300,000-line values are conservative feature-degradation
triggers modeled on mature source-editor behavior; they are not editing limits.
The long-term performance target is reliable editing and saving of at least
100 MiB, with fixtures up to 250 MiB used to establish each backend's safety
ceiling. The ceiling remains centralized and benchmark-driven. CodeMirror in
WKWebView is not assumed to be the permanent backend for this range.

A stock TextKit 2 `NSTextView` was evaluated as the first alternative backend.
Although its layout API is viewport-oriented and avoids WebKit and JSON-IPC,
its standard content storage still owns the complete decoded document and has
substantial per-line and layout overhead. The benchmark recorded below rejects
that widget substitution for Ghost's large-file path. Reaching VS Code-class
sizes requires a mapped-file or disk-backed piece-table content store with a
windowed presentation layer; TextKit 2 could still render that bounded window,
but it cannot be the document model. Native read-only mapped/windowed text
remains a smaller intermediate option.

Large source mode disables syntax parsing and highlighting, folding, code-aware
indentation, bracket matching and insertion, word wrapping, decorations that
scan the document, and eager match counting. It preserves selection, line
numbers where practical, viewport rendering, undo/redo, ordinary editing,
incremental find navigation, explicit save, and coalesced autosave.

Rich Markdown uses a separate encoded-size and structural-complexity budget.
Crossing that budget opens the exact Markdown source in editable large-source
mode rather than a read-only Tiptap document. The rich-mode threshold can be
conservative because it changes presentation, not file access or editability.
Large CSV/TSV similarly falls back from the table to editable source. SVG may
fall back from its rendered/source split to source only.

### Stream source loading and saving

Large source content does not cross IPC as one serialized string. Native reads
produce bounded UTF-8 chunks with encoding metadata, modification signature,
and correct multibyte-boundary handling. CodeMirror builds its document from
those chunks while retaining only its own text model and normal UI state.

A CodeMirror transaction marks the document dirty but never calls
`doc.toString()` merely to schedule autosave. Saving reads a snapshot from the
editor in bounded chunks and writes those chunks to a uniquely created native
temporary file. The save is synchronized, preserves required metadata, and
atomically replaces the destination only after every chunk succeeds.

Header statistics have a separate, substantially smaller resource budget.
Ghost may calculate all count modes eagerly only through 1 MiB and may retain
live text for the selected count only through 2 MiB. Above that point it shows
the inspected encoded size and original line count. Reduced and extreme source
documents never flatten their CodeMirror tree for statistics; this restriction
is independent of their editability and save path.

External-change protection uses a compact native version token derived from
canonical identity, file identity where available, byte size, and precise
modification time. A streaming content fingerprint may resolve ambiguous
metadata without sending the original document through IPC. Saves are
serialized, duplicate requests coalesce, and large-file autosave uses a longer
idle interval with at most one write in flight.

An interrupted or conflicted save leaves the original untouched and removes
its temporary file. The implementation may later transmit composed edit
patches instead of a complete snapshot, but patch saving is not required for
the first reliable 100 MiB target.

### Retain a bounded extreme-text viewer

Text beyond the validated in-memory editor ceiling routes to a `large-text`
viewer-owned mode before the body crosses IPC. This viewer is read-only because
CodeMirror still holds a complete in-WebView document; it is not the permanent
large-text architecture or the fallback for ordinary 20-100 MiB files.

Native commands expose bounded UTF-8 windows with byte offsets, file size,
modification signature, and beginning/end state. Reads align away from split
UTF-8 sequences and retain enough line context to prevent lost or duplicated
text. Native streaming Find returns offsets and remains cancellable. Selecting
a result loads its containing window, and an external change invalidates stale
windows.

### Use resource delivery and decode budgets for binary viewers

Seekable or directly renderable resources do not cross IPC as `Vec<u8>` merely
to construct a Blob. Exact canonical runtime-scoped asset URLs remain the
default delivery mechanism when the platform viewer can consume a URL.

Audio and video retain their existing range-capable media path and do not need
a Ghost file-size ceiling. They remain subject to WebKit and platform codec,
duration, track, and hardware limits. This behavior is safe because playback
streams the resource, not because the viewers are read-only.

Image policy is based primarily on decoded pixels rather than compressed file
bytes. The loader reads dimensions, frame count, and format before decoding.
Ordinary images use a URL-backed decode. Images beyond the active decoded-
memory budget use an orientation-aware native ImageIO thumbnail with a bounded
maximum pixel size and retain Open Original Externally. A future deep-zoom
viewer must use tiles rather than decoding the full-resolution bitmap.

Fonts should load through a scoped URL instead of a JavaScript byte array and
retain a generous encoded-byte safety ceiling. ICNS remains a native
transformation because WebKit cannot reliably render the container, with both
input and rendered pixel output bounded.

### Prototype PDFKit as the primary PDF backend

Ghost will prototype AppKit `PDFView` from PDFKit as its primary PDF backend.
Ghost is macOS-first, and the quality difference between Preview and the
current canvas implementation warrants pursuing the native direction before
investing further in PDF.js-specific architecture.

A time-boxed, file-URL-backed PDFKit prototype must establish that `PDFView`:

1. embeds cleanly beside the Tauri WKWebView;
2. exposes continuous display, zoom, current and visible pages, selection,
   copy, history, navigation, and search integration; and
3. materially improves performance and interaction quality over Ghost's
   current PDF.js canvas viewer.

The comparison uses small ordinary documents, a 100 MiB image-heavy document,
a long document with thousands of pages, large vector pages, encrypted PDFs,
and documents containing links, selections, forms, and annotations. It records
time to first page, rapid-scroll behavior, zoom quality and latency, steady and
peak memory, search/copy behavior, keyboard focus, accessibility, replacement
refresh, window resize, dark-window integration, and implementation
complexity.

Native `PDFView` becomes the macOS primary renderer if it can be embedded in
the Tauri window without unacceptable z-order, focus, resize, or toolbar
integration problems and meets the performance and interaction bar. Quick Look
and an optimized PDF.js implementation are contingency candidates only: Ghost
will prototype them later if PDFKit fails or leaves a material gap, and will
record that change before investing in either path.

Regardless of backend, PDFs receive the local file URL rather than whole-byte
IPC, render only a bounded visible working set, release offscreen resources,
and fail safely on malformed or unsupported documents. No backend is treated
as unlimited merely because it is native.

### Bound incidental reads too

Command Palette previews read only a bounded prefix and visibly label
truncation. Copy/export actions may read complete content only after an
explicit user action and reject requests beyond a documented safe ceiling
unless they have a streaming implementation. Reload-on-focus compares metadata
first and refreshes the active model according to its resolved profile.

No failure or fallback may alter the source file. A windowed extreme-text model
never participates in autosave or reports whole-file statistics from a partial
window.

## Implementation record

The first implementation landed as one shared resource policy with these
initial, centralized budgets:

- fully featured source through 20 MiB, 300,000 lines, and 200 KiB per line;
- reduced editable CodeMirror source through 128 MiB, 5,000,000 lines, and
  8 MiB per line;
- bounded read-only text windows beyond that ceiling;
- rich Markdown source fallback above 4 MiB or 100,000 lines;
- CSV/TSV source fallback above 8 MiB or 100,000 rows;
- SVG source-only fallback above 5 MiB;
- an oversized-image thumbnail path above 40 million decoded pixels or an
  estimated 128 MiB RGBA bitmap, capped at 3,072 pixels on the longest edge;
- font specimens through a 64 MiB encoded-file ceiling;
- 64 KiB incidental text previews and a 20 MiB ceiling for complete explicit
  text-copy reads.

CodeMirror loading and saving now use bounded chunks and immutable document
snapshots. The extreme-text viewer uses version-checked windows, candidate-
optimized native streaming Find, and byte-correct active-match highlighting.
Ordinary images and fonts use scoped file URLs; oversized
images use ImageIO thumbnails. Audio and video remain streamed URL resources.

Profiling showed that JSON serialization of editable source chunks dominated
large-file opening time even though native disk reads and CodeMirror document
construction were fast. Those chunks now use Tauri's raw octet-stream response
and are decoded as UTF-8 in the WebView. A 17 MiB fixture fell from roughly
555 ms to 187 ms and a 50 MiB fixture from roughly 1,416 ms to 345 ms through
first paint. The existing exact native structure inspection remains separate;
a custom in-band metrics format was prototyped but rejected because it added
maintenance cost without a meaningful end-to-end improvement.

The PDF.js dependency and whole-byte PDF bridge were removed. The PDF
descriptor now embeds one retained PDFKit `PDFView` per Ghost window, loaded
directly from a file URL, with continuous pages, zoom, page navigation, Find,
selection/copy, native scrolling, focus handoff, resize tracking, and lifecycle
cleanup. Automated build checks and the core navigation, Find, zoom, and
200 MiB manual pass are complete. The broader representative fixture matrix
remains follow-up validation rather than a blocker for the current PDFKit
backend. Quick Look and optimized PDF.js remain unimplemented contingencies and
will be considered only if that matrix finds a material PDFKit gap.

Manual acceptance on 2026-08-24 invalidated the original 256 MiB CodeMirror
ceiling. A roughly 76 MiB SQL file and 100 MiB text/Markdown fixtures loaded
slowly, and editing or rapid scrolling could terminate and restart WebKit's
content process. The temporary ceiling is therefore 64 MiB: larger source goes
directly to the bounded read-only viewer after a 64 KiB probe. This is a safety
boundary, not a claim that files above 64 MiB should never be editable. The
disk-backed prototype above is the path to raising it.

Profiling the 17.1 MiB CSV edit path found a separate renderer-memory defect:
autosave correctly streamed the CodeMirror tree, but an incidental header-stats
update flattened the document and synchronously calculated words, characters,
lines, and tokens. Reproducing that calculation alone peaked at roughly 787 MiB
RSS. The statistics budgets above removed that work without changing the
then-current source ceiling; the controlled experiment below records the later
reconsideration after this fix and the HMR confounder were isolated.

The first manual retest exposed an independent development-only confounder.
The native save completed all 18 chunks and committed in 249 ms, after which
Tailwind v4's Vite plugin reloaded the page because the repo-local CSV fixture
had been registered as a scanned HMR dependency. Ghost now excludes its
runtime-editable fixture corpus from both Tailwind content scanning and Vite
watching. A repeated edit and explicit save passed; production builds never had
this development-server reload path.

On 2026-08-25 the editable ceiling was raised from 64 MiB to 128 MiB for a
controlled 100 MiB edit/save retest. This supersedes the temporary 64 MiB
boundary above for the current implementation, now that live statistics,
fixture-triggered HMR reloads, source saving, and source transport are bounded.
The manual application pass completed without a WebKit content-process restart,
and the user accepted the current opening latency. Its staged trace was roughly
623 ms: 374 ms for native inspection, 99 ms for raw transport, 61 ms for UTF-8
decode and CodeMirror document construction, and 37 ms from view creation to
first paint. Keep 128 MiB as the current empirically validated ceiling; raising
it again requires another complete open, navigation, edit, save, and reopen pass.

### Large-editor benchmark record

On 2026-08-24, Ghost benchmarked a process-isolated stock TextKit 2
`NSTextView(usingTextLayoutManager: true)` against CodeMirror's reduced
large-source document state. Each process mapped/read and decoded the fixture,
attached the document, forced a first 1200 x 800 layout where applicable,
navigated to the end, inserted one character at the midpoint, performed a
case-insensitive no-match search, and traversed the edited document for save.
The harnesses live in `scripts/textkit-benchmark.swift` and
`scripts/codemirror-benchmark.mjs`.

| Fixture | Lines | TextKit first layout | TextKit end/edit | TextKit peak RSS | CodeMirror load/state | CodeMirror end/edit | CodeMirror RSS after full search |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 17.1 MiB CSV | 314,579 | 3.75 s | 468 / 467 ms | 1.14 GiB | 26.2 / 0.7 ms | 0.04 / 0.49 ms | 130 MiB |
| 50.1 MiB CSV | 920,017 | 11.44 s | 1.47 / 1.65 s | 3.21 GiB | 59.4 / 0.6 ms | 0.04 / 0.52 ms | 227 MiB |
| 72.6 MiB SQL | 301,587 | 4.32 s | 244 / 440 ms | 2.45 GiB | 53.2 / 0.7 ms | 0.04 / 0.63 ms | 187 MiB |
| 97.4 MiB text | 2,688,656 | 33.78 s | 4.34 / 4.45 s | 7.26 GiB | 137.9 / 0.7 ms | 0.04 / 0.49 ms | 357 MiB |

The comparison deliberately answers a narrow architectural question. The
TextKit process includes an AppKit text view and native layout; the CodeMirror
process measures its real tree, reduced state extensions, transactions,
search cursor, and save traversal but not an `EditorView`, WKWebView, Tauri IPC,
or React. It is therefore not an end-to-end claim that Ghost can safely raise
the CodeMirror ceiling. It does show that stock TextKit 2 is not a safer
replacement and that CodeMirror's core document/edit operations are not the
source of the observed multi-second opening and Web-content-process failures.
The next profiling target is Ghost's bridge and view integration. At benchmark
time the 64 MiB ceiling remained unchanged; the controlled 128 MiB trial above
explicitly supersedes that temporary boundary.

Native editor abstractions were surveyed before closing the experiment. Neon
is an efficient, text-system-independent range styling and tree-sitter layer;
it explicitly is not a drop-in editor and its stock AppKit adapters still use
the underlying text view. SourceView and TextViewPlus improve `NSTextView`
behavior but retain TextKit 2's storage/layout model. STTextView reimplements
the view around TextKit 2 and adds mature editor behavior, but still owns a
complete attributed document and does not supply a disk-backed source model.

CodeEditTextView was the one materially different candidate. It owns a complete
`NSTextStorage`, but replaces TextKit layout with a line-oriented Core Text
renderer, visible-line reuse, and a red-black-tree line index. A release build
of main commit `d7ac3f11f22ec2e820187acce8f3a3fb7aa8ddec` attached the 1.2 MiB
SQL fixture in 269 ms and rendered its first viewport in 14 ms at 134 MiB RSS.
The 17 MiB/315k-line fixture had not completed attachment after 26 seconds and
had reached 695 MiB RSS, so the run was terminated and larger fixtures were not
attempted. This rules out adopting an existing native view as a quick fix. Neon
may still be useful later as a styling layer once a bounded document model and
renderer exist.

## Consequences

### Positive

- Plain-text editability survives well beyond the threshold where expensive
  language and presentation features stop being appropriate.
- A 100 MiB edit no longer creates repeated complete strings or sends old and
  new documents together through IPC.
- Rich Markdown and structured CSV degrade to exact editable source instead of
  becoming inaccessible.
- Selecting an arbitrarily large valid file no longer unconditionally creates
  several whole-file copies in the WebView.
- Image, PDF, font, and media policies reflect their actual decoded or streamed
  working sets.
- PDF renderer selection is based on representative Ghost workflows instead of
  prematurely standardizing on the existing library.
- New viewers must declare both a format handler and a resource strategy.

### Costs

- Chunked editor loading and snapshot saving require a native session protocol,
  cancellation, cleanup, conflict tokens, and exact UTF-8 handling.
- Large source mode needs a deliberately reduced CodeMirror extension set and
  separate performance tests.
- Text remains read-only beyond the validated in-memory ceiling until Ghost has
  a disk-backed editor.
- A native large-file editor is now known to require a custom bounded document
  model; using stock TextKit 2 does not remove this engineering cost.
- Embedding PDFKit adds macOS-specific native-view lifecycle, focus, coordinate,
  and z-order work and may eventually require a fallback.
- PDF behavior may diverge by platform if Ghost later ships outside macOS.
- Decoder and renderer budgets require profiling and adjustment as macOS and
  WebKit change.

## Alternatives considered

### Apply one small editable-file ceiling to every format

Rejected. A byte threshold that is enormous for a rich note may be routine for
a log, while compressed image bytes say little about decoded memory. Resource
budgets and capability degradation must be format-specific.

### Route every file above 8-16 MiB to read-only text

Rejected. It prevents useful source and log editing even though a viewport
editor can remain responsive. Read-only windowing is reserved for content
beyond the validated in-memory editor ceiling.

### Give CodeMirror or Tiptap the complete file with fewer extensions

Rejected as the complete solution. Reduced extensions help rendering but do
not remove Ghost's Rust string, IPC serialization, JavaScript string,
per-keystroke `toString()`, or whole-document save copies. Tiptap is also not a
large-log editor.

### Replace CodeMirror with Monaco solely for large files

Deferred. Monaco has mature large-file behavior, but CodeMirror already has a
tree document and viewport renderer. Ghost should first fix its surrounding
load/save pipeline; changing editor libraries would not by itself remove IPC
or autosave copies.

### Parse or render in a Web Worker

Rejected as the primary bound. A worker protects the main thread from parsing
CPU but still transfers and retains the complete file in WebView memory.

### Standardize immediately on PDF.js

Rejected as premature. PDF.js is portable and controllable but requires Ghost
to own range delivery, page virtualization, canvas memory, zoom behavior, and
WebView input integration. Native PDFKit may provide a better macOS experience.

### Standardize on PDFKit without a prototype

Rejected. Native rendering is the chosen first direction, but an AppKit view
layered into a Tauri/WKWebView window can introduce focus, z-order, resize, and
chrome-integration costs that must be proven before productionizing it.

### Silently truncate the normal editor

Rejected because the document would appear editable while containing only a
prefix. Saving such a model risks destructive data loss.

### Memory-map the file into JavaScript

Rejected. WKWebView does not expose a safe zero-copy mapping into editor data
structures, and CodeMirror would still materialize text and indexes.

## Migration

1. Keep the completed CSV row virtualization as the immediate rendering fix.
2. Replace CodeMirror's eager string autosave with dirty tracking and bounded
   snapshot writes, using compact native conflict tokens.
3. Add metadata-aware model resolution, streamed source loading, and the
   reduced large-source CodeMirror profile in both window types.
4. Add bounded windowing and native streaming Find only for text beyond the
   benchmark-validated in-memory ceiling.
5. Move ordinary images and fonts from whole-byte IPC to scoped URLs; add
   metadata-first pixel budgets and native oversized-image thumbnails.
6. Validate the implemented PDFKit path against the acceptance matrix. Consider
   Quick Look or optimized PDF.js only if it does not meet the bar.
7. Bound Command Palette, explicit copy/export, focus reload, ICNS, and every
   remaining whole-file command.
8. Benchmark normal, large, long-line, highly multiline, Unicode, image, and
   PDF fixtures; publish the tuned capability budgets in the supported-formats
   guide.
