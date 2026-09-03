# Synced folders review — what we learned

The 2026-09-03 review of the synced-folders and sharing work (rationale in the [synced-folders ADR](../adrs/0005-synced-folders.md), build log in the [roadmap](../plans/synced-folders-roadmap.md)). These are the surprises: places where a correct-looking piece met another piece and lost data or access.

## TL;DR

- Every loop that touches `.ghost/index.json` must go through the per-root queue and merge with what the editor recorded meanwhile. A snapshot written back seconds later is a lost update, and a lost content hash turns the next rename into trash plus create.
- A remount of the editor is an adoption. Anything that changes the path of an open note (rename, move, drag) must move the index entry first, or the note gets a new document ID and its Cloud original is trashed.
- "Missing on disk" has two meanings. Never on disk means write it; was on disk and gone means someone deleted it, so never write it back.
- A record with no version is not permission to write. It means nobody has established what the file holds.
- Launch order matters: reconciliation ran before the session was restored, so "signed out" was the state for the first pass on every launch.
- On the server, authorizing the source of an operation is not authorizing its destination. Duplicate wrote into the parent; trash and rename accepted a root from an editor.
- A name from someone else's Cloud is untrusted input to the filesystem. It must be one path segment, checked on both sides, and the native commands must refuse `..` regardless.
- Suppressing a watcher event by file stamp is right for writes and wrong for renames: a rename keeps the stamp, so another app's rename looked like Ghost's own.
- A file-id cache for rename pairing walks every watched folder, symlinks included. That is fine for a notes folder and disastrous for an open code checkout.
- Identity columns are assigned at insert, not commit. "Everything after ID n" can skip a row committed later with a smaller ID.

## The pull resurrected deleted files

**Symptom:** deleting a note on the Mac brought it back within a second and the deletion never reached Cloud. **Cause:** the Cloud pull wrote a file whenever the local store had content and the file was missing, and a window focus ran the pull before reconciliation. **Fix:** write from Cloud only when the index says the file has never been on disk (`contentHash` and `mirrorVersion` both null), and run the pull on the same queue as reconciliation.

## Renaming an open note minted a new document

**Symptom:** rename a synced note from the header; Cloud shows the old note in Trash and a new note with no history or shares. **Cause:** the layout retargets the editor immediately; the editor remounts, finds no index entry for the new path, and adopts a fresh document; reconciliation later pairs nothing and trashes the old one. **Fix:** `relocateDocument` moves the index entry and the Cloud item before the retarget, queued with reconciliation; as a backstop the editor looks for an entry whose file is gone and whose hash matches before minting an ID.

## The writer overwrote an agent's edit when ingestion failed

**Symptom:** a file edited by an agent while closed; open it, type, the agent's text is gone with no conflict copy. **Cause:** adoption marks a divergent file with `mirrorVersion: null`; the writer passed that as "no expected version" and the Rust side skipped every check. Open-time ingestion normally fixes the record first, but any failure in it removed the protection. **Fix:** the writer holds writes while the record has no version and reports an ingestion failure instead of writing blind; `markDiskCurrent` then schedules what was typed meanwhile.

## Reconciliation before the session existed

**Symptom:** deletions and renames made while Ghost was closed never reached Cloud. **Cause:** the launch reconcile runs before `useCloudAccount` restores the session, so it ran with no client and dropped the entries from the index. **Fix:** for an uploaded root, keep deleted entries and mark renamed ones `cloudStale` until a signed-in pass.

## Duplicate wrote into a folder the caller could not edit

**Symptom:** an editor on a shared subfolder duplicates it; the copy appears at the owner's top level, invisible to the editor. **Cause:** `cloud_duplicate_item` checked the source only. **Fix:** the destination parent needs edit rights too; at the top level that means owning the workspace. Trash and rename got the same treatment for synced roots.

## Update IDs are not commit order

**Symptom:** none seen, found by reading. Two editors insert concurrently; the one with the smaller ID commits second; a client that already read past it never fetches it. **Fix:** a before-insert trigger takes a per-document advisory lock and assigns the ID under it, so ID order is commit order.

## A sharer's folder names became paths on the member's Mac

**Symptom:** none seen, found by reading. A shared folder named `..` under another `..` would have written the shared note into the member's home folder, and trashed it on revoke. **Cause:** `planSharedRoot` joined item names into relative paths, and the native write, move, and trash commands accept any absolute path. **Fix:** names that are not one safe path segment are skipped with their subtree, the server rejects them with a check constraint, and every mutating native command refuses a `..` component.

## Own-write suppression swallowed external renames

**Symptom:** rename a note in Finder within ten seconds of saving it in Ghost and nothing happens: the sidebar keeps the old name and the editor keeps writing to it. **Cause:** a rename keeps the inode and modification time that the own-write registry matched on. **Fix:** a rename counts as Ghost's own only when its source is Ghost's temp file; the stamp is used for creates and modifies alone.

## Watching a code checkout walked it whole

**Symptom:** opening a large folder made the app unresponsive for a while. **Cause:** the debouncer's file-id cache, used to pair renames, walks every watched folder on registration and follows symlinks. **Fix:** no cache. Renames arrive as a remove and a create, which the tree already handles and synced roots pair by content hash. Watched roots are also canonicalized, so events under `/tmp` or a symlinked folder are matched to the root they came from.
