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

Status: In progress 2026-08-22

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
