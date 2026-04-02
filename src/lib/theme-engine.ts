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
}

export const BUILTIN_THEMES: ThemePreset[] = themesData as ThemePreset[];

export const DEFAULT_THEME: ThemePreset =
  BUILTIN_THEMES.find((t) => t.id === "factory") ?? BUILTIN_THEMES[0];

// --- Derivation engine ---

export function deriveTheme(colors: ThemeColors): Record<string, string> {
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
  };
}

/** Apply a derived theme to the document root element */
export function applyTheme(colors: ThemeColors) {
  const vars = deriveTheme(colors);
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
