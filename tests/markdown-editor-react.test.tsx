// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

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
import { applyContentInPlace } from "../src/lib/editor-utils";

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
  it("uses the same editor chrome and extension surface for collaborative documents", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    const yDocument = new Y.Doc();
    const awareness = new Awareness(yDocument);
    awareness.setLocalStateField("user", { name: "Alice", color: "#ff7145" });
    const onContentChange = vi.fn();
    let editor: Editor | null = null;

    await act(async () => {
      root.render(
        <main data-editor-scroll-container>
          <MarkdownEditor
            collaboration={{
              document: yDocument,
              provider: { awareness },
              user: { name: "Alice", color: "#ff7145" },
            }}
            onContentChange={onContentChange}
            showStyleBar
            onEditorReady={(readyEditor) => { editor = readyEditor; }}
          />
        </main>,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(editor).not.toBeNull();
    expect(host.querySelector(".floating-toolbar")).not.toBeNull();
    act(() => {
      (editor as Editor).commands.setContent("# Shared heading", { contentType: "markdown" });
    });
    expect(host.querySelector(".ghost-editor h1")?.textContent).toContain("Shared heading");
    expect(onContentChange).not.toHaveBeenCalled();
    expect(Y.encodeStateAsUpdate(yDocument).length).toBeGreaterThan(2);
  });

  it("moves to the start of the document with Cmd+ArrowUp", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    let editor: Editor | null = null;

    await act(async () => {
      root.render(
        <main data-editor-scroll-container>
          <MarkdownEditor
            content={"First paragraph\n\nSecond paragraph"}
            onContentChange={vi.fn()}
            activeFile="/tmp/navigation.md"
            onEditorReady={(readyEditor) => { editor = readyEditor; }}
          />
        </main>,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(editor).not.toBeNull();
    const viewport = host.querySelector("[data-editor-scroll-container]") as HTMLElement;
    let start = 0;
    await act(async () => {
      (editor as Editor).commands.focus("start");
      start = (editor as Editor).state.selection.from;
      (editor as Editor).commands.focus("end");
      expect((editor as Editor).state.selection.from).toBeGreaterThan(start);
      viewport.scrollTop = 240;
      (editor as Editor).view.dom.dispatchEvent(new KeyboardEvent("keydown", {
        key: "ArrowUp",
        code: "ArrowUp",
        metaKey: true,
        bubbles: true,
      }));
    });

    expect((editor as Editor).state.selection.from).toBe(start);
    expect(viewport.scrollTop).toBe(0);
  });

  it("does not serialize or save a clean document when explicitly flushed", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    const onContentChange = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <MarkdownEditor
          content={"Salt & pepper\n\n[unclear: x]"}
          onContentChange={onContentChange}
          activeFile="/tmp/clean.md"
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(window.__ghostFlushSave).toBeTypeOf("function");
    await act(async () => {
      await window.__ghostFlushSave?.();
    });

    expect(onContentChange).not.toHaveBeenCalled();
  });

  it("keeps externally reloaded clean content clean instead of writing it back", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    const onContentChange = vi.fn(async () => undefined);
    let editor: Editor | null = null;

    await act(async () => {
      root.render(
        <MarkdownEditor
          content="Before"
          onContentChange={onContentChange}
          activeFile="/tmp/external.md"
          onEditorReady={(readyEditor) => { editor = readyEditor; }}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const applied = applyContentInPlace(
      { current: editor },
      { current: null },
      { current: null },
      "Salt & pepper\n\n[unclear: x]",
    );
    expect(applied).toBe(true);

    await act(async () => {
      await window.__ghostFlushSave?.();
    });
    expect(onContentChange).not.toHaveBeenCalled();
  });

  it("does not replace a dirty buffer with an external reload", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    const onContentChange = vi.fn(async () => undefined);
    let editor: Editor | null = null;

    await act(async () => {
      root.render(
        <MarkdownEditor
          content="Before"
          onContentChange={onContentChange}
          activeFile="/tmp/dirty.md"
          onEditorReady={(readyEditor) => { editor = readyEditor; }}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    act(() => {
      (editor as Editor).commands.insertContentAt(
        (editor as Editor).state.doc.content.size,
        " locally edited",
      );
    });
    const applied = applyContentInPlace(
      { current: editor },
      { current: null },
      { current: null },
      "Externally repaired",
    );

    expect(applied).toBe(false);
    expect((editor as Editor).getText()).toContain("locally edited");
  });

  it("saves edited recipe prose without adding entities or unnecessary escapes", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    const onContentChange = vi.fn(async () => undefined);
    let editor: Editor | null = null;

    await act(async () => {
      root.render(
        <MarkdownEditor
          content={"Salt & pepper\n\n[unclear: x]\n\n~1/4 cup"}
          onContentChange={onContentChange}
          activeFile="/tmp/recipe.md"
          onEditorReady={(readyEditor) => { editor = readyEditor; }}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    act(() => {
      (editor as Editor).commands.insertContentAt(
        (editor as Editor).state.doc.content.size - 1,
        "!",
      );
    });
    await act(async () => {
      await window.__ghostFlushSave?.();
    });

    expect(onContentChange).toHaveBeenCalledTimes(1);
    expect(onContentChange.mock.calls[0][0]).toBe(
      "Salt & pepper\n\n[unclear: x]\n\n~1/4 cup!",
    );

    await act(async () => {
      await window.__ghostFlushSave?.();
    });
    expect(onContentChange).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed edit dirty so a later flush can retry it", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push({ root, host });
    const onContentChange = vi.fn()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValueOnce(undefined);
    let editor: Editor | null = null;

    await act(async () => {
      root.render(
        <MarkdownEditor
          content="Before"
          onContentChange={onContentChange}
          activeFile="/tmp/retry.md"
          onEditorReady={(readyEditor) => { editor = readyEditor; }}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    act(() => {
      (editor as Editor).commands.insertContentAt(
        (editor as Editor).state.doc.content.size - 1,
        " after",
      );
    });

    await expect(window.__ghostFlushSave?.()).rejects.toThrow("disk unavailable");
    await act(async () => {
      await window.__ghostFlushSave?.();
    });

    expect(onContentChange).toHaveBeenCalledTimes(2);
    expect(onContentChange.mock.calls[1][0]).toBe("Before after");
  });

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
