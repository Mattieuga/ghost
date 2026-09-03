# ADRs — Architectural Decision Records

One file per committed decision: the *why* (context, decision, rejected alternatives, consequences) and the *what to do* (the recipe that follows). ADRs are how the system's `reference/` docs change over time — each accepted ADR is a dated edit to the living architecture.

For the role of this folder in the docs taxonomy, see [`docs/README.md`](../README.md). Copy [`_TEMPLATE.md`](./_TEMPLATE.md) to start a new ADR.

## Naming convention

**New ADRs use a date prefix: `YYYY-MM-DD-slug.md`** (e.g. `2026-06-16-auth-and-onboarding-flow.md`). Reference an ADR by its slug ("the synced-folders ADR"), not a number.

Why date-prefixed and not sequential integers (`0001`, `0002`, …): an integer is chosen when you *start* writing, so two branches or git worktrees in flight both grab the same next number and collide on merge. Date prefixes are assigned monotonically, never collide across worktrees (same-day ties are broken by the slug), preserve chronological order, and mirror timestamped DB migrations. The five ADRs below started on integer IDs and keep them as legacy names; everything new is date-prefixed.

## Index

- [`0001-extensible-file-viewers.md`](./0001-extensible-file-viewers.md) — file classification and a registry of viewers, so Ghost opens more than Markdown.
- [`0002-bounded-large-file-loading.md`](./0002-bounded-large-file-loading.md) — capability degradation and bounded resource handling for large files.
- [`0003-native-quick-look-document-previews.md`](./0003-native-quick-look-document-previews.md) — native Quick Look for documents Ghost does not render itself.
- [`0004-cloud-collaborative-markdown-workspaces.md`](./0004-cloud-collaborative-markdown-workspaces.md) — the collaboration engine: Yjs, Supabase, the adapter, the durable update log, passwordless accounts. Partially superseded by the synced-folders ADR.
- [`0005-synced-folders.md`](./0005-synced-folders.md) — every root is a folder, any non-repository folder can sync to Cloud, Yjs is canonical with the file as mirror, external writes are ingested by rule, one sidebar, the Shared root.

## Conventions

- **Curate.** ADRs capture decisions that are cross-cutting, costly to reverse, and likely to be re-litigated. Anything smaller belongs in `learnings/` or a code comment.
- **Decision + recipe in one file.** The *why* and the *how-to-apply* live together.
- **Record rejected alternatives.** That's what stops re-litigation.
- **Supersede, don't rewrite.** A superseded ADR keeps its file and gets a `Status: superseded by the <slug> ADR` header — never deleted or rewritten in place.
- **Cross-link.** The discovery doc it came from, the reference doc it updates, sibling ADRs (by slug).
- **Update `reference/` + `CLAUDE.md`** in the same change when an ADR moves an invariant.
