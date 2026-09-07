# EPUB.js lifecycle gaps

**Learned:** 2026-09-06
**Related:** [EPUB reader ADR](../adrs/2026-09-06-epub-reader.md)

EPUB.js 0.3.93's archive destructor revokes resource path keys instead of the cached blob URL values. Its resource destructor also drops rewritten stylesheet URLs without revoking them. Ghost's `destroyEpubBook` collects both sets before destroying the book and explicitly revokes them. The browser integration check tracks every created URL and requires zero live URLs after closing a book.

The library also starts navigation loading without a rejection handler. A missing or malformed table of contents can leave `loaded.navigation` pending and emit an unhandled rejection. Ghost falls back to the library's empty-navigation path, then builds chapter choices from the spine. Opening and displaying are time-bounded because some other malformed-book paths leave internal promises pending.

Do not destroy a book while its asynchronous open is still accessing its internal state. Mark the load cancelled, suppress UI updates, and dispose after the pending open settles. Regression checks must include changing books and closing/reopening a book, not just its initial display.

WebKit blocks DOM link handlers in a frame without the sandbox script token, including listeners registered by the parent. The reader therefore permits Ghost-owned handlers, while the pre-render chapter CSP forbids all book scripts. In-book links have no native href, so even an early click cannot navigate away and discard the chapter CSP. Ghost resolves their saved targets for clicks and Return; role and tabindex preserve keyboard accessibility. Integration tests verify that both injected scripts and inline event attributes stay blocked in WebKit and Chrome.

Keep the reader footer height stable while loading and changing chapters. A resize triggered by changing footer wrapping can redisplay the previous CFI over a newly selected chapter. The footer groups controls into a stable row, and the ResizeObserver skips its initial same-size callback.

Crossing chapters destroys the old iframe. If it held keyboard focus, WebKit drops focus to the outer document body, and later arrow keys never reach either the new chapter or Ghost’s viewer handler. Capture the focused chapter before navigation, and focus the stable reader when that frame is gone and focus has fallen back to the body. Do not steal focus if the user moved to another control. The integration check crosses chapters forward and backward using real keypresses without clicking the new chapter.
