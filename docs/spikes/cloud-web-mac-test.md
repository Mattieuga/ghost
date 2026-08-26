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

Direct invitations, share links, rename/move/delete, and two-account sharing
are later slices and are not part of this test.

## Test

1. Keep the development app and Vite process running with `pnpm tauri dev`.
2. Open `http://localhost:1420/web.html` in a browser.
3. Create a Cloud account in the web client. If email confirmation is enabled,
   follow the confirmation link; it should return to `web.html`. The local web
   URL must be present in the Supabase Auth redirect allow list.
4. Sign in to the Mac app's Cloud section with the same email and password.
   Browser and Mac sessions are intentionally separate; the Mac refresh token
   is stored in Keychain.
5. Create a Markdown document in either client. In the other client, click the
   Cloud refresh button, then open the same document.
6. Type in one client while watching the other. Text and the remote caret should
   appear live. Repeat in the other direction.
7. Confirm both clients show `Realtime: connected` and `Cloud: saved` after
   typing stops.
8. Reload `web.html`, reopen the document, and confirm the text remains. Close
   and reopen the document in the Mac app and confirm the same state.

## Expected limitations

- A new folder or document does not yet appear automatically in the other
  client's tree; use Refresh.
- Signing in as a second account does not grant access because invitation and
  sharing UI is not built yet.
- Cloud images, rename/move/delete, checkpoints, and full offline/reconnect
  hardening remain on the roadmap.
