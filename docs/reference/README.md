# Reference

The living description of the system as it stands — architecture, repo structure, and other always-current foundational docs. The backbone the rest of `docs/` revolves around, and the source `CLAUDE.md` compresses into its always-loaded rulebook.

For the role of this folder in the docs taxonomy, see [`docs/README.md`](../README.md). Copy [`_TEMPLATE.md`](./_TEMPLATE.md) to start a new reference doc.

## Index

- [`ghost-architecture.md`](./ghost-architecture.md) — the whole system: the two clients and the site, roots and the mirror engine, Cloud's schema and RPCs, the sync and sharing flows, and what is still open.
- [`supported-file-formats.md`](./supported-file-formats.md) — every file type Ghost opens, and how each is classified and shown.

## Conventions

- **Present tense, always current.** Reference docs describe what *is* — not what we decided (that's an ADR) and not what we might do (that's discovery). No "Status: superseded"; they're edited in place.
- **Code wins.** When a reference doc disagrees with the implementation, the code is right and the doc is stale. Fix the doc.
- **ADRs edit this folder.** A committed decision isn't done until the relevant reference doc — and `CLAUDE.md`, if an invariant moved — reflects it.
- **`CLAUDE.md` is the compressed form.** Keep the two in sync: reference is the long version, `CLAUDE.md` the rulebook.
