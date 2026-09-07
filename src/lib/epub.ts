import type { Book, NavItem } from "epubjs";

import { isBookRelativeLink as isEpubLink } from "@/lib/book-document";
export { BOOK_CONTENT_CSP as EPUB_CONTENT_CSP, applyBookTheme as applyEpubTheme,
  prepareBookDocument as prepareEpubDocument, isBookRelativeLink as isEpubLink } from "@/lib/book-document";

export function flattenEpubContents(items: NavItem[], navigationPath = "", depth = 0): Array<{ href: string; label: string }> {
  return items.flatMap((item) => {
    const target = isEpubLink(item.href) ? new URL(item.href, new URL(navigationPath, "https://epub.invalid/")) : null;
    return [
      ...(target ? [{ href: target.pathname.slice(1) + target.hash, label: `${"  ".repeat(Math.min(depth, 8))}${item.label.trim()}` }] : []),
      ...flattenEpubContents(item.subitems ?? [], navigationPath, depth + 1),
    ];
  });
}

export interface EpubBookmark { cfi?: string; href?: string; fontSize: number }
const bookmarkKey = (filePath: string) => `ghost:epub:${filePath}`;

export function readEpubBookmark(filePath: string): EpubBookmark {
  try {
    const saved = JSON.parse(window.localStorage.getItem(bookmarkKey(filePath)) ?? "null");
    return {
      cfi: typeof saved?.cfi === "string" && saved.cfi.startsWith("epubcfi(") ? saved.cfi : undefined,
      href: typeof saved?.href === "string" && isEpubLink(saved.href) ? saved.href : undefined,
      fontSize: Number.isFinite(saved?.fontSize) ? Math.min(160, Math.max(80, saved.fontSize)) : 100,
    };
  } catch { return { fontSize: 100 }; }
}

export function saveEpubBookmark(filePath: string, bookmark: EpubBookmark): void {
  try { window.localStorage.setItem(bookmarkKey(filePath), JSON.stringify(bookmark)); } catch { /* Reading works without storage. */ }
}

/** EPUB.js 0.3.93 does not revoke replacement CSS or archive URL values. */
export function destroyEpubBook(book: Book): void {
  const archive = book.archive as (Book["archive"] & { urlCache?: Record<string, string> }) | undefined;
  const resources = book.resources as (Book["resources"] & { replacementUrls?: string[] }) | undefined;
  const urls = new Set([...Object.values(archive?.urlCache ?? {}), ...(resources?.replacementUrls ?? [])]);
  book.destroy();
  for (const url of urls) if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}

export async function withEpubTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("This book could not finish loading. Try opening it in another book reader.")), 15_000);
      }),
    ]);
  } finally { clearTimeout(timer); }
}
