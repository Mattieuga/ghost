// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Book } from "epubjs";
import { applyEpubTheme, destroyEpubBook, EPUB_CONTENT_CSP, flattenEpubContents, isEpubLink, prepareEpubDocument, readEpubBookmark, saveEpubBookmark } from "../src/lib/epub";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.documentElement.removeAttribute("style"); });

describe("EPUB chapter isolation", () => {
  it("removes active content before rendering and restricts resources to the book", () => {
    const doc = new DOMParser().parseFromString(`<html><head><base href="https://tracker.invalid/"/><meta http-equiv="refresh" content="0;url=https://tracker.invalid/"/></head><body onload="alert(1)">
      <script>parent.alert(1)</script><iframe></iframe><form action="https://tracker.invalid/"><input/></form>
      <a href="javascript:alert(1)">bad</a><a href="https://tracker.invalid/">remote</a><a href="two.xhtml#note" target="_top" ping="https://tracker.invalid/">chapter</a>
      <img src="../Images/moon.svg" onerror="alert(1)"/><svg><a xlink:href="javascript:alert(1)">bad SVG</a><animate attributeName="href" values="https://tracker.invalid/"/></svg><math href="/app.html"/>
    </body></html>`, "text/html");
    prepareEpubDocument(doc, { url: "/OPS/Text/one.xhtml" });
    expect(doc.querySelector("script, iframe, form, input, animate, math[href], [onload], [onerror], [target], [ping]")).toBeNull();
    expect(doc.querySelector("meta")?.getAttribute("content")).toBe(EPUB_CONTENT_CSP);
    expect(doc.querySelector("a[href]")).toBeNull();
    expect(doc.querySelector('[role="link"]')?.getAttribute("tabindex")).toBe("0");
    expect(doc.querySelector("a[data-ghost-epub-href]")?.getAttribute("data-ghost-epub-href")).toBe("two.xhtml#note");
    expect(doc.querySelector("img")?.getAttribute("src")).toBe("../Images/moon.svg");
    expect(doc.querySelector("base")?.getAttribute("href")).not.toContain("tracker.invalid");
  });

  it.each(["javascript:alert(1)", "java\nscript:alert(1)", "data:text/html,bad", "//tracker.invalid", "https://tracker.invalid", "file:///etc/passwd", "mailto:a@b.c"])("blocks external or executable link %s", href => {
    expect(isEpubLink(href)).toBe(false);
  });

  it("keeps nested chapter targets and anchors", () => {
    expect(flattenEpubContents([{ id: "1", label: " Part one ", href: "one.xhtml", subitems: [{ id: "2", label: "A note", href: "one.xhtml#note" }] }])).toEqual([
      { href: "one.xhtml", label: "Part one" }, { href: "one.xhtml#note", label: "  A note" },
    ]);
  });

  it("resolves contents stored in a different folder from the package", () => {
    expect(flattenEpubContents([{ id: "one", label: "Chapter", href: "../Text/one.xhtml#note" }], "Navigation/toc.xhtml"))
      .toEqual([{ href: "Text/one.xhtml#note", label: "Chapter" }]);
  });

  it.each([["#eeeeee", "#111111"], ["#222222", "#fafafa"]])("pairs text %s with background %s, overriding publisher colors", (foreground, background) => {
    document.documentElement.style.setProperty("--foreground", foreground);
    document.documentElement.style.setProperty("--background", background);
    const doc = new DOMParser().parseFromString('<html><head></head><body><p style="color:red!important;background:white!important">Text</p><svg xmlns="http://www.w3.org/2000/svg"><path fill="blue"/></svg></body></html>', "text/html");
    applyEpubTheme(doc);
    expect(doc.querySelector("p")?.style.color).toBe(doc.body.style.color);
    expect(doc.body.style.backgroundColor).not.toBe("transparent");
    expect(doc.querySelector("p")?.style.backgroundColor).toBe("transparent");
    expect(doc.querySelector("p")?.style.getPropertyPriority("color")).toBe("important");
    expect(doc.querySelector("svg path")?.getAttribute("fill")).toBe("blue");
  });
});

describe("EPUB local reading state", () => {
  it("remembers a file's position and size without sharing them with another book", () => {
    saveEpubBookmark("/one.epub", { cfi: "epubcfi(/6/2)", href: "one.xhtml", fontSize: 120 });
    expect(readEpubBookmark("/one.epub")).toEqual({ cfi: "epubcfi(/6/2)", href: "one.xhtml", fontSize: 120 });
    expect(readEpubBookmark("/two.epub")).toEqual({ cfi: undefined, href: undefined, fontSize: 100 });
  });

  it("recovers from malformed or unavailable storage", () => {
    window.localStorage.setItem("ghost:epub:/bad.epub", "bad json");
    expect(readEpubBookmark("/bad.epub")).toEqual({ fontSize: 100 });
    vi.mocked(window.localStorage.setItem).mockImplementation(() => { throw new Error("full"); });
    expect(() => saveEpubBookmark("/one.epub", { fontSize: 100 })).not.toThrow();
  });

  it("revokes both archived images and rewritten stylesheets", () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const book = { archive: { urlCache: { "/image.png": "blob:image" } }, resources: { replacementUrls: ["blob:image", "blob:style"] }, destroy: vi.fn() };
    destroyEpubBook(book as unknown as Book);
    expect(book.destroy).toHaveBeenCalledOnce();
    expect(revoke.mock.calls).toEqual([["blob:image"], ["blob:style"]]);
  });
});
