# Extensible file-viewer roadmap

- Created: 2026-08-21
- Architecture: [`../architecture/0001-extensible-file-viewers.md`](../architecture/0001-extensible-file-viewers.md)

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

Status: Planned

- Extract shared media resource, error, and lifecycle handling from audio.
- Add video controls, aspect-ratio fitting, fullscreen, and optional captions.
- Classify ambiguous containers such as MP4, MOV, Ogg, and WebM using track metadata or a runtime media probe.
- Preserve hardware decoding by relying on the platform WebView rather than bundling codecs by default.

## Phase 4: Broad read-only coverage

Status: Planned

- Add a native Quick Look action or embedded preview for common macOS-supported formats, including Office/iWork documents and formats supplied by installed preview extensions.
- Add an archive browser that lists entries without extracting automatically.
- Add an incremental hex viewer as the final in-app fallback for arbitrary binary files.
- Consider structured read-only or editable views for property lists, large JSON, SQLite metadata, and similar formats only where round-trip behavior is well defined.

## Cross-cutting follow-ups

- Add bounded signature/MIME detection for unknown and mislabeled files.
- Record text encoding and line-ending metadata; preserve them when editing non-UTF-8 text.
- Add a large-text mode rather than mounting enormous documents in the normal CodeMirror configuration.
- Centralize viewer resource cleanup, external file refresh, and metadata formatting.
- Keep classification tests table-driven so each new extension declares its viewer, load mode, and capabilities.
