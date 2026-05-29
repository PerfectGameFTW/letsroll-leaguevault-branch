import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2 } from "lucide-react";

interface RemoveTarget {
  bowlerId: number;
  name: string;
}

interface TeamViewRemoveBowlerDialogProps {
  target: RemoveTarget | null;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}

export function TeamViewRemoveBowlerDialog({
  target,
  onOpenChange,
  onCancel,
  onConfirm,
  isPending,
}: TeamViewRemoveBowlerDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove Bowler from Team</DialogTitle>
          <DialogDescription>
            Are you sure you want to remove {target?.name} from this team? This will completely remove their association with this team.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
