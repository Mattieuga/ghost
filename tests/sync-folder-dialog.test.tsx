// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncFolderDialog, StopSyncingDialog } from "../src/mirror/sync-folder-dialog";
import type { MirrorFs } from "../src/lib/mirror/mirror-fs";
import type { SyncCandidate } from "../src/lib/mirror/preflight";
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

function facts(overrides: Partial<SyncCandidate> = {}): SyncCandidate {
  return {
    path: "/Users/me/Cowork",
    canonicalPath: "/Users/me/Cowork",
    home: "/Users/me",
    appDataDir: null,
    isDirectory: true,
    isPackage: false,
    writable: true,
    ancestorVcs: [],
    ancestorManaged: [],
    descendantVcs: [],
    descendantManaged: [],
    syncService: null,
    externalVolume: false,
    fileCount: 4,
    byteCount: 2_000,
    markdownCount: 3,
    scanTruncated: false,
    ...overrides,
  };
}

function fakeFs(candidate: SyncCandidate): MirrorFs {
  return { inspectSyncCandidate: async () => candidate } as unknown as MirrorFs;
}

async function settle() {
  for (let round = 0; round < 4; round += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
}

async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(node); });
  await settle();
  return host;
}

function buttonWithText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll("button"))
    .find((button) => button.textContent?.trim() === text);
}

describe("SyncFolderDialog", () => {
  it("explains a Git refusal and offers only Close", async () => {
    const onConfirm = vi.fn();
    await render(
      <SyncFolderDialog
        path="/Users/me/code/repo/docs"
        roots={[]}
        onClose={() => undefined}
        onConfirm={onConfirm}
        fs={fakeFs(facts({
          canonicalPath: "/Users/me/code/repo/docs",
          ancestorVcs: [{ path: "/Users/me/code/repo", marker: ".git" }],
        }))}
      />,
    );
    expect(document.body.textContent).toContain("Can't sync docs");
    expect(document.body.textContent).toContain("Git owns the files in repo");
    expect(buttonWithText("Sync")).toBeUndefined();
    expect(buttonWithText("Close")).toBeDefined();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("lists exclusions and warnings, then syncs on confirm", async () => {
    const onConfirm = vi.fn(async () => undefined);
    await render(
      <SyncFolderDialog
        path="/Users/me/Cowork"
        roots={[]}
        onClose={() => undefined}
        onConfirm={onConfirm}
        fs={fakeFs(facts({
          descendantVcs: [{ path: "/Users/me/Cowork/lib", marker: ".git" }],
          syncService: "Dropbox",
        }))}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("Sync Cowork to Cloud?");
    expect(text).toContain("3 notes found");
    expect(text).toContain("One folder inside will be skipped");
    expect(text).toContain("lib");
    expect(text).toContain("already synced by Dropbox");
    expect(text).toContain("won't sync yet");

    await act(async () => { buttonWithText("Sync")?.click(); });
    await settle();
    expect(onConfirm).toHaveBeenCalledWith("/Users/me/Cowork");
  });
});

describe("StopSyncingDialog", () => {
  it("names the three consequences and confirms with the root", async () => {
    const root: TrackedRoot = { id: "r", path: "/Users/me/Cowork", kind: "mirrored" };
    const onConfirm = vi.fn(async () => undefined);
    await render(<StopSyncingDialog root={root} onClose={() => undefined} onConfirm={onConfirm} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Stop syncing Cowork?");
    expect(text).toContain("stay on this Mac as plain Markdown");
    expect(text).toContain("Cloud Trash");
    expect(text).toContain("loses access");
    await act(async () => { buttonWithText("Stop Syncing")?.click(); });
    await settle();
    expect(onConfirm).toHaveBeenCalledWith(root);
  });
});
