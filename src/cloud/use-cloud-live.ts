import { useEffect, useRef } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { VisibleCloudItem } from "@/cloud/cloud-sharing";

/**
 * Tree changes arrive over Realtime broadcast from the database (see the
 * live-tree migration): one topic per workspace the account can see, and
 * one for the account itself. Every event turns into one debounced reload.
 */
export const LIVE_DEBOUNCE_MS = 400;

/** The topics an account should listen on, from what it can see. */
export function liveTopicsFor(userId: string | null, items: VisibleCloudItem[], ownWorkspaceId: string | null): string[] {
  const topics = new Set<string>();
  if (userId) topics.add(`ghost-user:${userId}`);
  if (ownWorkspaceId) topics.add(`ghost-tree:${ownWorkspaceId}`);
  for (const item of items) topics.add(`ghost-tree:${item.workspace_id}`);
  return Array.from(topics).sort();
}

export function subscribeCloudLive(
  client: SupabaseClient,
  topics: string[],
  onChange: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const fire = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      onChange();
    }, LIVE_DEBOUNCE_MS);
  };
  const channels: RealtimeChannel[] = topics.map((topic) => {
    const channel = client.channel(topic, { config: { private: true } });
    channel.on("broadcast", { event: "changed" }, fire);
    channel.subscribe();
    return channel;
  });
  return () => {
    if (timer) clearTimeout(timer);
    for (const channel of channels) void client.removeChannel(channel);
  };
}

export function useCloudLive(client: SupabaseClient | null, topics: string[], onChange: () => void): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const key = topics.join("\n");
  useEffect(() => {
    if (!client || !key) return;
    return subscribeCloudLive(client, key.split("\n"), () => onChangeRef.current());
  }, [client, key]);
}
