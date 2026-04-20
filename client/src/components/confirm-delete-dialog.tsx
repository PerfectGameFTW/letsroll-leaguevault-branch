import { useState, useEffect, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  itemLabel: string;
  itemName: string | undefined;
  consequencesIntro: string;
  consequences: ReactNode[];
  isPending: boolean;
  onConfirm: () => void;
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  itemLabel,
  itemName,
  consequencesIntro,
  consequences,
  isPending,
  onConfirm,
}: Props) {
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (!open) setConfirmText("");
  }, [open]);

  const canConfirm = !isPending && itemName !== undefined && confirmText === itemName;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <p className="font-semibold text-destructive">
                This action is irreversible and cannot be undone.
              </p>
              <p>{consequencesIntro}</p>
              <ul className="list-disc pl-5 space-y-1">
                {consequences.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
              <p className="text-sm">
                Consider archiving instead if you may need this data in the future.
              </p>
              <div className="pt-2">
                <Label htmlFor="confirm-name" className="text-sm font-medium">
                  Type the {itemLabel} name to confirm: <span className="font-bold">{itemName}</span>
                </Label>
                <Input
                  id="confirm-name"
                  className="mt-1.5"
                  placeholder={`Type ${itemLabel} name here`}
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                />
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
            disabled={!canConfirm}
          >
            {isPending ? "Deleting..." : "Permanently Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
