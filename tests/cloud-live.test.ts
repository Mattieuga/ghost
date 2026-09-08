import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { VisibleCloudItem } from "../src/cloud/cloud-sharing";
import { LIVE_DEBOUNCE_MS, liveTopicsFor, subscribeCloudLive } from "../src/cloud/use-cloud-live";

function item(overrides: Partial<VisibleCloudItem>): VisibleCloudItem {
  return {
    id: "x", workspace_id: "w1", parent_id: null, kind: "document", name: "x.md", root_kind: null, created_by: null,
    created_at: "t", updated_at: "t", deleted_at: null, access_role: "owner", shared_root_id: null, shared_by: null, shared_out: false,
    ...overrides,
  };
}

describe("live topics", () => {
  it("lists the account and the workspaces it owns, never another owner's", () => {
    const topics = liveTopicsFor("u1", [item({ workspace_id: "w1" }), item({ id: "y", workspace_id: "w2", shared_root_id: "y" })], "w1");
    expect(topics).toEqual(["ghost-tree:w1", "ghost-user:u1"]);
    // The Mac passes no workspace of its own; its own items name it.
    expect(liveTopicsFor("u1", [item({ workspace_id: "w1" })], null)).toEqual(["ghost-tree:w1", "ghost-user:u1"]);
    expect(liveTopicsFor(null, [], null)).toEqual([]);
  });

  it("subscribes to private channels and folds a burst of events into one reload", () => {
    vi.useFakeTimers();
    try {
      const handlers: Array<() => void> = [];
      const removed: unknown[] = [];
      const channel = (name: string, options: unknown) => {
        const self = {
          name,
          options,
          on: (_type: string, _filter: unknown, handler: () => void) => { handlers.push(handler); return self; },
          subscribe: () => self,
        };
        return self;
      };
      const client = { channel, removeChannel: async (ch: unknown) => { removed.push(ch); } } as unknown as SupabaseClient;
      const onChange = vi.fn();

      const stop = subscribeCloudLive(client, ["ghost-tree:w1", "ghost-user:u1"], onChange);
      expect(handlers).toHaveLength(2);
      handlers[0]();
      handlers[1]();
      handlers[0]();
      vi.advanceTimersByTime(LIVE_DEBOUNCE_MS + 1);
      expect(onChange).toHaveBeenCalledTimes(1);

      stop();
      expect(removed).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
