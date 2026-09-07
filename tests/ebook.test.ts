// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { prepareBookDocument } from "../src/lib/book-document";
import { isEbookLink, readEbookBookmark, saveEbookBookmark, loadEbook } from "../src/lib/ebook";
import { comicPages, readComicBookmark, saveComicBookmark } from "../src/lib/comic";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

describe("additional books", () => {
  it("keeps only known in-book targets and packaged resources", () => {
    const doc = new DOMParser().parseFromString(`<html><head><link rel="stylesheet" href="blob:style"></head><body><a href="filepos:123">MOBI</a><a href="kindle:pos:fid:0001:off:00000000A0">KF8</a><a href="#note">FB2</a><a href="blob:other-document">unsafe</a><a href="https://example.com">remote</a><script>bad()</script><img src="blob:image" onerror="bad()"></body></html>`, "text/html");
    prepareBookDocument(doc, { url: "/" }, { isInternalLink: isEbookLink, blobResources: true });
    expect(doc.querySelector("script, [onerror], a[href]")).toBeNull();
    expect(doc.querySelectorAll("a[data-ghost-epub-href]")).toHaveLength(3);
    expect(doc.querySelector("link")?.getAttribute("href")).toBe("blob:style");
    expect(doc.querySelector("meta")?.getAttribute("content")).toContain("script-src 'none'");
  });

  it("keeps text and comic bookmarks separate and tolerates broken storage", () => {
    saveEbookBookmark("/book.mobi", { section: 4, cfi: "epubcfi(/4/2:10)", fraction: 0.5, fontSize: 130 });
    expect(readEbookBookmark("/book.mobi").section).toBe(4);
    expect(readEbookBookmark("/other.mobi").section).toBe(0);
    saveComicBookmark("/comic.cbr", { page: "pages/010.jpg", zoom: 175, rtl: true });
    expect(readComicBookmark("/comic.cbr")).toEqual({ page: "pages/010.jpg", zoom: 175, rtl: true });
    localStorage.setItem("ghost:ebook:/book.mobi", "broken");
    expect(readEbookBookmark("/book.mobi").fontSize).toBe(100);
    localStorage.setItem("ghost:comic:/comic.cbr", '{"zoom":999,"rtl":"false"}');
    expect(readComicBookmark("/comic.cbr")).toEqual({ page: undefined, zoom: 300, rtl: false });
  });

  it("orders comic pages naturally and skips metadata, links and active documents", () => {
    const entries = ["10.jpg", "2.png", "1.webp", "__MACOSX/1.jpg", ".hidden.jpg", "art.svg", "ComicInfo.xml"].map(path => ({ path, kind: "file" as const, size_bytes: 100, modified_ms: null, link_target: null }));
    expect(comicPages([...entries, { ...entries[0], path: "3.jpg", kind: "symlink" }]).map(page => page.path)).toEqual(["1.webp", "2.png", "10.jpg"]);
  });

  it("rejects a malformed FB2 before starting the renderer", async () => {
    await expect(loadEbook(new TextEncoder().encode("<FictionBook/>").buffer, "/broken.fb2", vi.fn())).rejects.toThrow("not a readable FictionBook");
  });
});
