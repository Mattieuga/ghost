// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SharePanel, ShareSheet } from "../src/mirror/share-sheet";
import type { TrackedRoot } from "../src/hooks/use-tracked-folders";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];

afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop();
    act(() => item?.root.unmount());
    item?.host.remove();
  }
});

function mount(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(element));
  mounted.push({ root, host });
  return host;
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
}

function fakeClient() {
  const calls: Array<{ name: string; args: unknown }> = [];
  const invoked: Array<{ name: string; body: unknown }> = [];
  const sharing = {
    members: [{ user_id: "u2", email: "wife@example.com", display_name: null, role: "editor", created_at: "t" }],
    invitations: [],
    link: null as null | { id: string; role: string; token: string; created_at: string },
  };
  const rpc = vi.fn(async (name: string, args?: unknown) => {
    calls.push({ name, args });
    if (name === "cloud_item_sharing") return { data: sharing, error: null };
    if (name === "cloud_set_share_link") {
      const role = (args as { link_role: string | null }).link_role;
      sharing.link = role ? { id: "link-1", role, token: "tok123", created_at: "t" } : null;
      return { data: sharing.link, error: null };
    }
    if (name === "cloud_share_item") {
      return { data: { kind: "invited", invitation_id: "inv-1", email: "friend@example.com", role: "viewer" }, error: null };
    }
    return { data: null, error: null };
  });
  const functions = {
    invoke: vi.fn(async (name: string, options: { body: unknown }) => {
      invoked.push({ name, body: options.body });
      return { data: { sent: true }, error: null };
    }),
  };
  return { client: { rpc, functions } as unknown as SupabaseClient, calls, invoked };
}

function button(host: HTMLElement, label: string) {
  return Array.from(host.querySelectorAll("button")).find((candidate) => candidate.textContent === label);
}

describe("SharePanel", () => {
  it("turns the one link on, copies it, changes its role in place, and turns it off", async () => {
    const { client, calls } = fakeClient();
    const copied: string[] = [];
    const host = mount(
      <SharePanel client={client} itemId="doc-1" itemName="Plan.md" itemKind="document" webAppUrl="https://ghosteditor.app/app" copy={async (text) => { copied.push(text); }} />,
    );
    await flush();
    expect(host.textContent).toContain("Only people you invite below can open it.");
    expect(button(host, "Copy link")?.disabled).toBe(true);

    await act(async () => { button(host, "Can edit")?.click(); });
    await flush();
    expect(calls.find((call) => call.name === "cloud_set_share_link")?.args).toEqual({ target_item_id: "doc-1", link_role: "editor" });
    expect(copied).toEqual(["https://ghosteditor.app/app#share=tok123"]);
    expect(host.textContent).toContain("Anyone who has the link can edit.");
    expect(button(host, "Copy link")?.disabled).toBe(false);

    await act(async () => { button(host, "Copy link")?.click(); });
    await flush();
    expect(copied).toHaveLength(2);

    await act(async () => { button(host, "Can view")?.click(); });
    await flush();
    expect(host.textContent).toContain("Anyone who has the link can view.");
    expect(copied).toHaveLength(2);

    await act(async () => { button(host, "Off")?.click(); });
    await flush();
    expect(calls.filter((call) => call.name === "cloud_set_share_link").at(-1)?.args).toEqual({ target_item_id: "doc-1", link_role: null });
    expect(host.textContent).toContain("Link turned off.");
  });

  it("invites by email and asks the function to send the email", async () => {
    const { client, calls, invoked } = fakeClient();
    const host = mount(<SharePanel client={client} itemId="doc-1" itemName="Plan.md" itemKind="document" webAppUrl="https://ghosteditor.app/app" copy={async () => undefined} />);
    await flush();
    const input = host.querySelector<HTMLInputElement>("input[type=email]")!;
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "friend@example.com");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "viewer");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(calls.find((call) => call.name === "cloud_share_item")?.args).toEqual({
      target_item_id: "doc-1", member_email: "friend@example.com", member_role: "viewer",
    });
    expect(invoked).toEqual([{
      name: "share-invite",
      body: { item_id: "doc-1", item_name: "Plan.md", item_kind: "document", email: "friend@example.com", role: "viewer", web_app_url: "https://ghosteditor.app/app" },
    }]);
    expect(host.textContent).toContain("friend@example.com has an email with a link to sign in.");
  });

  it("explains when the server lacks the sharing migration", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "Could not find the function public.cloud_item_sharing in the schema cache" } }));
    const host = mount(<SharePanel client={{ rpc } as unknown as SupabaseClient} itemId="doc-1" itemName="x" itemKind="document" webAppUrl="x" copy={async () => undefined} />);
    await flush();
    expect(host.textContent).toContain("Cloud needs a server update before sharing works.");
  });
});

describe("ShareSheet", () => {
  const signIn = { emailRedirectTo: "", oauthRedirectTo: "", openOAuthUrl: () => undefined, externalError: null };
  const root: TrackedRoot = { id: "r", path: "/Users/me/Ghost/Notes", kind: "mirrored", cloudRootId: "r" };
  const account = { kind: "signed-in" as const, user: { id: "u1", email: "me@example.com" } as never };

  it("waits for the item to reach Cloud before showing the panel", async () => {
    const { client } = fakeClient();
    mount(
      <ShareSheet
        open
        onClose={() => undefined}
        client={client}
        account={account}
        target={{ path: "/Users/me/Ghost/Notes/Plan.md", kind: "file" }}
        root={root}
        cloudItemId={null}
        signIn={signIn}
        onSyncFolder={() => undefined}
        onCopyToNotes={() => undefined}
      />,
    );
    await flush();
    expect(document.body.textContent).toContain("Sharing opens as soon as Plan.md is there.");
    expect(document.body.querySelector("[data-share-panel]")).toBeNull();
  });

  it("shares a folder in a synced root through the same panel", async () => {
    const { client } = fakeClient();
    mount(
      <ShareSheet
        open
        onClose={() => undefined}
        client={client}
        account={account}
        target={{ path: "/Users/me/Ghost/Notes/Plans", kind: "folder" }}
        root={root}
        cloudItemId="folder-1"
        signIn={signIn}
        onSyncFolder={() => undefined}
        onCopyToNotes={() => undefined}
      />,
    );
    await flush();
    expect(document.body.textContent).toContain("Share Plans");
    expect(document.body.querySelector("[data-share-panel]")).not.toBeNull();
  });

  it("offers to sync a plain folder instead", async () => {
    const { client } = fakeClient();
    const sync = vi.fn();
    mount(
      <ShareSheet
        open
        onClose={() => undefined}
        client={client}
        account={account}
        target={{ path: "/Users/me/code/wiki", kind: "folder" }}
        root={{ id: "p", path: "/Users/me/code/wiki", kind: "plain" }}
        cloudItemId={null}
        signIn={signIn}
        onSyncFolder={sync}
        onCopyToNotes={() => undefined}
      />,
    );
    await flush();
    const syncButton = Array.from(document.body.querySelectorAll("button")).find((candidate) => candidate.textContent === "Sync wiki");
    await act(async () => { syncButton?.click(); });
    expect(sync).toHaveBeenCalledWith("/Users/me/code/wiki");
  });
});
