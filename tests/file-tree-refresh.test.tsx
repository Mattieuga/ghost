// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../src/types";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { useFileTree } from "../src/hooks/use-file-tree";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];
let tree: ReturnType<typeof useFileTree> | null = null;

function directory(path: string, children: FileEntry[] = []): FileEntry {
  return {
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    is_directory: true,
    children,
  };
}

function file(path: string): FileEntry {
  return {
    name: path.slice(path.lastIndexOf("/") + 1),
    path,
    is_directory: false,
    children: null,
  };
}

function Harness({ refresh = 0 }: { refresh?: number }) {
  tree = useFileTree(["/project"], [], refresh);
  return <output>{JSON.stringify(tree.getEntries("/project"))}</output>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function render(refresh = 0) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  await act(async () => { root.render(<Harness refresh={refresh} />); });
  await flush();
  return { host, root };
}

beforeEach(() => {
  mocks.invoke.mockReset();
  tree = null;
});

afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop();
    act(() => item?.root.unmount());
    item?.host.remove();
  }
});

describe("file-tree refresh stability", () => {
  it("requests only one directory level from the native bridge", async () => {
    mocks.invoke.mockResolvedValue([]);

    await render();

    expect(mocks.invoke).toHaveBeenCalledWith("read_directory", expect.objectContaining({
      path: "/project",
      maxDepth: 1,
    }));
    expect(mocks.invoke.mock.calls[0]?.[1]).not.toHaveProperty("max_depth");
  });

  it("keeps expanded rows mounted until a complete refresh is ready", async () => {
    const nestedRefresh = deferred<FileEntry[]>();
    let nestedReads = 0;
    mocks.invoke.mockImplementation((_command: string, args: { path: string }) => {
      if (args.path === "/project") return Promise.resolve([directory("/project/nested")]);
      nestedReads += 1;
      return nestedReads === 1
        ? Promise.resolve([file("/project/nested/old.md")])
        : nestedRefresh.promise;
    });

    const { host, root } = await render();
    await act(async () => { await tree?.expandFolder("/project/nested"); });
    expect(host.textContent).toContain("old.md");

    await act(async () => { root.render(<Harness refresh={1} />); });
    await flush();

    // The old tree remains intact while the expanded directory is still
    // loading, rather than briefly collapsing to the shallow root result.
    expect(host.textContent).toContain("old.md");

    nestedRefresh.resolve([file("/project/nested/new.md")]);
    await flush();
    expect(host.textContent).toContain("new.md");
    expect(host.textContent).not.toContain("old.md");
  });

  it("inserts and retargets created rows immediately", async () => {
    mocks.invoke.mockImplementation((_command: string, args: { path: string }) => {
      if (args.path === "/project") return Promise.resolve([directory("/project/nested")]);
      return Promise.resolve([file("/project/nested/existing.md")]);
    });

    const { host } = await render();
    await act(async () => { await tree?.expandFolder("/project/nested"); });

    act(() => tree?.insertEntry("/project/nested/Untitled.md", false));
    expect(host.textContent).toContain("Untitled.md");

    act(() => tree?.renameEntry(
      "/project/nested/Untitled.md",
      "/project/nested/notes.md",
    ));
    expect(host.textContent).toContain("notes.md");
    expect(host.textContent).not.toContain("Untitled.md");
  });

  it("refreshes only the nearest loaded directory and preserves deeper rows", async () => {
    let nestedReads = 0;
    mocks.invoke.mockImplementation((_command: string, args: { path: string }) => {
      if (args.path === "/project") return Promise.resolve([directory("/project/nested")]);
      if (args.path === "/project/nested/deeper") {
        return Promise.resolve([file("/project/nested/deeper/kept.md")]);
      }
      nestedReads += 1;
      return Promise.resolve(nestedReads === 1
        ? [directory("/project/nested/deeper"), file("/project/nested/old.md")]
        : [directory("/project/nested/deeper"), file("/project/nested/new.md")]);
    });

    const { host } = await render();
    await act(async () => { await tree?.expandFolder("/project/nested"); });
    await act(async () => { await tree?.expandFolder("/project/nested/deeper"); });
    expect(host.textContent).toContain("kept.md");

    act(() => tree?.refreshPath("/project/nested/new.md"));
    await flush();
    expect(host.textContent).toContain("new.md");
    expect(host.textContent).toContain("kept.md");
  });
});
