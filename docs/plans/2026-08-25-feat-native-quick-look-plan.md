# Native Quick Look document preview plan

- Created: 2026-08-25
- Architecture: [`../adrs/0003-native-quick-look-document-previews.md`](../adrs/0003-native-quick-look-document-previews.md)
- Parent roadmap: [`file-viewer-roadmap.md`](file-viewer-roadmap.md)
- Target release: 0.11

## Goal

Let Ghost preview common word-processing, spreadsheet, presentation, rich-text,
and iWork documents inline using the native macOS Quick Look stack, without
converting, editing, or copying complete files into JavaScript.

## Phase 0: Feel prototype

Status: Implementation ready for manual feel test — 2026-08-25

- Add a `quick-look` viewer kind and explicit document extension registry.
- Route supported documents through viewer-owned, read-only loading.
- Embed a normal-style `QLPreviewView` in the active Tauri webview window.
- Reuse the proven PDFKit frame, generation, focus, refresh, hide, and window
  cleanup lifecycle.
- Keep Ghost's Open Externally action visible.
- Add classification, loader, routing, and lifecycle-focused tests.
- Test the prototype in both the main window and an accessory window.

Prototype formats:

- Word: `.doc`, `.docx`, `.docm`, `.dot`, `.dotx`, `.dotm`
- Excel: `.xls`, `.xlsx`, `.xlsm`, `.xlsb`, `.xlt`, `.xltx`, `.xltm`
- PowerPoint: `.ppt`, `.pptx`, `.pptm`, `.pps`, `.ppsx`, `.ppsm`, `.pot`,
  `.potx`, `.potm`
- iWork: `.pages`, `.numbers`, `.key`
- Rich text: `.rtf`
- OpenDocument: `.odt`, `.ods`, `.odp`

Acceptance checks:

- Opening each representative family shows an inline native preview or a clear
  Quick Look unsupported state without changing the file.
- Documents never invoke text probing or whole-file reads.
- Scrolling, text selection, links, zoom, and page/sheet/slide navigation feel
  native where Quick Look exposes them.
- Closing the sidebar and editor-focus commands put focus in the preview.
- Resizing the window/sidebar keeps the native surface aligned.
- Switching, renaming, deleting, replacing, or closing a document releases or
  refreshes the correct native view without leaving an overlay behind.
- Open Externally remains available.

Manual feel questions:

- Does the native Quick Look chrome feel at home inside Ghost?
- Is the amount of whitespace appropriate at normal and minimum window widths?
- Are Word pages, spreadsheet sheets, and presentation slides navigable enough
  for a read-only viewer?
- Should Ghost add any surrounding metadata or controls, or let Quick Look own
  the entire preview surface?
- Does RTF belong in Quick Look, or should it eventually receive a dedicated
  native rich-text editor?

Prototype verification notes:

- Frontend: 28 test files and 255 tests pass.
- Native: 45 Rust tests pass and the Quick Look framework links successfully.
- Production frontend build passes.
- A Finder Quick Look thumbnail preflight generated previews for the DOC, RTF,
  ODT, XLS, XLSX, and PPT fixtures. The combined nine-file command stalled
  before completing DOCX, ODS, and ODP, so those formats remain explicit
  priorities for the embedded-view manual pass rather than being inferred from
  the thumbnail service.

Manual feedback — 2026-08-25:

- The embedded surface and supported previews feel native and visually fit
  Ghost.
- The ODS and ODP fixtures show Quick Look's generic document icon. Their UTIs
  are recognized by macOS, but this Mac has no registered Quick Look provider
  for either type; the built-in Text provider covers ODT only.
- The DOCX fixture is a valid Open XML ZIP and Apple registers its Office Quick
  Look provider, but that particular document stalls/fails the provider.
  `textutil` can still extract its text, making it a useful fallback fixture.
- Finder's panel and embedded `QLPreviewView` use the same provider and internal
  `QLWeb2View`, but the public embedded mode disables generated-document text
  selection. Ghost now dynamically opts into the panel interaction mode before
  loading the item and focuses the provider's deepest responder. The selector
  is guarded and falls back to standard embedded behavior if unavailable.
- Production hardening should distinguish tested native previews from
  best-effort installed-extension formats and evaluate an explicit extracted-
  text mode for selectable/searchable Word, RTF, and ODT content.

## Phase 1: Production hardening

Status: Planned after prototype feedback

- Record a fixture-backed compatibility matrix across Office, iWork, RTF, and
  OpenDocument variants, including large and malformed files.
- Refine loading and failure presentation based on Quick Look's observable
  behavior.
- Verify accessibility, keyboard traversal, copy/select, Find, and external
  file replacement.
- Decide whether preview display state should be preserved when navigating away
  and back.
- Document actual format behavior in `docs/reference/supported-file-formats.md`.

## Phase 2: Broader Quick Look coverage

Status: Planned

- Evaluate EPUB, web archives, RAW/design/3D formats, and formats supplied by
  installed preview extensions.
- Decide between explicit routing, a user-invoked Preview action on unsupported
  files, or a bounded native capability probe.
- Evaluate directory-backed document packages such as RTFD without weakening
  ordinary folder navigation.
- Reuse the same surface for archive entries only after cache leases and
  read-only provenance remain explicit.

## Out of scope

- Editing or round-tripping Office, iWork, RTF, or OpenDocument files.
- Cloud publishing, synchronization, or collaboration.
- Bundling LibreOffice, server-side conversion, or JavaScript Office renderers.
- Replacing Ghost's dedicated PDF, image, media, archive, or text viewers.
- Cross-platform document preview parity.
