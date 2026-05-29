import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface EditingPaymentState {
  id: number;
  amount: string;
}

interface Props {
  editingPayment: EditingPaymentState | null;
  onChange: (next: EditingPaymentState | null) => void;
  onSave: (id: number) => void;
  isPending: boolean;
}

export function EditPaymentAmountDialog({ editingPayment, onChange, onSave, isPending }: Props) {
  return (
    <Dialog open={editingPayment !== null} onOpenChange={(open) => !open && onChange(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Payment Amount</DialogTitle>
          <DialogDescription>Update the payment amount below.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2">
            <Label htmlFor="amount">Amount ($)</Label>
            <Input
              id="amount"
              value={editingPayment?.amount || ""}
              onChange={(e) =>
                onChange(editingPayment ? { ...editingPayment, amount: e.target.value } : null)
              }
              placeholder="0.00"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onChange(null)}>Cancel</Button>
          <Button onClick={() => editingPayment && onSave(editingPayment.id)} disabled={isPending}>
            {isPending ? <Loader2 className="mr-2 size-4 animate-spin" /> : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
