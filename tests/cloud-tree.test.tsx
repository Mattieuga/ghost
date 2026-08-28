// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CloudTree } from "../src/cloud/cloud-tree";
import type { CloudItem } from "../src/cloud/cloud-data";
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

function cloudItem(overrides: Partial<CloudItem>): CloudItem {
  return {
    id: "document-1",
    workspace_id: "workspace-1",
    parent_id: null,
    kind: "document",
    name: "Plan.md",
    created_by: "user-1",
    created_at: "2026-08-28T00:00:00Z",
    updated_at: "2026-08-28T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

function cloudTreeState(items: CloudItem[], error: string | null = null): CloudTreeState {
  return {
    workspace: {
      id: "workspace-1",
      owner_id: "user-1",
      name: "My Cloud",
      created_at: "2026-08-28T00:00:00Z",
      updated_at: "2026-08-28T00:00:00Z",
    },
    items,
    loading: false,
    error,
    create: vi.fn(),
    rename: vi.fn(),
    duplicate: vi.fn(),
    trash: vi.fn(),
    reload: vi.fn(),
  };
}

describe("CloudTree", () => {
  it("uses Workspace tree rows and keeps only quick-add plus temporary refresh", async () => {
    const documentItem = cloudItem({});
    const folder = cloudItem({ id: "folder-1", kind: "folder", name: "Notes" });
    const select = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });

    await act(async () => {
      root.render(
        <CloudTree
          tree={cloudTreeState([documentItem, folder])}
          selectedId={documentItem.id}
          onSelectDocument={select}
          compact
        />,
      );
    });

    expect(host.querySelector('[title="New Cloud document"]')?.textContent).toBe("+");
    expect(host.querySelector('[title="Refresh Cloud"]')).not.toBeNull();
    expect(host.querySelector('[title="New Cloud folder"]')).toBeNull();
    expect(host.querySelector('[title="Sign out of Cloud"]')).toBeNull();
    expect(host.querySelector('[data-file-active="true"]')?.textContent).toContain("Plan.md");
    expect(host.textContent).toContain("Notes");

    const rootFolder = host.querySelector<HTMLElement>('[data-root-folder]');
    expect(rootFolder).not.toBeNull();
    expect(rootFolder?.querySelector('[data-root-dot]')).not.toBeNull();

    await act(async () => {
      rootFolder?.querySelector<HTMLButtonElement>('[data-tree-focus-target]')?.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    expect(rootFolder?.dataset.treeFocused).toBe("true");
    expect(rootFolder?.querySelector('[data-tree-focus-target]')?.className).toContain("ring-ghost-amber");

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-file-active="true"] button')?.click();
    });
    expect(select).toHaveBeenCalledWith(documentItem);
  });

  it("reports load failures in a compact notification instead of an inline error bar", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });

    await act(async () => {
      root.render(
        <CloudTree
          tree={cloudTreeState([], "Cloud is temporarily unavailable")}
          selectedId={null}
          onSelectDocument={() => undefined}
          compact
        />,
      );
    });

    const notification = host.querySelector('[role="status"]');
    expect(notification?.textContent).toContain("Cloud is temporarily unavailable");
    expect(notification?.className).toContain("fixed");
  });
});
