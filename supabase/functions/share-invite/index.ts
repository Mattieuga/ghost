// Email an invitation for something shared by email. Access is granted by
// `cloud_share_item` before this runs; this only tells the person.
//
// A new address gets Supabase's invite email, which creates the account and
// lands on the web app after the link is followed; the pending invitation
// attaches at that first sign-in. An address that already has an account
// gets nothing yet: the share appears under Shared on their next visit.
//
// Deploy with `supabase functions deploy share-invite`. The project's own
// service role key is provided to the function by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const ROLES = new Set(["viewer", "editor"]);

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
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

  let body: { item_id?: string; item_name?: string; email?: string; role?: string; web_app_url?: string; item_kind?: string };
  try {
    body = await request.json();
  } catch {
    return json(400, { error: "Invalid body" });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const itemId = body.item_id ?? "";
  if (!email.includes("@") || !itemId || !ROLES.has(body.role ?? "")) return json(400, { error: "Invalid invitation" });

  // Only the item's owner may email about it; the sharing summary answers for owners alone.
  const { error: ownerError } = await caller.rpc("cloud_item_sharing", { target_item_id: itemId });
  if (ownerError) return json(403, { error: "Only the owner can invite people" });

  const webAppUrl = (body.web_app_url ?? "https://ghosteditor.app/app").replace(/\/+$/, "");
  const redirectTo = body.item_kind === "document" ? `${webAppUrl}/#/d/${itemId}` : `${webAppUrl}/`;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      invited_by: user.email ?? "someone",
      shared_item: body.item_name ?? "a note",
      shared_role: body.role,
    },
  });
  if (error) {
    // An existing account is not re-invited; the share is waiting for them.
    if (/already|exists|registered/i.test(error.message)) return json(200, { sent: false, reason: "existing-account" });
    return json(502, { error: error.message });
  }
  return json(200, { sent: true });
});
