# ADR 0004: Cloud-native collaborative Markdown workspaces

- Status: Proposed; retained Mac/web vertical slice implemented, resilience
  and sharing gates remain
- Date: 2026-08-25
- Last updated: 2026-08-28
- Related plan: [`../plans/cloud-collaboration-roadmap.md`](../plans/cloud-collaboration-roadmap.md)
- Related decisions:
  - [`0001-extensible-file-viewers.md`](0001-extensible-file-viewers.md)
  - [`0002-bounded-large-file-loading.md`](0002-bounded-large-file-loading.md)

## Context

Ghost is intentionally a local-first macOS application. Its current document
identity is a filesystem path; its browser enumerates arbitrary tracked
folders; and its save path performs atomic, version-checked filesystem writes.
Those properties are central to local Ghost and must continue to work without
an account or network connection.

Ghost also wants an opt-in cloud experience with:

- a dedicated Cloud section containing folders and Markdown documents;
- real-time editing, presence, and offline reconciliation between Ghost and a
  focused web client;
- sharing a file or folder with a revocable link, similar to Google Docs;
- sharing directly with another user through a durable account identity; and
- a later path to comments, review workflows, and linking an arbitrary local
  file or folder to a cloud item.

Filesystem conflict detection is not collaborative merging. A cloud document
needs a stable identity, an authorization model, a durable CRDT state, and a
low-latency transport. Likewise, a database or realtime message bus is not by
itself a durable collaborative-document service.

The first cloud release should validate cloud-native collaboration without
also building a Dropbox-style local sync agent. Publishing static copies,
comments, arbitrary file types, and sharing local files in place are separate
product problems and are not prerequisites.

## Decision

### Decision summary

- Preserve the existing account-free local workspace and add Cloud as a
  separate logical source containing Markdown documents and folders.
- Use Tiptap plus Yjs for collaborative document state and share the editor
  implementation between the Mac and web clients.
- Use Supabase for Auth, Postgres, RLS, Storage, Edge Functions, and preferably
  Realtime collaboration as well.
- Start with a pinned, audited, and likely Ghost-maintained adaptation of
  `@supabase-labs/y-supabase`; do not accept it on the strength of version
  `0.1.0` or mocked upstream tests.
- Keep collaboration behind a Ghost-owned adapter with provider-neutral
  document IDs and binary Yjs export/import. Fall back to self-hosted
  Hocuspocus if the Supabase path fails Phase 0.
- Require accounts for owners and direct members, while link recipients use
  anonymous authenticated sessions with explicit viewer/editor permissions.
- Offer Sign in with Apple and passwordless email code/link for permanent
  accounts. Treat the Supabase user ID, rather than an Apple ID or email
  address, as Ghost's canonical account identity.
- After the cloud product is stable, add filesystem integration in strict
  stages: untracked export, a managed read-only Finder location, external edits
  inside that location, and finally arbitrary-path tracking.
- Defer comments, review, non-Markdown files, and publishing.

### Preserve local Ghost and add Cloud as a separate source

The sidebar will contain a first-class Cloud section alongside the existing
local workspace. Local use remains available without an account. Creating or
owning cloud content requires a recoverable Ghost account.

Permanent-account onboarding has no Ghost password. The preferred action is
Sign in with Apple, with a passwordless email one-time code and sign-in link as
an equal fallback. Both clients use Supabase Auth's PKCE flow: the web client
returns to its Cloud route, while an installed Apple-platform app returns
through the registered `ghost-md://auth/callback` deep link and stores its
refresh session in a dedicated Tauri app-data store. Email-code entry remains
available in development builds where macOS does not register app deep links.
The app-data choice avoids repeated Keychain authorization prompts from
unsigned and frequently rebuilt development binaries. It deliberately trades
Keychain encryption for the protections of the current macOS user account and
application-data directory; revisit encrypted, non-prompting credential
storage before broad production distribution if the platform permits it.

Provider credentials are an authentication detail, not document identity.
Ghost authorization, memberships, and ownership reference `auth.users.id`.
Supabase identity linking can therefore attach Apple and email identities to
one account, and later Windows or Android clients can use the same email flow
or add platform-appropriate OAuth providers without migrating documents.
Automatic identity linking must follow Supabase's verified-identity rules;
Ghost must never merge accounts based only on user-entered matching email
text.

Cloud folders are logical database containers, not filesystem directories or
Finder mounts. Cloud documents use stable UUIDs and are not represented by
fabricated local paths. UI state and document services will use a discriminated
identity rather than passing every item as a path:

```ts
type DocumentRef =
  | { kind: "local"; path: string }
  | { kind: "cloud"; documentId: string }
```

Loading, saving, asset resolution, subscriptions, rename/move behavior, and
available actions will be provided through source-specific capabilities. The
existing local file pipeline remains the local implementation.

The web application exposes only cloud content. It will not reproduce Ghost's
arbitrary local filesystem browser.

### Limit cloud items to Markdown documents and logical folders

The Cloud tree initially supports:

- folders;
- Markdown documents; and
- private image assets referenced by a Markdown document.

Images are document assets, not independently browsable cloud files. Remote
image URLs may remain remote. Other source formats and Ghost's binary viewers
remain local-only.

Cloud document names end in `.md`, whether the extension is shown or supplied
automatically by the UI. Name collisions are rejected within one parent.
Folders and documents support create, rename, move, soft-delete, and restore.
Permanent deletion is a separate explicit operation.

Resource limits for collaborative documents and assets must be established by
the Phase 0 spike. Cloud collaboration will not inherit the much larger bounds
of local CodeMirror and read-only viewers.

### Use Yjs state as the live source of truth

A cloud document's canonical collaborative state is a binary Yjs document
containing the Tiptap/ProseMirror document. Markdown is a supported interchange
and export representation, not the object concurrently mutated by clients.

The selected persistence implementation stores the binary Yjs state exactly.
It must not recreate Yjs history from JSON or Markdown on each load. A derived
Markdown snapshot is generated with Ghost's shared editor schema and serializer
for:

- explicit download/export;
- backups and disaster recovery;
- future cloud content search; and
- the later share-in-place bridge.

Failure to derive Markdown must never replace a valid Yjs state or last-known
good snapshot. The backend records a schema version with every document, and a
client that cannot safely interpret a newer schema must refuse write access
rather than discard unknown content.

The rich Markdown schema, parser, serializer, and collaboration-safe extension
set will be extracted into a package shared by the Tauri client, web client,
and any backend checkpoint or migration worker. Frontmatter, tables, tasks,
links, images, and Ghost-specific attributes need explicit round-trip tests
under collaboration.

### Make permissions hierarchical and explicit

The initial roles are:

- `owner`: manage, share, edit, move, and delete;
- `editor`: read and edit; create descendants when granted on a folder; and
- `viewer`: read only.

An item can receive a user membership or share link. Permission on a folder is
inherited by descendants. A direct document share grants no visibility into
its ancestors or siblings. Moving an item across a permission boundary must
preview and confirm access changes.

Link sharing supports "Anyone with the link can view" and "Anyone with the
link can edit." Link recipients do not need to register, but the system creates
an anonymous authenticated session internally so database and collaboration
authorization remain deny-by-default. Guests choose a display name for
presence. A cleared browser session loses that guest identity but can redeem a
still-valid link again.

Direct user sharing is durable and requires a non-anonymous account. An invite
sent to an email address may wait for that person to create or sign into the
matching account before membership is attached.

Share tokens are high-entropy capabilities. Only a hash is stored. Links can
be revoked, can expire, and are exchanged for a short-lived session; the raw
capability is never used as a document identifier or collaboration credential.

Comments and a `commenter` role are deferred.

Revocation stops future API, asset, and collaboration access. It cannot make a
recipient forget content they already viewed, copied, exported, or captured.
Ghost clears its own managed offline cache when it learns that access was
revoked, but the Share UI must not imply stronger recall guarantees.

### Establish the initial privacy boundary

Cloud content is private by default. Network traffic uses TLS and stored data
uses the selected providers' encryption at rest and access controls. The first
cloud release is not end-to-end encrypted: Ghost's selected backend can read
Yjs state to validate schemas, generate Markdown checkpoints, operate backups,
and support the web client.

Server credentials and privileged content access are limited, audited, and
never shipped to clients. Adding end-to-end encryption would change sharing,
guest access, search, backup, recovery, and abuse handling and therefore needs
a separate decision rather than an unchecked option in this implementation.

### Prefer Supabase-native collaboration if it passes the acceptance gate

The proposed architecture is:

```text
Ghost for Mac ─┐
               ├─ Ghost collaboration adapter
Ghost Web ─────┘        │
                        └─ Supabase Auth/Postgres/Storage/Edge Functions
                                      │
                                      └─ Realtime Broadcast and Presence
                                          carry Yjs updates and awareness
```

Supabase is the preferred control and collaboration plane:

- Auth provides permanent owner/member accounts and anonymous guest sessions.
- Postgres stores the Cloud tree, item memberships, invitations, share-link
  hashes, guest redemptions, document state, checkpoints, and audit metadata.
- Row Level Security protects all client-accessible metadata.
- Storage holds private image assets with matching access policies.
- Edge Functions perform privileged operations such as link redemption,
  invitation acceptance, and provider-specific authorization when required.
- Realtime private channels carry Yjs updates and awareness, with send/receive
  rights enforced by RLS against effective document permissions.

The preferred Phase 0 candidate is `@supabase-labs/y-supabase`. It binds a
`Y.Doc` and awareness protocol to Supabase Realtime and can persist encoded Yjs
state in Postgres, eliminating a separately operated WebSocket service.

This preference is conditional. At the date of this decision the upstream
library is version `0.1.0`, has a small commit history, and its automated tests
use mocked Supabase clients rather than real Realtime, RLS, multi-device, or
failure tests. Its default provider API also does not expose all production
channel controls Ghost needs. Ghost must pin and audit the implementation and
may vendor a small fork to add at least:

- private Realtime channels and deny-by-default Broadcast/Presence RLS;
- acknowledged sends and visible retry/error behavior;
- distinct viewer and editor behavior at channel and persistence layers;
- bounded update batching and payload limits;
- explicit synchronization versus durable-persistence status; and
- safe initialization, reconnect, and teardown around local IndexedDB and the
  latest Postgres state.

Client-side whole-state upserts are not assumed safe merely because Yjs merges
updates. The spike must test overlapping writers, lost broadcasts, stale
clients, delayed writes, crash timing, and two offline histories. It may replace
whole-state upserts with an append-only update log plus compaction or another
acknowledged persistence design.

If Supabase-native collaboration fails the acceptance gate, the first fallback
is Hocuspocus v4 behind the same Ghost adapter. Hocuspocus would authenticate a
short-lived document-scoped token, enforce read-only connections, and load/store
binary Yjs state in Supabase Postgres. Render is only a possible host for that
service; choosing Render instead of another container host does not change the
client protocol or product architecture.

Periodic checkpoints and restore drills are required with either provider
because the latest compacted Yjs state alone is not user-facing version history.

The Phase 0 spike must select and prove a durability protocol. A provider's
"synced" event may mean that a WebSocket server received an update, not that
Postgres committed it. Ghost must not label that state as durably saved. The
accepted implementation will either persist an append-only update log before
acknowledging durability and compact it into Yjs snapshots, or retain client
updates until an explicit server persistence acknowledgement confirms the
latest state. Persistence failure must remain visible and retryable.

### Share one editor implementation between Mac and web

The Markdown editor schema and cloud-document UI are shared React code. Shell
capabilities remain separate:

- the Tauri shell can open local and cloud documents;
- the web shell can open cloud documents only; and
- both use the same cloud provider and collaboration session lifecycle.

The web application initially needs routes for signed-in cloud use and shared
links. It can be deployed as a static application with dynamic calls to
Supabase and the selected collaboration provider; the hosting vendor is not an
architectural dependency.

Cloud documents cache Yjs state locally with `y-indexeddb` so a previously
opened document can load and accept edits offline. WKWebView persistence,
multi-window behavior, reconnect handling, and offline folder mutations must
be validated in the Phase 0 spike. A durable native cache may replace or
supplement IndexedDB if WKWebView does not meet the acceptance checks.

The retained cache key is versioned and scoped by account ID plus document ID.
It is opened before the network adapter so locally durable updates can be
compared with the server state and uploaded after a restart. IndexedDB failure
degrades to network-only editing with a visible recovery warning; it must not
prevent an otherwise healthy Cloud document from opening. Each cache
also retains the last server-verified document role. After one verified open,
Ghost renders that document as soon as IndexedDB is ready and revalidates the
role, catches up the durable log, and connects Realtime in the background.
Edits made during catch-up are merged and durably uploaded once authorization
is confirmed. A revoked cache is cleared when the server reports access loss;
a cached editor that became a viewer is immediately made read-only and its
local-only changes are not uploaded. The first open still needs the network,
and a cold offline app launch still needs cached tree and selection metadata
before the broader offline-open requirement is satisfied.

Collaborative undo uses the Yjs editor binding as its only tracked origin.
Remote, persistence, and reconnect transactions are not placed on the local
undo stack, so one collaborator cannot undo another collaborator's work.

Authentication refresh tokens in the Mac app are isolated in a dedicated
`cloud-auth.json` Tauri app-data store rather than mixed into general settings.
The store is not Keychain-encrypted. This keeps session persistence consistent
with a browser while avoiding recurring system password prompts during local
development; no application service keys or document content belong there.

### Stage filesystem materialization after the cloud product

The initial cloud product keeps a private device cache so previously opened
documents can load and accept edits offline. That cache is an implementation
detail inside Ghost's managed application data. It is not a supported Finder
location, does not promise stable paths, and must not be edited by external
applications.

User-visible filesystem integration follows only after the cloud workspace,
multiplayer, sharing, web client, offline recovery, and operational controls
are stable. The stages are deliberately ordered:

1. **Untracked download/export.** A document can be downloaded as Markdown and
   a folder can be exported as a deterministic Markdown/assets tree. These are
   ordinary point-in-time copies. Editing, moving, or deleting them does not
   affect Cloud.
2. **Managed Finder location.** A macOS File Provider domain, or another design
   accepted in a later ADR, exposes cloud documents under a Ghost-managed
   Finder location. The first iteration is a cloud-to-filesystem projection:
   items are readable and may be materialized offline, but external writes are
   not imported.
3. **External edits in the managed location.** The managed location becomes
   bidirectional. Ghost parses an external Markdown write using the shared
   schema and applies it to the latest cloud document as a Yjs transaction.
   Concurrent or unsafe changes create an explicit conflict copy or require
   user resolution; they are never silently resolved by last-writer-wins.
4. **Arbitrary-path tracking.** A user can link an existing Markdown file or
   folder anywhere they grant Ghost access to an existing cloud item. This is
   the later share-in-place feature and must handle filesystem moves, external
   editors, Git operations, offline divergence, deletion, permissions, and
   detaching the relationship.

The canonical object throughout remains the cloud Yjs document. Exported files
are copies; managed or arbitrary-path files are synchronized materializations.
Ghost must not present two independently canonical documents. Stable cloud
UUIDs, not paths or filenames, anchor every managed mapping.

The managed Finder, bidirectional external-edit, and arbitrary-path stages each
require a separate implementation decision and acceptance criteria. Completing
one does not implicitly authorize or promise the next.

### Keep the collaboration provider replaceable

Ghost will own a narrow collaboration adapter covering:

- connect/disconnect and sync status;
- the `Y.Doc` and awareness instance;
- user identity and read-only state;
- token refresh;
- offline persistence; and
- lifecycle/error events.

The intended shape is provider-neutral:

```ts
interface CollaborationAdapter {
  connect(documentId: string): Promise<CollaborationSession>
}

interface CollaborationSession {
  ydoc: Y.Doc
  awareness: Awareness
  permission: "viewer" | "editor"
  syncStatus: "connecting" | "synced" | "offline" | "error"
  durabilityStatus: "pending" | "durable" | "error"
  destroy(): Promise<void>
}
```

Editor components must not call Supabase Realtime, `y-supabase`, Hocuspocus,
or another provider's APIs outside this adapter. Stable Ghost document UUIDs
must not be provider room IDs that cannot be reproduced elsewhere. Ghost also
owns binary Yjs snapshot export/import and a migration utility that can copy a
document into another provider before routing new sessions there.

This boundary does not make a provider migration free: authorization,
persistence, monitoring, and data migration still change. It does keep that
change below the editor, Cloud tree, sharing UX, account model, and document
identity. It permits a move from Supabase Realtime to Hocuspocus, Liveblocks,
Y-Sweet, or another Yjs-compatible service without rewriting those layers.

### Explicitly defer adjacent features

This decision does not include:

- publishing static copies;
- comments, suggestions, mentions, or review workflows;
- filesystem materialization or synchronization in the initial cloud release;
- moving local files into Cloud automatically outside the later explicitly
  linked arbitrary-path workflow;
- non-Markdown cloud documents;
- public indexing or unauthenticated database reads; or
- team billing and administrative organization features.

The ordered post-cloud filesystem stages above build on the stable cloud IDs,
Markdown checkpoints, permissions, and provider boundary established here.

## Initial data model

The exact schema belongs in migrations, but the control plane begins with:

- `profiles`: permanent and anonymous display identity;
- `cloud_items`: stable item ID, kind, parent, name, owner, and soft-delete
  metadata;
- `item_memberships`: item, user, role, inviter, and acceptance state;
- `invitations`: pending direct invitations and expiry;
- `share_links`: item, role, token hash, creator, expiry, and revocation;
- `share_sessions`: redeemed link, authenticated guest, and expiry;
- `collaboration_documents`: document ID, binary Yjs state, schema version,
  latest Markdown snapshot, and persistence timestamps;
- `collaboration_updates`: an optional ordered update log when the Phase 0
  durability protocol requires write-ahead updates before snapshot compaction;
- `document_checkpoints`: restorable binary states and derived Markdown
  snapshots; and
- `document_assets`: document-scoped metadata pointing at private Storage
  objects.

Tree and permission invariants such as cycle prevention, collision-safe moves,
and inherited access are enforced in transactional database functions. RLS is
still the final boundary for reads and writes exposed to clients.

## Technology evaluation

| Candidate | Strengths for Ghost | Primary concern | Disposition |
| --- | --- | --- | --- |
| Supabase Realtime + audited `y-supabase` adapter | One backend provider, RLS-aligned permissions, no collaboration server, Yjs-compatible | Upstream is new; client persistence, private-channel authorization, acknowledgement, and failure recovery need proof | Preferred candidate, conditional on Phase 0 |
| Supabase + Hocuspocus | Open Yjs protocol, exact Tiptap fit, centralized authorization/persistence, provider control | Operate and harden a WebSocket service | Self-hosted fallback behind the adapter |
| Supabase + Tiptap Cloud | Closest managed Tiptap integration, scoped JWTs, history, export/import | No free plan and a high fixed starting cost | Rejected for the initial release; migration remains possible |
| Supabase + Liveblocks | Excellent Tiptap integration, permissions, history, comments, notifications | Tiptap offline support is currently experimental; broad second platform | Managed alternative |
| Supabase + Y-Sweet | Lean Yjs-native service and portable protocol | More permission, history, recovery, and operational work remains ours | Revisit if Hocuspocus is too heavy |
| Cloudflare Durable Objects/PartyKit | Natural room isolation, durable compute, hibernating WebSockets | More custom CRDT persistence, auth, recovery, and provider coupling | Deferred |
| CloudKit/CKShare | Strong Apple-native identity and sharing | Apple-centric web/guest model and no low-latency CRDT service | Rejected for this direction |

One selected collaboration adapter owns each document's edit stream and
awareness. Ghost will not run Supabase and Hocuspocus transports for the same
document simultaneously except inside an explicit, tested migration tool.

## Consequences

### Positive

- Local Ghost keeps its no-account, ordinary-files contract.
- Cloud collaboration can be designed around stable IDs instead of pretending
  database records are paths.
- Mac and web clients share the existing React/Tiptap investment.
- Yjs supplies deterministic online and offline merge semantics for edits made
  through Ghost.
- Supabase may supply relational folder and permission modeling, auth, private
  assets, realtime Yjs transport, and persistence without another backend
  provider.
- The Ghost-owned adapter and Yjs snapshot path keep collaboration
  infrastructure replaceable if the preferred provider does not hold up.
- The design establishes the cloud identity and checkpoint foundation required
  for later share-in-place sync.

### Costs and risks

- Ghost becomes an operated service with accounts, abuse controls, email,
  backups, monitoring, data export/deletion, and incident responsibilities.
- The preferred `y-supabase` library is immature and may require a maintained
  Ghost fork plus production integration tests.
- If the preferred provider fails, a separately deployed Hocuspocus WebSocket
  service adds operational work beyond Supabase.
- Collaborative Tiptap state is not literally a Markdown file at rest; Markdown
  fidelity depends on the shared schema and serializer.
- All clients must coordinate editor-schema migrations.
- Hierarchical RLS and item moves are security-sensitive and require adversarial
  tests, not only happy-path UI tests.
- Anonymous edit links can be abused and require rate limits, quotas, expiry,
  and a cleanup policy.
- The initial cloud backend can read cloud document content; privacy copy and
  operational access controls must accurately reflect the lack of end-to-end
  encryption.
- Offline folder operations, deletes, and moves are harder than offline edits
  inside an already-open document and may be deferred independently.
- Presence and edit permissions must update promptly after link or membership
  revocation.

## Alternatives considered

### Copy or publish local files before cloud collaboration

Rejected as a prerequisite. Static publishing does not validate the desired
cloud workspace or multiplayer behavior. Explicit import/export can still be
added after the cloud product without creating a publishing product.

### Share local files in place in the first release

Deferred. It requires a background filesystem sync engine, external-edit
reconciliation, move tracking, dual-write recovery, and conflict UI in addition
to every cloud requirement in this decision. It is the final filesystem stage,
after untracked export, a managed Finder projection, and managed external edits.

### Use Supabase Realtime as the collaboration service

Selected as the preferred candidate only through an audited Yjs provider and a
proven persistence protocol. Broadcast and Presence alone still do not supply
Yjs persistence, compaction, reconnect state, schema-aware initialization, or
document recovery. Ghost accepts responsibility for those missing semantics and
will fall back to Hocuspocus if Phase 0 cannot prove them without effectively
rebuilding an unreliable collaboration server.

### Use Tiptap Cloud for managed collaboration

Rejected for the initial release because it has no free plan and its fixed
starting cost is too high for Ghost's expected early usage. It retains the
closest editor integration, scoped JWT authorization, version history,
webhooks, and document export/import, so the collaboration adapter and binary
export path deliberately keep a later migration possible.

### Use Liveblocks

Retained as a managed alternative. Its Tiptap integration, permissions,
version history, comments, notifications, and future review features are
strong. At the time of this decision its Tiptap offline support is documented
as experimental, while offline editing is a core Ghost requirement. It would
also leave Ghost with Supabase plus a second broad application platform.

### Use Y-Sweet, PartyKit, or Cloudflare Durable Objects

Deferred. They can provide a lean Yjs or room-oriented service, and Durable
Objects are attractive for hibernating WebSockets, but Ghost would own more of
the authentication, persistence, recovery, and editor-specific operational
surface. They remain candidates if Hocuspocus hosting proves unsuitable.

### Use CloudKit and CKShare

Rejected for this product direction. CloudKit is attractive for Apple-native
personal sync but makes cross-platform web identity and no-registration guest
links Apple-centric, and it is not a low-latency CRDT transport.

### Use Firebase, Convex, or a general realtime database for document updates

Rejected for now. Each can support application metadata, but none removes the
need for a Yjs-aware collaboration layer. Postgres and RLS better fit Ghost's
hierarchical items, invitations, share links, and future operational queries.

## Acceptance gate

### Retained implementation evidence as of 2026-08-28

- Production `cloud_*` metadata and append-only Yjs update tables are separate
  from the disposable Phase 0 schema and are protected by deny-by-default RLS.
- Private Supabase Realtime topics reuse the effective item role: viewers may
  receive and editors may send. Live tests accepted an owner and rejected an
  unrelated permanent account at both Realtime and Postgres boundaries.
- The Mac app and focused `web.html` client now share one browser-safe
  collaborative Markdown editor and Ghost-owned adapter. Mac auth persists in
  dedicated Tauri app data; the browser retains its own session and neither
  client contains a service-role key. The Mac store is intentionally not
  Keychain-encrypted, as documented above.
- Local and Cloud Markdown now render through the same `MarkdownEditor`
  component, extension surface, style toolbar, document header, spacing, and
  heading minimap. Cloud injects Yjs collaboration and source-specific actions
  into that component instead of maintaining a second Tiptap configuration.
  Detailed transport/durability badges are no longer product chrome: a compact
  Saved/Saving/Offline label summarizes the state while the adapter retains
  distinct diagnostics for tests and future debug tooling.
- Workspace and Cloud trees now use the same file row, folder row, inline
  rename, trash dialog, and context-menu components. Each source injects only
  its backend-specific actions. Both use root-folder dots, amber keyboard
  focus, and the same literal quick-add `+`. Cloud keeps quick document
  creation and a temporary manual refresh; account management is deliberately
  outside the tree. Cloud duplicate and recursive soft-delete mutations
  require inherited editor access.
- Non-blocking Cloud failures no longer resize or cover the document with
  inline banners. They use the same compact, dismissible top notification
  treatment as app updates, while the header retains the quiet saved/offline
  state needed during normal disconnection.
- Permanent-account onboarding now uses passwordless email code/link and Sign
  in with Apple behind the same Supabase user identity. Web callbacks remain in
  the Cloud route; installed Mac builds use a PKCE deep link. The connected
  project still needs its email template and Apple provider configured before
  both production methods are live.
- Reconnect no longer relies only on a best-effort peer state-vector handshake:
  a committed update emits a private durable-change signal, and peers
  incrementally apply the authoritative Postgres log after their last update
  ID. A live two-account test converged divergent updates in both arrival
  orders.
- Account-scoped IndexedDB recovery now has an explicit editor status and a
  reload test proving local Yjs updates survive teardown/reopen. Tiptap's Yjs
  undo manager is configured and tested to preserve remote changes when a user
  undoes their own edit.
- Previously verified documents now render from IndexedDB without blocking on
  Supabase. Authorization, durable catch-up, and Realtime startup continue in
  the background; tests cover edits made during that window, role downgrade,
  and access revocation. Cached tree metadata for a fully cold offline launch
  remains later work.
- Automatic versions store both Markdown and binary Yjs snapshots behind
  inherited document RLS. Ghost creates a baseline, checkpoints after 30
  seconds idle while grouping versions at least five minutes apart, and forces
  a checkpoint at least every 15 minutes during continuous editing. Restoring
  a version first stores the current state as `Before restore`, then applies
  the selected Markdown as a new collaborative edit.
- The connected Supabase project has the versions migration. A live test
  proved same-content deduplication, owner access, and rejection of an
  unrelated permanent account; its disposable accounts and workspaces were
  removed afterward.
- The joint Mac/web manual pass is documented in
  [`../spikes/cloud-web-mac-test.md`](../spikes/cloud-web-mac-test.md). This is
  evidence toward the gate, not acceptance of the still-unrun fully cold
  offline tree, process-kill, live revocation, disaster-restore, and
  provider-comparison checks.

This ADR remains Proposed until the Phase 0 spike demonstrates all of the
following with Ghost's actual extension schema:

1. A Tauri window and web client concurrently edit the same Markdown document
   with correct cursors and per-user undo.
2. Two clients edit offline, reconnect in either order, and converge without
   duplicated content.
3. The selected provider survives its relevant forced-restart/disconnect cases
   and loads the exact persisted Yjs state.
4. Frontmatter, tasks, tables, links, images, and Ghost's custom Markdown
   attributes survive collaborative editing and Markdown export/import.
5. A viewer link receives updates but cannot submit document changes.
6. An editor link can edit, can be revoked, and loses access within the chosen
   token lifetime.
7. A direct member account retains access across devices while an anonymous
   guest remains scoped to redeemed links.
8. Previously opened documents survive offline app/web restarts with no
   credentials or content written to the plaintext settings store.
9. A documented backup and restore exercise recovers both metadata and Yjs
   state.
10. Hocuspocus and Liveblocks are rechecked against current cost, offline,
    export, and operational requirements before final acceptance.
11. Internal diagnostics distinguish peer/provider synchronization from
    confirmed durable persistence, the compact product status never says
    `Saved` prematurely, and a forced-failure test cannot silently discard
    edits shown as durably saved.

If the proposed stack fails this gate, update this ADR and record the selected
alternative instead of silently changing providers during implementation.

## Migration

1. Complete the technology and Markdown-fidelity spike.
2. Introduce source-neutral document identities and a collaboration adapter
   without changing local behavior.
3. Extract the shared Markdown editor schema and build the Supabase control
   plane, authentication, and secure credential storage.
4. Add private Cloud folders/documents and authenticated multiplayer to Ghost.
5. Ship the focused web client, guest links, and direct user invitations.
6. Harden assets, offline recovery, checkpoints, quotas, observability,
   deletion, and disaster recovery.
7. Add point-in-time Markdown/assets download and folder export with no sync
   relationship.
8. Decide and implement a managed, initially read-only Finder location.
9. Add conflict-aware external edits inside the managed location.
10. Decide and implement arbitrary-path file/folder tracking.
11. Evaluate comments/review as a separate decision after the cloud workspace
    is stable.

## References

- [Tiptap Collaboration overview](https://tiptap.dev/docs/collaboration/getting-started/overview)
- [Tiptap Collaboration extension](https://tiptap.dev/docs/editor/extensions/functionality/collaboration)
- [Tiptap offline support with Y IndexedDB](https://tiptap.dev/docs/guides/offline-support)
- [Hocuspocus authentication](https://tiptap.dev/docs/hocuspocus/guides/authentication)
- [Hocuspocus persistence](https://tiptap.dev/docs/hocuspocus/guides/persistence)
- [Hocuspocus database extension](https://tiptap.dev/docs/hocuspocus/server/extensions/database)
- [Hocuspocus Redis extension](https://tiptap.dev/docs/hocuspocus/server/extensions/redis)
- [Supabase Labs Yjs provider](https://github.com/supabase-community/y-supabase)
- [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)
- [Supabase Realtime protocol](https://supabase.com/docs/guides/realtime/protocol)
- [Tiptap Cloud document authorization](https://tiptap.dev/docs/collaboration/getting-started/authenticate)
- [Tiptap Cloud document export/import](https://tiptap.dev/docs/collaboration/documents/rest-api)
- [Tiptap Platform pricing model](https://tiptap.dev/pricing)
- [Liveblocks Tiptap integration](https://liveblocks.io/docs/collaboration-features/multiplayer/text-editor/tiptap)
- [Liveblocks permissions](https://liveblocks.io/docs/authentication/permissions)
- [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous)
- [Supabase passwordless email](https://supabase.com/docs/guides/auth/auth-email-passwordless)
- [Supabase Sign in with Apple](https://supabase.com/docs/guides/auth/social-login/auth-apple)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)
- [Supabase Edge Function authentication](https://supabase.com/docs/guides/functions/auth)
