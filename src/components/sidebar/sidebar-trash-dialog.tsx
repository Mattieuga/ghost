import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function SidebarTrashDialog({
  open,
  kind,
  name,
  description,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  kind: "file" | "folder";
  name: string;
  description?: string;
  onOpenChange(open: boolean): void;
  onConfirm(): void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={(event) => { if (event.key === "Enter") onConfirm(); }}>
        <DialogHeader>
          <DialogTitle>Move {kind} to Trash?</DialogTitle>
          <DialogDescription>
            {description ?? `“${name}” can be recovered from the macOS Trash.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" onClick={onConfirm}>Move to Trash</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
