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
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function fakeClient() {
  const calls: Array<{ name: string; args: unknown }> = [];
  const sharing = {
    members: [{ user_id: "u2", email: "wife@example.com", display_name: null, role: "editor", created_at: "t" }],
    invitations: [],
    links: [] as Array<{ id: string; role: string; created_at: string; expires_at: null }>,
  };
  const rpc = vi.fn(async (name: string, args?: unknown) => {
    calls.push({ name, args });
    if (name === "cloud_item_sharing") return { data: sharing, error: null };
    if (name === "cloud_create_share_link") {
      sharing.links.push({ id: "link-1", role: "editor", created_at: "t", expires_at: null });
      return { data: { id: "link-1", token: "tok123", role: "editor", created_at: "t", expires_at: null }, error: null };
    }
    if (name === "cloud_share_item") {
      return { data: { kind: "invited", invitation_id: "inv-1", email: "friend@example.com", role: "viewer" }, error: null };
    }
    return { data: null, error: null };
  });
  return { client: { rpc } as unknown as SupabaseClient, calls };
}

describe("SharePanel", () => {
  it("copies a fresh edit link and lists who has access", async () => {
    const { client, calls } = fakeClient();
    const copied: string[] = [];
    const host = mount(
      <SharePanel client={client} itemId="doc-1" webAppUrl="https://ghosteditor.app/app" copy={async (text) => { copied.push(text); }} />,
    );
    await flush();
    expect(host.textContent).toContain("wife@example.com");
    expect(host.textContent).toContain("can edit");

    const copyEdit = Array.from(host.querySelectorAll("button")).find((button) => button.textContent === "Copy edit link");
    await act(async () => { copyEdit?.click(); });
    await flush();

    expect(copied).toEqual(["https://ghosteditor.app/app#share=tok123"]);
    expect(calls.find((call) => call.name === "cloud_create_share_link")?.args).toEqual({
      target_item_id: "doc-1", link_role: "editor", expires_in_hours: null,
    });
    expect(host.textContent).toContain("Edit link copied.");
    expect(host.textContent).toContain("Edit link");
  });

  it("invites by email through the form", async () => {
    const { client, calls } = fakeClient();
    const host = mount(<SharePanel client={client} itemId="doc-1" webAppUrl="https://ghosteditor.app/app" copy={async () => undefined} />);
    await flush();
    const input = host.querySelector<HTMLInputElement>("input[type=email]")!;
    const select = host.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "friend@example.com");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      const selectSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      selectSetter.call(select, "viewer");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flush();
    expect(calls.find((call) => call.name === "cloud_share_item")?.args).toEqual({
      target_item_id: "doc-1", member_email: "friend@example.com", member_role: "viewer",
    });
    expect(host.textContent).toContain("friend@example.com gets access when they sign in.");
  });

  it("explains when the server lacks the sharing migration", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: "Could not find the function public.cloud_item_sharing in the schema cache" } }));
    const host = mount(<SharePanel client={{ rpc } as unknown as SupabaseClient} itemId="doc-1" webAppUrl="x" copy={async () => undefined} />);
    await flush();
    expect(host.textContent).toContain("Cloud needs a server update before sharing works.");
  });
});

describe("ShareSheet", () => {
  const signIn = { emailRedirectTo: "", oauthRedirectTo: "", openOAuthUrl: () => undefined, externalError: null };
  const root: TrackedRoot = { id: "r", path: "/Users/me/Ghost/Notes", kind: "mirrored", cloudRootId: "r" };
  const account = { kind: "signed-in" as const, user: { id: "u1", email: "me@example.com" } as never };

  it("waits for the note to reach Cloud before showing the panel", async () => {
    const { client } = fakeClient();
    const host = mount(
      <ShareSheet
        open
        onClose={() => undefined}
        client={client}
        account={account}
        filePath="/Users/me/Ghost/Notes/Plan.md"
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

  it("shows the panel once the note has a Cloud ID", async () => {
    const { client } = fakeClient();
    mount(
      <ShareSheet
        open
        onClose={() => undefined}
        client={client}
        account={account}
        filePath="/Users/me/Ghost/Notes/Plan.md"
        root={root}
        cloudItemId="doc-1"
        signIn={signIn}
        onSyncFolder={() => undefined}
        onCopyToNotes={() => undefined}
      />,
    );
    await flush();
    expect(document.body.querySelector("[data-share-panel]")).not.toBeNull();
    expect(document.body.textContent).toContain("signed in as me@example.com");
  });
});
