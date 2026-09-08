// Email an invitation for something shared by email. Access is granted by
// `cloud_share_item` before this runs; this only tells the person.
//
// A new address gets Supabase's invite email, which creates the account and
// lands on the web app after the link is followed; the pending invitation
// attaches at that first sign-in. An address that already has an account
// gets nothing yet: the share appears under Shared on their next visit.
//
// The request names the item and the address only. The address must hold
// a pending invitation on the item, and the role and the item's name come
// from the database, so the function never mails an address the owner did
// not invite and never carries text of the caller's choosing.
//
// Deploy with `supabase functions deploy share-invite`. The project's own
// service role key is provided to the function by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const ROLES = new Set(["viewer", "editor"]);
const DEFAULT_WEB_APP_URL = "https://ghosteditor.app/app";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

/** The web app the email should land on: the live site, or a local build. */
function webAppUrlFrom(candidate: string | undefined): string {
  try {
    const url = new URL(candidate ?? DEFAULT_WEB_APP_URL);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.origin === "https://ghosteditor.app" || local) return url.href.replace(/\/+$/, "");
  } catch {
    // Not a URL; the default stands.
  }
  return DEFAULT_WEB_APP_URL;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
      },
    });
  }
  if (request.method !== "POST") return json(405, { error: "POST only" });

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json(500, { error: "Function is not configured" });

  const authorization = request.headers.get("Authorization") ?? "";
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: { user } } = await caller.auth.getUser();
  if (!user || user.is_anonymous) return json(401, { error: "Sign in to invite people" });

  let body: { item_id?: string; email?: string; web_app_url?: string };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid body" });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const itemId = body.item_id ?? "";
  if (!email.includes("@") || !itemId) return json(400, { error: "Invalid invitation" });

  // Only the item's owner may email about it; the sharing summary answers
  // for owners alone, and it lists the invitations that are waiting.
  const { data: sharing, error: ownerError } = await caller.rpc("cloud_item_sharing", { target_item_id: itemId });
  if (ownerError) return json(403, { error: "Only the owner can invite people" });
  const invitations = (sharing as { invitations?: Array<{ email?: string; role?: string }> } | null)?.invitations ?? [];
  const invitation = invitations.find((candidate) => (candidate.email ?? "").toLowerCase() === email);
  if (!invitation || !ROLES.has(invitation.role ?? "")) {
    return json(400, { error: "No invitation is waiting for that address" });
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: item } = await admin
    .from("cloud_items")
    .select("name, kind")
    .eq("id", itemId)
    .maybeSingle();
  const webAppUrl = webAppUrlFrom(body.web_app_url);
  const redirectTo = item?.kind === "document" ? `${webAppUrl}/#/d/${itemId}` : `${webAppUrl}/`;
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      invited_by: user.email ?? "someone",
      shared_item: item?.name ?? "a note",
      shared_role: invitation.role,
    },
  });
  if (error) {
    // An existing account is not re-invited; the share is waiting for them.
    if (/already|exists|registered/i.test(error.message)) return json(200, { sent: false, reason: "existing-account" });
    return json(502, { error: error.message });
  }
  return json(200, { sent: true });
});
