export const MACOS_SYSTEM_FONT = "macOS System (SF Pro)";

const FONT_FAMILY_ALIASES: Record<string, string> = {
  [MACOS_SYSTEM_FONT]: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
  "Atkinson Hyperlegible Next": '"Atkinson Hyperlegible Next Variable"',
  "Source Sans 3": '"Source Sans 3 Variable"',
  Literata: '"Literata Variable"',
  Newsreader: '"Newsreader Variable"',
};

/** Strip characters that could escape a CSS font-family value. */
export function sanitizeFontName(name: string): string {
  return name.replace(/[";{}\\]/g, "");
}

/** Resolve user-facing font names to the family names registered by CSS. */
export function fontFamilyValue(name: string): string {
  return FONT_FAMILY_ALIASES[name] ?? `"${sanitizeFontName(name)}"`;
}
