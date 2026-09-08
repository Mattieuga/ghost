# Ghost — Architecture

> **Status:** living reference — the always-current description of Ghost as built. Kept in sync with the code; when this disagrees with the implementation, the code wins and this doc gets updated. ADRs in [`../adrs/`](../adrs/) change this document; it's the synthesis they edit.
>
> **Last updated:** 2026-09-07

Ghost is a native Mac Markdown editor that grew into a general file editor and is becoming a notes app with sync, sharing, and a browser client. Files on disk are the product: every sidebar root is a real folder, agents and other apps write to the same files, and Cloud is added on top of a folder rather than being a second place where notes live. This document covers the two clients and the public site, the roots and mirror engine on the Mac, the Cloud backend, the flows that keep the three in step, and what is still open. The decisions behind it are the ADRs, chiefly [synced folders](../adrs/0005-synced-folders.md) and [cloud collaborative workspaces](../adrs/0004-cloud-collaborative-markdown-workspaces.md).

## Guiding principles

- **Files are the product, so every root is a real folder.** We keep the sidebar as one list of folders on disk because agents, Finder, and other editors can then see everything Ghost sees; nothing lives only inside Ghost.
- **One owner per file.** A plain root is owned by the disk. A synced root is owned by its Yjs document, and the file on disk is a mirror of it. We chose Yjs as canonical for synced roots because concurrent edits from a phone, a collaborator, and an agent cannot be merged safely at the level of bytes.
- **Never sync inside a version-controlled checkout.** Branch switches and worktrees rewrite files underneath a live document, so the pre-flight refuses Git, Mercurial, and the like, and a synced folder can only be linked into a repository as a symlink that the repository ignores.
- **Nothing destructive happens silently.** External writes are ingested by rule, conflicts produce a copy rather than a loss, every ingestion is preceded by a local version, and known lossy edges are written down.
- **One parser and one serializer everywhere.** Markdown enters and leaves through the same frontmatter-aware parser and escape-relaxed serializer on the Mac, on the web, and in version history, so a round trip is stable.
- **Sign-in is additive.** Nothing requires an account. Signing in adds Cloud on top of folders that already exist and shows sidebar sections; signing out pauses sync and touches no files.
- **Sharing works like a shared document.** One link per item, off or view or edit, that the owner can copy again any time; the token is readable by the owner alone, is looked up by hash when redeemed, and travels in the URL fragment so it never reaches a request log.

## Repo layout

| Path | What it is |
|---|---|
| `index.html` → `src/main.tsx` | The desktop entry. Runs only inside the Tauri window; Tauri APIs fail in a browser. |
| `app.html` → `src/app-main.tsx` | The browser client, served at `/app/` in production and `/app.html` in dev. |
| `site/` | The public site: landing page, the native auth callback, the Apple association file. |
| `src/components/` | React UI: `editor/` (Tiptap and CodeMirror editors, Markdown schema, serializer), `sidebar/`, `viewer/` (non-Markdown file viewers), `settings/`, `command-palette/`, `ui/`. |
| `src/cloud/` | Supabase clients, auth, sharing, the web app and tree, and `collaboration/` with the Yjs adapter and local persistence. |
| `src/mirror/` | Mac UI for synced roots: the mirrored document editor, the Share sheet, sync dialogs, save status. |
| `src/lib/mirror/` | The mirror engine, UI-free and tested with an in-memory filesystem. |
| `src/hooks/`, `src/lib/`, `src/types/` | Roots, file tree, settings, and shared helpers. |
| `src-tauri/` | The Rust side: filesystem and search commands, the folder watcher with own-write suppression, security-scoped bookmarks, windows and menus, Quick Look and PDF views. |
| `supabase/migrations/` | The Cloud schema, applied to the Supabase project with the CLI's `db query -f` (see the auth runbook). `supabase/functions/` holds the Edge Functions. |
| `tests/` | Vitest suites for the frontend and engine, plus text checks over the migrations. |
| `docs/` | This documentation system. |
| `vite.config.ts`, `vite.web.config.ts`, `vercel.json` | The desktop build, the site build, and the Vercel deployment settings. |

## The three surfaces

**The Mac app** is a Tauri 2 shell around a React 19 frontend. Markdown opens in a Tiptap 3 editor over ProseMirror; a CodeMirror source view and a family of viewers handle everything else (see the [file viewers](../adrs/0001-extensible-file-viewers.md), [bounded loading](../adrs/0002-bounded-large-file-loading.md), and [Quick Look](../adrs/0003-native-quick-look-document-previews.md) ADRs). Rust owns the filesystem: reads and writes with version tokens, directory listing, search, archive previews, the `~/Ghost` folder, sync pre-flight, repository links, and a global watcher that emits structured `fs-event`s and ignores the app's own writes by device, inode, and modification time.

EPUB books use a dedicated read-only viewer with lazy-loaded EPUB.js, chapter/page navigation, text sizing, and local CFI bookmarks. Rust validates the immutable ZIP snapshot before binary IPC (64 MiB compressed, 32 MiB per resource, 256 MiB expanded, 10,000 entries). Detached chapter documents are stripped of active content and external links, then rendered in script-free iframes with an offline CSP. Protected resources fall back to an external reader. The source book is never rewritten or extracted. See the [EPUB reader ADR](../adrs/2026-09-06-epub-reader.md).

MOBI/AZW3 and FB2 share the EPUB footer and chapter policy, using lazy Foliate parsers plus its paginator. Foliate is pinned to `78914aef4466eb960965702401634c2cb348e9b1`, with lifecycle/error fixes recorded in `patches/` and `pnpm-workspace.yaml`. Native `read_ebook` limits Kindle books to 64 MiB, FB2 to 16 MiB, validates Kindle record tables and rejects DRM and HUFF/CDIC compression; actual expanded text is capped at 64 MiB and fonts at 8 MiB. The app CSP permits fetching and framing local blob URLs; each chapter retains its own `script-src 'none'` and offline policy. New text bookmarks store section, text CFI, fallback fraction, and font size under `ghost:ebook:<path>`; EPUB bookmarks remain unchanged. CBZ/CBR use natural filename order and bounded per-page materialization from the existing archive cache, native image inspection/thumbnails, zoom, and reading direction. Comic page path, zoom, and direction live under `ghost:comic:<path>`. PDF remains native PDFKit. See the [additional formats ADR](../adrs/2026-09-06-additional-book-formats.md).

**The browser client** is the same React code with the Tauri-only pieces left out, built on its own by `vite.web.config.ts` with `/app/` as its base. It shows an account's synced roots under "Cloud" and everything shared with it under "Shared", edits through the same collaboration adapter, and uses hash routes: `#/d/<documentId>` opens one document and `#share=<token>` redeems a share link. Its tree follows Realtime tree events and refreshes on focus. Images in a note are served from the `cloud-assets` bucket through short-lived signed URLs; the web cannot add images yet.

**The site** at `ghosteditor.app` is static files from `site/`, deployed by Vercel together with the browser client. It carries the landing page, the universal-link callback the Mac uses to finish sign-in, and the Apple association file that authorizes it.

## Roots and the mirror engine

A **root** is a folder in the sidebar, stored as a `TrackedRoot` with an ID, a path, a kind, an optional macOS bookmark, and once uploaded a Cloud ID and the account it was uploaded by. Two kinds exist. A **plain** root is a folder Ghost edits in place. A **mirrored** root is Yjs-backed: each Markdown file has a Yjs document in a local IndexedDB store, the file on disk mirrors that document, and a `.ghost/` folder inside the root holds `folder.json` (root identity and Cloud ID), `index.json` (one entry per file: document ID, content hash, the version token and state vector at the last mirror write, the Cloud ID once uploaded, which may differ from the document ID, the Cloud cursor for pulls, and the hashes and etags of its synced images), and `versions/` with local history as Markdown plus a Yjs snapshot. `~/Ghost/Notes` is created on first run and is mirrored from the start; it is the default home, not a boundary. A special mirrored root, **Shared** at `~/Ghost/Shared`, mirrors what other people shared.

Any non-repository folder becomes mirrored through **Sync to Cloud**, which runs a native pre-flight (refuse version control and packages, auto-exclude build output, warn on size), takes a bookmark so the root survives moves, and adopts every Markdown file: a fresh Yjs document is seeded from the file through the shared parser and the index records the disk as current. **Stop Syncing** removes `.ghost/` and makes the root plain again.

While a mirrored document is open, a **MirrorWriter** serializes the Yjs document and writes it to disk with a version token, debounced, and records the content hash and state vector. Writes go through Rust, which registers them so the watcher stays quiet. When the watcher reports a change under the root that Ghost did not make, **ingestion** decides by rule: an own write is ignored; a formatting-only change (the parsed documents are equal) just records the disk as current; a real change is merged three ways at block level against the most recent version Ghost knows, and only overlapping edits produce a conflict copy next to the file. A local version is captured before every ingestion. Documents are updated by block-level diff, never by replacing the whole document, so collaborators keep their cursors and Yjs history stays small.

**Root reconciliation** keeps the index and Cloud in step with the files, and a folder renamed or moved as a whole travels to Cloud as one item: on launch, after every watcher event under the root, and after an upload, a file that disappeared goes to Cloud Trash, a renamed or moved file keeps its document and is renamed or moved in Cloud, and a new file is adopted and put in Cloud under its own ID. For an uploaded root, deletions and renames made while signed out wait in the index until a signed-in pass carries them over. Files an editor has open are left to that editor.

## Cloud

Cloud is a Supabase project: Postgres with row-level security, Auth, and Realtime. The schema, in `supabase/migrations/`:

- `cloud_profiles` and `cloud_workspaces`: one workspace per permanent account.
- `cloud_items`: folders and documents with a parent, a name unique among live siblings, soft deletion, and at the top level a `root_kind` of `notes` or `folder`. One Notes root per workspace.
- `cloud_memberships`: `owner`, `editor`, or `viewer` on an item, inherited by everything below it; the effective role is the best role found walking up the tree, with the workspace owner always an owner.
- `cloud_documents` and `cloud_document_updates`: the append-only Yjs update log per document, one row per client sequence number so replays are idempotent, plus a Markdown snapshot.
- `cloud_document_versions`: named and automatic versions, including ones uploaded from a Mac's local history and ones captured before an external write.
- `cloud_share_links` and `cloud_invitations`: one live link per item with a role, its token kept for the owner and its hash for lookup; invitations by email that attach when that address signs in.
- Storage bucket `cloud-assets`: a note's companion images under `<document_id>/<file name>`, readable by anyone who can read the note and writable by its editors.
- Triggers on `cloud_items` and `cloud_memberships` broadcast a `changed` event on `ghost-tree:<workspace_id>` and `ghost-user:<user_id>` topics, with a policy that lets owners and members listen.

Clients change data only through security-definer RPCs, all grouped by prefix: `cloud_ensure_workspace`, `cloud_create_item` and `cloud_adopt_items` (client-supplied IDs, idempotent, server-side rename on collision), `cloud_rename_item`, `cloud_move_item`, `cloud_duplicate_item`, `cloud_trash_item`; `cloud_document_role`, `cloud_document_heads`, `cloud_upload_document_versions`; and the sharing family `cloud_share_item`, `cloud_revoke_access`, `cloud_accept_invitations`, `cloud_set_share_link`, `cloud_redeem_share_link`, `cloud_leave_item`, `cloud_list_visible_items`, `cloud_item_sharing`, `cloud_set_display_name`. One Edge Function, `share-invite`, emails a person invited by address; it uses Supabase's invite email for new accounts and does nothing yet for existing ones. Realtime uses one broadcast topic per document, `ghost-cloud:<documentId>`, with the same role checks on who may listen and who may send.

**Sessions.** The Supabase collaboration adapter binds the Yjs document, appends local updates, and relays them over Realtime; a viewer's session is read-only. A local IndexedDB store per document sits under it so edits survive restarts and offline periods. A note opens from that store at once, with the role verified last time, and the adapter catches up with the server's durable log in the background; nothing on the network stands between the click and the editor. On the Mac, a mirrored document opens a Cloud session only when signed in, its root is uploaded, and the note exists in Cloud; otherwise a local session does the same job without a network.

**Auth.** Accounts are passwordless by default: a magic link with PKCE. On the web the link returns to the page it started from. On the Mac it returns to `/auth/native/callback/` on the site, which the universal link hands to the app; a development build that the link cannot reach accepts the pasted callback URL instead, and a password can be set for the same account. Share links work for guests through anonymous sign-in.

## Flows that keep the three in step

- **Sign-in** uploads every mirrored root that has never been sent: the folder tree with the client's IDs, each document's state as its first durable update, local history as versions, and each note's companion images. A Notes root joins an existing one if the web created it first. When another account signs in on the same Mac, a root it has not had is uploaded as a copy under fresh Cloud IDs, and each account's link to the root is kept under `.ghost/cloud-links/` so switching back restores it without a second upload.
- **Opening** a mirrored document adopts it if needed and, when signed in, makes sure it exists in Cloud before the session starts.
- **Editing** flows live through the session; the writer mirrors it to disk on the Mac.
- **Disk changes** reach Cloud through ingestion (content) and root reconciliation (structure).
- **Cloud changes** reach an open document through its session. For closed documents, a **Cloud pull** on sign-in, on focus, and every five minutes asks for each document's latest update ID, applies what is new to the local store, and rewrites the file only when the file is still where Ghost left it; a file that was there and is gone was deleted on purpose and is never written back. Before the pull, a **Cloud tree sync** moves, renames, trashes, or adds files to match what the web did to the root's structure, leaving open files and pending local renames alone. Both share a queue with reconciliation so they cannot interleave.
- **Images** follow their note: a change inside `<note>.assets/` sends the changed files to the bucket and removes deleted ones; a note that arrives or changes from Cloud, and the open note when its text mentions its assets folder, fetches what changed there. Files stay beside the note as before. The sidebar and Quick Open treat a note's assets folder as part of the note: it is listed only with "Show hidden files", while an orphaned assets folder stays an ordinary folder. Finder's own files (`.DS_Store`, `.localized`, icon files, AppleDouble `._*` shadows) and their Windows counterparts are never listed, whatever the switches say, like `.ghost`.
- **Version history** is a sidebar beside the note on both clients, listing local versions from disk and Cloud versions together; a selected version is shown in the editor's own surface with the words and blocks it added and removed marked, and Restore applies it as a block diff after saving a backup version.
- **Sharing** is owner-only from the Mac Share sheet, reached from the header or a right-click on any note, synced folder, or synced root: one link per item that is off, view, or edit and can be copied again at any time, and people by email. A link opens straight away in the browser as a named guest, no form. Access is re-checked on focus, every minute, and on any refused write, so a revoked share stops within a minute and the web shows that it ended. The Mac header for a synced note shows the save state, who else is in the note, a History button for the Cloud version history when signed in, and the Share icon at the far right; Settings, Share, and the sync dialogs are all the same floating panel. Sync to Cloud is ⇧⌘U on the folder that owns the focused item or open note, and a synced root carries a cloud mark in the sidebar. What is shared with an account is materialized flat into its Shared root on every refresh, with the sharer's name on a name collision; shares that end move the local file to the Trash; a shared file removed by hand comes back, because Leave is the way out.

## Testing and commands

`pnpm test` runs the Vitest suites, which mount the real layout with the Tauri bridge mocked, drive the engine against an in-memory filesystem, and check the migrations as text. `pnpm build` is the desktop build, `pnpm build:web` assembles the site, and `cargo test --manifest-path src-tauri/Cargo.toml` covers Rust. Only one Ghost can run at a time because Vite is pinned to port 1420 and every build shares one bundle ID.

## Known risks and open work

- Tree changes between devices arrive live over Realtime and again on focus and a timer as a fallback; a rename of the note that is open is applied by retargeting the editor. Document content for closed notes still arrives on those refreshes, not on a live signal.
- Inside a shared folder on the Mac an editor can create notes and folders; renaming, moving, and trashing there are still done on the web.
- Invitation email goes only to addresses without an account, through Supabase's invite email on its default sender, which is rate-limited; custom SMTP is needed before this is relied on. An existing account gets no email. A guest cannot upgrade to an account in place.
- Companion images sync; other file types do not. Table widths and image sizes have no home in Markdown; the version captured before ingestion is the recovery path.
- Ancestry is computed by recursive query on every permission check; a closure table waits until folders are large enough to need it.
- A repository created inside a synced folder pauses sync at once with a panel offering Stop Syncing; moving the folder out resumes it. Markers deeper than the root's top level are not watched for.
- Loose top-level Cloud items from before synced folders still exist in the database and are hidden by the web client rather than removed.
- Switching accounts on one Mac uploads a root as a copy for the new account; the two Clouds do not share a document afterwards.
- Accessory windows do not yet open mirrored documents through the mirror boundary.
