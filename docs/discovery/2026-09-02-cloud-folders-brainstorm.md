# Cloud Folders — One Model for Notes, Files, and Agents

**Date:** 2026-09-02
**Status:** Captured in [ADR 0005](../adrs/0005-synced-folders.md)
and the [synced folders roadmap](../plans/synced-folders-roadmap.md) on
2026-09-02
**Supersedes in spirit:** the "separate Cloud source" framing in
[ADR 0004](../adrs/0004-cloud-collaborative-markdown-workspaces.md)
and the filesystem stages 7–9 of the
[cloud collaboration roadmap](../plans/cloud-collaboration-roadmap.md).
Those documents will be updated, not silently replaced.

## The problem

Ghost started as a Markdown editor and grew into a general local-file editor
used on code repos and agent working directories. It should now also replace
Notes and Bear: personal notes that sync to phone and web, with live
multiplayer. The retained Cloud slice proves the multiplayer engine, but it
presents Cloud as a second kind of thing: logical folders in Postgres with no
presence on disk, a "Cloud" section above "Workspace", and a sign-in form
inside the sidebar. That is what makes the app feel like two products.

At the same time, agent-facing documents (plans, discovery notes, learnings)
want to be both agent-visible on disk and shareable with people, and files
inside a Git checkout must never be live-synced.

We need one mental model, one sidebar, and no cruft.

## Core rule

Every file has exactly one owner.

- Either the filesystem owns it and Ghost is an editor that writes in place.
- Or Ghost owns it: the Yjs document is the source of truth, and the copy on
  disk is a mirror that Ghost writes and watches.

Never both. Every product decision below derives from this rule.

## The model

There is one noun: **folder**. Every root in the sidebar is a real folder on
disk. Any root can be **synced to Cloud** or not, and that is the only
distinction in the product.

A synced folder:

- has version history;
- appears on phone and web;
- can share any file or subfolder in it; and
- accepts writes from other apps and agents, which Ghost ingests.

An unsynced folder is edited in place, exactly like Ghost today.

Folders Ghost creates under `~/Ghost` are Yjs-backed from creation, so
history and non-destructive ingestion work before any account exists.
Sign-in adds upload, multiplayer, phone, and sharing, and changes nothing
else. The disk mirror is always a complete recovery source for content.

`~/Ghost` is the default parent for Ghost-created folders (`Notes`, and
`Shared` for items shared with you). It is a convenience, not a boundary.
This is the Obsidian model, not the Dropbox model: the folder is the unit,
and any folder can be the unit.

### What Obsidian gets right, and what we do differently

Borrowed:

- A vault is a folder you point at. It is never imported or owned. Other apps
  write into it and the app picks the changes up.
- Sync is an opt-in property of a vault, not a different kind of vault.
- A moved vault gets a Locate prompt, not data loss.
- A hidden marker folder (`.obsidian`) makes the folder self-describing.

Different:

- Ghost keeps its multi-root sidebar instead of one vault per window.
- Ghost has live multiplayer through Yjs.
- Ghost keeps a far smaller settings surface.

## Vocabulary

| Word | Meaning |
| --- | --- |
| Folder | Any root in the sidebar. Always a real folder on disk. |
| Cloud | The section of the sidebar holding synced folders. Never a place that is not also a folder on disk. |
| On This Mac | The section holding opened, unsynced folders. |
| Sync to Cloud | The verb on a folder. Nothing moves on disk; the row moves up. |
| Stop syncing | The reverse. Files stay on disk as plain Markdown; the cloud copy goes to cloud Trash. |
| Notes | The folder Ghost creates on first run at `~/Ghost/Notes`. Only special as the ⌘N default. |
| Shared | The folder Ghost creates at `~/Ghost/Shared` for everything shared with you. |

The words "notebook", "workspace", "space", and "ownership" do not appear in
the product.

## Sidebar

Rows, dots, the amber guide, inline rename, context menus, and keyboard
navigation stay exactly as they are. Both sections use the same components.

With no account there is one list and no headers:

```
 Search…                        ⌘K

 ● Notes
 ● pepper
 ● tirith

 Settings                       ‹
```

Signing in is what makes "Cloud" true, so that is when the split appears, and
from then on both headers are always present:

```
 CLOUD
 ● Notes
 ● Pepper notes      👥
 ● Cowork
 ● Shared
     Budget plan
   ▸ Family
     Q3 planning

 ON THIS MAC
 ● pepper
 ● tirith
 ● Documents
```

Rules:

- The only glyphs are a people mark on a root you have shared out, and a small
  cloud mark on a subfolder inside an On This Mac tree that is also a synced
  root (see "Syncing a subfolder of an open root").
- Sync status is not sidebar chrome. The document header keeps its compact
  Saved / Saving / Offline label. A sync failure adds one muted row under the
  affected root, and nothing else.
- An empty On This Mac section shows one muted "Open a folder…" row rather
  than disappearing. Stable beats clever in a sidebar.
- `Shared` appears only when it contains something.
- No root-level files. Everything lives in a folder.
- Big folders stay collapsed by default, load lazily, and remember expansion.
  Search is the primary way in.

### Names considered

| Pair | Verdict |
| --- | --- |
| Cloud / On This Mac | Chosen. Pairs with Apple's iCloud / On My Mac. Honest once Cloud is always also on disk. |
| Synced / On This Mac | Runner-up. "Sync" matches the verb, but reads technical. |
| All Devices / This Mac | Over-promises before sign-in. |
| Notes / Folders | Wrong the moment a Cowork folder is synced. |
| Ghost / Folders | The app name as a section header reads oddly inside the app. |

## First run

1. Ghost opens with one root, `Notes`, expanded. A note called Welcome is
   selected and the cursor is blinking at the end of it. No wizard, no account
   prompt, no sections, and the word Cloud appears nowhere.
2. The Welcome note is the onboarding, in about five sentences: notes live in
   `~/Ghost/Notes` as plain Markdown you can see in Finder; ⌘N makes a note;
   ⌘O opens any folder and Ghost edits it in place; when you want a note on
   your phone or with someone else, press Share, and that is the first time
   Ghost asks you to sign in.
3. Days pass. Everything is local. Existing users upgrading see their tracked
   folders and nothing new; `Notes` is created lazily the first time ⌘N has
   nowhere else to go.
4. They press Share on a note. A sheet says "Sign in to share" with Sign in
   with Apple and an email field. They click the emailed link, the app comes
   forward, and the sheet dismisses.
5. `Notes` slides up into a new Cloud section, the headers appear, the header
   label ticks from Saving to Saved, and the share sheet now shows link
   options. One sheet, one email click.
6. They press Share on a file inside the Cowork folder. The sheet offers two
   buttons: "Sync Cowork" and "Copy to Notes". Sync runs the pre-flight
   checks, they confirm, the row moves up, and the link appears.
7. On their phone they open the web app, sign in, and see the Cloud section
   and nothing else.
8. Their partner shares a document. It arrives by email and opens on the web.
   On the Mac, `Shared` appears under Cloud with the document inside it.
9. They run Claude with `--add-dir ~/Ghost/Notes`, or right-click a synced
   folder and choose Link into project, or sync the Cowork folder and let
   Cowork keep writing to it.

## Adding and creating

One `+` button and three shortcuts:

- ⌘N: new note in the selected folder, else in `Notes`. If `Notes` does not
  exist, create it (and `~/Ghost` if needed) and, when signed in, sync it.
- New folder: a name only. Created inside the selected root, else in
  `~/Ghost` as a new root.
- ⌘O: open a folder. It lands in On This Mac.
- Drag from Finder onto the Cloud section: copy into `~/Ghost` and sync.
  Drag onto On This Mac: open in place. Same drop zone as today.

Copy bridges, always copies, never links:

- "Copy to Notes…" on any file in an unsynced folder.
- "Save a copy…" on any note. "Promote to project" is the same action with a
  repository preselected.

## Sync to Cloud

Right-click a root or a folder inside an On This Mac root, or press Share on a
file inside one. Ghost resolves symlinks, then runs pre-flight checks on the
folder, its ancestors, and its descendants.

| Verdict | Trigger |
| --- | --- |
| Refuse | An ancestor contains `.git`, `.hg`, `.svn`, `.jj`, `.sl`, `.bzr`, `.fossil`, `_darcs`, or `.pijul` |
| Refuse | The folder is, or is inside, an already synced root |
| Refuse | The folder contains an already synced root. The message names it and says to stop syncing that one first |
| Refuse | Home, `/`, `~/Library`, `/System`, `/Applications`, `/Volumes` itself, `~/.Trash`, or Ghost's own app data |
| Refuse | Package bundles such as `.app`, `.photoslibrary`, `.bundle`. They look like folders and are not |
| Refuse | Ghost cannot write there. The mirror needs write access |
| Auto-exclude, notice | Repositories found inside the folder. "3 Git repositories inside will be skipped." Same for a nested Obsidian vault or another app's managed folder |
| Auto-exclude, silent | `node_modules`, `.venv`, `target`, `dist`, `build`, `.cache`, `DerivedData`, `Pods`, `.DS_Store`. This list seeds user filters later |
| Warn, allow | Inside another sync service: Dropbox, iCloud Drive, anything under `~/Library/CloudStorage`, or `.stfolder`, `.sync`, `.dropbox` markers |
| Warn, allow | On an external or network volume. "May be unavailable when disconnected" |
| Warn, allow | Very large. The pre-flight scan reports file and byte counts above a threshold |
| Warn, allow | Many non-Markdown files, until blob sync lands. "412 files won't sync yet" |

The same checks re-run whenever a root's bookmark resolves, so a folder that is
later dragged into a repository is caught.

The Git refusal dialog teaches the model in two sentences: Git owns these
files, so Ghost will not sync them; you can copy a file into Notes to share it.

### Syncing a subfolder of an open root

Allowed. The subfolder becomes its own root under Cloud. The parent tree keeps
showing it with a small cloud mark, and clicking either row opens the same
file. It is one folder on disk with two views. Syncing a root that is already
synced is not offered; syncing an ancestor of a synced root is refused.

### Git appears later

A user can run `git init` inside a folder Ghost created and is syncing. The
watcher sees the marker appear and Ghost reacts at once rather than waiting
for the next bookmark check:

- At the root or above it: sync pauses and a dialog explains that the folder
  is now a Git repository, that Git and Ghost cannot both own the same files,
  and that sync is paused. Buttons are Stop syncing and Keep paused.
  Deleting the repository resumes sync on its own. The pause deletes nothing
  on disk or in the cloud.
- In a subfolder: the subfolder is excluded with the same notice as
  pre-flight, and its cloud copies go to cloud Trash, which is recoverable.

The same handling applies to every marker in the refuse list, not only Git.

### What gets synced, in order

1. Markdown and the images they reference.
2. Every file type, as blobs with versions.
3. User filters, seeded from the auto-exclude list above.

### Stop syncing

The row moves down. Files stay on disk as plain Markdown. The `.ghost` marker
is removed. The cloud copy goes to cloud Trash and is recoverable. Any shares
on it are revoked, and the confirmation dialog says so.

## Identity and moved folders

A synced root is not identified by its path.

- Ghost stores a macOS bookmark for each synced root, the same mechanism
  Finder aliases use, which keeps resolving after a rename or a move on the
  same volume.
- Each synced root carries a hidden `.ghost/` folder holding its folder ID
  and the file-to-document-ID index. The marker is excluded from sync and
  from the tree.
- Documents have client-generated UUIDs so they can be created offline before
  an account exists and uploaded at sign-in with no migration.
- Renames on disk are detected by matching the deleted path's content to the
  new path so document IDs survive agents and Finder renaming files.

On launch and on window focus Ghost resolves every bookmark:

| Result | Behavior |
| --- | --- |
| Resolves to a new path | Update silently |
| Resolves, but the folder now breaks a pre-flight rule | Sync pauses. The row shows one line saying why, with Move and Stop syncing |
| Does not resolve; volume unmounted | Row dims to "Unavailable" and returns when the disk does |
| Does not resolve at all | Row dims to "Can't find Cowork" with Locate and Stop syncing. Locate verifies the chosen folder's `.ghost` ID before resuming, or offers to re-mirror from the cloud into an empty folder |

The safety rule underneath: **a missing local folder never deletes cloud
content.** Only in-app Trash does. Deleting a synced folder in Finder pauses
sync and leaves the phone copy intact.

### If the user deletes Notes early

`Notes` is only special in two ways: Ghost creates it on first run, and it is
the ⌘N default. Close and Trash work on it like any root.

- Closed or deleted before sign-in: nothing happens at sign-in beyond whatever
  triggered it. Signing in from Settings with nothing to sync shows one muted
  row under Cloud: "Nothing in Cloud yet. Sync a folder, or press ⌘N."
- ⌘N with no selection and no synced folder recreates `~/Ghost/Notes` (and
  `~/Ghost` if it is gone) and syncs it when signed in.
- Deleted after it was synced: the "Can't find Notes" row above. The cloud
  copy is intact.
- `~/Ghost` deleted entirely: recreated lazily when `Notes` or `Shared` is
  next needed.

## Shared with you

One root named `Shared`, owned by nobody, at `~/Ghost/Shared`. Everything
someone shares with you lands in it, whether a folder or a single document.

Why one root instead of top-level items: it maps to ownership, which is the
rule the whole product runs on. Your roots are things you own and can move,
delete, and share out. `Shared` holds things you do not own and can only
leave. The visuals follow: a people mark on your own root means you shared it
out; the `Shared` root means it came in.

The most common case is a single document shared directly. It appears as a
file directly inside `Shared`, mirrored to `~/Ghost/Shared/Budget plan.md`.
A shared folder appears as a subfolder. `Shared` is flat and sorted like any
other folder; the document header shows who shared it.

- On arrival Ghost shows the same compact notification used elsewhere:
  "Anna shared Budget plan". It does not steal the selection.
- Name collisions get the sharer's name as a suffix, not a number.
- Shared items mirror to disk like everything else, so Finder and agents see
  them.
- In version one a shared item cannot be moved out of `Shared`. Mirroring a
  shared folder to a custom path, so a teammate can point their own agent at
  it, is a later feature.
- Removing is "Leave", not "Delete", and only appears on items you do not
  own. It drops your membership and removes the mirror. A link you still have
  can bring it back.
- Revocation by the owner removes the item and its mirror with one muted
  notification.
- A document shared directly that is also inside a folder shared with you
  shows once, in the folder.

## Sign-in

Sign-in has three entry points and no others: the Share button, an "Open on
phone" action, and Settings → Account. It never appears in the sidebar.

Signing in uploads whatever is already synced-eligible with no migration.
`Notes` syncs automatically at sign-in because it is Ghost's own folder.
Nothing else moves without the user asking.

## Agents and external writes

This is the feature that makes Ghost different from Bear.

Zero setup: `claude --add-dir ~/Ghost/pepper` works on day one, because a
synced folder is a plain folder.

One click: right-click a synced folder → "Link into project…". Ghost creates a
`notes` symlink inside the chosen repository and adds it to
`.git/info/exclude`, so the repository never shows dirty and nothing is
committed. The exclude file lives in the common Git directory, so it covers
every worktree; the Superset setup script recreates the symlink per worktree.

External writes, from Claude, Cowork, Codex, or any editor, are ingested by
the existing folder watcher with a three-rule policy:

1. Document closed in Ghost, or open but unchanged since Ghost's last mirror
   write: replace the content as one Yjs transaction, after a version
   checkpoint. This is the agent case, including watching an agent write a
   plan live in rich text.
2. Both disk and the Yjs document changed: write a conflict copy beside it
   (`plan (conflict 2026-09-02 14.03).md`) and say so.
3. Later, a Ghost MCP server lets agents make real deltas instead of file
   rewrites.

Ghost's own mirror writes must not trigger ingestion. The same policy applies
to writes arriving through the cloud API, which is how the MCP server's cloud
mode will work.

The document lifecycle for project work: draft plans and discovery notes in a
synced project folder (live, phone-editable, shareable); promote a copy into
the repository when they harden. Agents see the draft through the link; people
see it through Cloud.

## Later, but designed for now

These are not in the first build, but the first build must not make them hard.

### MCP server

A Ghost MCP server so agents can list, read, create, change, and trash notes,
and manage tasks and reminders.

- File mode first: works offline and without an account, against synced and
  unsynced folders alike, using the same ingestion policy as the watcher.
- Cloud mode second: a personal access token lets an agent work through the
  cloud API even when the Mac is closed, and lets remote agents in.
- Requirement on the first build: the ingestion policy must be a reusable
  function, not code buried in the watcher handler, and the cloud must expose
  a "apply this Markdown to this document" operation that runs it server-side.

### Tasks and reminders

Markdown task items with due dates and reminders, a Tasks view, and agent
management through the MCP server.

- The syntax must be plain text that round-trips through the editor, so agents
  can write it. Task items need a stable identity only when a reminder or an
  agent references them; an appended block ID is the likely answer.
- A server-side task index is derived from the Markdown snapshots the cloud
  already stores. Reminder delivery runs on `pg_cron` and Supabase edge
  functions.
- The local Tasks view derives from the mirror files with the same parser, so
  it works offline and for unsynced folders too.
- Requirement on the first build: the task syntax must be recognizable by
  the plain Markdown parser, because the full Tiptap schema needs a DOM and
  will not run in an edge function. The server-side index parses snapshots
  with the plain parser; the clients use the full schema.

### Blob sync

Non-Markdown files in a synced folder sync as versioned blobs, with the
auto-exclude list as the seed for user filters.

### Presentation metadata

Table column widths and image sizes currently live inside the Markdown file
(a `ghost-table-widths` comment and `<img width>` HTML). An agent that
rewrites the file drops them. This is a known destructive edge. Today the
version checkpoint taken before every ingestion makes the loss recoverable
from history; the eventual fix is a `.ghost/` sidecar for presentation
metadata keyed by document ID. The general rule stands: Ghost never makes a
silent destructive edit without a version to return to.

## Platforms

- Phone and web show the Cloud section only. Ghost is a notes app there.
- Desktop is notes plus file editor.
- Finder "Open with" keeps opening an accessory window with no sidebar.

## Cut

- "Share for review" for Git files (snapshot, cloud comments, suggested
  edits applied locally). The copy bridge covers the need. Revisit only if
  users ask.
- In-place conversion of a folder outside Ghost's checks. Every sync goes
  through pre-flight.
- The "two front doors" fallback (accessory editor for files, main window as
  a notes app). It makes the product more bimodal, not less.
- A Cloud section that is not also folders on disk.
- Sign-in in the sidebar.

## Key decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Unit of sync | Any non-Git folder | Obsidian model; covers Cowork and Codex folders without moving them |
| Default location | `~/Ghost` for Notes and Shared | New things need a home; not a boundary |
| Ownership | Yjs canonical for synced Markdown; disk is a mirror | One owner per file |
| Sidebar | One list before sign-in; Cloud / On This Mac after | The split appears exactly when it means something |
| Root identity | macOS bookmark plus `.ghost/` folder ID | Survives moves and renames; self-describing folder |
| Document identity | Client-generated UUID, path index in `.ghost/` | Offline creation, no migration at sign-in |
| External writes | Replace when clean, conflict copy when dirty, checkpoint first | Covers agents without a tree-diff engine |
| Shared with you | One `Shared` root, flat, mirrored | Maps to ownership; things you can only leave |
| Sign-in | Share, Open on phone, Settings only | Never a wall, never in the sidebar |
| Git | Refuse ancestors, auto-exclude descendants | Git owns those files |
| Sync scope | Markdown and images, then blobs, then filters | Ship the notes case first |
| Before sign-in | Ghost-created folders are Yjs-backed from creation | Sign-in is additive; history without an account |
| Local history | On disk under `.ghost/versions/` | Survives loss of the browser store; inspectable |

## Open questions

- The exact block-ID syntax for addressable tasks, and the due/reminder
  syntax.
- Whether local version history should cover every Markdown file Ghost
  opens, not only synced ones. It would make sync the only thing an account
  adds.
- The size threshold for the "very large" warning.
- Whether `Shared` should ever allow moving an item to a custom path.
- The MCP transport (local socket to the running app versus direct file and
  cloud access) and its authentication in cloud mode.
- What the web client shows for a synced folder that contains not-yet-synced
  non-Markdown files.
