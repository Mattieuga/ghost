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

Interactive read-only viewers expose one primary keyboard destination with the `data-viewer-focus-target` attribute. Editor-focus commands and focus that would otherwise stop on the surrounding scroll surface are redirected there. This keeps keyboard ownership consistent between the sidebar and the active viewer without adding viewer-specific branches to the window layouts.

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

### Costs

- Open-file state now includes a descriptor in addition to path and content.
- Some existing convenience predicates become compatibility helpers or disappear.
- Native Quick Look and media asset scoping still require platform-specific Rust work.
- Content signatures, non-UTF-8 encodings, and large-text editing remain separate follow-up projects.

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
5. Add broader fallbacks such as Quick Look, archives, and an incremental hex viewer.
