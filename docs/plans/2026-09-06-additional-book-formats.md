# Plan: additional book formats

**Branch:** `feat/sharing-polish`
**Related references:** [ADR](../adrs/2026-09-06-additional-book-formats.md)
**Last updated:** 2026-09-06
**Current status:** done — implementation and automated verification passed; ready for native click-through.

## Scope

Add MOBI/AZW3/FB2 through Foliate and CBZ/CBR through the existing archive backend. Share the minimal reader controls and preserve EPUB behavior. Download sample books into `/Users/matt/code/ghost/example test files` with provenance. No book edits, Cloud changes, app relaunch, or GitHub writes.

## Implementation and acceptance

1. Pin the parser dependency; add bounded native reading, sanitized chapter loading, shared controls, local bookmarks, and viewer routing.
2. Add comics with page cache cleanup, natural sorting, zoom, and direction controls.
3. Exercise actual formats in an isolated browser harness: chapter/page changes, keyboard focus after dropdown selection, saved location, text/background contrast, script blocking, and cleanup.
4. Run frontend tests, desktop/web builds, and Rust tests. Reconcile references and commit locally under the user's existing instruction.

## Resumption

Read git status and this plan. Foliate source was inspected in `/tmp/ghost-foliate-evaluation`. Keep original EPUB checks passing. Never start Tauri; the user will click through the ready change in their running app.

## Verification

- Frontend: 501 passed, 2 existing skipped tests.
- Rust: 74 passed, including actual MOBI and AZW3 validation.
- Desktop and web builds passed.
- Existing EPUB WebKit checks passed after extracting shared controls and content policy.
- Foliate integration passed in Chrome and WebKit: MOBI/AZW3/FB2 rendering, links, chapter selection, arrows after selection and across chapters, saved text position/font size, paired light/dark colors, script blocking, resize, resource cleanup, and leaving during a pending native read.
- Comic integration passed for the original CBZ fixture and for downloaded Tom Sawyer RAR pages: page selection, arrows, RTL, zoom, saved page, and per-entry cleanup. The harness uses the actual macOS archive command with mocked native IPC; the existing Rust archive suites also passed.
- Six sample books are in `/Users/matt/code/ghost/example test files`, together with their source note and the FB2 fixture license. The CBZ edition of Tom Sawyer was repackaged from the downloaded CBR pages without image changes.
- No app restart or GitHub writes. New native commands and CSP changes require a user-requested relaunch before native click-through.

## Limits

DRM/KFX, HUFF/CDIC-compressed Kindle files, zipped FB2, annotations, nested book previews, and Cloud sync are out of scope. Source books are never changed. Comics use temporary per-page materialization, released on navigation/close.
