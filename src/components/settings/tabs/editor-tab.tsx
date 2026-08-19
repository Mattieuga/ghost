import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Separator } from "@/components/ui/separator";
import type { Settings } from "@/hooks/use-settings";
import { fontFamilyValue, MACOS_SYSTEM_FONT, sanitizeFontName } from "@/lib/fonts";

const FEATURED_TEXT_FONTS = [
  MACOS_SYSTEM_FONT, "Avenir Next",
  "Atkinson Hyperlegible Next", "Source Sans 3", "Literata", "Newsreader",
  "Lora", "Source Serif 4", "Crimson Pro", "Playfair Display",
  "Fraunces", "IBM Plex Serif", "Roboto", "Inter", "Space Grotesk",
];

const FEATURED_CODE_FONTS = [
  "JetBrains Mono", "Fira Code", "IBM Plex Mono", "Source Code Pro",
];

const MAX_VISIBLE_SYSTEM_FONTS = 50;

// Module-level cache: fetch system fonts once, share across all pickers
let systemFontsPromise: Promise<string[]> | null = null;
function fetchSystemFonts(): Promise<string[]> {
  if (!systemFontsPromise) {
    systemFontsPromise = invoke<string[]>("list_system_fonts").catch(() => []);
  }
  return systemFontsPromise;
}

interface FontPickerProps {
  label: string;
  value: string;
  featuredFonts: string[];
  onChange: (font: string) => void;
}

function FontPicker({ label, value, featuredFonts, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });
  const [activeIndex, setActiveIndex] = useState(-1);

  const query = search.toLowerCase();
  const filteredFeatured = featuredFonts.filter((f) => f.toLowerCase().includes(query));
  const allFilteredSystem = systemFonts?.filter(
    (f) => !featuredFonts.includes(f) && f.toLowerCase().includes(query),
  ) ?? null;
  const filteredSystem = allFilteredSystem?.slice(0, MAX_VISIBLE_SYSTEM_FONTS) ?? null;
  const totalSystemMatches = allFilteredSystem?.length ?? 0;

  // All selectable items in order (for keyboard nav)
  const allItems = [...filteredFeatured, ...(filteredSystem ?? [])];

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (e.target instanceof Node &&
          ref.current && !ref.current.contains(e.target) &&
          btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    if (open && systemFonts === null) {
      fetchSystemFonts().then(setSystemFonts);
    }
    if (open) {
      setActiveIndex(-1);
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [open, systemFonts]);

  const selectItem = (font: string) => {
    onChange(sanitizeFontName(font));
    setOpen(false);
    setSearch("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      setSearch("");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && activeIndex >= 0 && activeIndex < allItems.length) {
      e.preventDefault();
      selectItem(allItems[activeIndex]);
    }
  };

  return (
    <div className="relative">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <button
        ref={btnRef}
        onClick={() => {
          if (!open && btnRef.current) {
            const rect = btnRef.current.getBoundingClientRect();
            setDropPos({ top: rect.bottom + 4, left: rect.left });
          }
          setOpen(!open);
          if (open) setSearch("");
        }}
        className="h-8 w-full px-3 rounded-md border border-border hover:border-ring bg-transparent text-sm text-card-foreground cursor-pointer flex items-center gap-2 justify-between"
      >
        <span className="truncate" style={{ fontFamily: fontFamilyValue(value) }}>{value}</span>
        <span className="text-muted-foreground text-xs">▾</span>
      </button>

        {open && createPortal(
          <div ref={ref} className="fixed z-[9999] w-64 max-h-80 flex flex-col rounded-lg border border-border bg-popover shadow-lg" style={{ top: dropPos.top, left: dropPos.left }}>
            {/* Search input */}
            <div className="px-2 pt-2 pb-1 shrink-0">
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => { setSearch(e.target.value); setActiveIndex(-1); }}
                onKeyDown={handleKeyDown}
                placeholder="Search fonts..."
                className="w-full h-7 px-2 rounded-md border border-border bg-transparent text-xs text-card-foreground outline-none focus:border-ring caret-ghost-amber placeholder:text-muted-foreground"
              />
            </div>

            <div className="overflow-y-auto flex-1">
              {/* Featured bundled and macOS fonts */}
              {filteredFeatured.length > 0 && (
                <div className="px-2 py-1">
                  <div className="text-[10px] font-medium uppercase text-muted-foreground px-2 mb-0.5" style={{ letterSpacing: "1px" }}>
                    Featured
                  </div>
                  {filteredFeatured.map((font, i) => (
                    <button
                      key={font}
                      onClick={() => selectItem(font)}
                      className={`w-full text-left px-2 py-1 rounded-md text-sm cursor-pointer transition-colors ${
                        activeIndex === i ? "bg-accent text-accent-foreground" :
                        value === font ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                      }`}
                      style={{ fontFamily: fontFamilyValue(font) }}
                    >
                      {font}
                    </button>
                  ))}
                </div>
              )}

              {filteredFeatured.length > 0 && (filteredSystem === null || filteredSystem.length > 0) && (
                <div className="border-t border-border mx-2" />
              )}

              {/* System fonts section — capped at MAX_VISIBLE, rendered in default font */}
              {filteredSystem === null ? (
                <div className="px-4 py-2 text-xs text-muted-foreground">Loading...</div>
              ) : filteredSystem.length > 0 ? (
                <div className="px-2 py-1">
                  <div className="text-[10px] font-medium uppercase text-muted-foreground px-2 mb-0.5" style={{ letterSpacing: "1px" }}>
                    System{totalSystemMatches > MAX_VISIBLE_SYSTEM_FONTS ? ` (${MAX_VISIBLE_SYSTEM_FONTS} of ${totalSystemMatches})` : ""}
                  </div>
                  {filteredSystem.map((font, i) => {
                    const globalIdx = filteredFeatured.length + i;
                    return (
                      <button
                        key={font}
                        onClick={() => selectItem(font)}
                        className={`w-full text-left px-2 py-1 rounded-md text-sm cursor-pointer transition-colors ${
                          activeIndex === globalIdx ? "bg-accent text-accent-foreground" :
                          value === font ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                        }`}
                      >
                        {font}
                      </button>
                    );
                  })}
                </div>
              ) : search && filteredFeatured.length === 0 ? (
                <div className="px-4 py-2 text-xs text-muted-foreground">No fonts found</div>
              ) : null}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

interface EditorTabProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
  compact?: boolean;
}

function CompactSlider({ label, value, display, ...props }: {
  label: string; value: number; display: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-card-foreground">{label}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{display}</span>
      </div>
      <input
        type="range"
        value={value}
        {...props}
        aria-label={props["aria-label"] ?? label}
        className="block w-full accent-ghost-amber"
      />
    </div>
  );
}

export function EditorTab({ settings, onUpdateSettings, compact }: EditorTabProps) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      {/* Fonts */}
      <div className={compact ? "space-y-3" : "grid grid-cols-3 gap-3"}>
        <FontPicker
          label="Text"
          value={settings.textFont}
          featuredFonts={FEATURED_TEXT_FONTS}
          onChange={(textFont) => onUpdateSettings({ textFont })}
        />
        <FontPicker
          label="Heading"
          value={settings.headingFont}
          featuredFonts={FEATURED_TEXT_FONTS}
          onChange={(headingFont) => onUpdateSettings({ headingFont })}
        />
        <FontPicker
          label="Code"
          value={settings.codeFont}
          featuredFonts={FEATURED_CODE_FONTS}
          onChange={(codeFont) => onUpdateSettings({ codeFont })}
        />
      </div>

      <Separator />

      {/* Typography sliders */}
      <div className={compact ? "space-y-4" : "grid grid-cols-2 gap-x-6 gap-y-4"}>
        <CompactSlider
          label="Font size" value={settings.fontSize} display={`${settings.fontSize}px`}
          min={12} max={24} step={1}
          onChange={(e) => onUpdateSettings({ fontSize: Number(e.currentTarget.value) })}
        />
        <CompactSlider
          label="Line height" value={settings.lineHeight} display={settings.lineHeight.toFixed(2)}
          min={1.2} max={2.4} step={0.05}
          onChange={(e) => onUpdateSettings({ lineHeight: Number(e.currentTarget.value) })}
        />
        <CompactSlider
          label="Block spacing" value={settings.blockSpacing} display={settings.blockSpacing.toFixed(2)}
          min={0} max={2.5} step={0.05}
          onChange={(e) => onUpdateSettings({ blockSpacing: Number(e.currentTarget.value) })}
        />
        <CompactSlider
          label="Before heading" value={settings.headingSpacing} display={settings.headingSpacing.toFixed(2)}
          min={0.25} max={2.5} step={0.05}
          onChange={(e) => onUpdateSettings({ headingSpacing: Number(e.currentTarget.value) })}
        />
        <CompactSlider
          label="After heading" value={settings.headingAfterSpacing} display={settings.headingAfterSpacing.toFixed(2)}
          min={0} max={1.5} step={0.05}
          onChange={(e) => onUpdateSettings({ headingAfterSpacing: Number(e.currentTarget.value) })}
        />
        <CompactSlider
          label="Editor width" value={settings.editorWidth} display={`${settings.editorWidth}px`}
          min={500} max={1000} step={10}
          onChange={(e) => onUpdateSettings({ editorWidth: Number(e.currentTarget.value) })}
        />
      </div>

      <div className="flex justify-end pt-1">
        <button
          onClick={() => onUpdateSettings({
            textFont: "Avenir Next", headingFont: "Avenir Next", codeFont: "JetBrains Mono",
            fontSize: 16, lineHeight: 1.65, blockSpacing: 0,
            headingSpacing: 0.80, headingAfterSpacing: 0.50, editorWidth: 730,
          })}
          className="text-xs text-muted-foreground hover:text-card-foreground transition-colors cursor-pointer"
        >
          Restore Defaults
        </button>
      </div>
    </div>
  );
}
