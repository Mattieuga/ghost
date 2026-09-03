# CLAUDE.md

This file provides guidance to the coding agent working in this repository.

Read this before making changes. Full architecture lives in `docs/reference/ghost-architecture.md` — this file is the compressed rulebook distilled from that living reference.

_Last reconciled with code: 2026-09-03._ When you change an architectural invariant, update this line, this file, and the relevant `docs/reference/` doc in the same change (see "Before you commit").

## What this is

Ghost is a native Mac Markdown editor (Tauri 2, React 19, Tiptap 3) that also opens other file types, and is becoming a notes app with sync, sharing, and a browser client on Supabase. Files on disk are the product: every sidebar root is a real folder, and Cloud is added on top of a folder rather than being a second place where notes live.

## Repo layout

- `index.html` → `src/main.tsx`: the desktop entry, Tauri only. `app.html` → `src/app-main.tsx`: the browser client, served at `/app/`.
- `src/components/` UI; `src/cloud/` Supabase, auth, sharing, the web app, and the collaboration adapter; `src/mirror/` Mac UI for synced roots; `src/lib/mirror/` the mirror engine, UI-free.
- `src-tauri/` Rust: filesystem, search, watcher with own-write suppression, bookmarks, windows.
- `supabase/migrations/` the Cloud schema, applied by hand through the SQL editor. `site/` the public site. `tests/` Vitest. `docs/` per "Docs organization".

## Architectural invariants

- **Every root is a real folder on disk**, because agents and other apps must see everything Ghost sees.
- **One owner per file.** Plain roots are owned by the disk; synced roots are owned by their Yjs document and the file is a mirror. Never write a synced file from anything but the mirror writer, ingestion, or the Cloud pull.
- **Never sync inside a version-controlled checkout.** Pre-flight refuses it; a synced folder is only ever linked into a repository as an ignored symlink.
- **External writes are ingested by rule**: ignore own writes, record formatting-only changes, merge real changes three ways at block level, and make a conflict copy only for overlapping edits. Capture a local version before every ingestion. Apply changes as block diffs, never by replacing a whole collaborative document.
- **Nothing destructive happens silently.** Record lossy edges in the plan and keep a version to return to.
- **One parser and one serializer** (`parseMarkdownDocument`, `serializeMarkdownDocument`) on the Mac, the web, and in version history.
- **Sign-in is additive** and lives only in Share, "Open on phone", and Settings → Account. Signing out pauses sync and touches no files.
- **Cloud data changes only through security-definer RPCs** behind row-level security. Share tokens are stored as hashes and travel in the URL fragment.

## What NOT to do

- Do not open `http://localhost:1420` in a browser for the desktop entry; Tauri APIs fail there. The browser client is `app.html`.
- Do not start or restart `pnpm tauri dev` unless asked. Only one Ghost can run at a time: Vite is pinned to port 1420 and every build uses bundle id `com.ghost.app`.
- Do not use `setContent` on a collaborative document; use the block diff.
- Do not create Cloud items from the Shared root; it mirrors other people's trees.
- Do not put site files or fixtures under `docs/`; the site is `site/`, and `docs/` never deploys.
- Do not push, tag, open or merge pull requests, create releases, or dispatch workflows without explicit approval. Local edits, builds, tests, branches, and commits are fine.

## Tech choices

Change requires an ADR.

| Area | Choice |
|---|---|
| Shell | Tauri 2 with Rust commands; no filesystem plugin |
| UI | React 19, Tailwind 4, Radix primitives |
| Markdown editing | Tiptap 3 over ProseMirror, CodeMirror 6 for source |
| Collaboration | Yjs with y-prosemirror; y-indexeddb locally; a Ghost-owned Supabase adapter |
| Backend | Supabase: Postgres with RLS, Auth with PKCE magic links, Realtime broadcast |
| Hosting | Vercel for `ghosteditor.app`, assembled by `pnpm build:web` |
| Tests | Vitest; migrations checked as text; Rust with `cargo test` |

## Local commands

```sh
pnpm test                                   # frontend and engine suites
pnpm build                                  # desktop build (tsc + vite)
pnpm build:web                              # the site and browser client into dist-web/
cargo test --manifest-path src-tauri/Cargo.toml
pnpm tauri dev                              # only when asked; one Ghost at a time
```

## Worktrees and app testing

Superset workspaces are git worktrees; `.superset/setup.sh` installs JS deps, shares the main checkout's Cargo target dir, and writes the workspace name used by the sidebar DEV badge. When you finish a change, run the test and build commands above, do not restart the app, tell the user the work is ready to click through, then wait. Relaunch only when the user explicitly asks; they will have quit the other Ghost first. The sidebar badge shows a slice of the workspace name so they can see which worktree is running.

Repo-local viewer fixtures under `example test files/` are runtime data, not frontend source. Keep that directory excluded from both Tailwind's content scan in `src/styles/globals.css` and Vite's watcher in `vite.config.ts`. Tailwind v4 registers scanned files as HMR dependencies and deliberately sends a full page reload when they change; without both exclusions, saving a fixture through the dev app can look like a Ghost crash even though its native save completed.

## Docs organization

See [`docs/README.md`](./docs/README.md) for the folder taxonomy and conventions. In short: `reference/` is the living architecture (always current; this `CLAUDE.md` is its compressed form), `adrs/` are dated decisions that change it, `discovery/` is pre-decision exploration, `plans/` are active builds, `learnings/` are hard-won gotchas, `runbooks/` are setup and 2 a.m. procedures, `design/` holds rendering fixtures. Each folder has a `README.md` index and a `_TEMPLATE.md` to copy. The five existing ADRs keep their numbers; new ones are date-prefixed. The synced-folders ADR is `docs/adrs/0005-synced-folders.md` and its plan is `docs/plans/synced-folders-roadmap.md`.

**When to write what** — triggers, not suggestions:

- Committed a decision that's cross-cutting, costly to reverse, or likely to be re-litigated → write an ADR, and update `docs/reference/` + this file in the same change.
- Something surprised you — behavior that didn't match the docs, or cost far more than it should have → append it to `docs/learnings/`.
- Starting work that spans sessions or could be interrupted → open a plan in `docs/plans/`; stamp it done when finished.
- Exploring an approach you haven't committed to → write it in `docs/discovery/`; don't build from it without an ADR.
- Shipped something an operator will touch when it breaks or sets it up → add or update a runbook.

Before a large architectural change: write or update the ADR (context, decision, alternatives, consequences, migration path); add a phased plan when the work spans more than one independently testable change; link plans and ADRs to each other and mark superseded decisions explicitly instead of rewriting history; implement only the approved phase, verify it, and update the plan status before the next.

## Before you commit

- Run `pnpm test`, `pnpm build`, and `cargo test --manifest-path src-tauri/Cargo.toml`; run `pnpm build:web` too when the web client or the site changed.
- **Reconcile the rulebook.** If your change alters an architectural invariant, a tech choice, or the repo/module shape, update this `CLAUDE.md`, the relevant `docs/reference/` doc, and the `Last reconciled with code` date at the top — in the same change. CLAUDE.md is a hand-maintained distillation; it drifts silently if you don't.
- **Update the folder index.** If you added, renamed, or retired a doc under `docs/`, fix its one-line entry in that folder's `README.md` index in the same change.
- Commit only when asked. Pushing and everything else that writes to GitHub needs explicit approval first.

## Working norms

- Code is the source of truth; docs are intent. When they disagree, trust the code and fix the doc.
- Prefer "we decided X because Y" over "X is the way." Write for the stranger you will be in six months.
- Flag a constraint that forces a change to a committed decision rather than quietly diverging.
- The owner wants the product great and simple. Push back on complexity, and record what was cut.
