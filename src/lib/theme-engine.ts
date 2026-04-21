export interface ThemeColors {
  editorBg: string;
  sidebarBg: string;
  text: string;
  accent: string;
  heading: string;
}

// --- Color utilities (simple RGB interpolation) ---

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

/** Blend two hex colors. amount=0 returns color1, amount=1 returns color2. */
function blend(color1: string, color2: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(color1);
  const [r2, g2, b2] = hexToRgb(color2);
  return rgbToHex(
    r1 + (r2 - r1) * amount,
    g1 + (g2 - g1) * amount,
    b1 + (b2 - b1) * amount,
  );
}

// --- Theme presets (loaded from JSON) ---

import themesData from "@/data/themes.json";

export interface ThemePreset extends ThemeColors {
  id: string;
  label: string;
  syntaxPalette?: string;
}

export const BUILTIN_THEMES: ThemePreset[] = themesData as ThemePreset[];

export const DEFAULT_THEME: ThemePreset =
  BUILTIN_THEMES.find((t) => t.id === "factory") ?? BUILTIN_THEMES[0];

// --- Luminance helper ---

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// --- Syntax color palettes keyed by theme ID ---

interface SyntaxPalette {
  keyword: string;
  name: string;
  function: string;
  constant: string;
  type: string;
  operator: string;
  string: string;
  comment: string;
  default: string;
}

const DARK_SYNTAX: SyntaxPalette = {
  keyword: "#c678dd", name: "#e06c75", function: "#61afef", constant: "#d19a66",
  type: "#e5c07b", operator: "#56b6c2", string: "#98c379", comment: "#5c6370", default: "#abb2bf",
};

const LIGHT_SYNTAX: SyntaxPalette = {
  keyword: "#a626a4", name: "#e45649", function: "#4078f2", constant: "#986801",
  type: "#c18401", operator: "#0184bc", string: "#50a14f", comment: "#a0a1a7", default: "#383a42",
};

const THEME_SYNTAX: Record<string, SyntaxPalette> = {
  monokai: {
    keyword: "#f92672", name: "#f8f8f2", function: "#a6e22e", constant: "#ae81ff",
    type: "#66d9ef", operator: "#f92672", string: "#e6db74", comment: "#75715e", default: "#f8f8f2",
  },
  dracula: {
    keyword: "#ff79c6", name: "#f8f8f2", function: "#50fa7b", constant: "#bd93f9",
    type: "#8be9fd", operator: "#ff79c6", string: "#f1fa8c", comment: "#6272a4", default: "#f8f8f2",
  },
  nord: {
    keyword: "#81a1c1", name: "#d8dee9", function: "#88c0d0", constant: "#b48ead",
    type: "#8fbcbb", operator: "#81a1c1", string: "#a3be8c", comment: "#616e88", default: "#d8dee9",
  },
  "solarized-dark": {
    keyword: "#859900", name: "#268bd2", function: "#b58900", constant: "#cb4b16",
    type: "#2aa198", operator: "#859900", string: "#2aa198", comment: "#586e75", default: "#839496",
  },
  "solarized-light": {
    keyword: "#859900", name: "#268bd2", function: "#b58900", constant: "#cb4b16",
    type: "#6c71c4", operator: "#d33682", string: "#2aa198", comment: "#93a1a1", default: "#657b83",
  },
  "gruvbox-dark": {
    keyword: "#fb4934", name: "#ebdbb2", function: "#b8bb26", constant: "#d3869b",
    type: "#fabd2f", operator: "#fe8019", string: "#b8bb26", comment: "#928374", default: "#ebdbb2",
  },
  "gruvbox-light": {
    keyword: "#9d0006", name: "#3c3836", function: "#79740e", constant: "#8f3f71",
    type: "#b57614", operator: "#af3a03", string: "#79740e", comment: "#928374", default: "#504945",
  },
  "tokyo-night": {
    keyword: "#bb9af7", name: "#c0caf5", function: "#7aa2f7", constant: "#ff9e64",
    type: "#2ac3de", operator: "#89ddff", string: "#9ece6a", comment: "#565f89", default: "#a9b1d6",
  },
  "catppuccin-mocha": {
    keyword: "#cba6f7", name: "#cdd6f4", function: "#89b4fa", constant: "#fab387",
    type: "#89dceb", operator: "#94e2d5", string: "#a6e3a1", comment: "#6c7086", default: "#cdd6f4",
  },
  "catppuccin-latte": {
    keyword: "#8839ef", name: "#4c4f69", function: "#1e66f5", constant: "#fe640b",
    type: "#179299", operator: "#04a5e5", string: "#40a02b", comment: "#9ca0b0", default: "#4c4f69",
  },
  factory: DARK_SYNTAX,
  "one-dark": DARK_SYNTAX,
  "rose-pine": {
    keyword: "#31748f", name: "#e0def4", function: "#9ccfd8", constant: "#c4a7e7",
    type: "#ebbcba", operator: "#31748f", string: "#f6c177", comment: "#6e6a86", default: "#e0def4",
  },
  sepia: {
    keyword: "#8b4513", name: "#6b3a2a", function: "#7b5b3a", constant: "#a0522d",
    type: "#8b6914", operator: "#8b4513", string: "#5a7247", comment: "#9c8b75", default: "#5b4636",
  },
  "github-light": {
    keyword: "#cf222e", name: "#1f2328", function: "#8250df", constant: "#0550ae",
    type: "#0550ae", operator: "#cf222e", string: "#0a3069", comment: "#6e7781", default: "#1f2328",
  },
};

const HIDDEN_PALETTE_IDS = new Set(["factory"]);

export const SYNTAX_PALETTE_OPTIONS = Object.keys(THEME_SYNTAX)
  .filter((id) => !HIDDEN_PALETTE_IDS.has(id))
  .map((id) => ({
    id,
    label: id.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "),
  }));

export function getSyntaxPaletteColors(paletteId: string | undefined): string[] {
  const p = (paletteId && THEME_SYNTAX[paletteId]) || DARK_SYNTAX;
  return [p.keyword, p.function, p.string, p.constant, p.type, p.operator];
}

function getSyntaxPalette(themeId: string | undefined, syntaxPaletteOverride: string | undefined, editorBg: string): SyntaxPalette {
  if (syntaxPaletteOverride && THEME_SYNTAX[syntaxPaletteOverride]) return THEME_SYNTAX[syntaxPaletteOverride];
  if (themeId && THEME_SYNTAX[themeId]) return THEME_SYNTAX[themeId];
  return luminance(editorBg) > 0.5 ? LIGHT_SYNTAX : DARK_SYNTAX;
}

// --- Derivation engine ---

export function deriveTheme(colors: ThemeColors, themeId?: string, syntaxPalette?: string): Record<string, string> {
  const { editorBg, sidebarBg, text, accent, heading } = colors;

  // Shifts: blend base toward text/heading by a percentage
  // Use text for content-related derivations, heading for UI chrome (higher contrast)
  const bgShift6 = blend(editorBg, text, 0.06);
  const bgShift8 = blend(editorBg, heading, 0.08);
  const bgShift12 = blend(editorBg, heading, 0.12);
  const bgShift25 = blend(editorBg, heading, 0.25);
  const bgShift35 = blend(editorBg, heading, 0.35);
  const textBlend75 = blend(editorBg, text, 0.75);

  const sbShift6 = blend(sidebarBg, text, 0.06);
  const sbShift8 = blend(sidebarBg, heading, 0.08);
  const sbShift35 = blend(sidebarBg, heading, 0.35);
  const sbShift60 = blend(sidebarBg, text, 0.60);
  const sbShift75 = blend(sidebarBg, text, 0.75);

  const syntax = getSyntaxPalette(themeId, syntaxPalette, editorBg);

  return {
    "--background": editorBg,
    "--foreground": heading,
    "--card": bgShift6,
    "--card-foreground": text,
    "--popover": sidebarBg,
    "--popover-foreground": text,
    "--primary": heading,
    "--primary-foreground": editorBg,
    "--secondary": bgShift6,
    "--secondary-foreground": text,
    "--muted": bgShift6,
    "--muted-foreground": textBlend75,
    "--accent": bgShift6,
    "--accent-foreground": text,
    "--destructive": "#dc2626",
    "--destructive-foreground": "#fafafa",
    "--border": bgShift8,
    "--input": bgShift25,
    "--ring": bgShift35,

    "--sidebar": sidebarBg,
    "--sidebar-foreground": sbShift60,
    "--sidebar-primary": sbShift75,
    "--sidebar-primary-foreground": sidebarBg,
    "--sidebar-accent": sbShift6,
    "--sidebar-accent-foreground": text,
    "--sidebar-border": sbShift8,
    "--sidebar-ring": sbShift35,

    "--ghost-amber": accent,

    "--checkbox-background": bgShift12,
    "--checkbox-border": bgShift25,
    "--checkbox-background-checked": bgShift6,
    "--checkbox-border-checked": bgShift12,
    "--checkbox-mark": bgShift35,

    "--code-keyword": syntax.keyword,
    "--code-name": syntax.name,
    "--code-function": syntax.function,
    "--code-constant": syntax.constant,
    "--code-type": syntax.type,
    "--code-operator": syntax.operator,
    "--code-string": syntax.string,
    "--code-comment": syntax.comment,
    "--code-default": syntax.default,
  };
}

/** Apply a derived theme to the document root element */
export function applyTheme(colors: ThemeColors, themeId?: string, syntaxPalette?: string) {
  const vars = deriveTheme(colors, themeId, syntaxPalette);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
