import type { ReactNode } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";

export const bookControlClass = "rounded p-1.5 hover:bg-muted focus-visible:outline focus-visible:outline-ring disabled:opacity-30";

export function BookReaderControls({ options, selected, onSelect, disabled, atStart, atEnd, onPrevious, onNext, progress, scale, children, contentsLabel = "Table of contents" }: {
  options: Array<{ href: string; label: string }>;
  selected: string;
  onSelect: (value: string, control: HTMLElement) => void;
  disabled: boolean;
  atStart?: boolean;
  atEnd?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  progress: string;
  scale: { value: number; min: number; max: number; change: (delta: number) => void; zoom?: boolean };
  children?: ReactNode;
  contentsLabel?: string;
}) {
  return <div className="flex shrink-0 flex-col items-center gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground sm:flex-row">
    <select aria-label={contentsLabel} value={selected} disabled={disabled}
      onChange={(event) => onSelect(event.target.value, event.currentTarget)}
      className="w-full min-w-0 flex-1 truncate rounded border border-border bg-background px-2 py-1.5 text-xs outline-none focus:border-ring">
      <option value="" disabled>Contents</option>
      {options.map((item, index) => <option key={`${item.href}:${index}`} value={item.href}>{item.label}</option>)}
    </select>
    <div className="flex shrink-0 items-center justify-center gap-1">
      <button aria-label="Previous page" title="Previous page (Left arrow)" className={bookControlClass} disabled={disabled || atStart} onClick={onPrevious}><ChevronLeft className="size-4" /></button>
      <span className="min-w-24 text-center text-[11px] tabular-nums" aria-live="polite">{progress}</span>
      <button aria-label="Next page" title="Next page (Right arrow)" className={bookControlClass} disabled={disabled || atEnd} onClick={onNext}><ChevronRight className="size-4" /></button>
      <span className="mx-1 h-4 w-px bg-border" />
      <button aria-label={scale.zoom ? "Zoom out" : "Smaller text"} className={bookControlClass} disabled={disabled || scale.value <= scale.min} onClick={() => scale.change(scale.zoom ? -25 : -10)}><Minus className="size-3.5" /></button>
      <span className="w-8 text-center text-[11px] tabular-nums">{scale.value}%</span>
      <button aria-label={scale.zoom ? "Zoom in" : "Larger text"} className={bookControlClass} disabled={disabled || scale.value >= scale.max} onClick={() => scale.change(scale.zoom ? 25 : 10)}><Plus className="size-3.5" /></button>
      {children}
    </div>
  </div>;
}

export function restoreBookFocus(reader: HTMLElement | null, previousFrame: Element | null, control?: HTMLElement): void {
  if ((previousFrame && !previousFrame.isConnected && document.activeElement === document.body)
    || (control && (document.activeElement === control || document.activeElement === document.body))) {
    reader?.focus({ preventScroll: true });
  }
}
