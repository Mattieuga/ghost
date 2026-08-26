# Cloud collaboration Phase 0 prototype

- Status: Implemented locally; waiting for a Supabase project to run live tests
- Date: 2026-08-26
- Architecture: [`../architecture/0004-cloud-collaborative-markdown-workspaces.md`](../architecture/0004-cloud-collaborative-markdown-workspaces.md)
- Roadmap: [`../plans/cloud-collaboration-roadmap.md`](../plans/cloud-collaboration-roadmap.md)

## What this spike proves

The isolated `?mode=collaboration-spike` entry uses Ghost's Markdown editor
schema with Tiptap Collaboration, Yjs, local IndexedDB, Supabase Realtime, and
an append-only Postgres update log. It exposes connection, CRDT sync, and
durable database state separately.

It pins `@supabase-labs/y-supabase` 0.1.0, built from upstream commit
`cec1e3b900a51cfe0d58a94b4bcd16815f75caed`. A Ghost-owned adapter supplies
the controls missing from that release:

- private Realtime channels;
- acknowledged Broadcast sends;
- viewer send suppression, backed by Realtime and table RLS;
- append-only Yjs update persistence instead of whole-state last-writer upserts;
- a recoverable queue for failed writes; and
- independent Realtime, synchronization, and durability status.

This remains disposable. It intentionally does not add the Cloud sidebar,
folders, sharing UI, production accounts, or the final web shell.

## What is needed from the Supabase project owner

1. Create a free Supabase project. A separate throwaway project is preferable.
2. In Authentication settings, enable Anonymous Sign-Ins.
3. In Realtime settings, disable **Allow public access to channels** so private
   channel authorization is enforced.
4. Paste
   [`20260826000000_collaboration_spike.sql`](../../supabase/migrations/20260826000000_collaboration_spike.sql)
   into the SQL editor and run it.
5. Copy the Project URL and **publishable** key from the Connect dialog into an
   untracked `.env.local` file using [`.env.example`](../../.env.example).
   Never expose the secret or legacy service-role key to this client.

The URL and publishable key are client-side configuration rather than secrets.
The project owner does not need to give Ghost database credentials or a secret
key.

## Assign the three test identities

Open the prototype once for each actor:

- `?mode=collaboration-spike&actor=alice`
- `?mode=collaboration-spike&actor=bob`
- `?mode=collaboration-spike&actor=viewer`

Each actor uses a separate stored anonymous session. Until assigned, its page
shows the exact SQL needed to add its generated UUID to the hard-coded room.
Alice and Bob are editors; Viewer is a viewer. Run those three statements in
the SQL editor, then reload the pages.

This manual assignment is deliberate: accepting a client-selected role would
make a modified viewer able to promote itself and would invalidate the security
test.

## Live test script

1. Open Alice and Bob side by side. Load the fidelity fixture in one empty
   editor and confirm it appears in the other with a remote caret.
2. Edit the same paragraph, nested task list, and table concurrently.
3. Confirm the derived Markdown retains frontmatter, tasks, links, table
   content, underline/highlight, and image syntax.
4. Open Viewer and confirm the editor is read-only while updates continue to
   arrive.
5. Take Bob offline, edit, reconnect, and confirm convergence plus a final
   Database `saved` state.
6. Close and reopen a client to verify IndexedDB recovery and Postgres reload.
7. Attempt a direct insert into `collaboration_spike_updates` and a private
   Broadcast send with the viewer session; both must be rejected.

The remaining Phase 0 failure, payload, process-kill, and fallback-provider
tests should be recorded here once live infrastructure is connected.
