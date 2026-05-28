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
import { Link } from "wouter";

interface PaymentEntry {
  bowlerId: number;
  type: string;
  amount: string;
  checkNumber?: string;
}

interface BowlerInfo {
  id: number;
  name: string;
}

interface PaymentEntryRowProps {
  bowler: BowlerInfo;
  teamName?: string;
  entry: PaymentEntry | undefined;
  onPaymentTypeChange: (bowlerId: number, type: string) => void;
  onAmountChange: (bowlerId: number, amount: string) => void;
  onCheckNumberChange: (bowlerId: number, checkNumber: string) => void;
  onSubmit: (bowlerId: number) => void;
  isSubmitting: boolean;
  variant?: "table" | "card";
  bowlerHrefSuffix?: string;
}

export const PaymentEntryRow = memo(function PaymentEntryRow({
  bowler,
  teamName,
  entry,
  onPaymentTypeChange,
  onAmountChange,
  onCheckNumberChange,
  onSubmit,
  isSubmitting,
  variant = "table",
  bowlerHrefSuffix = "",
}: PaymentEntryRowProps) {
  if (variant === "card") {
    return (
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Link href={`/bowlers/${bowler.id}${bowlerHrefSuffix}`} className="hover:underline text-foreground font-medium">
            {bowler.name}
          </Link>
          {teamName !== undefined && (
            <span className="text-sm text-muted-foreground">{teamName}</span>
          )}
        </div>
        <div className="space-y-2">
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
              placeholder="Check number"
              value={entry?.checkNumber || ""}
              onChange={(e) => onCheckNumberChange(bowler.id, e.target.value)}
            />
          )}
          <Input
            type="text"
            placeholder="Amount (0.00)"
            value={entry?.amount || ""}
            onChange={(e) => onAmountChange(bowler.id, e.target.value)}
          />
          <Button
            className="w-full"
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
              <Loader2 className="mr-2 size-4 animate-spin" />
            )}
            Record Payment
          </Button>
        </div>
      </div>
    );
  }

  return (
    <TableRow>
      <TableCell>
        <Link href={`/bowlers/${bowler.id}${bowlerHrefSuffix}`} className="hover:underline text-foreground">
          {bowler.name}
        </Link>
      </TableCell>
      {teamName !== undefined && (
        <TableCell className="text-muted-foreground">{teamName}</TableCell>
      )}
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
            <Loader2 className="mr-2 size-4 animate-spin" />
          )}
          Record Payment
        </Button>
      </TableCell>
    </TableRow>
  );
});
