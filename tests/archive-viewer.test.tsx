// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
  stopListening: vi.fn(),
  fsChangeListener: null as ((event: { payload: string }) => void) | null,
  manifest: {
    archive_size_bytes: 1024,
    modified_ms: 100,
    entry_count: 4,
    total_uncompressed_bytes: 92,
    entries: [
      { path: "Project", kind: "directory", size_bytes: 0, modified_ms: 1, link_target: null },
      { path: "Project/README.md", kind: "file", size_bytes: 12, modified_ms: 2, link_target: null },
      { path: "Project/Sources", kind: "directory", size_bytes: 0, modified_ms: 3, link_target: null },
      { path: "Project/Sources/App.swift", kind: "file", size_bytes: 80, modified_ms: 4, link_target: null },
    ],
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, listener: (event: { payload: string }) => void) => {
    mocks.fsChangeListener = listener;
    return mocks.stopListening;
  }),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));

import { ArchiveViewer } from "../src/components/viewer/archive-viewer";

const mounted: Array<ReturnType<typeof createRoot>> = [];
const hosts: HTMLElement[] = [];

beforeEach(() => {
  mocks.invoke.mockReset().mockImplementation(async (command: string) => {
    if (command === "list_archive") return mocks.manifest;
    if (command === "get_file_metadata") return { size_bytes: 1024, modified_ms: 100 };
    if (command === "extract_archive") return { output_path: "/tmp/Project 2" };
    if (command === "materialize_archive_entry") {
      return {
        token: "preview-1",
        path: "/tmp/archive-cache/payload.bin",
        display_name: "README.md",
        mime_type: "application/octet-stream",
        size_bytes: 12,
      };
    }
    if (command === "cancel_archive_preview" || command === "release_archive_preview") return undefined;
    if (command === "reveal_in_finder") return undefined;
    throw new Error(`Unexpected command: ${command}`);
  });
  mocks.open.mockReset().mockResolvedValue(null);
  mocks.stopListening.mockReset();
  mocks.fsChangeListener = null;
});

afterEach(() => {
  while (mounted.length) act(() => mounted.pop()?.unmount());
  while (hosts.length) hosts.pop()?.remove();
});

async function renderArchive() {
  const host = document.createElement("div");
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  mounted.push(root);
  await act(async () => {
    root.render(<ArchiveViewer filePath="/project/Project.zip" />);
  });
  return host;
}

describe("ArchiveViewer", () => {
  it("renders a single-root archive expanded with summary metadata", async () => {
    const host = await renderArchive();

    expect(host.textContent).toContain("ZIP archive · 4 entries");
    expect(host.textContent).toContain("README.md");
    expect(host.textContent).toContain("1.0 KB compressed");
    expect(host.textContent).toContain("92 B uncompressed");
    expect(mocks.invoke).toHaveBeenCalledWith("list_archive", { path: "/project/Project.zip" });
  });

  it("navigates and collapses the archive hierarchy from the keyboard", async () => {
    const host = await renderArchive();
    const tree = host.querySelector<HTMLElement>("[role='tree']");
    if (!tree) throw new Error("archive viewer should render a tree");

    expect(host.querySelector("[aria-selected='true']")?.textContent).toContain("Project");
    act(() => tree.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    expect(host.querySelector("[aria-selected='true']")?.textContent).toContain("Sources");

    act(() => tree.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true })));
    act(() => tree.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
    expect(host.querySelectorAll("[role='treeitem']")).toHaveLength(1);
  });

  it("focuses and filters with the archive-local Command-F search", async () => {
    const host = await renderArchive();
    const tree = host.querySelector<HTMLElement>("[role='tree']");
    const search = host.querySelector<HTMLInputElement>("[aria-label='Search archive entries']");
    if (!tree || !search) throw new Error("archive viewer should render search and tree controls");

    tree.focus();
    act(() => { expect(window.__ghostViewerFind?.()).toBe(true); });
    expect(document.activeElement).toBe(search);

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        ?.set?.call(search, "swift");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("App.swift");
    expect(host.textContent).not.toContain("README.md");
  });

  it("materializes a selected file with Space and releases the temporary preview", async () => {
    const host = await renderArchive();
    const tree = host.querySelector<HTMLElement>("[role='tree']");
    if (!tree) throw new Error("archive viewer should render a tree");
    const readme = Array.from(host.querySelectorAll<HTMLElement>("[role='treeitem']"))
      .find((item) => item.textContent?.includes("README.md"));
    if (!readme) throw new Error("README entry should render");

    await act(async () => {
      readme.click();
    });
    await act(async () => {
      tree.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    });

    expect(mocks.invoke).toHaveBeenCalledWith("materialize_archive_entry", expect.objectContaining({
      archivePath: "/project/Project.zip",
      entryPath: "Project/README.md",
    }));
    expect(host.textContent).toContain("No in-app preview for this entry");

    const close = host.querySelector<HTMLButtonElement>("[aria-label='Close archive entry preview']");
    if (!close) throw new Error("archive preview should render a close button");
    await act(async () => { close.click(); });
    expect(mocks.invoke).toHaveBeenCalledWith("release_archive_preview", { token: "preview-1" });
  });

  it("cancels an in-flight materialization when the preview is closed", async () => {
    let resolvePreview: ((value: unknown) => void) | null = null;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "list_archive") return mocks.manifest;
      if (command === "get_file_metadata") return { size_bytes: 1024, modified_ms: 100 };
      if (command === "materialize_archive_entry") {
        return await new Promise((resolve) => { resolvePreview = resolve; });
      }
      if (command === "cancel_archive_preview" || command === "release_archive_preview") return undefined;
      throw new Error(`Unexpected command: ${command}`);
    });
    const host = await renderArchive();
    const previewButton = host.querySelector<HTMLButtonElement>("[aria-label='Preview selected archive entry']");
    const tree = host.querySelector<HTMLElement>("[role='tree']");
    if (!previewButton || !tree) throw new Error("archive preview controls should render");
    const readme = Array.from(host.querySelectorAll<HTMLElement>("[role='treeitem']"))
      .find((item) => item.textContent?.includes("README.md"));
    if (!readme) throw new Error("README entry should render");
    await act(async () => {
      readme.click();
    });
    await act(async () => { previewButton.click(); });
    const cancel = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Cancel"));
    if (!cancel) throw new Error("loading preview should offer cancellation");
    await act(async () => { cancel.click(); });
    expect(mocks.invoke).toHaveBeenCalledWith(
      "cancel_archive_preview",
      expect.objectContaining({ requestId: expect.stringContaining("archive-preview-") }),
    );
    await act(async () => {
      resolvePreview?.({
        token: "late-preview",
        path: "/tmp/payload.bin",
        display_name: "README.md",
        mime_type: "application/octet-stream",
        size_bytes: 12,
      });
      await Promise.resolve();
    });
    expect(mocks.invoke).toHaveBeenCalledWith("release_archive_preview", {
      token: "late-preview",
    });
  });

  it("extracts into the selected parent and reveals the result", async () => {
    mocks.open.mockResolvedValue("/tmp");
    const host = await renderArchive();
    const extract = Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Extract"));
    if (!extract) throw new Error("archive viewer should render Extract");

    await act(async () => extract.click());

    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({
      directory: true,
      defaultPath: "/project",
    }));
    expect(mocks.invoke).toHaveBeenCalledWith("extract_archive", {
      archivePath: "/project/Project.zip",
      destinationParent: "/tmp",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("reveal_in_finder", { path: "/tmp/Project 2" });
    expect(host.textContent).toContain("Extracted to Project 2");
  });

  it("releases an open preview when an external change makes the archive unreadable", async () => {
    let archiveReadable = true;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "list_archive") {
        if (!archiveReadable) throw new Error("Archive was replaced");
        return mocks.manifest;
      }
      if (command === "get_file_metadata") return { size_bytes: 1024, modified_ms: 100 };
      if (command === "materialize_archive_entry") {
        return {
          token: "preview-before-change",
          path: "/tmp/archive-cache/payload.bin",
          display_name: "README.md",
          mime_type: "application/octet-stream",
          size_bytes: 12,
        };
      }
      if (command === "cancel_archive_preview" || command === "release_archive_preview") return undefined;
      throw new Error(`Unexpected command: ${command}`);
    });
    const host = await renderArchive();
    const readme = Array.from(host.querySelectorAll<HTMLElement>("[role='treeitem']"))
      .find((item) => item.textContent?.includes("README.md"));
    if (!readme) throw new Error("README entry should render");
    await act(async () => { readme.click(); });
    const previewButton = host.querySelector<HTMLButtonElement>("[aria-label='Preview selected archive entry']");
    if (!previewButton) throw new Error("archive preview control should render");
    await act(async () => { previewButton.click(); });

    archiveReadable = false;
    await act(async () => {
      mocks.fsChangeListener?.({ payload: "/project/Project.zip" });
      await Promise.resolve();
    });

    expect(host.textContent).toContain("Archive was replaced");
    expect(mocks.invoke).toHaveBeenCalledWith("release_archive_preview", {
      token: "preview-before-change",
    });
  });

  it("shows a read-only fallback when macOS cannot inspect the archive", async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === "list_archive") throw new Error("Archive is encrypted");
      throw new Error(`Unexpected command: ${command}`);
    });
    const host = await renderArchive();

    expect(host.textContent).toContain("Unable to preview Project.zip");
    expect(host.textContent).toContain("Archive is encrypted");
    expect(host.textContent).toContain("Open Externally");
    expect(host.textContent).not.toContain("Extract…");
    expect(window.__ghostViewerFind?.()).toBe(false);
  });
});
