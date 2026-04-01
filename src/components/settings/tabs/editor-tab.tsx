import { Separator } from "@/components/ui/separator";
import type { Settings } from "@/hooks/use-settings";
import { SettingRow } from "@/components/settings/setting-row";

interface EditorTabProps {
  settings: Settings;
  onUpdateSettings: (updates: Partial<Settings>) => void;
}

export function EditorTab({ settings, onUpdateSettings }: EditorTabProps) {
  return (
    <div className="rounded-xl border bg-card p-6 space-y-4">
      <SettingRow label="Font size" description="Editor body text size (12–24px)">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={12}
            max={24}
            step={1}
            value={settings.fontSize}
            onChange={(e) =>
              onUpdateSettings({ fontSize: Number(e.target.value) })
            }
            className="w-24 accent-ghost-amber"
          />
          <span className="text-sm text-muted-foreground w-10 text-right tabular-nums">
            {settings.fontSize}px
          </span>
        </div>
      </SettingRow>

      <Separator />

      <SettingRow label="Line height" description="Spacing between lines (1.2–2.4)">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={1.2}
            max={2.4}
            step={0.05}
            value={settings.lineHeight}
            onChange={(e) =>
              onUpdateSettings({ lineHeight: Number(e.target.value) })
            }
            className="w-24 accent-ghost-amber"
          />
          <span className="text-sm text-muted-foreground w-10 text-right tabular-nums">
            {settings.lineHeight.toFixed(2)}
          </span>
        </div>
      </SettingRow>

      <Separator />

      <SettingRow label="Paragraph spacing" description="Space between paragraphs (0–1.5rem)">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={settings.paragraphSpacing}
            onChange={(e) =>
              onUpdateSettings({ paragraphSpacing: Number(e.target.value) })
            }
            className="w-24 accent-[#f57c00]"
          />
          <span className="text-sm text-muted-foreground w-10 text-right tabular-nums">
            {settings.paragraphSpacing.toFixed(2)}
          </span>
        </div>
      </SettingRow>

      <Separator />

      <SettingRow label="Heading spacing" description="Space above headings (0.25–2.5rem)">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0.25}
            max={2.5}
            step={0.05}
            value={settings.headingSpacing}
            onChange={(e) =>
              onUpdateSettings({ headingSpacing: Number(e.target.value) })
            }
            className="w-24 accent-[#f57c00]"
          />
          <span className="text-sm text-muted-foreground w-10 text-right tabular-nums">
            {settings.headingSpacing.toFixed(2)}
          </span>
        </div>
      </SettingRow>

      <Separator />

      <SettingRow label="Editor width" description="Maximum content width (500–1000px)">
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={500}
            max={1000}
            step={10}
            value={settings.editorWidth}
            onChange={(e) =>
              onUpdateSettings({ editorWidth: Number(e.target.value) })
            }
            className="w-24 accent-ghost-amber"
          />
          <span className="text-sm text-muted-foreground w-10 text-right tabular-nums">
            {settings.editorWidth}px
          </span>
        </div>
      </SettingRow>
    </div>
  );
}
