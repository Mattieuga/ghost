/**
 * The desktop entry can be reached in a normal browser when Supabase falls
 * back to its Site URL. Route that request to the browser-safe Cloud entry
 * without dropping PKCE callback parameters.
 */
export function cloudWebEntryUrl(currentHref: string): string {
  const current = new URL(currentHref);
  const cloud = new URL("app.html", current);
  cloud.search = current.search;
  cloud.hash = current.hash;
  return cloud.href;
}
