// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";

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

    await act(async () => {
      (host.querySelector(".ghost-frontmatter-header") as HTMLButtonElement).click();
    });

    const yamlEditor = host.querySelector(
      'textarea[aria-label="YAML frontmatter content"]',
    ) as HTMLTextAreaElement;
    expect(yamlEditor.value).toBe("title: Chili");
    expect(host.querySelectorAll(".ghost-frontmatter-delimiter")[0]?.textContent).toBe("---");
    expect(host.querySelectorAll(".ghost-frontmatter-delimiter")[1]?.textContent).toBe("---");

    await act(async () => {
      yamlEditor.focus();
      yamlEditor.setSelectionRange(5, 5);
      const setTextareaValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setTextareaValue?.call(yamlEditor, "titleX: Chili");
      yamlEditor.setSelectionRange(6, 6);
      yamlEditor.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const updatedYamlEditor = host.querySelector(
      'textarea[aria-label="YAML frontmatter content"]',
    ) as HTMLTextAreaElement;
    expect(updatedYamlEditor.value).toBe("titleX: Chili");
    expect(document.activeElement).toBe(updatedYamlEditor);
    expect(updatedYamlEditor.selectionStart).toBe(6);
    expect(updatedYamlEditor.selectionEnd).toBe(6);
  });

  it("flushes a pending edit when the editor unmounts before the debounce", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    const onContentChange = vi.fn(async () => undefined);
    let editor: Editor | null = null;

    await act(async () => {
      root.render(
        <MarkdownEditor
          content="# Before"
          onContentChange={onContentChange}
          activeFile="/tmp/pending.md"
          onEditorReady={(readyEditor) => {
            editor = readyEditor;
          }}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(editor).not.toBeNull();
    act(() => {
      (editor as Editor).commands.insertContentAt((editor as Editor).state.doc.content.size, " After");
    });
    expect(onContentChange).not.toHaveBeenCalled();

    mounted.pop();
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    host.remove();

    expect(onContentChange).toHaveBeenCalledTimes(1);
    expect(onContentChange.mock.calls[0][0]).toContain("After");
  });
});
