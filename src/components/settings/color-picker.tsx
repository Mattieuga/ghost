import { useCallback, useEffect, useRef, useState } from "react";

// --- HSV/RGB/Hex conversion ---

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) =>
        Math.round(Math.max(0, Math.min(255, v)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, v];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r = 0,
    g = 0,
    b = 0;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hexToHsv(hex: string): [number, number, number] {
  return rgbToHsv(...hexToRgb(hex));
}

function hsvToHex(h: number, s: number, v: number): string {
  return rgbToHex(...hsvToRgb(h, s, v));
}

// --- Component ---

interface ColorPickerProps {
  color: string;
  onChange: (hex: string) => void;
}

export function ColorPicker({ color, onChange }: ColorPickerProps) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(color));
  const [hexInput, setHexInput] = useState(color.replace("#", "").toUpperCase());
  const areaRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"area" | "hue" | null>(null);
  const hsvRef = useRef(hsv);
  hsvRef.current = hsv;

  // Sync from external color prop
  useEffect(() => {
    const newHsv = hexToHsv(color);
    setHsv(newHsv);
    setHexInput(color.replace("#", "").toUpperCase());
  }, [color]);

  const emit = useCallback(
    (h: number, s: number, v: number) => {
      const hex = hsvToHex(h, s, v);
      setHexInput(hex.replace("#", "").toUpperCase());
      onChange(hex);
    },
    [onChange],
  );

  // --- Saturation/Value area ---
  const handleAreaPointer = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      const rect = areaRef.current?.getBoundingClientRect();
      if (!rect) return;
      const s = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const v = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
      const next: [number, number, number] = [hsvRef.current[0], s, v];
      setHsv(next);
      emit(...next);
    },
    [emit],
  );

  // --- Hue slider ---
  const handleHuePointer = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      const rect = hueRef.current?.getBoundingClientRect();
      if (!rect) return;
      const h = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const next: [number, number, number] = [h, hsvRef.current[1], hsvRef.current[2]];
      setHsv(next);
      emit(...next);
    },
    [emit],
  );

  // Global pointer tracking
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (draggingRef.current === "area") handleAreaPointer(e);
      else if (draggingRef.current === "hue") handleHuePointer(e);
    };
    const onUp = () => {
      draggingRef.current = null;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [handleAreaPointer, handleHuePointer]);

  const handleHexCommit = () => {
    const cleaned = hexInput.replace("#", "").trim();
    if (/^[0-9a-fA-F]{6}$/.test(cleaned)) {
      const hex = `#${cleaned.toLowerCase()}`;
      const newHsv = hexToHsv(hex);
      setHsv(newHsv);
      onChange(hex);
    } else {
      // Reset to current
      setHexInput(hsvToHex(...hsv).replace("#", "").toUpperCase());
    }
  };

  const [h, s, v] = hsv;
  const hueColor = hsvToHex(h, 1, 1);
  const currentHex = hsvToHex(h, s, v);

  return (
    <div className="flex flex-col gap-3 p-3 rounded-lg border border-border bg-popover w-[232px]">
      {/* SV area */}
      <div
        ref={areaRef}
        className="relative w-full aspect-square rounded-md cursor-crosshair overflow-hidden"
        style={{ background: hueColor }}
        onPointerDown={(e) => {
          draggingRef.current = "area";
          handleAreaPointer(e);
          e.preventDefault();
        }}
      >
        {/* White → transparent (saturation) */}
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(to right, #fff, transparent)" }}
        />
        {/* Transparent → black (value) */}
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(to bottom, transparent, #000)" }}
        />
        {/* Thumb */}
        <div
          className="absolute size-3.5 rounded-full border-2 border-white pointer-events-none"
          style={{
            left: `${s * 100}%`,
            top: `${(1 - v) * 100}%`,
            transform: "translate(-50%, -50%)",
            boxShadow: "0 0 2px rgba(0,0,0,0.6)",
          }}
        />
      </div>

      {/* Hue slider */}
      <div
        ref={hueRef}
        className="relative h-3 rounded-full cursor-pointer"
        style={{
          background:
            "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)",
        }}
        onPointerDown={(e) => {
          draggingRef.current = "hue";
          handleHuePointer(e);
          e.preventDefault();
        }}
      >
        <div
          className="absolute top-1/2 size-3.5 rounded-full border-2 border-white pointer-events-none"
          style={{
            left: `${h * 100}%`,
            transform: "translate(-50%, -50%)",
            boxShadow: "0 0 2px rgba(0,0,0,0.6)",
          }}
        />
      </div>

      {/* Hex input */}
      <div className="flex items-center gap-2">
        <div
          className="size-6 rounded-md border border-border shrink-0"
          style={{ background: currentHex }}
        />
        <div className="flex items-center gap-1 flex-1">
          <span className="text-[11px] text-muted-foreground">#</span>
          <input
            value={hexInput}
            onChange={(e) => setHexInput(e.target.value.toUpperCase())}
            onBlur={handleHexCommit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleHexCommit();
            }}
            maxLength={6}
            className="flex-1 bg-transparent text-[12px] font-mono text-card-foreground outline-none caret-ghost-amber"
          />
        </div>
      </div>
    </div>
  );
}
