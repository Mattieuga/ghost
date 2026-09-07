# Foliate integration boundaries

Foliate's individual parsers and paginator work with Ghost's UI, but the pinned upstream revision assumes the demo reader's lifetime. WebKit regression checks exposed errors from delayed font and resize callbacks after React removed a chapter iframe: `documentElement` was being read from a null document. Its initial `destroy()` also assumed a first page had loaded, and a failed section load was caught and replaced with an empty navigation result.

The tracked pnpm patch propagates section-load failures, destroys a partially initialized MOBI parser, disconnects the chapter resize observer, and guards layout callbacks after removal. Ghost waits for active operations to settle before disposing the book, and ignores native reads that finish after leaving the viewer.

The other integration boundary is the generated chapter URL. Unlike EPUB.js's in-memory document hook, these parsers return blob URLs. Ghost reads that blob, sanitizes its detached document, installs the offline CSP, and gives only the sanitized URL to the paginator. The app CSP therefore needs both `connect-src blob:` and `frame-src blob:`. The chapter still has `script-src 'none'`; inline scripts, same-origin external scripts, event attributes, native navigation, and remote resource loading remain blocked.

FB2 creates one shared stylesheet URL at module evaluation. That URL lives for the module lifetime; all per-book chapter/resource URLs must be released. The integration harness accounts for that one shared URL explicitly.

Run `node scripts/check-ebook-reader.mjs` and `node scripts/check-ebook-reader.mjs webkit` after changes. `GHOST_COMIC_SAMPLE=/absolute/path/to/book.cbr` also exercises a real RAR archive's pages through the harness. The harness serves known fixtures and mocks native IPC; it never starts Tauri or opens the desktop entry.
