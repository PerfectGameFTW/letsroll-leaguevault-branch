import { memo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import type { Bowler } from "@shared/schema";

interface PaymentEntry {
  bowlerId: number;
  type: string;
  amount: string;
  checkNumber?: string;
}

interface PaymentEntryRowProps {
  bowler: Bowler;
  entry: PaymentEntry | undefined;
  onPaymentTypeChange: (bowlerId: number, type: string) => void;
  onAmountChange: (bowlerId: number, amount: string) => void;
  onCheckNumberChange: (bowlerId: number, checkNumber: string) => void;
  onSubmit: (bowlerId: number) => void;
  isSubmitting: boolean;
}

export const PaymentEntryRow = memo(function PaymentEntryRow({
  bowler,
  entry,
  onPaymentTypeChange,
  onAmountChange,
  onCheckNumberChange,
  onSubmit,
  isSubmitting,
}: PaymentEntryRowProps) {
  return (
    <TableRow>
      <TableCell>{bowler.name}</TableCell>
      <TableCell>
        <Select
          value={entry?.type || ""}
          onValueChange={(value) => onPaymentTypeChange(bowler.id, value)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="check">Check</SelectItem>
          </SelectContent>
        </Select>
        {entry?.type === 'check' && (
          <Input
            className="mt-2"
            placeholder="Check number"
            value={entry?.checkNumber || ""}
            onChange={(e) => onCheckNumberChange(bowler.id, e.target.value)}
          />
        )}
      </TableCell>
      <TableCell>
        <Input
          type="text"
          placeholder="0.00"
          value={entry?.amount || ""}
          onChange={(e) => onAmountChange(bowler.id, e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Button
          onClick={() => onSubmit(bowler.id)}
          disabled={
            !entry?.type ||
            !entry?.amount ||
            (entry?.type === 'check' && !entry?.checkNumber) ||
            isSubmitting
          }
          size="sm"
        >
          {isSubmitting && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          Record Payment
        </Button>
      </TableCell>
    </TableRow>
  );
});
