declare module "foliate-js" {
  export interface Navigation { index: number; anchor?: number | ((doc: Document) => Range | Element | number | null | undefined) }
  export interface Section { id?: number | string; linear?: string; load: () => string | Promise<string>; unload?: () => void }
  export interface TocItem { href: string; label: string; subitems?: TocItem[] }
  export interface Book { sections: Section[]; toc?: TocItem[]; dir?: string; metadata?: { title?: string }; resolveHref: (href: string) => Navigation | Promise<Navigation>; destroy: () => void }
}
declare module "foliate-js/mobi.js" {
  import type { Book } from "foliate-js";
  export class MOBI {
    constructor(options: { unzlib: (data: Uint8Array) => Uint8Array });
    loadText(index: number): Promise<Uint8Array>;
    open(file: Blob): Promise<Book>;
  }
}
declare module "foliate-js/fb2.js" {
  import type { Book } from "foliate-js";
  export function makeFB2(file: Blob): Promise<Book>;
}
declare module "foliate-js/vendor/fflate.js" {
  export function unzlibSync(data: Uint8Array, options?: { out: Uint8Array }): Uint8Array;
}
declare module "foliate-js/epubcfi.js" {
  export function fromRange(range: Range): string;
  export function toRange(doc: Document, cfi: unknown): Range;
  export function parse(cfi: string): unknown;
}
declare module "foliate-js/paginator.js" {
  import type { Book, Navigation } from "foliate-js";
  export class Paginator extends HTMLElement {
    open(book: Book): void;
    goTo(target: Navigation): Promise<void>;
    next(): Promise<void>;
    prev(): Promise<void>;
    getContents(): Array<{ doc: Document; index: number }>;
    setStyles(styles: string): void;
    destroy(): void;
    atStart: boolean;
    atEnd: boolean;
    page: number;
    pages: number;
  }
}
