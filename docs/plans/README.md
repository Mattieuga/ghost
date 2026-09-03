# Plans

Active build plans with live status. "Here's what we're constructing now, what's done, and how to pick it up if interrupted." Build-time — not run-time (that's `runbooks/`) and not reference (that's `adrs/` + `reference/`).

For the role of this folder in the docs taxonomy, see [`docs/README.md`](../README.md). Copy [`_TEMPLATE.md`](./_TEMPLATE.md) to start a new plan.

## Index

Active:

- [`synced-folders-roadmap.md`](./synced-folders-roadmap.md) — the six-phase build of synced folders, Cloud upload, sharing, the Shared root, and later blobs and tasks. Phases 1 to 4 built; Phase 4 awaiting click-through.

Finished, kept as build logs:

- [`cloud-collaboration-roadmap.md`](./cloud-collaboration-roadmap.md) — the first Cloud build: spike, foundation, Mac plus web vertical slice. Superseded from its Phase 4 on by the synced-folders roadmap.
- [`file-viewer-roadmap.md`](./file-viewer-roadmap.md) — extensible file viewers. Completed 2026-08-22.
- [`large-file-hardening.md`](./large-file-hardening.md) — bounded loading for large files. Implemented and verified 2026-08-24.
- [`2026-08-25-feat-native-quick-look-plan.md`](./2026-08-25-feat-native-quick-look-plan.md) — native Quick Look previews.
- [`2026-08-20-feat-keyboard-navigation-plan.md`](./2026-08-20-feat-keyboard-navigation-plan.md) — keyboard-first navigation of the sidebar and editor.
- [`2026-04-03-feat-in-app-auto-update-plan.md`](./2026-04-03-feat-in-app-auto-update-plan.md) — in-app auto-update through the Tauri updater.
- [`2026-04-03-feat-accessory-windows-plan.md`](./2026-04-03-feat-accessory-windows-plan.md) — multi-window editing.
- [`2026-04-01-feat-theme-library-and-custom-save-plan.md`](./2026-04-01-feat-theme-library-and-custom-save-plan.md) — theme presets, custom saves, and the color editor.
- [`2026-03-27-feat-cmd-k-global-search-palette-plan.md`](./2026-03-27-feat-cmd-k-global-search-palette-plan.md) — the ⌘K command and search palette.
- [`2026-03-26-fix-copy-text-as-plan.md`](./2026-03-26-fix-copy-text-as-plan.md) — Copy Text As plain, Markdown, or rich text.
- [`2026-03-25-feat-sidebar-context-menus-plan.md`](./2026-03-25-feat-sidebar-context-menus-plan.md) — the sidebar context menus.
- [`2026-03-24-fix-sidebar-ux-improvements-plan.md`](./2026-03-24-fix-sidebar-ux-improvements-plan.md) — early sidebar fixes.
- [`2026-03-24-feat-dnd-kit-file-dragging-plan.md`](./2026-03-24-feat-dnd-kit-file-dragging-plan.md) — file drag and drop with dnd-kit.
- [`2026-03-23-feat-ghost-markdown-editor-plan.md`](./2026-03-23-feat-ghost-markdown-editor-plan.md) — the first build of the editor.

Plans from before this docs system carry their status inside the file, or none; treat the code as the record of what shipped.

## Conventions

- **Name files `YYYY-MM-DD-slug.md`.** Same collision-proof rationale as ADRs (see [`../adrs/README.md`](../adrs/README.md)); the date is when the plan was opened. The roadmap files above predate this rule and keep their names.
- **Written to be resumed cold.** Open with branch + status + a "read this top-to-bottom first" note. Close with a resumption checklist and an open-follow-ups list. Assume the next reader (human or agent) has zero context.
- **Per-step acceptance criteria.** Every step says how you know it's done.
- **Committed decisions don't get re-litigated.** List them up top; flag if a constraint forces a change rather than quietly diverging.
- **When a plan finishes:** stamp `Status: done — see the relevant ADR`, distill durables into the ADR / reference doc, leave it as a build log. Archive to `plans/archive/` only when the live folder gets noisy.
