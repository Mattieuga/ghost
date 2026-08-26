// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FolderTree } from "../src/components/sidebar/folder-tree";
import { FileTreeKeyboard } from "../src/components/sidebar/file-tree-keyboard";
import { ActiveFileProvider, ActiveFileStore } from "../src/components/sidebar/sidebar-context";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];

afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop();
    act(() => item?.root.unmount());
    item?.host.remove();
  }
});

describe("sidebar active guide", () => {
  it("marks a collapsed active project without treating its row as a guide endpoint", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });

    const activeFileStore = new ActiveFileStore();
    activeFileStore.set("/project/notes.md");

    await act(async () => {
      root.render(
        <FileTreeKeyboard activePath="/project/notes.md" onFocusEditor={() => {}}>
          <ActiveFileProvider value={activeFileStore}>
            <FolderTree
              path="/project"
              entries={[{
                name: "notes.md",
                path: "/project/notes.md",
                is_directory: false,
                children: null,
              }]}
              error={null}
              onRefreshFolder={() => {}}
              activeDropFolder={null}
              onFileSelect={() => {}}
              onRemoveFolder={() => {}}
              onFileRenamed={() => {}}
              onFileDeleted={() => {}}
              newlyCreatedFile={null}
              onNewFileRenamed={() => {}}
              newlyCreatedFolder={null}
              onNewFolderRenamed={() => {}}
              defaultOpen={false}
            />
          </ActiveFileProvider>
        </FileTreeKeyboard>,
      );
      await Promise.resolve();
    });

    const projectRoot = host.querySelector('[data-root-folder="/project"]');
    expect(projectRoot?.querySelector("[data-root-active-collapsed]")).not.toBeNull();
    expect(projectRoot?.querySelector("[data-folder-active]")).toBeNull();
    expect(host.querySelector("[data-file-active]")).toBeNull();
  });
});
