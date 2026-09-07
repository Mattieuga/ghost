import type { ArchiveEntry } from "@/lib/archive";

export function comicPages(entries: ArchiveEntry[]): ArchiveEntry[] {
  return entries.filter(entry => entry.kind === "file"
    && /\.(?:jpe?g|png|webp|gif|bmp|avif)$/i.test(entry.path)
    && !entry.path.split("/").some(part => part.startsWith(".") || part === "__MACOSX"))
    .sort((a, b) => a.path.localeCompare(b.path, "en", { numeric: true, sensitivity: "base" }));
}

export interface ComicBookmark { page?: string; zoom: number; rtl: boolean }
export function readComicBookmark(filePath: string): ComicBookmark {
  try {
    const saved = JSON.parse(localStorage.getItem(`ghost:comic:${filePath}`) ?? "null");
    return {
      page: typeof saved?.page === "string" ? saved.page : undefined,
      zoom: Number.isFinite(saved?.zoom) ? Math.max(100, Math.min(300, saved.zoom)) : 100,
      rtl: saved?.rtl === true,
    };
  } catch { return { zoom: 100, rtl: false }; }
}
export function saveComicBookmark(filePath: string, bookmark: ComicBookmark): void {
  try { localStorage.setItem(`ghost:comic:${filePath}`, JSON.stringify(bookmark)); } catch { /* Optional UI state. */ }
}
