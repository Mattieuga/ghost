// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));

vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({
  writeHtml: vi.fn(async () => undefined),
  writeText: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(async () => null),
}));

import { MarkdownEditor } from "../src/components/editor/markdown-editor";

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = TestResizeObserver as typeof ResizeObserver;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: Array<{ root: ReturnType<typeof createRoot>; host: HTMLDivElement }> = [];

afterEach(() => {
  while (mounted.length) {
    const item = mounted.pop();
    act(() => item?.root.unmount());
    item?.host.remove();
  }
});

describe("MarkdownEditor React integration", () => {
  it("opens a frontmatter document with menus and toolbar without a render loop", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    const onContentChange = vi.fn();

    await act(async () => {
      root.render(
        <MarkdownEditor
          content={"---\ntitle: Chili\n---\n\n# Recipe"}
          onContentChange={onContentChange}
          activeFile="/tmp/recipe.md"
          showStyleBar
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(host.querySelector(".ghost-frontmatter-header")?.textContent).toContain("Frontmatter");
    expect(host.querySelector(".ghost-editor")?.textContent).toContain("Recipe");
    expect(host.querySelector(".floating-toolbar")).not.toBeNull();
    expect(onContentChange).not.toHaveBeenCalled();
  });
});
