# Learnings

Things we discovered while building, that future-us shouldn't have to re-discover. Quirks, gotchas, surprises. Write-once, read-often.

For the role of this folder in the docs taxonomy, see [`docs/README.md`](../README.md). Copy [`_TEMPLATE.md`](./_TEMPLATE.md) to start a new learning.

## Index

- [`2026-09-03-synced-folders-review.md`](./2026-09-03-synced-folders-review.md) — what the review of synced folders and sharing found: index write races, remounts that adopt twice, the two meanings of "missing on disk", server checks that authorized the source but not the destination.
- [`ghost-build-learnings.md`](./ghost-build-learnings.md) — architecture decisions and lessons from the first build of the editor.
- [`2026-03-26-pre-push-review.md`](./2026-03-26-pre-push-review.md) — findings from the pre-push review of the first release, by priority.
- [`radix-context-menu-focus-stealing.md`](./radix-context-menu-focus-stealing.md) — Radix context menus steal focus from inputs created while they close.
- [`tauri-v2-traffic-light-position.md`](./tauri-v2-traffic-light-position.md) — what the traffic-light `y` value means in Tauri 2.
- [`tauri-v2-window-dragging-overlay-titlebar.md`](./tauri-v2-window-dragging-overlay-titlebar.md) — window dragging breaks with an overlay title bar in Tauri 2, and the fix.
- [`wkwebview-context-menu-item-positioning.md`](./wkwebview-context-menu-item-positioning.md) — a custom WKWebView context-menu item lands at the bottom instead of in order.

## Conventions

- **Name files `YYYY-MM-DD-slug.md`.** Same collision-proof rationale as ADRs (see [`../adrs/README.md`](../adrs/README.md)); the date is when the topic was opened — keep appending gotchas to the same file as they accumulate. The undated files above predate this rule.
- **Surprises, not rationale.** The "why we chose this" lives in an ADR; a learning is for what didn't go as the docs predicted, or cost more than it should have.
- **TL;DR first.** Lead with the punchlines someone would want before writing similar code.
- **One section per gotcha**, self-contained and greppable: symptom → cause → fix.
- **Cross-link** to the ADR / plan the learning came out of.
