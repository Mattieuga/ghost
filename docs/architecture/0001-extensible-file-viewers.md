# ADR 0001: Extensible file classification and viewers

- Status: Accepted
- Date: 2026-08-21
- Related plan: [`../plans/file-viewer-roadmap.md`](../plans/file-viewer-roadmap.md)

## Context

Ghost supports rich Markdown, source code and plain text, CSV/TSV, SVG, images, PDF, and fonts. Each dedicated viewer is already isolated in its own React component, but the surrounding file pipeline is distributed across extension predicates, negative binary checks, duplicated loaders in the main and accessory windows, and viewer-specific header conditions.

That structure is workable for a small set of formats but becomes unsafe as support grows. A newly recognized binary format must currently be excluded from unknown-text probing, added to the viewer router, and reflected separately in window chrome. Unknown-file probing also reads the whole file before deciding whether it is text. Whole-file byte IPC, while acceptable for small images or fonts, is not a suitable default for seekable media.

Ghost aspires to preview as many useful file types as practical while preserving a crucial distinction: text editors may write files, while binary and generated previews are read-only unless a format has an explicitly safe editor.

## Decision

Ghost will model every open file with a positive `FileDescriptor` produced by one classifier. A descriptor identifies:

- the viewer kind;
- how content is loaded;
- whether the file is editable and searchable;
- whether text statistics or external-open controls belong in the window chrome;
- optional format metadata such as MIME type.

The classifier and descriptor registry remain framework-independent. React viewer selection is a separate, exhaustive mapping from viewer kind to component. This preserves compile-time pressure to handle new kinds without coupling file classification to UI imports.

Both the main window and accessory editor windows will use one shared loader returning a `FileModel` containing the path, resolved descriptor, and optional text content. Known text is read as text; known binary viewers own their resources; unknown files receive a bounded text probe and become ordinary code/text documents only when that probe succeeds.

Window chrome, search availability, reload-on-focus behavior, and save behavior will use descriptor capabilities instead of inferring behavior from a negative `isBinaryViewer` test.

Large binary media will be delivered as seekable URLs rather than serialized byte arrays. Audio and video use Tauri's scoped asset protocol, with an empty static scope, exact runtime file grants, and CSP directives limited to media. Viewers must release resources and stop playback when unmounted.

Audio playback uses an HTML `audio` element inside the Tauri WebView. This is a WebKit-backed player that uses the platform media stack, not a separately embedded AppKit or Swift `AVPlayer` view. The DOM player preserves Ghost's existing window, focus, theming, and accessibility architecture while Tauri's range-capable asset protocol provides seeking without a whole-file JavaScript copy. Runtime grants accumulate for the application session because Tauri's asset scope does not expose a safe allow-list removal operation; each grant is limited to a canonical file path.

Video follows the same media substrate with a dedicated `video` viewer kind and visible HTML `video` element. Audio and video share HTMLMediaElement lifecycle/state handling and Ghost's custom playback controls, while their presentation remains separate: audio uses a compact file card and video uses a responsive contain-fit stage. Ghost does not bundle FFmpeg or transcode media in this phase; WebKit retains hardware decoding and unsupported containers/codecs fail into an explicit Open Externally state.

Container extensions select a likely viewer but do not assert codec support. Formats with established video-oriented extensions route to video, including best-effort legacy containers, and WebKit decides at metadata/decode time whether the tracks are playable. Ambiguous `.ogg` remains audio-oriented while `.ogv` is video-oriented. A future bounded track probe may replace these defaults without changing viewer callers.

Media features backed by WebKit presentation APIs, such as fullscreen and Picture in Picture, are exposed only after runtime capability detection. On macOS, Ghost explicitly enables WKWebView's element-fullscreen preference because embedded webviews disable the DOM Fullscreen API by default. Fullscreen is part of the initial video phase; Picture in Picture and sidecar captions remain follow-ups until their Tauri/WKWebView behavior is manually verified.

Interactive read-only viewers expose one primary keyboard destination with the `data-viewer-focus-target` attribute. Editor-focus commands and focus that would otherwise stop on the surrounding scroll surface are redirected there. This keeps keyboard ownership consistent between the sidebar and the active viewer without adding viewer-specific branches to the window layouts. A viewer with its own read-only filtering interface may register the viewer-find command while mounted so both the native Find menu item and Command-F target that interface without advertising editable document search or replacement capabilities.

Archive files use a dedicated read-only browser backed by macOS's bundled
`bsdtar`/libarchive rather than loading compressed bytes into JavaScript or
bundling a second decompression library. Ghost asks `bsdtar` to convert the
archive directory to an mtree manifest, parses that bounded manifest into
structured entry metadata, and renders the hierarchy in React. Unsupported,
encrypted, corrupt, or excessively large manifests fail without changing the
archive and retain the Open Externally path.

Raw gzip and bzip2 files are single-file compression streams, not containers,
but reuse the archive viewer as a one-entry manifest. Ghost reads only bounded
gzip header metadata to recover an embedded filename when present; bzip2 output
names are derived from the source filename. It does not decompress either
stream merely to list it or calculate its expanded size. Explicit extraction
streams `/usr/bin/gzip -dc` or `/usr/bin/bzip2 -dc` directly into a newly-created
file without a shell or loading decompressed bytes into application memory.

Extraction is a separate, explicit capability rather than a side effect of
opening an archive. The user chooses a parent directory; Ghost atomically
creates a new, collision-free child directory derived from the archive name
and invokes `/usr/bin/tar` without a shell. Extraction keeps libarchive's
default absolute-path, `..`, and symlink traversal protections, adds
keep-existing semantics, and never runs with preserve-permissions or
absolute-path options. A failed extraction removes only the new directory
Ghost created; if cleanup fails, the error identifies the partial directory.
Password entry and selective extraction are deferred.

Archive entry preview is a separate read-only materialization capability shared
by every archive family the operating-system reader can list. Previewing still
requires decompression, but never writes beside the source archive: Ghost
streams one unique regular-file entry into a session-scoped directory under
Tauri's application cache, classifies the completed artifact by filename and
bounded content inspection, and passes it to an existing viewer. Raw gzip and
bzip2 streams use the same path with their single synthetic entry. Directories,
links, duplicate paths, encrypted entries, nested archives, and unsupported
payloads are not rendered; failed or unrenderable temporary artifacts remain
subject to the same lease and cleanup rules.

Materialization is explicit and bounded by the decompressed result, not the
compressed input or untrusted manifest metadata. Text-like artifacts stop at
10 MiB, images/PDF/fonts at 100 MiB, and audio/video at 256 MiB; 256 MiB is the
absolute per-artifact ceiling. A request may be cancelled and partial output is
removed. Completed artifacts are atomically published, leased while visible,
and retained only in the current session. The cache evicts inactive least-
recently-used entries above 512 MiB, is removed on normal exit, and abandoned
session or partial directories are removed on the next launch. Only the exact
completed artifact is admitted to the WebView asset scope.

Archive preview stays inside the archive viewer so selection and provenance
remain visible. Wide layouts use a tree/detail split; narrow layouts drill into
the detail with an explicit Back action. Selection never decompresses by
itself: Space, Enter, double-click, or Preview starts materialization. A future
pop-out must use a dedicated read-only preview window and cache lease rather
than reusing the editable accessory-window contract.

## File detection policy

Detection is layered:

1. Exact filenames and extensions select deterministic known handlers.
2. Known binary handlers are never passed through text detection.
3. Unknown files receive a bounded UTF-8 text probe.
4. Future signature/MIME probing may refine unknown or ambiguous formats without changing callers.
5. A file that cannot be rendered remains read-only and offers an external-open path; future Quick Look and hex viewers may improve this fallback.

An extension is a routing hint, not proof that a container's codec is playable. Media viewers must handle runtime decode failures without treating the file as corrupt or editable text.

## Consequences

### Positive

- Adding a viewer becomes one classification entry, one exhaustive UI route, and focused tests.
- Known media cannot accidentally trigger whole-file text probing.
- Main and accessory windows share loading semantics, including rename behavior.
- Capabilities make read-only, searchable, and editable behavior explicit.
- The same media substrate can support audio first and video later.
- Shared controls keep audio and video interaction consistent without merging their layouts.
- Archive inspection and extraction reuse the operating system's maintained
  format support while keeping compressed data out of the webview.

### Costs

- Open-file state now includes a descriptor in addition to path and content.
- Some existing convenience predicates become compatibility helpers or disappear.
- Native Quick Look and media asset scoping still require platform-specific Rust work.
- Content signatures, non-UTF-8 encodings, and large-text editing remain separate follow-up projects.
- Broad video routing improves fallback behavior but cannot make an unsupported codec playable.
- Archive behavior depends on the libarchive version supplied by the running
  macOS release, so recognized legacy formats can still fail gracefully.

## Alternatives considered

### Continue adding predicates and branches

Rejected because every format expands the number of combinations that must remain synchronized, and negative binary classification makes omissions dangerous.

### Put React components directly in a plugin registry

Rejected for now. Ghost does not need runtime third-party viewer plugins, and a React-aware registry would couple pure classification to the UI. A typed static registry plus exhaustive rendering provides most of the value with less machinery.

### Use whole-file byte IPC for media

Rejected as the long-term media path because it delays playback, duplicates memory, and does not scale to large seekable files.

### Use Quick Look for every non-text format

Rejected as the primary path because Ghost's dedicated viewers provide a more consistent interface and editing affordances. Quick Look remains a high-value fallback for broad macOS coverage.

## Migration

1. Introduce descriptors, a pure classifier, and a shared loader while preserving current viewers.
2. Route existing viewers and chrome from descriptors; remove negative binary checks from callers.
3. Add WebKit-backed audio through the scoped asset protocol.
4. Reuse the media substrate for video and ambiguous media containers.
5. Add a read-only archive browser and explicit OS-backed extraction.
6. Add broader fallbacks such as Quick Look and an incremental hex viewer.
