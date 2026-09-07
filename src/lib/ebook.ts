import type { Book, TocItem } from "foliate-js";
import { prepareBookDocument } from "@/lib/book-document";

export interface EbookBookmark { section: number; cfi?: string; fraction: number; fontSize: number }
export function readEbookBookmark(filePath: string): EbookBookmark {
  try {
    const saved = JSON.parse(localStorage.getItem(`ghost:ebook:${filePath}`) ?? "null");
    return {
      section: Number.isSafeInteger(saved?.section) && saved.section >= 0 ? saved.section : 0,
      cfi: typeof saved?.cfi === "string" && saved.cfi.startsWith("epubcfi(") ? saved.cfi : undefined,
      fraction: Number.isFinite(saved?.fraction) ? Math.min(1, Math.max(0, saved.fraction)) : 0,
      fontSize: Number.isFinite(saved?.fontSize) ? Math.min(160, Math.max(80, saved.fontSize)) : 100,
    };
  } catch { return { section: 0, fraction: 0, fontSize: 100 }; }
}
export function saveEbookBookmark(filePath: string, bookmark: EbookBookmark): void {
  try { localStorage.setItem(`ghost:ebook:${filePath}`, JSON.stringify(bookmark)); } catch { /* Optional UI state. */ }
}

export function isEbookLink(href: string): boolean {
  return /^(?:filepos:\d+|kindle:pos:fid:[0-9a-v]+:off:[0-9a-v]+|\d+(?:#\d+)?|#[^\s]+)$/i.test(href);
}
export function flattenEbookContents(items: TocItem[], depth = 0): Array<{ href: string; label: string }> {
  if (depth > 8) return [];
  return items.flatMap(item => [
    ...(isEbookLink(item.href) ? [{ href: item.href, label: `${"  ".repeat(depth)}${item.label.trim() || "Untitled chapter"}` }] : []),
    ...flattenEbookContents(item.subitems ?? [], depth + 1),
  ]);
}

export async function loadEbook(bytes: ArrayBuffer, filePath: string, onFailure: (reason: unknown) => void): Promise<Book> {
  const blob = new Blob([bytes]);
  let book: Book;
  if (filePath.toLowerCase().endsWith(".fb2")) {
    // Validate before Foliate's converter, which expects a well-formed body.
    const text = await blob.text();
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.querySelector("parsererror") || doc.documentElement.localName !== "FictionBook" || !doc.querySelector("body")) {
      throw new Error("This file is not a readable FictionBook document");
    }
    const { makeFB2 } = await import("foliate-js/fb2.js");
    book = await makeFB2(blob);
  } else {
    const [{ MOBI }, { unzlibSync }] = await Promise.all([
      import("foliate-js/mobi.js"), import("foliate-js/vendor/fflate.js"),
    ]);
    const mobi = new MOBI({ unzlib: data => {
      // Supplying the output buffer bounds even a forged compressed font.
      const output = unzlibSync(data, { out: new Uint8Array(8 * 1024 * 1024) });
      if (output.length >= 8 * 1024 * 1024) throw new Error("A book font exceeds the preview limit");
      return output;
    } });
    const loadText = mobi.loadText.bind(mobi);
    const records = new Map<number, number>();
    let expanded = 0;
    mobi.loadText = async index => {
      const output = await loadText(index);
      expanded += output.length - (records.get(index) ?? 0);
      records.set(index, output.length);
      if (output.length > 256 * 1024 || expanded > 64 * 1024 * 1024) {
        throw new Error("This book exceeds the expanded text preview limit");
      }
      return output;
    };
    book = await mobi.open(blob);
  }
  if (!book.sections.length || book.sections.length > 10_000) {
    book.destroy();
    throw new Error("This book has no readable chapters or exceeds the chapter limit");
  }

  // Every format supplies a chapter URL. Wrap that boundary, before any bytes
  // enter a live iframe, rather than relying on format-specific content hooks.
  const urls = new Map<number, string>();
  let closed = false;
  for (const [index, section] of book.sections.entries()) {
    const load = section.load.bind(section);
    const unload = section.unload?.bind(section);
    section.load = async () => {
      try {
        if (closed) throw new Error("Book closed");
        if (urls.has(index)) return urls.get(index)!;
        const source = await load();
        if (!source.startsWith("blob:")) throw new Error("Remote book content is disabled");
        const response = await fetch(source);
        const text = await response.text();
        if (closed) throw new Error("Book closed");
        if (text.length > 16 * 1024 * 1024) throw new Error("This chapter exceeds the preview limit");
        let doc = new DOMParser().parseFromString(text, "application/xhtml+xml");
        if (doc.querySelector("parsererror")) doc = new DOMParser().parseFromString(text, "text/html");
        prepareBookDocument(doc, { url: "/" }, { isInternalLink: isEbookLink, blobResources: true });
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: "application/xhtml+xml" }));
        urls.set(index, url);
        return url;
      } catch (reason) { onFailure(reason); throw reason; }
    };
    section.unload = () => {
      const url = urls.get(index);
      if (url) URL.revokeObjectURL(url);
      urls.delete(index);
      unload?.();
    };
  }
  const destroy = book.destroy.bind(book);
  book.destroy = () => {
    closed = true;
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    destroy();
  };
  return book;
}
