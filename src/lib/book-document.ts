export const BOOK_CONTENT_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline' blob:; img-src blob: data:; font-src blob: data:; base-uri 'self'; form-action 'none'";

export function applyBookTheme(doc: Document): void {
  const theme = getComputedStyle(document.documentElement);
  const foreground = theme.getPropertyValue("--foreground").trim() || "#e8e6e2";
  const background = theme.getPropertyValue("--background").trim() || "#0e0e0e";
  const body = doc.querySelector("body");
  if (!body) return;
  // Inline !important also wins over publisher IDs and inline colors. Keep
  // images and SVG artwork intact, while text always uses Ghost's color pair.
  for (const element of [doc.documentElement, body, ...body.querySelectorAll("*")]) {
    if (element.namespaceURI !== "http://www.w3.org/1999/xhtml") continue;
    const style = (element as HTMLElement).style;
    style.setProperty("color", foreground, "important");
    style.setProperty("-webkit-text-fill-color", "currentColor", "important");
    style.setProperty("background-color", element === body || element === doc.documentElement ? background : "transparent", "important");
    style.setProperty("background-image", "none", "important");
  }
}

/** Only in-book links may reach EPUB.js's navigation handler. */
export function isBookRelativeLink(href: string): boolean {
  try {
    return new URL(href, "https://epub.invalid/").origin === "https://epub.invalid"
      && !href.trimStart().startsWith("//")
      && !/^[\s\u0000-\u0020]*[a-z][a-z\d+.-]*:/i.test(href);
  } catch {
    return false;
  }
}

/** Runs on the detached chapter, before its first byte reaches an iframe. */
export function prepareBookDocument(doc: Document, section: { url: string }, options: { isInternalLink?: (href: string) => boolean; blobResources?: boolean } = {}): void {
  doc.querySelectorAll("script, iframe, frame, frameset, object, embed, form, input, button, textarea, select, base, meta[http-equiv], foreignObject, animate, animateMotion, animateTransform, set, discard, link:not([rel='stylesheet'])")
    .forEach((element) => element.remove());
  for (const element of doc.querySelectorAll("*")) {
    element.removeAttribute("data-ghost-epub-href");
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name) || ["srcdoc", "target", "download", "ping", "autofocus"].includes(attribute.name)) {
        element.removeAttribute(attribute.name);
      }
    }
    for (const attribute of ["href", "xlink:href"]) {
      const href = element.getAttribute(attribute);
      const resource = options.blobResources && ["link", "image", "use"].includes(element.localName) && href?.startsWith("blob:");
      const internal = (options.isInternalLink ?? isBookRelativeLink)(href ?? "");
      if (href !== null && !resource && !internal) element.removeAttribute(attribute);
    }
    const href = element.getAttribute("href") || element.getAttribute("xlink:href");
    if (["a", "area"].includes(element.localName) && href) {
      element.setAttribute("data-ghost-epub-href", href);
      // No native href: even a click before Ghost's listener attaches cannot
      // navigate out of the chapter and lose its restrictive CSP.
      element.removeAttribute("href");
      element.removeAttribute("xlink:href");
      element.setAttribute("role", "link");
      element.setAttribute("tabindex", "0");
      (element as HTMLElement).style.setProperty("cursor", "pointer");
      (element as HTMLElement).style.setProperty("text-decoration", "underline");
    } else if (!["link", "image", "use"].includes(element.localName)) {
      element.removeAttribute("href");
      element.removeAttribute("xlink:href");
    }
  }
  const head = doc.querySelector("head");
  if (!head) throw new Error("This book chapter has no document header");
  const create = (name: string) => doc.createElementNS("http://www.w3.org/1999/xhtml", name);
  const policy = create("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", BOOK_CONTENT_CSP);
  head.prepend(policy);
  // EPUB.js reads this attribute to resolve chapter/footnote links. Only the
  // app's own origin is eligible; remote book resources stay blocked by CSP.
  const base = create("base");
  base.setAttribute("href", new URL(section.url, window.location.origin).href);
  head.append(base);
  applyBookTheme(doc);
}
