# Ghost Cloud Mac + web vertical-slice test

- Date: 2026-08-26
- Scope: retained private Cloud folders/documents and same-account Mac/web
  collaboration
- Backend: connected Supabase project from `.env.local`

## What this proves

This pass verifies that Ghost for Mac and the standalone browser client use the
same permanent account, Cloud item IDs, private Realtime authorization, durable
Yjs update log, and shared Markdown editor. Document edits are live. The item
tree currently refreshes on demand.

After an offline divergence failure found during this pass, the retained
adapter also uses the durable update log as a reconnect catch-up source. A
private acknowledged signal tells peers to pull rows after their last applied
update ID. The adapter retains separate connection, synchronization, and
durability diagnostics, while product chrome summarizes them as
`Connecting…`, `Saving…`, `Saved`, `Offline`, or `Save failed`.

Direct invitations, share links, move/delete, and two-account sharing are later
slices and are not part of this test.

## Test

1. Keep the development app and Vite process running with `pnpm tauri dev`.
2. Open `http://localhost:1420/web.html` in a browser.
3. Enter an email in the web client and use either the six-digit code or the
   sign-in link. The link should return to `web.html`; the local web URL must
   be present in the Supabase Auth redirect allow list.
4. Sign in to the Mac app's Cloud section with the same email and a fresh code.
   Browser and Mac sessions are intentionally separate; the Mac refresh token
   is stored in dedicated Tauri app data. Sign-in links and Apple callbacks
   return to an installed Mac build through `ghost-md://auth/callback`; macOS
   does not register that deep link for `tauri dev`, so use the code during
   development.
5. Create a Markdown document in either client. In the other client, click the
   Cloud refresh button, then open the same document.
6. Type in one client while watching the other. Text and the remote caret should
   appear live. Repeat in the other direction.
7. Confirm both clients show `Saved` after typing stops. Confirm the style
   toolbar, document spacing, blurred title bar, and heading minimap match a
   local Markdown document. Click the Cloud title and rename it inline.
   Confirm Cloud and Workspace use the same tree row, folder disclosure,
   inline rename, trash dialog, and right-click menu treatment. Cloud's section
   header should contain only quick-add plus temporary refresh; sign-out belongs
   to the future account surface.
8. Reload `web.html`, reopen the document, and confirm the text remains. Close
   and reopen the document in the Mac app and confirm the same state.
9. Disconnect both clients, make different edits, reconnect them in either
   order, and confirm both show the merged content and return from `Offline` to
   `Saved`. Confirm disconnection does not add a full-width banner over the
   document; actionable failures should use the compact dismissible top
   notification.
10. Make an edit, close and reopen the document while online, and confirm its
    cached content appears immediately while the compact status finishes
    background catch-up. Confirm no local-recovery warning appears. The first
    open after this change seeds cached access metadata; test instant open on
    the next reopen.
11. Make an edit in each client. Undo in one client with Command-Z and confirm
    only that client's latest change is removed.
12. Open History. Confirm an automatic baseline is present, preview it, then
    restore it. Confirm the pre-restore state appears as a separate `Before
    restore` version and the restored content synchronizes to the other client.

Automatic history currently uses a best-guess policy: an initial baseline,
then a checkpoint after 30 seconds idle when at least five minutes have elapsed
since the latest version, with a 15-minute maximum during continuous editing.

## Automated recovery evidence

`tests/cloud-collaboration-live.test.ts` creates disposable confirmed
accounts in an explicitly configured live run, grants one editor membership,
and commits divergent Yjs updates in both arrival orders. It verifies both
active documents converge through durable catch-up. It also verifies automatic
version deduplication and rejects version reads/writes from an unrelated
account, then removes the channels, accounts, and cascaded workspaces. The
default test suite skips this test unless its three `GHOST_SUPABASE_*`
environment variables are provided.

## Expected limitations

- A new folder or document does not yet appear automatically in the other
  client's tree; use Refresh.
- Signing in as a second account does not grant access because invitation and
  sharing UI is not built yet.
- A selected, previously verified document can open from its private cache and
  accept edits before the network check finishes. A fully cold offline app
  launch still needs cached tree/selection metadata. Process-kill timing, live
  cache clearing after revocation, and disaster recovery also need broader
  hardening even though cached bootstrap, downgrade/revocation, local reload,
  and durable divergent-update catch-up pass automated tests.
- Cloud images and rename/move/delete remain later slices.
