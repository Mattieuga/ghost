# EPUB reading through the existing viewer pipeline

- **Status:** accepted
- **Decided:** 2026-09-06
- **Supersedes:** nothing
- **Related:** [file viewers](./0001-extensible-file-viewers.md), [plan](../plans/2026-09-06-epub-reader.md), [architecture](../reference/ghost-architecture.md)

## Context

EPUBs need book-aware layout and navigation. Ghost already separates read-only binary viewers from editors; opening a book should follow that path without extracting or rewriting the original file.

## Decision

We chose lazy-loaded EPUB.js for EPUB 2/3 layout, navigation and CFI reading positions because implementing those formats ourselves would turn a small viewer into a publishing engine. Rust validates ZIP contents with the existing zip crate (now a direct dependency with deflate enabled) and returns bounded binary IPC: 64 MiB compressed, 32 MiB per resource, 256 MiB actually expanded, and 10,000 entries. Validation and rendering use the same byte snapshot.

The viewer is read-only. Book iframes permit same-origin access and Ghost-owned DOM event handlers; WebKit requires both sandbox tokens for working chapter links. Book scripts remain blocked by a `script-src 'none'` chapter CSP, installed before rendering, plus removal of active content. Popups and top-level navigation remain sandboxed, and book links have no native hrefs; Ghost resolves their stored targets. A pre-render content hook removes active elements and external links and inserts an offline CSP. Blob styles and fonts are allowed in the app CSP for packaged book resources. The existing media-asset hook provides version checks and refresh on filesystem changes or focus; only the exact book file enters asset scope, with no folder grant. Publisher text and background colors are overridden together with Ghost’s theme, including inline important declarations; image and SVG artwork is preserved. Position and text size live in local UI storage, separate from book files and Cloud.

## Rejected alternatives

- Quick Look: inconsistent EPUB support and no Ghost-owned reading controls.
- A custom EPUB parser/layout engine: too much compatibility work for this feature.
- Convert to Markdown: loses book layout and creates a second document.

## Consequences

EPUB.js adds a lazy JavaScript chunk and requires lifecycle and sandbox regression coverage. Protected resources, including obfuscated fonts, exceed this version's scope and get an external-reader fallback. No editing, annotations, Cloud book sync, or nested archive previews are added. Local bookmarks are keyed by file path, so moving or renaming a book starts a new reading position.

## How to apply

Classify `.epub` as `viewer-owned`, never editable or text-probed. Load through `read_epub`; register the chapter safety hook before rendering. Destroy renditions and revoke book resource URLs when leaving a book. Run `node scripts/check-epub-reader.mjs` (Chrome) and `node scripts/check-epub-reader.mjs webkit` when upgrading EPUB.js. The harness mocks native IPC and never opens the desktop entry or starts Tauri. Its sample books are original fixtures under `example test files/`.

## References

- [EPUB.js](https://github.com/futurepress/epub.js/)
- [EPUB 3.3](https://www.w3.org/TR/epub-33/)
