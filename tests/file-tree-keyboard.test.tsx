// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FileTreeKeyboard,
  useFileTreeNode,
  type FileTreeKeyboardHandle,
} from "../src/components/sidebar/file-tree-keyboard";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HTMLElement.prototype.scrollIntoView = vi.fn();

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];

afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop();
    act(() => item?.root.unmount());
    item?.host.remove();
  }
});

interface HarnessActions {
  activate: ReturnType<typeof vi.fn>;
  preview: ReturnType<typeof vi.fn>;
  openNewWindow: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
  duplicate: ReturnType<typeof vi.fn>;
  trash: ReturnType<typeof vi.fn>;
}

function TestFile({
  path,
  projectPath = "/project",
  label,
  actions,
}: {
  path: string;
  projectPath?: string;
  label: string;
  actions: HarnessActions;
}) {
  const { nodeProps, isFocused, restoreTreeFocus } = useFileTreeNode({
    path,
    projectPath,
    label,
    kind: "file",
    parentPath: path.substring(0, path.lastIndexOf("/")),
    actions,
  });

  return (
    <div {...nodeProps} data-label={label} data-focused={isFocused || undefined}>
      <button
        data-tree-focus-target
        tabIndex={-1}
        onClick={() => {
          actions.activate();
          requestAnimationFrame(restoreTreeFocus);
        }}
      >
        {label}
      </button>
    </div>
  );
}

function TreeHarness({
  controllerRef,
  actions,
  focusEditor,
  initiallyOpen = true,
}: {
  controllerRef: React.RefObject<FileTreeKeyboardHandle | null>;
  actions: HarnessActions;
  focusEditor: () => void;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const folderNode = useFileTreeNode({
    path: "/project",
    projectPath: "/project",
    label: "Project",
    kind: "folder",
    parentPath: null,
    expanded: open,
    expand: () => setOpen(true),
    collapse: () => setOpen(false),
    actions: { activate: () => setOpen((value) => !value) },
  });

  return (
    <div {...folderNode.nodeProps} data-label="Project">
      <span data-tree-focus-target>Project</span>
      {open && (
        <div role="group">
          <TestFile path="/project/alpha.md" label="Alpha" actions={actions} />
          <TestFile path="/project/beta.md" label="Beta" actions={actions} />
        </div>
      )}
    </div>
  );
}

function SecondProject({ actions }: { actions: HarnessActions }) {
  const folderNode = useFileTreeNode({
    path: "/other",
    projectPath: "/other",
    label: "Other",
    kind: "folder",
    parentPath: null,
    expanded: true,
    actions: {},
  });

  return (
    <div {...folderNode.nodeProps} data-label="Other">
      <span data-tree-focus-target>Other</span>
      <div role="group">
        <TestFile path="/other/gamma.md" projectPath="/other" label="Gamma" actions={actions} />
      </div>
    </div>
  );
}

function OverlappingProjects({ actions }: { actions: HarnessActions }) {
  const outerRoot = useFileTreeNode({
    path: "/project",
    projectPath: "/project",
    label: "Outer Root",
    kind: "folder",
    parentPath: null,
    expanded: true,
    actions: {},
  });
  const outerNested = useFileTreeNode({
    path: "/project/nested",
    projectPath: "/project",
    label: "Outer Nested",
    kind: "folder",
    parentPath: "/project",
    expanded: true,
    actions: {},
  });
  const innerRoot = useFileTreeNode({
    path: "/project/nested",
    projectPath: "/project/nested",
    label: "Inner Root",
    kind: "folder",
    parentPath: null,
    expanded: true,
    actions: {},
  });

  return (
    <>
      <div {...outerRoot.nodeProps} data-label="Outer Root">
        <span data-tree-focus-target>Outer Root</span>
        <div role="group">
          <div {...outerNested.nodeProps} data-label="Outer Nested">
            <span data-tree-focus-target>Outer Nested</span>
            <div role="group">
              <TestFile
                path="/project/nested/shared.md"
                projectPath="/project"
                label="Outer Shared"
                actions={actions}
              />
            </div>
          </div>
        </div>
      </div>
      <div {...innerRoot.nodeProps} data-label="Inner Root">
        <span data-tree-focus-target>Inner Root</span>
        <div role="group">
          <TestFile
            path="/project/nested/shared.md"
            projectPath="/project/nested"
            label="Inner Shared"
            actions={actions}
          />
        </div>
      </div>
    </>
  );
}

async function renderTree(initiallyOpen = true, includeSecondProject = false) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  const controllerRef = { current: null } as React.RefObject<FileTreeKeyboardHandle | null>;
  const focusEditor = vi.fn();
  const actions: HarnessActions = {
    activate: vi.fn(),
    preview: vi.fn(),
    openNewWindow: vi.fn(),
    rename: vi.fn(),
    duplicate: vi.fn(),
    trash: vi.fn(),
  };

  await act(async () => {
    root.render(
      <FileTreeKeyboard
        ref={controllerRef}
        activePath="/project/beta.md"
        onFocusEditor={focusEditor}
      >
        <TreeHarness
          controllerRef={controllerRef}
          actions={actions}
          focusEditor={focusEditor}
          initiallyOpen={initiallyOpen}
        />
        {includeSecondProject && <SecondProject actions={actions} />}
      </FileTreeKeyboard>,
    );
    await Promise.resolve();
  });

  return {
    host,
    tree: host.querySelector('[role="tree"]') as HTMLDivElement,
    controllerRef,
    actions,
    focusEditor,
  };
}

async function press(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));
    await Promise.resolve();
  });
}

describe("FileTreeKeyboard", () => {
  it("reveals and focuses the active file through collapsed ancestors", async () => {
    const { controllerRef, tree, host } = await renderTree(false);

    await act(async () => {
      await controllerRef.current?.focusActive();
    });

    const beta = host.querySelector('[data-label="Beta"]');
    expect(beta).not.toBeNull();
    expect(beta?.getAttribute("data-focused")).toBe("true");
    expect(tree.getAttribute("aria-activedescendant")).toContain("beta.md");
    expect(document.activeElement).toBe(tree);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
  });

  it("reveals palette selections without stealing focus from the editor", async () => {
    const { controllerRef, tree, host } = await renderTree(false);
    const editor = document.createElement("button");
    host.appendChild(editor);
    editor.focus();

    await act(async () => {
      await controllerRef.current?.revealPath("/project/beta.md");
    });

    expect(host.querySelector('[data-label="Beta"]')).not.toBeNull();
    expect(document.activeElement).toBe(editor);
    expect(document.activeElement).not.toBe(tree);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: "center" });
  });

  it("does not scroll when focusing an active row that is already visible", async () => {
    const { controllerRef, tree, host } = await renderTree();
    const betaRow = host.querySelector('[data-label="Beta"] [data-tree-focus-target]') as HTMLElement;
    vi.spyOn(tree, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 300,
      height: 300,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(betaRow, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 130,
      height: 30,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();

    await act(async () => { await controllerRef.current?.focusActive(); });

    expect(document.activeElement).toBe(tree);
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("clears the visual focus ring outside the tree and does not jump on the next click", async () => {
    const { controllerRef, tree, host } = await renderTree();
    await act(async () => { await controllerRef.current?.focusPath("/project/alpha.md"); });

    const alpha = host.querySelector('[data-label="Alpha"]');
    expect(alpha?.getAttribute("data-focused")).toBe("true");

    const externalViewerButton = document.createElement("button");
    host.appendChild(externalViewerButton);
    await act(async () => { externalViewerButton.focus(); });
    expect(alpha?.getAttribute("data-focused")).toBeNull();
    expect(tree.getAttribute("aria-activedescendant")).toContain("alpha.md");

    vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();
    const betaButton = host.querySelector('[data-label="Beta"] [data-tree-focus-target]') as HTMLButtonElement;
    await act(async () => {
      betaButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      // WebKit focuses a button after mousedown. Both events must remain on
      // the child instead of bubbling selection into its parent treeitem.
      betaButton.focus();
    });
    expect(tree.getAttribute("aria-activedescendant")).toContain("beta.md");
    expect(host.querySelector('[data-label="Project"]')?.getAttribute("data-tree-focused")).toBeNull();

    await act(async () => {
      betaButton.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });

    expect(host.querySelector('[data-label="Beta"]')?.getAttribute("data-focused")).toBe("true");
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("uses standard tree arrows, Home, End, and type-ahead", async () => {
    const { controllerRef, tree, host } = await renderTree();
    await act(async () => { await controllerRef.current?.focusPath("/project/alpha.md"); });

    await press(tree, "ArrowDown");
    expect(host.querySelector('[data-label="Beta"]')?.getAttribute("data-focused")).toBe("true");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });

    await press(tree, "Home");
    expect(host.querySelector('[data-label="Project"]')?.getAttribute("data-tree-focused")).toBe("true");

    await press(tree, "End");
    expect(host.querySelector('[data-label="Beta"]')?.getAttribute("data-focused")).toBe("true");

    await press(tree, "a");
    expect(host.querySelector('[data-label="Alpha"]')?.getAttribute("data-focused")).toBe("true");

    await press(tree, "ArrowLeft");
    expect(host.querySelector('[data-label="Project"]')?.getAttribute("data-tree-focused")).toBe("true");
    await press(tree, "ArrowLeft");
    expect(host.querySelector('[data-label="Alpha"]')).toBeNull();
    expect(host.querySelector('[data-label="Project"]')?.getAttribute("aria-expanded")).toBe("false");
  });

  it("supports Command boundaries and Option viewport jumps", async () => {
    const { controllerRef, tree, host } = await renderTree(true, true);
    await act(async () => { await controllerRef.current?.focusPath("/project/alpha.md"); });

    await press(tree, "ArrowDown", { metaKey: true });
    expect(host.querySelector('[data-label="Beta"]')?.getAttribute("data-focused")).toBe("true");

    await act(async () => { await controllerRef.current?.focusPath("/project/alpha.md"); });
    await press(tree, "ArrowUp", { metaKey: true });
    expect(host.querySelector('[data-label="Project"]')?.getAttribute("data-tree-focused")).toBe("true");

    await press(tree, "ArrowDown", { metaKey: true });
    expect(host.querySelector('[data-label="Gamma"]')?.getAttribute("data-focused")).toBe("true");

    await act(async () => { await controllerRef.current?.focusPath("/other/gamma.md"); });
    await press(tree, "ArrowUp", { metaKey: true });
    expect(host.querySelector('[data-label="Other"]')?.getAttribute("data-tree-focused")).toBe("true");

    await press(tree, "ArrowUp", { metaKey: true });
    expect(host.querySelector('[data-label="Project"]')?.getAttribute("data-tree-focused")).toBe("true");

    await act(async () => { await controllerRef.current?.focusPath("/project"); });
    await press(tree, "ArrowDown", { altKey: true });
    expect(host.querySelector('[data-label="Gamma"]')?.getAttribute("data-focused")).toBe("true");

    await press(tree, "ArrowUp", { altKey: true });
    expect(host.querySelector('[data-label="Project"]')?.getAttribute("data-tree-focused")).toBe("true");
  });

  it("previews with Space, opens with Return, and exposes file actions", async () => {
    const { controllerRef, tree, actions, focusEditor } = await renderTree();
    await act(async () => { await controllerRef.current?.focusPath("/project/alpha.md"); });

    await press(tree, " ");
    expect(actions.preview).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(tree);

    await press(tree, "F2");
    await press(tree, "d", { metaKey: true });
    await press(tree, "Backspace", { metaKey: true });
    await press(tree, "Enter", { metaKey: true });
    expect(actions.rename).toHaveBeenCalledTimes(1);
    expect(actions.duplicate).toHaveBeenCalledTimes(1);
    expect(actions.trash).toHaveBeenCalledTimes(1);
    expect(actions.openNewWindow).toHaveBeenCalledTimes(1);

    await press(tree, "Enter");
    expect(actions.activate).toHaveBeenCalledTimes(1);
    expect(focusEditor).toHaveBeenCalledTimes(1);
    expect(focusEditor).toHaveBeenCalledWith("start");
  });

  it("waits for keyboard activation to finish before focusing the editor", async () => {
    const { controllerRef, tree, actions, focusEditor } = await renderTree();
    await act(async () => { await controllerRef.current?.focusPath("/project/alpha.md"); });

    let finishActivation: ((opened: boolean) => void) | undefined;
    actions.activate.mockImplementation(() => new Promise<boolean>((resolve) => {
      finishActivation = resolve;
    }));

    await press(tree, "Enter");
    expect(focusEditor).not.toHaveBeenCalled();

    await act(async () => {
      finishActivation?.(true);
      await Promise.resolve();
    });
    expect(focusEditor).toHaveBeenCalledTimes(1);
    expect(focusEditor).toHaveBeenCalledWith("start");
  });

  it("keeps focus in the tree when keyboard activation fails", async () => {
    const { controllerRef, tree, actions, focusEditor } = await renderTree();
    await act(async () => { await controllerRef.current?.focusPath("/project/alpha.md"); });
    actions.activate.mockResolvedValue(false);

    await press(tree, "Enter");

    expect(focusEditor).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(tree);
  });

  it("toggles folders with Space without leaving the tree", async () => {
    const { controllerRef, tree, host } = await renderTree();
    await act(async () => { await controllerRef.current?.focusPath("/project"); });

    await press(tree, " ");
    expect(host.querySelector('[data-label="Project"]')?.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(tree);

    await press(tree, " ");
    expect(host.querySelector('[data-label="Project"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(tree);
  });

  it("uses one tree tab stop with accessible treeitem state", async () => {
    const { tree, host } = await renderTree();

    expect(tree.tabIndex).toBe(0);
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(3);
    expect(host.querySelector('[data-label="Project"]')?.getAttribute("aria-expanded")).toBe("true");
    expect(Array.from(host.querySelectorAll('[role="treeitem"]')).every((node) => (node as HTMLElement).tabIndex === -1)).toBe(true);
  });

  it("keeps overlapping project occurrences distinct and scopes Command boundaries", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    const controllerRef = { current: null } as React.RefObject<FileTreeKeyboardHandle | null>;
    const actions: HarnessActions = {
      activate: vi.fn(),
      preview: vi.fn(),
      openNewWindow: vi.fn(),
      rename: vi.fn(),
      duplicate: vi.fn(),
      trash: vi.fn(),
    };

    await act(async () => {
      root.render(
        <FileTreeKeyboard
          ref={controllerRef}
          activePath="/project/nested/shared.md"
          onFocusEditor={vi.fn()}
        >
          <OverlappingProjects actions={actions} />
        </FileTreeKeyboard>,
      );
      await Promise.resolve();
    });

    const duplicateOccurrences = host.querySelectorAll('[data-tree-path="/project/nested/shared.md"]');
    expect(duplicateOccurrences).toHaveLength(2);
    expect(duplicateOccurrences[0].id).not.toBe(duplicateOccurrences[1].id);

    const tree = host.querySelector('[role="tree"]') as HTMLDivElement;
    await act(async () => { tree.focus(); });
    expect(host.querySelector('[data-label="Inner Shared"]')?.getAttribute("data-focused")).toBe("true");

    await act(async () => {
      await controllerRef.current?.focusPath("/project/nested/shared.md", "/project/nested");
    });
    expect(host.querySelector('[data-label="Inner Shared"]')?.getAttribute("data-focused")).toBe("true");

    await press(tree, "ArrowUp", { metaKey: true });
    expect(host.querySelector('[data-label="Inner Root"]')?.getAttribute("data-tree-focused")).toBe("true");

    await act(async () => {
      await controllerRef.current?.focusPath("/project/nested/shared.md", "/project");
    });
    await press(tree, "ArrowUp", { metaKey: true });
    expect(host.querySelector('[data-label="Outer Root"]')?.getAttribute("data-tree-focused")).toBe("true");
  });
});
