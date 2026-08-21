// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => ({
    matches: [],
    total_matches: 0,
    files_searched: 0,
  })),
}));

import {
  CommandPalette,
  type PaletteCommand,
} from "../src/components/command-palette/command-palette";

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

async function renderPalette({
  mode = "files" as const,
  commands = [] as PaletteCommand[],
  onFileSelect = vi.fn(),
} = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push({ root, host });
  const onClose = vi.fn();

  await act(async () => {
    root.render(
      <CommandPalette
        open
        initialMode={mode}
        onClose={onClose}
        allFiles={[
          { name: "alpha.md", path: "/project/alpha.md", folderDisplay: "project" },
          { name: "beta.md", path: "/project/beta.md", folderDisplay: "project" },
        ]}
        recentFiles={["/project/alpha.md", "/project/beta.md"]}
        onFileSelect={onFileSelect}
        folders={["/project"]}
        extensions={["md"]}
        commands={commands}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

  const input = document.querySelector('[role="combobox"]') as HTMLInputElement;
  return { input, onClose, onFileSelect };
}

async function press(target: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...options }));
    await Promise.resolve();
  });
}

async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

describe("CommandPalette keyboard modes", () => {
  it("opens recent files with accessible arrow and Return navigation", async () => {
    const { input, onClose, onFileSelect } = await renderPalette();

    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Go to file");
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(2);
    expect(document.activeElement).toBe(input);

    await press(input, "ArrowDown");
    await press(input, "Enter");
    expect(onFileSelect).toHaveBeenCalledWith("/project/beta.md");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("cycles quick-open results when Cmd-P is pressed repeatedly", async () => {
    const { input, onFileSelect } = await renderPalette();

    await press(input, "p", { metaKey: true });
    expect(input.getAttribute("aria-activedescendant")).toBe("ghost-command-result-1");

    await press(input, "Enter");
    expect(onFileSelect).toHaveBeenCalledWith("/project/beta.md");
  });

  it("keeps Quick Open mounted until the selected file finishes opening", async () => {
    const opening = Promise.withResolvers<boolean>();
    const onFileSelect = vi.fn(() => opening.promise);
    const rendered = await renderPalette({ onFileSelect });

    await press(rendered.input, "Enter");
    expect(rendered.onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    await act(async () => {
      opening.resolve(true);
      await opening.promise;
      await Promise.resolve();
    });
    expect(rendered.onClose).toHaveBeenCalledWith("selection");
  });

  it("filters and runs contextual commands entirely from the keyboard", async () => {
    const runRename = vi.fn();
    const runSearch = vi.fn();
    const commands: PaletteCommand[] = [
      { id: "rename", title: "Rename Focused Tree Item", shortcut: "F2", run: runRename },
      { id: "search", title: "Search File Contents", shortcut: "⇧⌘F", run: runSearch },
    ];
    const { input, onClose } = await renderPalette({ mode: "commands", commands });

    expect(input.placeholder).toBe("Search commands...");
    await type(input, "rename");
    expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
    expect(document.body.textContent).toContain("Rename Focused Tree Item");

    await press(input, "Enter");
    expect(runRename).toHaveBeenCalledTimes(1);
    expect(runSearch).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("can switch palette modes without closing the palette", async () => {
    const switchMode = vi.fn();
    const command: PaletteCommand = {
      id: "files",
      title: "Go to File",
      closeOnRun: false,
      run: switchMode,
    };
    const { input, onClose } = await renderPalette({ mode: "commands", commands: [command] });

    await press(input, "Enter");
    expect(switchMode).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("starts direct content-search mode without requiring the hash prefix", async () => {
    const { input } = await renderPalette({ mode: "content" });
    expect(input.placeholder).toBe("Search file contents...");
    expect(document.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toBe("Search file contents");

    await type(input, "salt");
    expect(input.value).toBe("salt");
  });
});
