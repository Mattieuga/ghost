import { useEffect, useState } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export type CloudAccountState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "signed-in"; user: User }
  | { kind: "error"; message: string };

export function useCloudAccount(client: SupabaseClient | null): CloudAccountState {
  const [account, setAccount] = useState<CloudAccountState>(
    client ? { kind: "loading" } : { kind: "error", message: "Ghost Cloud is not configured." },
  );

  useEffect(() => {
    if (!client) return;
    let active = true;

    void client.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setAccount({ kind: "error", message: error.message });
      else if (data.session?.user) setAccount({ kind: "signed-in", user: data.session.user });
      else setAccount({ kind: "signed-out" });
    });

    const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setAccount(session?.user
        ? { kind: "signed-in", user: session.user }
        : { kind: "signed-out" });
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [client]);

  return account;
}
