# Cloud collaboration roadmap

- Status: In progress; retained Mac/web Cloud vertical slice ready for joint testing
- Date: 2026-08-25
- Last updated: 2026-08-26
- Architecture: [`../architecture/0004-cloud-collaborative-markdown-workspaces.md`](../architecture/0004-cloud-collaborative-markdown-workspaces.md)

## Goal

Add an opt-in Cloud section to Ghost containing logical folders and
Markdown-only documents that can be edited concurrently from Ghost for Mac and
a focused web client. Support account-backed ownership, direct user sharing,
and revocable view/edit links without changing the existing local filesystem
experience.

## Product boundary

The completed initial project includes:

- permanent accounts for cloud owners and direct members;
- a Cloud folder/document tree;
- real-time collaborative Markdown editing and presence;
- offline editing of previously opened documents;
- private Markdown image assets;
- view/edit links with no registration UI for guests;
- direct invitations to permanent users;
- a cloud-only web application;
- soft delete, restore, and operational backups; and
- permission, quota, abuse, and recovery controls appropriate for production.

It does not include comments, review/suggestions, static publishing,
share-in-place local sync, Finder integration, or non-Markdown cloud files.
User-visible filesystem work follows the initial cloud release in the ordered
post-cloud sequence below.

## Phase 0: Technology and fidelity spike

Status: In progress; online Supabase collaboration and access controls pass,
with resilience and operational gates remaining

Build a disposable vertical slice before accepting ADR 0004 or creating
production infrastructure.

### First implementation slice

After any pending `main` changes are integrated, first rerun the repository's
baseline checks and inspect changes to the editor schema and app boundaries.
Then build only this disposable slice:

1. Pin the reviewed `y-supabase` commit and place it behind the minimal
   `CollaborationAdapter` contract.
2. Create the smallest local Supabase schema for one hard-coded document, two
   editors, and one viewer, using private Realtime channels and RLS.
3. Open that same document in two editing clients with Ghost's real Tiptap
   schema and prove live text and awareness, then prove viewer read-only
   behavior with a separate session.
4. Add real integration tests for acknowledged persistence, reload, forced
   disconnect, and one offline/reconnect cycle.

Do not build the Cloud tree, account onboarding, general sharing UI, or web
product shell until this slice establishes that the preferred collaboration
path is viable.

### Progress as of 2026-08-27

Implemented locally:

- merged the pending Quick Look work and passed the frontend, production build,
  and Rust baselines;
- pinned `@supabase-labs/y-supabase` 0.1.0 (upstream commit `cec1e3b`) behind a
  Ghost-owned `CollaborationAdapter`;
- added a private, acknowledged Realtime wrapper and append-only Yjs update
  persistence with distinct connection, synchronization, and durability state;
- added IndexedDB recovery, the real Ghost Markdown schema, carets, a derived
  Markdown view, and separate Alice, Bob, and Viewer sessions;
- added a deny-by-default Supabase migration for one hard-coded room; and
- added adapter tests covering persisted reload, private channel configuration,
  durable editor writes, and viewer write suppression.

Validated live against the connected Supabase project:

- applied the migration and assigned isolated Alice, Bob, and Viewer sessions;
- exercised concurrent Tauri editing, awareness, stable remote carets, and a
  read-only Viewer in a two-client split harness;
- retained the representative Markdown fixture through the live edit pass;
- rejected an unrelated authenticated session at both the Postgres persistence
  and private Realtime channel boundaries; and
- kept connection, CRDT synchronization, and durable database state distinct
  in the UI.

Still required before accepting ADR 0004:

- complete the ready web-to-Tauri manual pass, then exercise reload,
  disconnect, offline divergence, and both reconnect orders;
- attack persistence and Broadcast using the assigned Viewer JWT as well as an
  unrelated authenticated session;
- record payload, latency, failure-boundary, process-kill, revocation, and
  backup/restore results; and
- compare the same failure/security cases with Hocuspocus and current
  Liveblocks terms.

Setup and the live test script are recorded in
[`../spikes/cloud-collaboration-prototype.md`](../spikes/cloud-collaboration-prototype.md).

### Scope

- Extract or reproduce Ghost's actual Tiptap extension schema in a spike.
- Add `@tiptap/extension-collaboration`, Yjs, awareness/carets, and Y IndexedDB.
- Implement the provider-neutral collaboration adapter before either candidate
  leaks into editor UI.
- First exercise an audited or locally patched `@supabase-labs/y-supabase`
  adapter using private channels, Realtime RLS, acknowledged sends, and
  Postgres persistence.
- Run one web client and one Tauri client against the same document.
- Persist exact Yjs binary state and test whether client-side whole-state
  upserts remain safe under overlapping writers, missed messages, stale
  clients, process kills, and offline divergence.
- Compare snapshot-only persistence plus explicit acknowledgement against an
  append-only Yjs update log with periodic compaction, and choose the durability
  contract Ghost can expose accurately.
- Prototype editor/viewer authorization at both Realtime channel and Postgres
  persistence layers, including a modified-client attack.
- Exercise offline divergent edits, reconnect in both orders, forced provider
  disconnect/termination, authentication expiry, and revocation.
- Export collaborative content through Ghost's Markdown serializer and import
  it again.
- Record payload size, reconnect latency, store cadence, memory, and failure
  behavior with representative small and upper-bound documents.
- Run the same failing or security-sensitive cases through a Hocuspocus adapter
  as the self-hosted fallback and record the additional server code and hosting
  required.
- Compare the same acceptance cases with current Liveblocks documentation and
  its free tier, including total expected cost at projected usage.
- Record the exact upstream `y-supabase` commit/version reviewed, missing
  production controls, local patches, and whether Ghost will pin, fork, or
  replace it.

### Required fixtures

- frontmatter;
- nested tasks and lists;
- tables, including resized columns if those attributes are retained;
- internal and external links;
- pasted and remote images;
- headings and collapsible state where relevant;
- inline underline/highlight and other nonstandard Markdown output; and
- concurrent edits at the same paragraph, list, table, and document boundary.

### Exit criteria

- Every ADR 0004 acceptance-gate check has recorded evidence.
- The spike identifies one canonical Yjs field and a versioned schema.
- Markdown fidelity regressions are either fixed or explicitly accepted.
- The selected provider can prevent a viewer from broadcasting or persisting
  mutations even through a modified client.
- Offline storage works after closing and reopening both target clients.
- Persistence survives forced client/provider termination at each store
  lifecycle boundary without losing acknowledged edits beyond a documented
  bound.
- Editor status distinguishes connection, CRDT synchronization, and confirmed
  durable persistence.
- A stack recommendation and operational cost model are attached to ADR 0004.

Do not evolve the disposable spike directly into production code unless its
package boundaries, secrets, migrations, and tests are deliberately rebuilt.

## Phase 1: Source-neutral document and editor foundation

Status: Initial retained foundation implemented; provider acceptance remains
blocked on the remaining Phase 0 gates

### Progress as of 2026-08-26

- Added exhaustive local/cloud `DocumentRef` identities and a source
  capability matrix covering persistence, subscriptions, filesystem-only
  actions, sharing, and assets.
- Added a local-only document source gateway and routed both editor surfaces,
  version-checked writes, streamed source writes, and focus reloads through it.
- Preserved the current Rust file commands and local save/conflict behavior;
  cloud references cannot be passed to this gateway without a type error.
- Added a separately built `web.html` entry whose loaded bundles contain no
  Tauri runtime imports.
- Added a shared email/password account flow for web and Mac. Browser sessions
  use browser storage while Mac refresh credentials use a dedicated Keychain
  command boundary.
- Added a shared, browser-safe collaborative Markdown surface while preserving
  the existing local editor and local-only source gateway.

### Scope

- Introduce `DocumentRef` with local and cloud variants.
- Define source capabilities for load, save/sync, subscribe, rename, move,
  delete, reveal/external-open, sharing, and assets.
- Keep all existing local paths routed through the current Rust commands.
- Extract a shared Markdown schema/parser/serializer package usable by browser,
  Tauri, and server runtimes.
- Add a narrow collaboration adapter so editor UI does not depend directly on
  Supabase Realtime, `y-supabase`, Hocuspocus, or another provider API.
- Keep Ghost document IDs provider-neutral and add binary Yjs snapshot
  export/import plus a migration test between the Supabase and Hocuspocus
  adapters.
- Make editor save/status chrome distinguish local save, cloud persistence,
  offline pending state, and synchronization errors.
- Establish a separate web entry that renders the shared cloud editor without
  importing Tauri-only modules.
- Update Tauri CSP with the smallest explicit HTTP, WebSocket, image, and auth
  destinations required by the selected environments.

### Verification

- Existing local tests/builds remain unchanged in behavior.
- Type-level exhaustiveness prevents cloud references reaching local-only
  commands such as Reveal in Finder.
- Shared schema tests run in frontend and server packages.
- Tauri and browser bundles contain no server secrets.
- Local Ghost remains fully usable with networking disabled and no account.

## Phase 2: Supabase control plane and account foundation

Status: Initial retained control-plane slice implemented; broader operations,
sharing, and recovery remain

### Progress as of 2026-08-26

- Added version-controlled production `cloud_*` tables, inherited roles,
  stable item UUIDs, Markdown-only document creation, and append-only Yjs
  updates without reusing the disposable spike schema.
- Added deny-by-default grants, table RLS, private Realtime authorization, and
  security-definer RPCs with pinned empty search paths.
- Applied the migration to the connected Supabase project and verified that an
  unrelated permanent account can neither enumerate nor write another user's
  workspace while the owner can create folders/documents and persist updates.
- Verified live private-channel authorization: an owner could join and send an
  acknowledged Broadcast while an unrelated account was rejected.
- Added permanent account onboarding and Keychain-backed Mac session storage.

### Scope

- Add version-controlled Supabase migrations and local development setup.
- Create profiles, cloud items, memberships, invitations, share links, share
  sessions, collaboration documents, checkpoints, and asset metadata.
- Implement transactional create, rename, move, soft-delete, restore, and
  collision/cycle validation.
- Implement deny-by-default RLS and adversarial policy tests for owners,
  members, guests, and unrelated users.
- Add permanent account onboarding and anonymous guest sessions.
- Store Mac refresh credentials through Keychain-backed secure storage.
- Add account deletion/export foundations before accepting user content.
- Add Edge Function foundations for privileged operations and, only if the
  selected provider needs them, collaboration-token issuance.
- Establish environment separation and secret rotation procedures.

### Verification

- An unauthenticated request cannot enumerate any cloud metadata or assets.
- An anonymous account cannot create or own a Cloud root.
- A permanent account can create only within its authorized roots.
- Tree operations are atomic and reject cycles, duplicate sibling names, and
  unauthorized moves.
- No service/secret key appears in a client bundle, log, or persisted settings.
- Local database reset and migration replay produce the same schema.

## Phase 3: Private Cloud tree and authenticated multiplayer

Status: First Mac/web vertical slice implemented; resilience and full tree
operations remain

### Progress as of 2026-08-26

- Added the opt-in Cloud section to the existing Mac sidebar without changing
  the local workspace tree or requiring a Cloud account for local files.
- Added shared folder/document creation, tree loading, document selection, and
  sign-out UI to the Mac app and focused web client.
- Added a retained Ghost-owned Supabase collaboration adapter with private,
  acknowledged Realtime, append-only durable updates, role enforcement,
  presence, and IndexedDB recovery.
- Added database-authoritative reconnect catch-up after a manual test exposed
  two connected/saved clients retaining divergent offline edits. Durable
  update notifications now trigger incremental pulls by update ID, and the UI
  reports synchronization independently from connection and persistence.
- Passed a live two-account recovery test with divergent Yjs updates arriving
  in both orders; disposable users and their workspace were removed afterward.
- Added account-deletion-safe audit references after the live test found that
  `created_by` could otherwise retain a deleted account.
- Added the same shared Tiptap/Yjs Markdown editor to both clients with separate
  Realtime and durable-save status.
- Versioned and account-scoped the private IndexedDB cache, made local recovery
  readiness visible, and added a reload test proving cached Yjs updates survive
  document teardown and reopening. Cold startup without a network access check
  remains unfinished.
- Enabled Yjs-aware undo/redo in the shared editor and verified that undoing a
  local edit retains a concurrently received collaborator edit.
- Added automatic, deduplicated document versions containing Markdown and Yjs
  snapshots. The current heuristic creates a baseline, waits for a 30-second
  idle boundary, groups versions at least five minutes apart, and checkpoints
  continuous editing within 15 minutes.
- Added a shared history browser and safe in-place restore. Restore creates a
  `Before restore` checkpoint before replacing the current Markdown through a
  normal collaborative transaction; copying a checkpoint into a separate new
  document remains a later recovery workflow.
- Applied and live-tested the version migration against the connected Supabase
  project, including RLS rejection for an unrelated account and cleanup of all
  disposable test data.
- Recorded the joint manual test in
  [`../spikes/cloud-web-mac-test.md`](../spikes/cloud-web-mac-test.md).

### Scope

- Add the Cloud section and account state to the Ghost sidebar.
- Support folder/document create, rename, move, soft-delete, restore, and
  stable selection/history by item ID.
- Productionize the provider selected in Phase 0. For Supabase Realtime this
  includes private channels, policy tests, acknowledgement/retry behavior, and
  usage monitoring. For Hocuspocus this includes one service with health
  checks, structured logs, graceful shutdown, bounded messages/connections,
  short-lived tokens, and server-side read-only mode.
- Persist exact binary Yjs state and a last-known-good Markdown snapshot.
- Add connection, persistence, presence, and offline state to editor chrome.
- Keep unacknowledged local updates until the selected durability protocol
  confirms persistence, and make failed persistence visible and retryable.
- Support multiple Mac windows and web tabs on the same cloud document.
- Create periodic restorable checkpoints independent of the compacted current
  state.

### Verification

- Two owners/editors converge under concurrent and offline edits.
- Viewers cannot mutate state using a modified client or raw WebSocket frames.
- Closing a window flushes or safely leaves recoverable local Yjs updates.
- Provider disconnect/termination, database restart, and temporary network
  partition recover.
- Rename/move/delete operations do not change collaboration document identity.
- A checkpoint can be restored in place without losing the pre-restore state;
  copy-to-new-document recovery remains to satisfy the non-mutating variant.

## Phase 4: Sharing and focused web application

Status: Blocked on Phase 3

### Scope

- Add Share UI to cloud documents and folders.
- Add view/edit link creation, copy, expiry, rotation, and revocation.
- Redeem raw links through a rate-limited Edge Function into anonymous
  authenticated share sessions.
- Add guest display names and presence without exposing email addresses.
- Add direct user invitations, acceptance, membership management, and
  transactional invitation email through a separately selected provider.
- Apply folder permissions to descendants without exposing ancestors/siblings.
- Confirm access changes when moving items across shared boundaries.
- Ship web routes for account sign-in, direct invitations, and link access.
- Provide explicit errors for revoked, expired, deleted, and permission-changed
  shares.

### Verification

- View and edit links enforce distinct permissions at database, asset, and
  realtime-transport layers.
- Revocation takes effect within the documented token/session lifetime.
- Ghost clears its managed offline cache after it confirms access loss, without
  promising recall of exports or copies outside Ghost.
- A link token is never logged or stored unhashed server-side.
- Direct members retain access across devices; unrelated accounts do not.
- Folder editors can create allowed descendants but cannot change ownership or
  sharing unless explicitly permitted.
- Accessibility and keyboard behavior are equivalent in the Tauri and web
  editors.

## Phase 5: Assets, offline behavior, and production hardening

Status: Blocked on Phase 4

### Scope

- Add private image upload, paste/drop, signed delivery, replacement, and
  orphan cleanup.
- Represent cloud assets by stable logical IDs; never persist expiring signed
  URLs inside document content.
- Finish offline caches for previously opened documents and cached tree
  metadata. Explicitly define which offline tree mutations are supported.
- Add per-account/document/asset limits, rate limiting, guest cleanup, and
  abuse monitoring.
- Add metrics for connection failures, authentication failures, persistence
  lag, store failures, reconnects, and restore success.
- Add automated database/Yjs backups, restore drills, retention, and deletion
  propagation.
- Add privacy-facing account data export and deletion.
- Document that the initial cloud backend is not end-to-end encrypted and audit
  all privileged paths that can read document state.
- Test old/new schema compatibility and block unsafe clients.

### Verification

- Assets follow the same effective permissions as their owning document.
- Offline edits survive process/browser restarts and converge after reconnect.
- Quota failures preserve edits and produce actionable UI.
- A clean environment can be restored from documented backups.
- Deleting an account or document follows the documented retention policy
  across Postgres, collaboration state, checkpoints, and Storage.

## Production launch gate

- ADR 0004 is Accepted with the final provider and cost model recorded.
- Full web tests, `pnpm test`, `pnpm build`, and Rust tests pass.
- Security tests cover every RLS policy, share role, invitation state, and
  selected-provider authorization rule or token claim.
- At least two browsers and the production Tauri build pass the multiplayer,
  offline, reconnect, and revoke matrix.
- Monitoring and alert ownership exist for database, asset, auth, and
  collaboration failures.
- Backup restore, account export, and account deletion have been exercised in
  a production-like environment.
- Terms/privacy copy and abuse-reporting paths match actual data handling.

## Phase 6: Point-in-time download and export

Status: Blocked on the production launch gate

### Scope

- Download one cloud document as Markdown.
- Export a folder as a deterministic Markdown tree, with a companion assets
  layout or archive that preserves relative image references.
- Clearly label downloads as point-in-time, untracked copies.
- Reuse the shared schema and last-known-good Markdown checkpoint rather than
  inventing a separate exporter.
- Keep export failure isolated from valid Yjs state and surface any unsupported
  or lossy schema conversion.

### Verification

- Exported Markdown opens locally in Ghost with managed images resolving.
- Exporting does not create a cloud/local mapping or background watcher.
- Editing, renaming, or deleting an exported copy cannot mutate Cloud.
- A folder exports deterministically across repeated runs at the same cloud
  checkpoint.

## Phase 7: Managed Finder location

Status: Blocked on Phase 6 and a dedicated implementation ADR

### Scope

- Evaluate and select the macOS File Provider architecture for a Ghost-managed
  Finder location.
- Expose cloud UUIDs as stable File Provider item identifiers independent of
  paths and names.
- Support enumeration, placeholders, download-on-open, offline materialization,
  rename/move propagation from Cloud, and soft-delete behavior.
- Start as a read-only cloud-to-filesystem projection. Do not silently accept
  external content writes in this phase.
- Keep the internal collaboration/offline cache separate from the Finder
  materialization cache.

### Verification

- Finder and Ghost show the same item identities after cloud rename and move.
- Opening or copying a materialized Markdown file produces the corresponding
  cloud checkpoint and assets.
- Offline materialized items remain readable within the documented cache rules.
- External applications cannot accidentally overwrite cloud content.
- Revocation and deletion behavior match the documented local-copy limits.

## Phase 8: External edits in the managed location

Status: Blocked on Phase 7 and a dedicated conflict-semantics ADR

### Scope

- Detect writes from external editors without reacting to Ghost's own
  filesystem materialization writes.
- Parse changed Markdown with the shared schema, synchronize the latest Yjs
  state, and apply safe changes as explicit Yjs transactions.
- Define rename, move, delete, invalid-Markdown, unsupported-attribute, and
  image-asset behavior.
- Create a conflict copy or require user resolution when an external write
  cannot be reconciled safely with newer cloud edits.
- Record enough version/checkpoint metadata to explain every conflict to the
  user and avoid silent last-writer-wins data loss.

### Verification

- External and multiplayer edits converge when they do not conflict.
- Concurrent incompatible edits preserve both versions and produce actionable
  conflict UI.
- Process termination at every import/materialization boundary loses neither
  the external file nor acknowledged cloud content.
- Rename, delete, and asset changes behave consistently across Finder, Ghost,
  and the web client.

## Phase 9: Arbitrary-path file and folder tracking

Status: Blocked on Phase 8 and a dedicated share-in-place ADR

### Scope

- Add an explicit "Link to Cloud" workflow for an existing Markdown file or
  folder anywhere the user grants Ghost access.
- Persist security-scoped access and a stable mapping from local identity to
  cloud UUID without treating the path as the document identity.
- Handle external moves, renames, Git operations, symlinks, inaccessible
  volumes, permission loss, offline divergence, deletion, and detach/relink.
- Define initial-link direction and confirmation when both the local and cloud
  items already contain content.
- Reuse Phase 8 import, conflict, asset, checkpoint, and recovery semantics.

### Verification

- A linked item survives supported local and cloud renames without becoming a
  duplicate document.
- Simultaneous local, Mac, and web edits preserve content and converge or create
  an explicit conflict artifact.
- Detaching stops synchronization without deleting either side.
- Moving a linked item outside Ghost's granted filesystem scope produces a
  recoverable permission state rather than data loss.
- Repository operations and application restarts do not create feedback loops
  or duplicate cloud items.

## Deferred follow-ups

- comments, anchored discussions, suggestions, mentions, and notifications;
- public publishing and indexing;
- non-Markdown collaborative/source formats; and
- organization administration and billing.
