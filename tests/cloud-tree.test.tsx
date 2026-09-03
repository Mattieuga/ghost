// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudTree } from "../src/cloud/cloud-tree";
import type { VisibleCloudItem } from "../src/cloud/cloud-sharing";
import type { CloudTreeState } from "../src/cloud/use-cloud-tree";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];

afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop();
    act(() => item?.root.unmount());
    item?.host.remove();
  }
});

function cloudItem(overrides: Partial<VisibleCloudItem>): VisibleCloudItem {
  return {
    id: "document-1",
    workspace_id: "workspace-1",
    parent_id: null,
    kind: "document",
    name: "Plan.md",
    root_kind: null,
    created_by: "user-1",
    created_at: "2026-08-28T00:00:00Z",
    updated_at: "2026-08-28T00:00:00Z",
    deleted_at: null,
    access_role: "owner",
    shared_root_id: null,
    shared_by: null,
    shared_out: false,
    ...overrides,
  };
}

function cloudTreeState(
  items: VisibleCloudItem[],
  options: { error?: string | null; guest?: boolean } = {},
): CloudTreeState {
  const roots = items.filter((item) => item.parent_id === null && item.access_role === "owner" && item.root_kind !== null);
  return {
    workspace: {
      id: "workspace-1",
      owner_id: "user-1",
      name: "My Cloud",
      created_at: "2026-08-28T00:00:00Z",
      updated_at: "2026-08-28T00:00:00Z",
    },
    items,
    roots,
    shared: items.filter((item) => item.shared_root_id === item.id),
    notesRootId: roots.find((root) => root.root_kind === "notes")?.id ?? null,
    guest: options.guest ?? false,
    loading: false,
    error: options.error ?? null,
    create: vi.fn(),
    rename: vi.fn(),
    duplicate: vi.fn(),
    trash: vi.fn(),
    leave: vi.fn(),
    reload: vi.fn(),
  };
}

function mount(element: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  return { host, render: () => act(async () => { root.render(element); }) };
}

describe("CloudTree", () => {
  it("shows synced roots under Cloud, open, with quick-add and refresh", async () => {
    const notes = cloudItem({ id: "notes", kind: "folder", name: "Notes", root_kind: "notes" });
    const documentItem = cloudItem({ parent_id: "notes" });
    const legacy = cloudItem({ id: "legacy", name: "Testfile.md" });
    const select = vi.fn();
    const { host, render } = mount(
      <CloudTree
        tree={cloudTreeState([notes, documentItem, legacy])}
        selectedId={documentItem.id}
        onSelectDocument={select}
      />,
    );
    await render();

    expect(host.querySelector('[title="New note in Notes"]')?.textContent).toBe("+");
    expect(host.querySelector('[title="Refresh"]')).not.toBeNull();
    expect(host.querySelector('[data-cloud-section="cloud"]')?.textContent).toContain("Notes");
    expect(host.querySelector('[data-cloud-section="shared"]')).toBeNull();
    // Loose top-level items from before synced folders are not a root.
    expect(host.textContent).not.toContain("Testfile.md");
    expect(host.querySelector('[data-file-active="true"]')?.textContent).toContain("Plan.md");

    const rootFolder = host.querySelector<HTMLElement>("[data-root-folder]");
    expect(rootFolder?.querySelector("[data-root-dot]")).not.toBeNull();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-file-active="true"] button')?.click();
    });
    expect(select).toHaveBeenCalledWith(documentItem);
  });

  it("lists what others shared under Shared and offers Leave instead of Trash", async () => {
    const sharedDoc = cloudItem({
      id: "shared-doc", name: "Trip.md", workspace_id: "workspace-2",
      access_role: "viewer", shared_root_id: "shared-doc", shared_by: "Sam",
    });
    const { host, render } = mount(
      <CloudTree tree={cloudTreeState([sharedDoc])} selectedId={null} onSelectDocument={() => undefined} />,
    );
    await render();

    const shared = host.querySelector('[data-cloud-section="shared"]');
    expect(shared?.textContent).toContain("Trip.md");
    expect(host.querySelector('[title="Shared by Sam"]')).not.toBeNull();
    expect(host.querySelector('[data-cloud-section="cloud"]')?.textContent).toContain("Nothing in Cloud yet");
  });

  it("hides the Cloud section and quick-add for guests", async () => {
    const sharedDoc = cloudItem({
      id: "shared-doc", name: "Trip.md", access_role: "editor", shared_root_id: "shared-doc", shared_by: "Sam",
    });
    const { host, render } = mount(
      <CloudTree
        tree={cloudTreeState([sharedDoc], { guest: true })}
        selectedId={null}
        onSelectDocument={() => undefined}
        accountLabel="Guest · Pat"
        onSignOut={() => undefined}
      />,
    );
    await render();

    expect(host.querySelector('[data-cloud-section="cloud"]')).toBeNull();
    expect(host.querySelector('[title="New note in Notes"]')).toBeNull();
    expect(host.textContent).toContain("Guest · Pat");
    expect(host.textContent).toContain("Sign in");
  });

  it("reports load failures in a compact notification instead of an inline error bar", async () => {
    const { host, render } = mount(
      <CloudTree
        tree={cloudTreeState([], { error: "Cloud is temporarily unavailable" })}
        selectedId={null}
        onSelectDocument={() => undefined}
      />,
    );
    await render();

    const notification = host.querySelector('[role="status"]');
    expect(notification?.textContent).toContain("Cloud is temporarily unavailable");
    expect(notification?.className).toContain("fixed");
  });
});
