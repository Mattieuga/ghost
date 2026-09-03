# Discovery

Pre-decision exploration. Brainstorms, spikes, half-thoughts, "what if we…", substantial design proposals that haven't been committed yet. The one folder where being unresolved is the point.

For the role of this folder in the docs taxonomy, see [`docs/README.md`](../README.md). Copy [`_TEMPLATE.md`](./_TEMPLATE.md) to start a new exploration.

## Index

- [`2026-03-23-ghost-editor-brainstorm.md`](./2026-03-23-ghost-editor-brainstorm.md) — the original shape of Ghost as a minimalist Mac Markdown editor. Built; see the first plan.
- [`2026-04-01-accessory-windows-brainstorm.md`](./2026-04-01-accessory-windows-brainstorm.md) — multi-window editing. Promoted to the accessory-windows plan.
- [`2026-09-02-cloud-folders-brainstorm.md`](./2026-09-02-cloud-folders-brainstorm.md) — one model for notes, files, and agents. Promoted to the synced-folders ADR.
- [`cloud-collaboration-prototype.md`](./cloud-collaboration-prototype.md) — the Phase 0 collaboration spike and its removal. Its surviving decisions live in the cloud collaborative workspaces ADR.
- [`cloud-web-mac-test.md`](./cloud-web-mac-test.md) — the vertical-slice test script for Mac plus web collaboration, from before synced folders.

## Conventions

- **Name files `YYYY-MM-DD-slug.md`.** Same collision-proof rationale as ADRs (see [`../adrs/README.md`](../adrs/README.md)). The two spike records predate this rule and keep their names.
- **Don't build from a discovery doc.** If something here is real enough to implement, promote it to an ADR first — that's the act of committing.
- **Promote or abandon.** A discovery doc's life ends when its decisions firm up (→ ADR) or it's dropped. Leaving a promoted brainstorm here as the apparent source of truth is the trap the `reference/` tier exists to prevent.
- **Open questions are welcome.** Capture them explicitly; resolving them is what promotion means.
