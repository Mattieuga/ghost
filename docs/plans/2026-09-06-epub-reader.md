# Plan: EPUB reader

**Branch:** `feat/sharing-polish`
**Related references:** [EPUB reader ADR](../adrs/2026-09-06-epub-reader.md), [file viewers](../adrs/0001-extensible-file-viewers.md)
**Last updated:** 2026-09-06
**Current status:** done — reader shipped; arrow-key focus loss across chapters reproduced and fixed. Ready for native click-through.

## Why this plan exists

Add a small read-only EPUB viewer as a separate local commit before resuming Cloud work. If interrupted, resume from the status and checklist here.

## Key decisions (committed)

Use lazy-loaded EPUB.js inside the existing viewer route, with bounded native reads and script-free, offline chapter rendering. Preserve book files; remember reading position in local UI storage. See the linked ADR.

## Out of scope

Editing, annotations, DRM or font deobfuscation, Cloud EPUB sync, and previewing EPUBs nested inside archives. There are no lossy writes or extraction steps.

## Phase 1 — reader

- Route `.epub` as viewer-owned and read-only in both desktop window types.
- Render chapters, contents, page navigation and adjustable text; restore reading position.
- Bound native ZIP reads, block active/remote book content, clean up resources, and show useful errors with external-open fallback.
- Add representative EPUB 2/3 fixtures and regression tests; run frontend tests, desktop and web builds, and Rust tests.

**Acceptance:** tests and builds pass; real EPUBs render through the viewer in the isolated browser harness. Native click-through waits for the user to relaunch Ghost.

## Verification

- `pnpm test`: 487 passed, 2 existing skipped tests.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 70 passed.
- `pnpm build` and `pnpm build:web`: passed.
- Chrome and WebKit integration checks: EPUB 2/3, chapter links, images/styles, navigation, saved position, font sizing, light/dark color pairing, resize, blocked scripts, and resource cleanup passed.
- No Cloud implementation changes, app restart, or GitHub writes.

## Click-through follow-up — arrow keys

The initial integration check covered chapter links, contents selection, and page buttons but did not continue typing after a keyboard chapter crossing. The new check reproduces the failure in WebKit: the old focused iframe disappears and focus falls back to the outer body. Restore focus to the stable reader only when the old chapter held focus and the user has not moved elsewhere. Forward/backward chapter crossings now run in the standard browser check for both buttons and keyboard.

Bookmark storage remains unchanged: on each location event, save CFI, chapter href and font size in WebView localStorage under the absolute file path. No book writes or Cloud storage.

## Resumption checklist

- Inspect `git status` before staging; keep Cloud work outside this commit.
- Implementation lives in `epub-viewer.tsx`, `lib/epub.ts`, and `commands/epub.rs`.
- Browser integration check: `node scripts/check-epub-reader.mjs [webkit]`.
- Update this status and the folder index when complete.
- Commit locally as requested; do not push or restart Ghost.

## Open follow-ups

Native click-through after the user quits their other Ghost instance and requests a relaunch.
