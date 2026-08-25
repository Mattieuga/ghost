function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Add a preview-only base URL without altering the source document. */
export function withHtmlPreviewBase(source: string, baseUrl: string): string {
  if (!baseUrl || /<base\b/i.test(source)) return source;
  const base = `<base href="${escapeAttribute(baseUrl)}">`;
  const head = /<head(?:\s[^>]*)?>/i.exec(source);
  if (head?.index !== undefined) {
    const end = head.index + head[0].length;
    return `${source.slice(0, end)}${base}${source.slice(end)}`;
  }

  const html = /<html(?:\s[^>]*)?>/i.exec(source);
  if (html?.index !== undefined) {
    const end = html.index + html[0].length;
    return `${source.slice(0, end)}<head>${base}</head>${source.slice(end)}`;
  }

  const doctype = /^\s*<!doctype[^>]*>/i.exec(source);
  if (doctype) {
    const end = doctype[0].length;
    return `${source.slice(0, end)}<head>${base}</head>${source.slice(end)}`;
  }
  return `<head>${base}</head>${source}`;
}
