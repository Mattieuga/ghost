# Additional books through a shared reader UI

- **Status:** accepted
- **Decided:** 2026-09-06
- **Supersedes:** nothing; extends the [EPUB reader](./2026-09-06-epub-reader.md)
- **Related:** [plan](../plans/2026-09-06-additional-book-formats.md), [architecture](../reference/ghost-architecture.md)

## Context

The owner requested trying Foliate.js for additional ebook formats and downloading sample books. The EPUB reader already has working theme, keyboard, and bookmark behavior. Comics need image pages instead of text pagination.

## Decision

Keep EPUB.js for EPUB and use Foliate's MOBI/KF8 and FB2 parsers plus its paginator for DRM-free `.mobi`, `.azw3`, and `.fb2`. Pin Foliate to commit `78914aef4466eb960965702401634c2cb348e9b1`; its upstream API has no stable release. Import just the modules we use, avoiding its demo UI and PDF engine. Ghost owns the shared footer, focus handling, color pairing, local bookmarks, and error states.

Native reads are bounded (64 MiB MOBI/AZW3; 16 MiB FB2). Kindle record tables are checked before parsing; DRM and HUFF/CDIC compression are rejected. Expanded text is limited to 64 MiB and font inflation to 8 MiB. Generated chapters are sanitized and given the same offline, script-free policy as EPUB before rendering. Book links are handled by Ghost. The app CSP allows local blob fetches and frames; chapter CSP still blocks scripts and remote resources. Files stay read-only and bookmarks remain local UI state keyed by path. EPUB bookmarks retain their existing format.

For `.cbz` and `.cbr`, reuse the existing bounded archive listing and per-entry preview cache. Display raster pages in natural filename order, with page selection, arrows, zoom, and reading direction. Only the selected page is materialized in temporary storage; release it on navigation/unmount. Never extract a comic beside its original or alter the archive. PDF remains native PDFKit.

## Rejected alternatives

- Replace EPUB.js immediately: unnecessary bookmark and rendering migration while evaluating the additional formats.
- Convert books on disk: introduces duplicate user files and extra tooling.
- Foliate's entire demo reader: brings unrelated PDF, search, annotation, and UI behavior into Ghost.

## Consequences

Two text engines share a small UI and content policy. `pnpm-workspace.yaml` registers the dependency patch in `patches/`: propagate chapter-load failures and clean up asynchronous font/layout work when closing, including incomplete startup. Foliate upgrades require real browser regression checks. DRM, KFX, zipped FB2, annotations, nested book previews, and Cloud book sync remain outside this addition. Public sample downloads live in the owner's requested fixture folder, with source information; they are not bundled into the app.

## References

- [Foliate.js](https://github.com/johnfactotum/foliate-js)
