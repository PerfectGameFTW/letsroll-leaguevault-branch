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
import { Loader2 } from "lucide-react";

interface DuplicateBowler {
  id: number;
  name: string;
  email: string;
}

interface BowlerFormDuplicateDialogProps {
  duplicateBowler: DuplicateBowler | null;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
  selectedLeagueId: number | null;
  selectedTeamId: number | null;
}

export function BowlerFormDuplicateDialog({
  duplicateBowler,
  onOpenChange,
  onCancel,
  onConfirm,
  isPending,
  selectedLeagueId,
  selectedTeamId,
}: BowlerFormDuplicateDialogProps) {
  return (
    <AlertDialog open={!!duplicateBowler} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Duplicate Bowler Found</AlertDialogTitle>
          <AlertDialogDescription>
            A bowler named <strong>{duplicateBowler?.name}</strong> with email{" "}
            <strong>{duplicateBowler?.email}</strong> already exists. Would you like to add them to this team instead?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={isPending || !selectedLeagueId || !selectedTeamId}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Adding…
              </>
            ) : (
              "Add to Team"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
