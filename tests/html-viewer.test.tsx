// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost${path}`),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
  convertFileSrc: mocks.convertFileSrc,
}));

vi.mock("../src/components/editor/code-editor", () => ({
  CodeEditor: () => <div data-code-editor>Source editor</div>,
}));

import { HtmlViewer } from "../src/components/viewer/html-viewer";

const mounted: Array<ReturnType<typeof createRoot>> = [];

beforeEach(() => {
  mocks.invoke.mockReset().mockResolvedValue("/project/site");
  mocks.convertFileSrc.mockClear();
});

afterEach(() => {
  while (mounted.length) act(() => mounted.pop()?.unmount());
  document.body.replaceChildren();
});

function props(searchTerm = "") {
  return {
    filePath: "/project/site/index.html",
    content: "<!doctype html><html><head></head><body><img src=\"images/logo.png\"></body></html>",
    onSourceChange: vi.fn().mockResolvedValue(undefined),
    searchTerm,
  };
}

describe("HtmlViewer", () => {
  it("defaults to editable source and renders a sandboxed preview on request", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mounted.push(root);

    await act(async () => root.render(<HtmlViewer {...props()} />));
    expect(host.querySelector("[data-code-editor]")).not.toBeNull();
    expect(mocks.invoke).toHaveBeenCalledWith("prepare_html_preview", {
      path: "/project/site/index.html",
    });

    const preview = [...host.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Preview"));
    if (!preview) throw new Error("preview button should render");
    await act(async () => preview.click());

    const frame = host.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame?.getAttribute("srcdoc")).toContain(
      '<base href="asset://localhost/project/site/">',
    );
    expect(frame?.hasAttribute("data-viewer-focus-target")).toBe(true);
    expect(host.textContent).toContain("scripts and navigation disabled");
  });

  it("returns to source mode when document search opens", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    mounted.push(root);

    await act(async () => root.render(<HtmlViewer {...props()} />));
    const preview = [...host.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("Preview"));
    if (!preview) throw new Error("preview button should render");
    await act(async () => preview.click());
    expect(host.querySelector("iframe")).not.toBeNull();

    await act(async () => root.render(<HtmlViewer {...props("logo")} />));
    expect(host.querySelector("[data-code-editor]")).not.toBeNull();
    expect(host.querySelector("iframe")).toBeNull();
  });
});
