import type { ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function TopNotification({ children }: { children: ReactNode }) {
  return (
    <div
      className="fixed left-1/2 top-2 z-50 -translate-x-1/2 animate-in slide-in-from-top fade-in duration-300"
      role="status"
    >
      <div className="flex max-w-[min(34rem,calc(100vw-2rem))] items-center gap-3 rounded-lg border bg-card px-4 py-2.5 shadow-lg">
        {children}
      </div>
    </div>
  );
}

export function AppNotification({
  message,
  onDismiss,
}: {
  message: string | null;
  onDismiss(): void;
}) {
  if (!message) return null;
  return (
    <TopNotification>
      <AlertTriangle className="size-4 shrink-0 text-destructive" />
      <span className="min-w-0 text-sm text-card-foreground">{message}</span>
      <Button size="icon-xs" variant="ghost" onClick={onDismiss} title="Dismiss">
        <X />
        <span className="sr-only">Dismiss</span>
      </Button>
    </TopNotification>
  );
}
