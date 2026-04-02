import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Separator } from "@/components/ui/separator";
import type { Settings } from "@/hooks/use-settings";

const BUNDLED_TEXT_FONTS = [
  "Lora", "Source Serif 4", "Crimson Pro", "Playfair Display",
  "Fraunces", "IBM Plex Serif", "Roboto", "Inter", "Space Grotesk",
];

const BUNDLED_CODE_FONTS = [
  "JetBrains Mono", "Fira Code", "IBM Plex Mono", "Source Code Pro",
];

interface FontPickerProps {
  label: string;
  description: string;
  value: string;
  bundledFonts: string[];
  onChange: (font: string) => void;
}

function FontPicker({ label, value, bundledFonts, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [systemFonts, setSystemFonts] = useState<string[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0 });

  const query = search.toLowerCase();
  const filteredBundled = bundledFonts.filter((f) => f.toLowerCase().includes(query));
  const filteredSystem = systemFonts?.filter((f) => f.toLowerCase().includes(query)) ?? null;

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) &&
          btnRef.current && !btnRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  useEffect(() => {
    if (open && systemFonts === null) {
      invoke<string[]>("list_system_fonts")
        .then(setSystemFonts)
        .catch(() => setSystemFonts([]));
    }
    if (open) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open, systemFonts]);

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
        <span className="truncate" style={{ fontFamily: `"${value}", sans-serif` }}>{value}</span>
        <span className="text-muted-foreground text-xs">▾</span>
      </button>

        {open && createPortal(
          <div ref={ref} className="fixed z-[9999] w-64 max-h-80 flex flex-col rounded-lg border border-border bg-popover shadow-lg" style={{ top: dropPos.top, left: dropPos.left }}>
            {/* Search input */}
            <div className="px-2 pt-2 pb-1 shrink-0">
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setSearch(""); } }}
                placeholder="Search fonts..."
                className="w-full h-7 px-2 rounded-md border border-border bg-transparent text-xs text-card-foreground outline-none focus:border-ring caret-ghost-amber placeholder:text-muted-foreground"
              />
            </div>

            <div className="overflow-y-auto flex-1">
              {/* Bundled section */}
              {filteredBundled.length > 0 && (
                <div className="px-2 py-1">
                  <div className="text-[10px] font-medium uppercase text-muted-foreground px-2 mb-0.5" style={{ letterSpacing: "1px" }}>
                    Bundled
                  </div>
                  {filteredBundled.map((font) => (
                    <button
                      key={font}
                      onClick={() => { onChange(font); setOpen(false); setSearch(""); }}
                      className={`w-full text-left px-2 py-1 rounded-md text-sm cursor-pointer transition-colors ${
                        value === font ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                      }`}
                      style={{ fontFamily: `"${font}", sans-serif` }}
                    >
                      {font}
                    </button>
                  ))}
                </div>
              )}

              {filteredBundled.length > 0 && (filteredSystem === null || (filteredSystem?.length ?? 0) > 0) && (
                <div className="border-t border-border mx-2" />
              )}

              {/* System fonts section */}
              {filteredSystem === null ? (
                <div className="px-4 py-2 text-xs text-muted-foreground">Loading...</div>
              ) : filteredSystem.length > 0 ? (
                <div className="px-2 py-1">
                  <div className="text-[10px] font-medium uppercase text-muted-foreground px-2 mb-0.5" style={{ letterSpacing: "1px" }}>
                    System
                  </div>
                  {filteredSystem.map((font) => (
                    <button
                      key={font}
                      onClick={() => { onChange(font); setOpen(false); setSearch(""); }}
                      className={`w-full text-left px-2 py-1 rounded-md text-sm cursor-pointer transition-colors ${
                        value === font ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                      }`}
                      style={{ fontFamily: `"${font}", sans-serif` }}
                    >
                      {font}
                    </button>
                  ))}
                </div>
              ) : search && filteredBundled.length === 0 ? (
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
}

function CompactSlider({ label, value, display, ...props }: {
  label: string; value: number; display: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-sm text-card-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1.5">
        <input type="range" value={value} {...props} className="w-20 accent-ghost-amber" />
        <span className="text-xs text-muted-foreground w-10 text-right tabular-nums">{display}</span>
      </div>
    </div>
  );
}

export function EditorTab({ settings, onUpdateSettings }: EditorTabProps) {
  return (
    <div className="rounded-xl border bg-card p-5 space-y-4">
      {/* Fonts — 3 pickers in a row */}
      <div className="grid grid-cols-3 gap-3">
        <FontPicker
          label="Text" description=""
          value={settings.textFont}
          bundledFonts={BUNDLED_TEXT_FONTS}
          onChange={(textFont) => onUpdateSettings({ textFont })}
        />
        <FontPicker
          label="Heading" description=""
          value={settings.headingFont}
          bundledFonts={BUNDLED_TEXT_FONTS}
          onChange={(headingFont) => onUpdateSettings({ headingFont })}
        />
        <FontPicker
          label="Code" description=""
          value={settings.codeFont}
          bundledFonts={BUNDLED_CODE_FONTS}
          onChange={(codeFont) => onUpdateSettings({ codeFont })}
        />
      </div>

      <Separator />

      {/* Typography sliders — 2-column grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-3">
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
          label="Paragraph" value={settings.paragraphSpacing} display={settings.paragraphSpacing.toFixed(2)}
          min={0} max={1.5} step={0.05}
          onChange={(e) => onUpdateSettings({ paragraphSpacing: Number(e.currentTarget.value) })}
        />
        <CompactSlider
          label="Heading gap" value={settings.headingSpacing} display={settings.headingSpacing.toFixed(2)}
          min={0.25} max={2.5} step={0.05}
          onChange={(e) => onUpdateSettings({ headingSpacing: Number(e.currentTarget.value) })}
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
            textFont: "Inter", headingFont: "Inter", codeFont: "Space Mono",
            fontSize: 16, lineHeight: 1.60, paragraphSpacing: 0.50, headingSpacing: 0.80, editorWidth: 730,
          })}
          className="text-xs text-muted-foreground hover:text-card-foreground transition-colors cursor-pointer"
        >
          Restore Defaults
        </button>
      </div>
    </div>
  );
}
