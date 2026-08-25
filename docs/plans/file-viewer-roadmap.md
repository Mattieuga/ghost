# Extensible file-viewer roadmap

- Created: 2026-08-21
- Architecture: [`../architecture/0001-extensible-file-viewers.md`](../architecture/0001-extensible-file-viewers.md)
- Large-file architecture: [`../architecture/0002-bounded-large-file-loading.md`](../architecture/0002-bounded-large-file-loading.md)

## Goals

- Make viewer additions predictable and difficult to misclassify.
- Preserve safe text round-tripping and explicit read-only behavior.
- Support large seekable media without whole-file JavaScript copies.
- Provide increasingly useful fallbacks for files without a dedicated editor.

## Phase 1: Classification and loading foundation

Status: Completed 2026-08-22

- Add positive viewer kinds, load modes, and file capabilities.
- Add a single `classifyFile` entry point while retaining existing language detection.
- Add a shared `loadFileModel` service for main and accessory windows.
- Resolve successful unknown-text probes to the code/text viewer.
- Replace binary checks in viewer routing, headers, rename reloads, search, and focus reloads.
- Bound the Rust unknown-text probe before loading the complete text.
- Add table-driven classification and loader tests plus Rust probe tests.

Acceptance checks:

- Every currently supported type opens in the same viewer as before.
- An extensionless or obscure UTF-8 file still opens as editable text.
- A known image/PDF/font never invokes text probing.
- Unsupported binary files remain read-only with Open Externally.
- Main and accessory windows use identical loading decisions.

## Phase 2: Audio viewer

Status: Implemented 2026-08-22 — awaiting manual codec and interaction verification

- Added an audio/media load mode backed by a seekable Tauri asset URL.
- Enabled an empty static scope, exact runtime file grants, and the required media CSP.
- Added a WebKit-backed `AudioViewer` using accessible HTML controls and `preload="metadata"`.
- Recognizes MP3, M4A/M4B, AAC, WAV/BWF, AIFF/AIFC, CAF, FLAC, Ogg/Opus, AU/SND, and AC-3 families, with runtime codec failure handling.
- Shows filename, size, duration, focused keyboard controls, and Open Externally fallback.
- Refreshes replaced media on filesystem/focus checks and pauses and releases its source on navigation or window close.

Acceptance checks:

- Common MP3, M4A, WAV, AIFF, FLAC, and Ogg samples either play or show a clear unsupported-codec fallback.
- A long recording starts and seeks without loading the entire file into JavaScript memory.
- Switching files stops playback and releases the old resource.
- Rename, delete, and external-change behavior remain coherent while audio is open.
- Main and accessory windows behave the same way.

## Phase 3: Shared media and video

Status: Implemented 2026-08-22 — awaiting final manual release verification

- Extract shared HTMLMediaElement state, lifecycle, errors, and responsive Ghost controls from audio without changing its behavior.
- Add a dedicated video viewer with contain-fit rendering, dimensions/file metadata, stable loading, and Open Externally fallback.
- Route common and best-effort legacy video containers through the asset URL load mode; retain runtime codec failure handling.
- Add capability-gated fullscreen, double-click fullscreen, and video keyboard controls.
- Preserve hardware decoding by relying on the platform WebView rather than bundling codecs.
- Defer Picture in Picture, captions, posters, and content-based track probing until the base viewer is verified.

Acceptance checks:

- Audio behavior and keyboard controls remain unchanged after extracting shared media code.
- H.264/AAC MP4, MOV, and VP8/VP9 WebM samples play when supported by the installed WebKit.
- Unsupported AVI, WMV, MKV, or codec combinations show a useful failure and Open Externally action.
- Landscape, portrait, unusual-aspect, long, and large video files fit and seek without whole-file JavaScript loading.
- Controls remain usable at minimum window width; fullscreen is never shown when unavailable.
- Switching, renaming, deleting, replacing, or detaching a video releases the previous source and preserves focus behavior.

## Phase 4: Archive browser

Status: Implemented 2026-08-24 — awaiting final manual UI and extraction verification

- Add an `archive` descriptor and viewer-owned load path for ZIP, TAR,
  compressed TAR, CPIO, 7-Zip, and RAR-family extensions.
- Read a bounded mtree manifest through macOS `bsdtar` and return structured
  paths, entry types, sizes, timestamps, link targets, and totals.
- Present a searchable, keyboard-navigable hierarchy without extracting entry
  contents or loading archive bytes into the webview.
- Add an explicit **Extract…** action that selects a parent directory, creates
  a collision-free output folder, and delegates extraction to `/usr/bin/tar`.
- Preserve the archive, reject unsafe paths through libarchive's default
  protections, avoid overwriting existing output, and report cleanup failures.
- Keep Open Externally available for encrypted, corrupt, unsupported, or
  platform-dependent archives.
- Present raw GZIP and BZIP2 streams as one-file manifests and decompress them
  only after the explicit extraction action.
- Materialize unique regular-file entries from every supported archive family
  into a bounded, session-scoped cache only after an explicit preview action.
- Detect the resulting payload and reuse Ghost's read-only image, PDF, font,
  audio, video, or source viewer in a responsive inline detail pane.
- Cancel stale work, remove partial artifacts, lease visible cache entries, and
  enforce per-kind limits plus a 512 MiB inactive-entry LRU budget.

Acceptance checks:

- ZIP, TAR, TGZ/TAR.GZ, TAR.BZ2, and TAR.XZ samples list their hierarchy and
  metadata without extraction.
- Raw GZIP preserves its embedded filename when available; raw BZIP2 derives
  its output name from the stream filename, and both extract into a new folder.
- Space, Enter, double-click, and Preview open an entry without writing beside
  the archive; Escape/Back returns focus to the same row.
- ZIP, TAR and compressed TAR variants are covered with real preview round trips;
  platform-dependent CPIO, 7-Zip, RAR and Zstandard use the same backend path
  whenever the installed macOS libarchive can read them.
- Oversized, duplicate-path, linked, corrupt, encrypted and cancelled entries
  fail safely and leave no partial cache artifact.
- Large manifests stop at a documented bound instead of growing webview or
  backend memory without limit.
- Keyboard arrows move through visible entries; Left/Right collapse and expand
  folders; the search field filters paths without mutating the archive.
- Extracting creates a new named directory under the selected parent, never
  overwrites an existing directory, and reveals the completed result in Finder.
- Malformed, encrypted, and unsupported archives show a useful error and Open
  Externally action.

## Phase 5: Large-file hardening

Status: Implemented; manual large-file and PDFKit acceptance passes pending — see [`large-file-hardening.md`](large-file-hardening.md)

- Resolve metadata and resource budgets before loading content.
- Keep large source editable with reduced features and streamed loading/saving;
  reserve chunked read-only inspection for the validated in-memory ceiling.
- Move images and fonts away from whole-byte IPC and bound decoder resources.
- Validate the implemented native PDFKit path against the integration and
  quality bar; consider other PDF backends only if it does not meet that bar.
- Bound incidental preview, font, copy, and reload reads.

## Phase 6: Broad read-only coverage

Status: Planned

- Add a native Quick Look action or embedded preview for common macOS-supported formats, including Office/iWork documents and formats supplied by installed preview extensions.
- Add an incremental hex viewer as the final in-app fallback for arbitrary binary files.
- Consider structured read-only or editable views for property lists, large JSON, SQLite metadata, and similar formats only where round-trip behavior is well defined.

## Cross-cutting follow-ups

- Add bounded signature/MIME detection for unknown and mislabeled files.
- Record text encoding and line-ending metadata; preserve them when editing non-UTF-8 text.
- Run and record the manual large-file/PDFKit acceptance matrices in
  [`large-file-hardening.md`](large-file-hardening.md).
- Centralize viewer resource cleanup, external file refresh, and metadata formatting.
- Keep classification tests table-driven so each new extension declares its viewer, load mode, and capabilities.
