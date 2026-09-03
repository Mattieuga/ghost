# Synced folders roadmap

- Status: Phases 1 and 2 clicked through on 2026-09-02; Phase 3 implemented
  locally the same day and awaiting click-through; the Phase 2 migration was
  applied to the connected project through the SQL editor on 2026-09-02
- Date: 2026-09-02
- Last updated: 2026-09-02
- Architecture: [`../adrs/0005-synced-folders.md`](../adrs/0005-synced-folders.md),
  with the retained backend decisions in
  [`../adrs/0004-cloud-collaborative-markdown-workspaces.md`](../adrs/0004-cloud-collaborative-markdown-workspaces.md)
- Supersedes: [`cloud-collaboration-roadmap.md`](cloud-collaboration-roadmap.md)
  from its Phase 4 onward. Its Phases 0 to 3 record what is already built.
- Brainstorm: [`../discovery/2026-09-02-cloud-folders-brainstorm.md`](../discovery/2026-09-02-cloud-folders-brainstorm.md)

## Goal

Make Ghost one product with one sidebar: every root is a real folder, any
non-repository folder can be synced to Cloud, synced folders are Yjs-backed
with the file on disk as a mirror, external writes from agents are ingested
without data loss, and sign-in is additive rather than a mode switch.

## Product boundary

The completed project includes:

- root records with bookmarks and a `.ghost/` folder per mirrored root;
- `~/Ghost/Notes` seeded on first run, Yjs-backed from creation, with local
  version history and no account;
- Sync to Cloud on any folder that passes pre-flight, and Stop syncing;
- the disk mirror, own-write suppression, and the three-rule ingestion policy;
- one sidebar with Cloud and On This Mac sections after sign-in;
- sign-in from Share, Open on phone, and Settings only, plus sign-out;
- the `Shared` root, share links, invitations, and memberships;
- image assets, then blob sync, then filters;
- task syntax, a Tasks view, reminders, and an MCP server in file and cloud
  modes; and
- a web client showing Cloud only.

It does not include comments, publishing, organization administration,
custom mirror paths for shared items, or end-to-end encryption.

## Survey findings this plan responds to

Recorded on 2026-09-02 from a read of the `ghost-cloud` branch. File
references are to that state.

- The sidebar Cloud block and inline sign-in live in `src/components/layout.tsx`
  around the `data-cloud-section` element, with a second keyboard tree inside
  `src/cloud/cloud-tree.tsx` and synthetic `cloud/<workspace>/<id>` paths.
- Selection, flush, navigation history, recent cycling, focus, and the
  command palette are local-only or duplicated for cloud documents.
- Roots persist as a bare path list in `src/hooks/use-tracked-folders.ts`.
- First run renders the sign-in form above "No folders tracked", and ⌘N with
  no roots opens a folder picker.
- Item IDs are server-generated in `cloud_create_item`; the adapter requires
  a server row; an unresolvable role clears the local cache.
- The editor's dirty flag is never set under collaboration.
- Cloud snapshots use `editor.getMarkdown()` and restore uses raw `setContent`
  in `src/cloud/cloud-version-history-panel.tsx`; local files use
  `serializeMarkdownDocument` and `parseMarkdownDocument`.
- The watcher in `src-tauri/src/watcher.rs` is global, emits one event kind,
  and has no own-write suppression.
- No bookmark, hashing, or UUID crate is present; `objc2-foundation` is.
- No test mounts the main layout.
- No Share button, share link, invitation, membership write path, sign-out,
  move RPC, edge function, or cron exists.

## Phase 1: Sidebar and first-run foundation

Status: Implemented locally on 2026-09-02; awaiting click-through

Local-only work that removes the two-product feel and prepares the ground.
It can merge to `main` on its own: the cloud branch has never shipped, so
removing its sidebar section regresses nothing users have.

### Progress as of 2026-09-02

- Roots are `TrackedRoot` records under a new `tracked-roots` store key with a
  one-time migration from the legacy path list; the legacy key is left in
  place. Consumers still receive a derived path list.
- New Rust commands `ghost_folder` and `ensure_notes_folder` resolve `~/Ghost`
  through Tauri's home directory and create `Notes` with the welcome note only
  when the folder is new. A user-made or emptied `Notes` is left alone.
- A fresh install (no roots key at all) seeds `Notes`, opens the welcome note,
  and places the cursor at its end. An emptied sidebar shows a small empty
  state with New File and Open Folder instead, and never a folder picker.
- ⌘N and ⇧⌘N resolve their target as: explicit directory, focused tree node,
  the open file's folder, then `Notes`, creating and adding it on demand.
- The sidebar Cloud block, the inline sign-in, the Workspace header, and the
  now-unreachable cloud document plumbing in the layout (second selection
  state, cloud flush global, cloud editor branch) are gone. The layout's
  document switches all go through one `flushActiveDocument`, which is also
  what `__ghostFlushSave` exposes to accessory windows and menus.
- The sidebar chrome gained one `+` menu with New File, New Folder, and Open
  Folder. The sidebar context menu and the command palette use the same three
  items, and "project" wording became "folder" in the menus and the macOS
  File menu.
- `CloudSignIn` and `CloudTree` lost their sidebar `compact` variants and now
  serve the web client only.
- The Phase 0 spike, its migration, its test, and its capability window label
  are deleted. The spike document records the removal.
- Cloud version snapshots and restore go through `serializeMarkdownDocument`
  and `parseMarkdownDocument`, guarded by a source-level test.
- `.ghost` is excluded from the Rust directory listing regardless of the
  show-hidden setting and from the tree's skip list.
- `tests/layout-first-run.test.tsx` mounts the real layout with the Tauri
  bridge mocked and covers the fresh install, the legacy migration, the empty
  sidebar, and both ⌘N routes. Frontend, build, and Rust checks pass.

Deferred inside Phase 1 on purpose: the welcome note does not yet mention
Share, because Share does not exist until Phase 3, which owns the final copy.

### Scope

- Replace the tracked-folder path list with `TrackedRoot` records, a
  one-time migration, and a derived path list for existing consumers
  (`use-file-tree`, `use-file-watcher`, the command palette, `layout.tsx`).
  Reorder within the list only.
- Add home-directory resolution and lazy creation of `~/Ghost` and
  `~/Ghost/Notes`. Seed the Welcome note on a fresh install. Existing
  installs create `Notes` the first time ⌘N has nowhere else to go.
- Route ⌘N to the selected folder, else `Notes`, else create `Notes`. Route
  ⇧⌘N the same way. Neither opens a folder picker.
- Remove the `data-cloud-section` block, the inline `CloudSignIn`, and the
  `compact` variants of `CloudSignIn` and `CloudTree`. `CloudTree` remains
  for the web client until Phase 4 aligns it.
- Remove the hard-coded Workspace header. With no account the sidebar is one
  list with no header.
- Delete the Phase 0 spike: `src/spikes/`, its migration, its adapter test,
  and its capability window label.
- Route cloud version snapshots and restore through `serializeMarkdownDocument`
  and `parseMarkdownDocument`.
- Provide one session-level flush that covers both the local save and the
  cloud session, and call it from every place that switches documents.
- Exclude `.ghost` from the tree, search, and Rust directory listing
  regardless of the show-hidden setting.
- Add a test that mounts the main layout: first run, one-list sidebar, ⌘N
  routing, and the absence of any sign-in UI.

### Verification

- A fresh profile opens to `Notes` with the Welcome note selected and no
  account UI anywhere.
- An existing profile keeps its roots and order after the migration.
- ⌘N inside a repository root creates a file there; ⌘N with nothing selected
  creates a note in `Notes`.
- Restoring a cloud version that contains frontmatter and table widths
  preserves both.
- `pnpm test`, `pnpm build`, and the Rust tests pass with the spike removed.

## Phase 2: Mirror engine

Status: Implemented locally on 2026-09-02 behind Settings → General → Mirror
engine (experimental); awaiting click-through; migration not applied

Everything needed for a mirrored root to work, behind a development flag,
with the backend changes that let a client-created tree upload.

### Progress as of 2026-09-02

Frontend, all under `src/lib/mirror/` unless noted, each with tests:

- `ingestion.ts`: the pure three-rule verdict plus `markdownMatchesDocument`,
  which compares parsed documents rather than bytes, and the conflict-copy
  name.
- `block-diff.ts`: block-level diff apply used by ingestion and by cloud
  version restore. Identical documents dispatch nothing.
- `ghost-index.ts`: the `.ghost/` model, `folder.json` and `index.json`
  parsing, and rename detection by content hash.
- `adoption.ts`: adopt one document or a whole folder, seeding a Yjs document
  from disk through `markdown-schema.ts`, the new headless editor factory
  that shares the schema with the visible editor and can bind to a Yjs doc.
  A store that already holds the document is kept, never merged with disk.
- `mirror-writer.ts`: debounced, version-token-only atomic writes; records
  token and state vector; suspends during ingestion; stops retrying after a
  conflict until ingestion resolves it.
- `ingestion-handler.ts`: performs the verdict's side effects on a headless
  editor bound to the same Yjs document, so the visible editor receives
  changes through Yjs; a queue serialises runs per document.
- `local-versions.ts`: history under `.ghost/versions/<documentId>/` as
  Markdown plus base64 Yjs snapshots, deduplicated and capped at the limit.
- `src/cloud/collaboration/local-session.ts`: a network-free session the
  editor cannot tell apart from a cloud one; `openYjsPersistence` and a
  root-scoped store key were extracted from the cloud persistence helper.
- `src/mirror/mirrored-document-editor.tsx`: opens a file in a mirrored root
  as a Yjs document, adopts on first open, mirrors, ingests `fs-event`
  changes, keeps automatic and external-write local versions, and reports
  status to the layout's one header via `MirrorSaveStatus`.

Rust:

- `watcher.rs` now uses `notify-debouncer-full`, emits a structured
  `fs-event` beside the legacy `fs-change`, filters `.ghost`, repositories,
  build output, `.DS_Store`, and Ghost temp files below each root, and drops
  Ghost's own writes via `own_writes.rs`, a registry keyed by device, inode,
  and mtime that `write_file` and `commit_source_save` feed.
- `bookmarks.rs`: `create_folder_bookmark` and `resolve_folder_bookmark`
  through `objc2-foundation`, with a test proving a bookmark survives a
  rename.
- `write_conflict_copy`, `hash_file`, `hash_text_content`,
  `ensure_directory`, and `remove_ghost_metadata_file`, the last restricted
  to paths inside `.ghost`.

Product surface, dev flag only: the root context menu offers "Mirror This
Folder", which adopts the folder, stores a bookmark, and marks the root
mirrored; "Stop Mirroring" marks it plain and leaves `.ghost` in place.
Reload-on-focus is disabled for mirrored documents, and the layout's flush
covers the mirror writer.

Backend: `supabase/migrations/20260902010000_cloud_synced_folders.sql` adds
client-supplied idempotent IDs on `cloud_create_item`, `cloud_adopt_items`,
`cloud_move_item` with cycle and workspace checks, the `root_kind` anchor
with one Notes root per workspace, the `external_write` version reason, and
`cloud_upload_document_versions`. It is text-tested, and was applied to the
connected project through the dashboard SQL editor on 2026-09-02. A check
afterwards found all seven functions and the `root_kind` column in place.

Deviations from the scope below, recorded here rather than silently:

- No third adapter state was added. A separate `LocalCollaborationSession`
  serves mirrored roots without an account; swapping to the cloud session
  after upload is Phase 3 work alongside adoption upload.
- The watcher keeps one debouncer registered with every root; filtering is
  per root. Per-root registration was not needed.
- A file renamed on disk is re-identified by hash on the next folder
  adoption or open; live retargeting of an open mirrored document on a
  rename event is still to do.
- External writes to a document that is not open are ingested on its next
  open, not while closed. That is enough before cloud sync exists.
- Browser-store keys are scoped by root and document for mirrored roots; the
  cloud keys are unchanged, so no persistence version bump was needed.
- Gate items 2, 3, 7, 8, 9, and 10 have automated coverage. Item 4 waits on
  cloud sync.
- Click-through on 2026-09-02 confirmed first run, the `+` menu, ⌘N routing,
  mirroring a folder, live ingestion of an external edit, and local
  versions. The conflict path was not reached by hand: Ghost writes half a
  second after typing stops, so a conflict needs the external write to land
  while Ghost still holds unsaved edits, which agents can do and a person
  rarely does. Sequential edits are replaces by design, and Ghost's earlier
  text is in local history. The conflict path was then confirmed with a
  scripted write during typing.
- Three-way block merge, added the same day in `three-way-merge.ts` and
  wired into the ingestion handler: the editor keeps the last eight mirror
  generations in memory, seeded on open from the newest local versions and
  the adopted file. An external write is matched to the generation it shares
  the most blocks with, then merged block by block with the current document.
  Different blocks merge, both sides appending at the same point keeps both,
  a stale copy has Ghost's edits restored and written back, and the same
  block changed on both sides still becomes a conflict copy. With no
  generation to compare against, the state-vector rules decide as before.
  Merge outcomes are covered by unit tests for the merge and for the handler.

### Scope

Rust:

- Bookmark create and resolve commands using `NSURL` through
  `objc2-foundation`.
- Per-root watcher registration on `notify-debouncer-full` with event kinds
  and rename pairs; native filtering of Ghost temp files, `.ghost/`,
  repositories, and the auto-exclude list.
- An own-write suppression registry keyed on device and inode after the
  atomic rename.
- `.ghost/` read and write commands for `folder.json`, `index.json`, and
  `versions/`.
- A conflict-copy writer that reuses the atomic writer.
- Content hashing (`blake3`) and UUID generation.

Frontend:

- A `mirrored` persistence kind in `src/lib/document-ref.ts` and a document
  source for it that loads and saves through the Yjs session.
- The mirror writer: debounced on Yjs updates that did not originate from
  ingestion, version-token check only, records the token and the state vector.
- The ingestion function as a pure module with tests for all three verdicts,
  plus a thin watcher handler that calls it.
- Block-level diff apply used by ingestion and by restore.
- The checkpoint hook extracted from the history panel with an
  `external_write` reason, writing to the local store and, when signed in,
  the server.
- The local version store under `.ghost/versions/` with the existing
  heuristic and cap.
- The adoption function: walk a folder, parse each Markdown file, create
  documents with client UUIDs, write the index, and upload when signed in.
- A "local, not uploaded" adapter state distinct from access revocation.
- Browser-store keys scoped by root and document rather than account, with a
  bumped persistence version.
- One save-status widget merging the local and cloud states.

Backend:

- Optional client ID on `cloud_create_item`, validated, idempotent.
- A batch adopt RPC that inserts a subtree parents-first and reports
  per-item outcomes, including server-side renames on sibling collision.
- `cloud_move_item`.
- Explicit root anchors for `Notes` and `Shared`.
- Batch version upload.
- Migration tests extended for every new RPC.

### Verification

- ADR 0005 gate items 2, 3, 4, 7, 8, 9, and 10 have automated coverage.
- A live test adopts a folder with nested documents, uploads it, and opens
  one document from a second client with converged state.
- A forced browser-store deletion re-adopts a root from disk with identical
  content.

## Phase 3: Product surface

Status: Implemented locally on 2026-09-02; awaiting click-through; upload
needs the Phase 2 migration applied

### Progress as of 2026-09-02

- Pre-flight is a native scanner (`sync_candidate.rs`: ancestor and
  descendant markers, sync services, volumes, counts, writability) feeding
  one pure rules table (`preflight.ts`) with tests for every row. The Sync
  dialog runs it on open, explains a refusal with only Close, and otherwise
  lists exclusions and warnings before asking once.
- Roots resolve on launch and on focus through `root-resolution.ts`: bookmark
  first, remembered path second; a moved folder is followed and re-bookmarked
  silently; a folder now inside a repository shows Paused; an unmounted
  volume shows Unavailable; anything else shows "Can't find" with Locate,
  which checks the chosen folder's own `.ghost` ID.
- The sidebar splits into Cloud and On This Mac once signed in, with an
  "Open a folder…" row when the Mac section is empty and a hint row when Cloud
  is. Drag reorder stays inside a section. The dev flag is gone.
- The root menu offers Sync to Cloud (plain roots and folders inside them,
  which become their own root), Stop Syncing (files stay, `.ghost` removed),
  and Link into Project (a `notes` symlink plus `.git/info/exclude`, resolved
  through the common Git directory so worktrees share it). File rows offer
  Copy to Notes in plain roots and Save a Copy in mirrored ones, through a
  native copy that carries companion assets.
- Notes is mirrored from birth: first run and ⌘N adopt it, and any plain root
  under `~/Ghost` left from before the engine is adopted at launch.
- Sign-in lives in three places and nowhere else: the header's Share button
  opens a sheet that is the sign-in card when signed out, offers Sync this
  folder or Copy to Notes for a plain root, and confirms a mirrored note is
  on the phone; Settings gained an Account tab with the same card, Sign out,
  and the Ghost folder path. Sign-out flushes, signs out, and touches no
  files. The welcome note now mentions Share.
- Signing in uploads every mirrored root that has no Cloud ID:
  `cloud-upload.ts` sends the tree through `cloud_adopt_items` with the
  client's IDs, each document's Yjs state as its first durable update, and
  local history through `cloud_upload_document_versions`, then records the
  Cloud ID in `.ghost/folder.json` and on the root. A server without the
  migration produces one plain notification. Once a root has a Cloud ID the
  mirrored editor opens a Supabase session instead of the local one, and
  falls back to local if the server does not know the document.

Two sign-in paths were added the same evening after a development build
could not receive the universal link, which macOS routes to the installed
bundle: the sign-in card's "sent" step accepts a pasted callback address
and exchanges the code itself, and email plus password is offered as an
alternative, with an optional password set from the Account tab. The
password path is a deviation from ADR 0004's passwordless decision, kept
optional and off the main path; it should be revisited before release.

Tree changes now propagate from disk to Cloud through `root-sync.ts`, added
after the first click-through showed a note deleted on the Mac still listed
on the web. On launch, after every watcher event below a mirrored root, and
after an upload, the root's index is reconciled with the files on disk: a
deleted file goes to Cloud Trash, a renamed or moved file keeps its document
and is renamed or moved in Cloud with missing folders created, and a new
file is adopted and created in Cloud under its own ID with its state pushed.
Files an editor has open are left to that editor, and a note created on the
Mac joins Cloud the first time it opens. Roots uploaded before the index
tracked Cloud IDs fall back to the document ID. Cloud-to-disk propagation,
where a note trashed on the web disappears from the Mac, is still Phase 4.

Still to do in this phase, recorded rather than silently dropped:

- Drag from Finder onto a section still opens the folder as plain.
- Stop Syncing does not yet move the Cloud copy to Trash; that lands with
  the Phase 4 sharing and trash work on uploaded roots.
- A mirrored subfolder inside a plain tree gets no cloud mark yet; it appears
  as its own root and as an ordinary folder in the parent.
- Accessory windows still open a mirrored file through the plain save path,
  and the main window's own-write suppression hides those writes from
  ingestion until refocus. Routing accessory windows through the mirrored
  boundary is the next fix.
- Upload and the Cloud session are untested against a live server until the
  migration is applied.

### Scope

- Sync to Cloud with the pre-flight module, its rules table under test, and
  the Git refusal dialog.
- Cloud and On This Mac sections in one keyboard tree with one header
  component, the cloud mark on a mirrored subfolder, the people mark on
  shared-out roots, the muted "Open a folder…" row, and the muted failure row.
- Root context menu factored out of the folder tree, with Sync to Cloud,
  Stop syncing, Link into project, Copy to Notes, and Save a copy.
- The Share sheet: sign-in with Apple and email when signed out; "Sync this
  folder" and "Copy to Notes" for files in plain roots; link options arrive
  in Phase 4.
- Settings → Account with sign-out and the Ghost folder location. Open on
  phone.
- Sign-in uploads every mirrored root. Sign-out pauses sync and touches no
  files.
- The bookmark resolve flow: silent update, paused with reason, Unavailable,
  and Can't find with Locate.
- Stop syncing with its three-part confirmation.
- Live detection of a version-control marker appearing inside or above a
  mirrored root: pause with a dialog for the root case, exclusion notice and
  cloud Trash for a subfolder, automatic resume when the marker is removed.
- Drag from Finder onto a section.
- One active-document concept across selection, history, recents, focus, and
  the command palette. Accessory windows open mirrored files through the
  mirrored boundary.
- Link into project: symlink plus `.git/info/exclude`, with a Superset setup
  snippet in the docs.
- Welcome note copy.

### Verification

- ADR 0005 gate items 1, 5, and 6.
- A manual pass recorded under `docs/discovery/` covering first run, sign-in from
  Share, Sync to Cloud on an agent working directory, an agent writing into
  it, moving it in Finder, and Stop syncing.
- Keyboard navigation crosses sections.
- Running `git init` inside `~/Ghost/Notes` pauses sync with the dialog and
  deletes no cloud content; removing `.git` resumes sync.

## Phase 4: Sharing and the Shared root

Status: Built 2026-09-02, migration applied the same day, awaiting click-through

Carries over the sharing scope of the superseded roadmap.

### Progress

Server: `20260902020000_cloud_sharing.sql` adds share links (only the SHA-256
of a token is stored; the raw token is returned once from
`cloud_create_share_link`), invitations that attach to an email address the
next time it signs in (`cloud_accept_invitations`, called by both clients
after sign-in), `cloud_share_item`, `cloud_revoke_access`,
`cloud_revoke_share_link`, `cloud_redeem_share_link` (guests included; an
existing higher role is kept), `cloud_leave_item`,
`cloud_list_visible_items` (own live items with a `shared_out` flag, plus
each shared subtree tagged with the item it came through and the sharer's
name), `cloud_item_sharing` for the owner's sheet, `cloud_document_heads`
so a client can tell which closed documents changed, and
`cloud_set_display_name`. Ancestry stays a recursive query; the closure
table waits until folders are large enough to need it.

Share sheet: for a note that is in Cloud, "Copy view link" and "Copy edit
link" each mint a link and put the URL on the clipboard, with the token in
the URL fragment so it never reaches a server log. People are invited by
email with a role; members, pending invitations, and live links are listed
with Remove and Revoke. Sharing is owner-only and needs a permanent account.

Web: the sidebar shows the account's synced roots under "Cloud" (Notes
first, open by default) and everything shared with it under "Shared", with
Leave instead of Trash on a shared item and no structural actions for
viewers. Loose top-level items from before synced folders are not shown.
"+" creates inside Notes, creating the Notes root if the web is first; the
Mac's upload then joins that root instead of asking for a second one.
Opening `#share=<token>` signed out offers a guest name and anonymous
sign-in, or the normal sign-in; either way the token is redeemed and
dropped from the address bar. Anonymous sign-ins must be enabled in the
Supabase project for the guest path.

Mac: `cloud-pull.ts` brings Cloud to disk for closed documents. On sign-in,
on focus (at most every 20 s), and every five minutes, each uploaded root
asks for document heads, pulls new updates into the local store, and
rewrites the file when the file is still where Ghost left it; a file
changed on disk meanwhile waits for the next open, where ingestion merges
it three ways. `shared-root.ts` lays what is shared out flat under
`~/Ghost/Shared`, a folder per shared folder and the sharer's name on a
name collision, moves and trashes files as shares change, and pulls
content the same way. The Shared root appears when something is shared
and goes when nothing is, is read-only in structure from the Mac (no
rename, move, create, or trash inside it; Copy to Notes and Leave instead),
and a viewer's editor is read-only. A note shared with you arrives with a
notification.

First click-through (2026-09-03) found two faults, both fixed the same day.
The Cloud pull wrote a file back whenever it was missing on disk, which
undid a desktop delete before root reconciliation could carry it to Cloud;
a file is now written from Cloud only when the index says it has never
been on disk, and the pull shares reconciliation's queue so the two never
interleave. In the Shared root the opposite holds: a shared file removed
by hand comes back, because Leave is the way out. Separately, launch
reconciliation ran before the session was restored, so a deletion or
rename made while signed out was dropped from the index without reaching
Cloud; for an uploaded root those now wait in the index until a signed-in
pass, and any document the index does not mark as in Cloud is adopted
there on that pass, which also back-fills roots uploaded before the mark
existed.

The web client gained hash routes: `#/d/<documentId>` opens one document
for members and guests, and a redeemed `#share=<token>` is replaced by the
document's route, so the address bar can be copied to another member. The
tree also refreshes when the tab regains focus.

A four-part code review on 2026-09-03 (engine, Cloud, shell, Rust) preceded
the merge to `main`. What it changed is written up in
[`../learnings/2026-09-03-synced-folders-review.md`](../learnings/2026-09-03-synced-folders-review.md);
in short: every index write goes through the per-root queue and merges with
the editor's records; renaming or moving an open note relocates its index
entry and Cloud item before the editor remounts; the writer never writes
without a disk record; signed-out renames are marked `cloudStale` and
carried to Cloud later; ⌘N never targets the Shared root; the deepest root
owns a path; Stop Syncing trashes the Cloud copy when signed in and clears
the root's Cloud marks; a root uploaded by another account is edited
locally only; uploads share the reconciliation queue; paused roots are left
alone; Leave asks first; a live session re-checks its role after a
permission failure; share tokens survive the sign-in round trip; guests are
named in the Share sheet. The server side is
`20260903010000_cloud_review_hardening.sql`: duplicate checks the
destination, synced roots stay with their owner, update IDs are assigned in
commit order, redeeming records the caller's profile, the sharer's address
is never shown, one shared root per item, invitations attach only to
confirmed addresses, version timestamps are clamped.

Deferred from this phase, recorded rather than dropped:

- Switching accounts on one Mac. A root uploaded by account A stays local
  for account B rather than being re-uploaded, because its document IDs
  already exist in A's Cloud. Re-uploading under fresh IDs needs the index
  to map local document IDs to Cloud IDs throughout.
- A folder renamed on disk creates a new Cloud folder; the empty old one
  stays in Cloud.
- A seeded document that later meets its Cloud copy while signed out cannot
  tell it is the same text; the signed-in open skips seeding, the
  signed-out one cannot.

- Creating notes inside a shared folder from the Mac. The web can; the Mac
  would need the shared plan in root reconciliation.
- Live tree updates. Cloud to Mac and web trees refresh on focus and on a
  timer, not on a realtime signal.
- Email delivery for invitations; the sharer tells the person themselves or
  sends a link.
- Upgrading a guest to an account in place; a guest signs in normally and
  opens the link again.

### Scope

- Membership share and revoke RPCs, invitations, share links with hashed
  tokens, expiry, and revocation, and anonymous guest sessions.
- `cloud_list_visible_items` and precomputed ancestry.
- The `Shared` root mirrored to `~/Ghost/Shared`, flat, with the sharer's
  name on collision, Leave, revocation handling, and the arrival notification.
- The real Share sheet with view and edit links and direct invitations.
- The web client aligned to Cloud only with `Shared`.

### Verification

- The superseded roadmap's Phase 4 verification list, unchanged.
- A shared single document appears directly inside `Shared` on the Mac and
  on the web, and Leave removes it from both.

## Phase 5: Images, blobs, and filters

Status: Blocked on Phase 4

### Scope

- Companion image assets upload to Storage keyed by document ID and relative
  path, with signed delivery on the web and the existing companion directory
  as the mirror.
- Every file type as versioned blobs with size caps and quota handling.
- Filter UI seeded from the auto-exclude list.
- Decide the presentation-metadata sidecar for table widths and image sizes.
  Until then the checkpoint before ingestion is the recovery path.

### Verification

- An image pasted on the Mac renders on the web and vice versa.
- A blob edited outside Ghost produces a new version, not a conflict.

## Phase 6: Tasks and agents

Status: Blocked on Phase 3; can overlap Phases 4 and 5

### Scope

- Task item attributes for due date, reminder, and block ID, with plain
  syntax that round-trips through the editor and is recognizable by the plain
  Markdown parser. Input rule and serializer overrides follow the existing
  table and image extension patterns.
- A local Tasks view over mirror files.
- MCP server, file mode: list, read, create, update, trash, search, and task
  operations that write files and rely on ingestion.
- Server-side task index derived from `cloud_documents.markdown_snapshot`,
  reminder delivery on `pg_cron` and edge functions, email first.
- MCP server, cloud mode: personal access tokens and a server-side apply
  operation that runs the ingestion function.

### Verification

- An agent adds, completes, and reschedules a task through the MCP server,
  and the Mac, the web, and the reminder job agree.
- Task syntax written by hand and by an agent parses identically in the
  editor and in the server index.

## Production launch gate

- ADR 0005 is Accepted and ADR 0004's retained gate items are recorded.
- `pnpm test`, `pnpm build`, and the Rust tests pass.
- Security tests cover every RLS policy, RPC, share role, and invitation
  state.
- The multiplayer, offline, reconnect, revoke, ingestion, and moved-folder
  matrix passes on two browsers and the production Tauri build.
- Monitoring and alert ownership exist for database, asset, auth, and
  collaboration failures.
- Backup restore, account export, and account deletion have been exercised.
- Terms and privacy copy match actual data handling.

## Deferred follow-ups

- Comments, mentions, and notifications beyond reminders.
- Publishing.
- Organization administration and billing.
- Custom mirror paths for items in `Shared`.
- Version history for plain roots.
