# ADR 0005: Synced folders

- Status: Proposed; supersedes parts of ADR 0004 (see "Relationship to ADR
  0004"); accepted when the Phase 2 gate in the plan is met
- Date: 2026-09-02
- Related plan: [`../plans/synced-folders-roadmap.md`](../plans/synced-folders-roadmap.md)
- Related brainstorm: [`../discovery/2026-09-02-cloud-folders-brainstorm.md`](../discovery/2026-09-02-cloud-folders-brainstorm.md)
- Related decisions:
  - [`0004-cloud-collaborative-markdown-workspaces.md`](0004-cloud-collaborative-markdown-workspaces.md)
  - [`0001-extensible-file-viewers.md`](0001-extensible-file-viewers.md)
  - [`0002-bounded-large-file-loading.md`](0002-bounded-large-file-loading.md)

## Context

Ghost is a local-first Markdown editor that grew into a general file editor
used on code repositories and agent working directories. It should now also
replace a personal notes app: notes that sync to phone and web, with live
multiplayer, version history, and sharing.

ADR 0004 established the collaboration engine: Yjs state as the live source
of truth, Supabase for auth, Postgres, RLS, and Realtime, a Ghost-owned
collaboration adapter, an append-only durable update log, version snapshots,
and passwordless accounts. Those decisions hold and are not revisited here.

ADR 0004 also framed Cloud as a separate logical source. Cloud folders were
Postgres containers with no presence on disk, the sidebar gained a Cloud
section above the local Workspace tree, the sign-in form rendered inline in
that section, and filesystem integration was deferred to four post-launch
stages ending in a macOS File Provider domain. Building the vertical slice
showed the cost of that framing:

- The product reads as two apps. Selection, navigation history, recent-file
  cycling, save flushing, keyboard focus, and the command palette all exist
  twice or only for the local half.
- Cloud items fake filesystem paths shaped like `cloud/<workspace>/<id>` to
  reuse the tree, so the identity model leaks into UI plumbing.
- Agents cannot see cloud content, which removes the main reason to keep notes
  in Ghost rather than in a notes app.
- Users who want to share files that already live in an agent's working
  directory (Claude Cowork, Codex) or in their own folder layout would have to
  move them into Ghost first.
- Files inside a Git checkout must never be live-synced, because branch
  switches, worktrees, and two writers on the same bytes corrupt both sides.

The survey of the current code that preceded this decision also found
constraints the design must respect:

- Item IDs are generated server-side and a document must exist in Postgres
  before the adapter will open it. An unresolvable role clears the local
  cache, which would delete a not-yet-uploaded document's only copy.
- The editor's dirty flag is never set while collaboration is attached, so it
  cannot decide whether an open document changed.
- Serialize-then-parse is not identity. Ghost normalizes list indentation,
  escapes, and line endings, so writing back after reading a file rewrites it.
- Replacing a collaborative document with `setContent` is delete-all plus
  insert-all in Yjs. Cloud restore does this today.
- Cloud version snapshots use Tiptap's raw serializer and restore bypasses the
  frontmatter-aware parser, while local files use the escape-relaxed
  serializer and the frontmatter parser.
- The folder watcher emits one event kind with no provenance, so it cannot
  distinguish Ghost's own atomic save from an external write, or a rename
  from a delete.
- Tracked roots are persisted as a bare list of path strings with no identity.
- Table column widths are stored in an HTML comment inside the file.

## Decision

### Decision summary

- There is one noun in the product, folder. Every sidebar root is a real
  folder on disk.
- Every file has exactly one owner. A root is either **plain** (the filesystem
  owns its files and Ghost edits in place) or **mirrored** (Ghost owns its
  Markdown; the Yjs document is canonical and the file on disk is a mirror
  Ghost writes and watches). Never both.
- A mirrored root that has an account behind it is **synced**: it has
  multiplayer, appears on phone and web, and can share any file in it.
- Folders Ghost creates under `~/Ghost` are mirrored from birth. Any other
  non-repository folder can be converted with "Sync to Cloud". `~/Ghost` is
  the default location, not a boundary.
- Folders under version control are refused. Repositories found inside a
  chosen folder are excluded.
- External writes from agents and other apps are ingested by a three-rule
  policy: replace when the document is closed or unchanged since the last
  mirror write, conflict copy when both sides changed, and a version
  checkpoint before either.
- Roots are identified by a macOS bookmark plus a hidden `.ghost/` folder
  holding the folder ID, the path-to-document index, and local version
  history. Documents have client-generated UUIDs.
- The sidebar shows one list before sign-in and two sections, Cloud and On
  This Mac, after. Sign-in is reachable only from Share, Open on phone, and
  Settings.
- Everything shared with the user lands in one `Shared` root at
  `~/Ghost/Shared`.
- The backend gains client-supplied IDs, a batch adopt RPC, a move RPC,
  explicit root rows, and a visibility query that spans workspaces. The
  collaboration protocol, security shape, and version model from ADR 0004 are
  unchanged.

### One owner per file, two root kinds

A tracked root is a record, not a path:

```ts
interface TrackedRoot {
  id: string;            // client-generated UUID, stable for the root's life
  path: string;          // last resolved absolute path, display only
  bookmark?: string;     // macOS bookmark data, present for mirrored roots
  kind: "plain" | "mirrored";
  cloudRootId?: string;  // present once the root has been uploaded
  order: number;
}
```

A plain root behaves exactly like Ghost today. Files are read and written
through the local document source with version-checked atomic saves. There is
no Yjs document, no `.ghost/` folder, and no history beyond what the editor
session holds.

A mirrored root is Ghost-owned. Each Markdown file has a Yjs document that is
the canonical state. Ghost writes the Markdown file as a mirror whenever the
Yjs document changes, watches the folder, and ingests external writes as
described below. Images beside a note are mirrored as real files in the
existing companion `.assets` directory. A mirrored root without an account
still has local version history and safe ingestion; an account adds upload,
multiplayer, phone, web, and sharing. Sign-in is therefore additive: nothing
about a mirrored root changes shape when the user signs in.

Folders Ghost creates under `~/Ghost` (`Notes` on first run, `Shared` on
first incoming share, and any folder made with New folder) are mirrored from
creation. This is the Yjs-by-default choice: a user who never signs in still
gets history and non-destructive ingestion, and a user who signs in later gets
an upload, not a migration.

The disk mirror must always be a complete content recovery source. If the
local Yjs store is lost, Ghost re-adopts the folder from disk. History may be
lost in that case; content never is.

### Any folder can be synced, with pre-flight checks

"Sync to Cloud" is offered on any plain root, on any folder inside a plain
root, and from the Share sheet of a file inside one. Ghost resolves symlinks,
then checks the folder, its ancestors, and its descendants:

| Verdict | Trigger |
| --- | --- |
| Refuse | An ancestor contains `.git`, `.hg`, `.svn`, `.jj`, `.sl`, `.bzr`, `.fossil`, `_darcs`, or `.pijul` |
| Refuse | The folder is, or is inside, an already mirrored root |
| Refuse | The folder contains an already mirrored root; the message names it |
| Refuse | Home, `/`, `~/Library`, `/System`, `/Applications`, `/Volumes` itself, `~/.Trash`, or Ghost's own application data |
| Refuse | Package bundles such as `.app`, `.photoslibrary`, `.bundle` |
| Refuse | Ghost cannot write there |
| Auto-exclude, notice | Repositories, Obsidian vaults, or other apps' managed folders found inside |
| Auto-exclude, silent | `node_modules`, `.venv`, `target`, `dist`, `build`, `.cache`, `DerivedData`, `Pods`, `.DS_Store` |
| Warn, allow | Inside another sync service: Dropbox, iCloud Drive, anything under `~/Library/CloudStorage`, or `.stfolder`, `.sync`, `.dropbox` markers |
| Warn, allow | On an external or network volume |
| Warn, allow | Above a file or byte threshold set in the plan |
| Warn, allow | Many non-Markdown files, until blob sync exists |

The Git refusal teaches the model: Git owns these files, so Ghost will not
sync them; copy a file into Notes to share it. Converting a plain folder to
mirrored is the same adoption path used at first run for `Notes`: walk the
folder, parse each Markdown file with the shared parser, create a Yjs document
with a client UUID, write the `.ghost/` index, and, when signed in, upload.

Syncing a subfolder of a plain root is allowed. The subfolder becomes its own
mirrored root; the parent tree keeps showing it with a small cloud mark, and
both rows open the same file. Syncing an ancestor of a mirrored root is
refused.

The same checks re-run whenever a root's bookmark resolves, so a mirrored
folder later dragged into a repository or a sync service is caught. The
watcher also reacts live when a version-control marker appears, which
covers a user running `git init` inside a folder Ghost created:

- Marker at the root or an ancestor. Sync pauses immediately and Ghost
  shows a dialog: the folder is now a Git repository, Git and Ghost cannot
  both own the same files, and sync is paused. The choices are Stop syncing
  and Keep paused. Removing the repository resumes sync automatically.
  Nothing on disk and nothing in the cloud is deleted by the pause.
- Marker inside a subfolder. The subfolder is excluded from then on with
  the same notice used at pre-flight, and its cloud copies move to cloud
  Trash so there is never a second canonical copy. Trash is recoverable.

### Identity, moved folders, and the `.ghost/` folder

A mirrored root is identified by a macOS bookmark, created and resolved
through `objc2-foundation`, which keeps resolving after a rename or a move on
the same volume. The root also carries a hidden `.ghost/` folder:

```text
.ghost/
  folder.json     root id, cloud root id, schema version
  index.json      relative path → document UUID, plus last mirror version token
  versions/       local version history: <docId>/<timestamp>.md and .yjs
```

`.ghost/` is excluded from the tree, from search, from the watcher's
ingestion path, and from sync, and stays excluded when "show hidden files" is
on. The tree already hides dot-directories by default; this decision makes
the exclusion explicit.

Documents have client-generated UUID v4 identities from creation. The index
maps relative paths to those IDs so a document survives renames on disk.
Renames are detected first from paired filesystem rename events and then by
content hash when the platform delivers a delete and a create.

On launch and on window focus Ghost resolves every mirrored root's bookmark:

| Result | Behavior |
| --- | --- |
| Resolves to a new path | Update the record silently |
| Resolves, but the folder now fails a pre-flight rule | Pause sync; the row shows why, with Move and Stop syncing |
| Does not resolve; volume unmounted | Row dims to "Unavailable" and returns when the disk does |
| Does not resolve at all | Row dims to "Can't find <name>" with Locate and Stop syncing. Locate verifies `.ghost/folder.json` before resuming, or offers to re-mirror from the cloud into an empty folder |

A missing local folder never deletes cloud content. Only in-app Trash does.

### Mirror writes and external-write ingestion

**Mirror write.** When a mirrored document's Yjs state changes for any reason
other than ingestion, Ghost serializes it with the shared escape-relaxed
serializer and writes the file through the existing atomic writer (sibling
temp file, permission and xattr preservation, fsync, rename, parent fsync).
The write is version-checked against the last mirror version token only.
Expected-content equality, which the local save path uses today, is not used,
because remote peers change the document without touching disk. After each
write Ghost records the returned version token and the Yjs state vector in
memory and in `.ghost/index.json`.

**Own-write suppression.** The watcher moves from the minimal debouncer to the
full one so it receives event kinds and rename pairs, is registered per root,
and filters Ghost's temp files, `.ghost/`, repositories, and the auto-exclude
list natively. Ghost's own mirror writes are suppressed by a native registry
keyed on the post-rename device and inode, not on path, because the atomic
rename changes the inode.

**Ingestion policy.** When an external change reaches a mirrored Markdown
file, a pure function decides the outcome from the disk content, the Yjs
document, the recorded state vector, and the recorded version token:

1. The document is closed in Ghost, or open and its state vector still equals
   the one recorded at the last mirror write. Parse the disk content with the
   shared parser, take a local version checkpoint with reason
   `external_write`, and apply the new content as one Yjs transaction. This is
   the agent case, including watching an agent write a plan live.
2. Both the disk and the Yjs document changed since the last mirror write.
   Write `name (conflict YYYY-MM-DD HH.mm).md` beside the file through the
   atomic writer, keep the Yjs document as is, and raise the compact
   notification.
3. The parsed disk document equals the current Yjs document. Do nothing.
   Comparison is on parsed documents, not bytes, because the serializer is not
   identity-preserving.

After ingesting, Ghost marks the disk as current and does not write the file
back until the Yjs document changes for another reason. This prevents the
write, event, ingest loop and leaves an agent's formatting untouched.

**Applying a parsed document.** Ingestion and version restore apply changes as
a block-level diff: top-level nodes are compared, and only changed runs are
replaced inside one Yjs transaction. Whole-document `setContent` is not used
on a collaborative document. This keeps other collaborators' cursors outside
the changed blocks, keeps history readable, and fixes the existing restore
path.

**Reusable by design.** The ingestion function takes plain values and returns
a verdict. It has no dependency on the watcher, the window, or React, because
the later MCP server and the cloud write API apply the same policy to writes
that arrive by other routes.

### Shared parser and serializer everywhere

All Markdown enters and leaves the editor through `parseMarkdownDocument` and
`serializeMarkdownDocument`. The cloud version snapshot and restore paths
switch to them from the raw Tiptap calls before the mirror is built, so the
checkpoint taken to protect a user is never the lossy copy.

The full Tiptap schema needs a DOM and is not a reasonable dependency for a
Deno edge function. Server-side processing of Markdown snapshots, such as the
later task index, uses the plain Markdown parser already in the dependency
tree. Any syntax that must be indexed server-side must therefore be
recognizable without Tiptap.

### Local version history

Version history exists for every mirrored root, with or without an account.
Versions are stored on disk under `.ghost/versions/<docId>/` as a Markdown
snapshot and a Yjs snapshot, using the same idle, minimum-gap, and maximum-gap
heuristic as the cloud versions today, plus the `external_write` reason. At
sign-in, or when a plain root is converted while signed in, local versions
upload in a batch. After that the server store is authoritative and the local
store is a cache with the same cap.

Storing versions on disk rather than in the browser store keeps them
inspectable in Finder, survives loss of the browser store, and makes the
mirror folder self-contained.

### Sidebar and sign-in

With no account there is one list of roots and no section headers. Mirrored
roots created by Ghost sit in it like any other. Signing in is what makes
"Cloud" true, so the split appears then and stays:

```text
 CLOUD
 ● Notes
 ● Pepper notes      👥
 ● Cowork
 ● Shared

 ON THIS MAC
 ● pepper
 ● tirith
```

- Both sections render through the same row, rename, trash, and context-menu
  components inside one keyboard tree, so arrow keys and type-ahead cross
  sections.
- The only glyphs are a people mark on a root the user shared out and a cloud
  mark on a subfolder that is also a mirrored root.
- Sync state is not sidebar chrome. The document header keeps its compact
  Saved, Saving, Offline label, merged with the local save status into one
  widget. A sync failure adds one muted row under the affected root.
- An empty On This Mac shows one muted "Open a folder…" row.
- `Shared` appears only when it contains something.
- Selection, navigation history, recent-file cycling, save flushing, focus,
  and the command palette operate on one active-document concept that covers
  both root kinds.

Sign-in has three entry points: the Share button, an "Open on phone" action,
and Settings → Account. It is never rendered in the sidebar. At sign-in, every
mirrored root that exists locally uploads; nothing plain moves without the
user asking. Sign-out exists, never touches disk, and pauses sync.

"Stop syncing" moves a root down: files stay on disk as plain Markdown, the
`.ghost/` folder is removed, the cloud copy goes to cloud Trash, and any
shares on it are revoked. The confirmation dialog says all three.

### Shared with you

One root named `Shared`, owned by nobody, mirrored to `~/Ghost/Shared`.
Everything shared with the user lands in it: a single shared document appears
as a file directly inside it, and a shared folder as a subfolder. It is flat
and sorted like any folder; the document header shows who shared it. Name
collisions take the sharer's name as a suffix.

This maps the sidebar to ownership: the user's roots are things they own and
can move, delete, and share out; `Shared` holds things they can only leave.
"Leave" replaces Delete for items the user does not own, drops the
membership, and removes the mirror. Revocation by the owner removes the item
and its mirror with one muted notification. A document shared directly that
is also inside a shared folder shows once, in the folder. Mirroring a shared
item to a custom path is deferred.

### Backend changes

The ADR 0004 control plane, security shape, durability protocol, and version
model are retained. These additions are required:

- `cloud_create_item` accepts an optional client ID, validates it, and is
  idempotent on conflict, so a retried upload is a no-op.
- A batch adopt RPC inserts a client-built subtree in one transaction,
  parents before children, and returns per-item outcomes including any
  server-side rename on sibling collision.
- `cloud_move_item` exists. The disk mirror demands it on the first external
  move.
- `Notes` and `Shared` have explicit root anchors instead of overloading a
  null parent.
- A `cloud_list_visible_items` RPC returns the owner's tree and every
  membership-rooted subtree tagged by root, replacing the workspace-scoped
  select that cannot see items from other workspaces.
- Membership share and revoke RPCs, invitations, and share links follow in the
  sharing phase, using the existing hierarchical role helper.
- Ancestry is precomputed before folders grow large, because the current
  per-row recursive policy is quadratic.
- Local versions upload in a batch at adoption.
- A mirrored root without an account runs on a separate local session that
  the editor cannot tell apart from a cloud session, rather than a new state
  inside the cloud adapter. Upload swaps the session. An unresolvable role on
  a document the server has never seen therefore never reaches the code path
  that clears a cache.

### Document boundary

`DocumentSourceCapabilities.persistence` gains a third value, `mirrored`,
alongside `versioned-file` and `collaborative`. A mirrored document loads and
saves through the Yjs session and the mirror writer, never through the plain
local save path, and accessory windows open mirrored files through the same
boundary so there is never a second writer on one file. Rename, move,
duplicate, and companion-asset rewrites for a mirrored document mutate the
Yjs document and let the mirror follow, instead of editing bytes on disk
behind the editor.

### Designed for later

These are outside the first build, but the decisions above keep them cheap:

- **MCP server.** File mode first: an agent lists, reads, creates, changes,
  and trashes notes by writing files, and the watcher ingests them with the
  policy above. Cloud mode second: a personal access token and a server-side
  "apply this Markdown to this document" operation that runs the same
  ingestion function.
- **Tasks and reminders.** Task items gain due and reminder attributes and, when
  referenced, a block ID, using plain-text syntax that round-trips through the
  editor and is recognizable by the plain parser. A server-side task index is
  derived from the Markdown snapshots the cloud already stores, and reminders
  run on `pg_cron` and edge functions. The local Tasks view uses the same
  parser over mirror files.
- **Blob sync.** Non-Markdown files in a mirrored root sync as versioned
  blobs, with the auto-exclude list seeding user filters. Images beside a note
  are the first blobs.
- **Presentation metadata.** Table widths and image sizes currently live inside
  the file. An agent rewriting the file drops them. This is a known
  destructive edge; the checkpoint before every ingestion makes the loss
  recoverable from history, and a `.ghost/` sidecar for presentation metadata
  is the eventual fix. Ghost's general rule stands: no silent destructive
  edit without a version to return to.

### Platforms

Phone and web show the Cloud section only. Desktop is notes plus file editor.
Finder "Open with" keeps opening an accessory window.

## Alternatives considered

### One synced root, Dropbox style

Rejected. Simpler to explain, but it forces users to move agent working
directories and their own folder layouts into `~/Ghost` before sharing a
single file from them. The ingestion machinery is required either way, so
the saving was only path stability, which bookmarks and `.ghost/` solve.

### A managed File Provider location after the cloud product

Rejected, superseding ADR 0004's stages 7 to 9. A plain folder with
write-through is what users and agents can see, needs no system extension,
and works identically for `~/Ghost/Notes` and for a folder anywhere else.

### Plain files before sign-in, Yjs only for synced roots

Rejected. It would have avoided a local version store and a browser-store
re-key at sign-in, but sign-in would change the nature of `Notes`, history
would not exist without an account, and agent writes before sign-in would
go through the destructive reload path rather than ingestion. The adoption
code is needed for Sync to Cloud regardless.

### Text diff into Yjs

Rejected for ingestion. The Yjs document holds a ProseMirror tree, not text,
so a text diff cannot be applied to it. Parse plus block-level tree diff is
cheap and sufficient; a finer diff can replace it later behind the same
function.

### Share for review of Git files

Cut. Snapshot anchoring, cloud comments, and suggested edits applied locally
are a second product. "Copy to Notes" covers the need.

### Separate windows for files and notes

Rejected. Two front doors make the product more bimodal, not less.

## Consequences

### Positive

- One mental model and one sidebar. The words notebook, workspace, space, and
  ownership do not appear in the product.
- Agents see every synced folder with no integration work, and their writes
  are ingested non-destructively.
- Sharing a file from any folder is one action that does not move anything.
- Local Ghost keeps its no-account contract, and `Notes` gains history without
  one.
- The collaboration engine, security shape, and version model from ADR 0004
  carry over unchanged.

### Costs and risks

- The watcher, root persistence, sidebar composition, and first run are
  rewritten. No test mounts the main layout today, so the rework starts by
  adding one.
- A local version store on disk is new machinery.
- Rename detection by content hash can misattribute identical files; the
  index and the paired-event path reduce the window.
- Ingestion at block granularity can still move a collaborator's cursor inside
  a changed block.
- Bookmarks do not survive a move across volumes; the Locate flow covers it.
- Users who enable hidden files can still open `.ghost/` in other apps.
- Syncing a folder another service also syncs can produce duplicates. Ghost
  warns and allows.

## Relationship to ADR 0004

ADR 0004 remains the decision of record for: Yjs as live source of truth,
Supabase as control and collaboration plane, the audited `y-supabase`
adaptation behind a Ghost-owned adapter, the append-only durable update log
and catch-up protocol, hierarchical permissions and link and guest sessions,
passwordless accounts and the native callback path, the initial privacy
boundary, version snapshots, and the acceptance-gate discipline.

This ADR supersedes these parts of ADR 0004:

- "Preserve local Ghost and add Cloud as a separate source", to the extent
  it makes Cloud folders logical containers with no disk presence and adds a
  Cloud section above the local tree.
- "Limit cloud items to Markdown documents and logical folders": folders are
  real, and blob sync is planned.
- "Stage filesystem materialization after the cloud product" in full: mirrored
  roots exist from the first build, and there is no managed Finder location
  distinct from any other mirrored folder.
- Migration steps 7 to 10.

## Acceptance gate

This ADR remains Proposed until the following are demonstrated with Ghost's
real schema:

1. A folder created under `~/Ghost` with no account has per-document Yjs
   state, a `.ghost/` index, and local versions; signing in uploads it with no
   user-visible change and no duplicate items.
2. An agent rewrites a mirrored file while it is closed, while it is open and
   unchanged, and while it is open with local edits. The first two ingest as
   one transaction with a checkpoint; the third writes a conflict copy. No
   case loses content.
3. Ingesting an agent's file and then making no edits leaves the file's bytes
   untouched.
4. A remote collaborator's edit produces one mirror write, and that write does
   not re-enter as an ingestion.
5. Renaming a mirrored root in Finder, moving it on the same volume, and
   unmounting its volume produce the behaviors in the bookmark table, and none
   deletes cloud content.
6. Sync to Cloud on a folder inside a repository is refused; on a folder that
   contains a repository, the repository is excluded and the rest syncs.
   Running `git init` inside a mirrored root pauses sync with the dialog,
   deletes nothing, and removing `.git` resumes it.
7. Restore from version history on a collaborative document preserves another
   collaborator's cursor outside the changed blocks.
8. Deleting the browser store re-adopts every mirrored root from disk with no
   content loss.
9. Cloud snapshots, local versions, and mirror writes all round-trip
   frontmatter and table widths through the shared parser and serializer.
10. The ingestion function has unit tests covering all three verdicts and is
    called from nowhere but a thin watcher handler.

## Migration

Phases live in the plan. In summary: rework the sidebar, roots, and first run
locally; build the mirror engine behind a flag with the backend ID and adopt
changes; ship Sync to Cloud, the two-section sidebar, and relocated sign-in;
then sharing, then images and blobs, then tasks and the MCP server.
