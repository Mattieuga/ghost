// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), createBook: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../src/hooks/use-media-asset", () => ({
  useMediaAsset: () => ({ sourceUrl: "asset:book", error: null, loading: false }),
}));
vi.mock("epubjs", () => ({ Book: class { constructor() { return mocks.createBook(); } } }));
import { EpubViewer } from "../src/components/viewer/epub-viewer";

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
beforeEach(() => {
  mocks.invoke.mockReset();
  mocks.createBook.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("EPUB loading lifecycle", () => {
  it("offers external opening when native validation rejects a book", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("This EPUB has protected resources"));
    await act(async () => root.render(<EpubViewer filePath="/books/protected.epub" />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("protected resources");
    expect(mocks.createBook).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValueOnce(undefined);
    const external = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Open Externally"));
    await act(async () => external!.click());
    expect(mocks.invoke).toHaveBeenLastCalledWith("open_with_default_app", { path: "/books/protected.epub" });
  });

  it("does not create a book when a late native read finishes after leaving", async () => {
    let resolve!: (bytes: ArrayBuffer) => void;
    mocks.invoke.mockReturnValue(new Promise<ArrayBuffer>(done => { resolve = done; }));
    await act(async () => root.render(<EpubViewer filePath="/books/slow.epub" />));
    await act(async () => root.render(null));
    await act(async () => resolve(new ArrayBuffer(4)));
    expect(mocks.createBook).not.toHaveBeenCalled();
    expect(host.childElementCount).toBe(0);
  });

  it("cleans up a malformed book and reports its loading failure", async () => {
    const book = {
      spine: { hooks: { content: { register: vi.fn() } } },
      loadNavigation: vi.fn(),
      open: vi.fn().mockRejectedValue(new Error("Invalid EPUB package")),
      destroy: vi.fn(),
    };
    mocks.createBook.mockReturnValue(book);
    mocks.invoke.mockResolvedValue(new ArrayBuffer(4));
    await act(async () => root.render(<EpubViewer filePath="/books/broken.epub" />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Invalid EPUB package");
    expect(book.destroy).toHaveBeenCalledOnce();
    expect(host.querySelector("select")?.disabled).toBe(true);
  });
});
