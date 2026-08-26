import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

export interface CollaborationSpikeConfig {
  url: string;
  publishableKey: string;
  projectRef: string;
}

export interface ActorSession {
  client: SupabaseClient;
  user: User;
}

const actorSessions = new Map<string, Promise<ActorSession>>();

export function readCollaborationSpikeConfig(): CollaborationSpikeConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;

  let projectRef: string;
  try {
    projectRef = new URL(url).hostname.split(".")[0] || "local";
  } catch {
    throw new Error("VITE_SUPABASE_URL is not a valid URL.");
  }

  return { url, publishableKey, projectRef };
}

export function getActorSession(
  config: CollaborationSpikeConfig,
  actor: string,
): Promise<ActorSession> {
  const safeActor = actor.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
  const cacheKey = `${config.projectRef}:${safeActor}`;
  const cached = actorSessions.get(cacheKey);
  if (cached) return cached;

  const pending = createActorSession(config, safeActor).catch((error) => {
    actorSessions.delete(cacheKey);
    throw error;
  });
  actorSessions.set(cacheKey, pending);
  return pending;
}

async function createActorSession(
  config: CollaborationSpikeConfig,
  actor: string,
): Promise<ActorSession> {
  const client = createClient(config.url, config.publishableKey, {
    auth: {
      storageKey: `ghost-collaboration-spike-${config.projectRef}-${actor}`,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  const { data: existing, error: sessionError } = await client.auth.getSession();
  if (sessionError) throw new Error(`Could not restore prototype session: ${sessionError.message}`);
  if (existing.session?.user) return { client, user: existing.session.user };

  const { data, error } = await client.auth.signInAnonymously({
    options: { data: { ghost_spike_actor: actor } },
  });
  if (error) {
    throw new Error(
      `Could not create an anonymous prototype user: ${error.message}. ` +
      "Confirm Anonymous Sign-Ins are enabled in Supabase Auth settings.",
    );
  }
  if (!data.user) throw new Error("Supabase did not return a prototype user.");
  return { client, user: data.user };
}
