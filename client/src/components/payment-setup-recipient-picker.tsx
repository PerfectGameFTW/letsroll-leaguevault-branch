import { FC } from "react";
import { Users } from "lucide-react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PaymentSetupRecipientPickerProps {
  selfBowler: { id: number; name: string };
  targetBowlerId: number;
  setTargetBowlerId: (id: number) => void;
  partnerOptions: { id: number; name: string }[];
}

export const PaymentSetupRecipientPicker: FC<PaymentSetupRecipientPickerProps> = ({
  selfBowler,
  targetBowlerId,
  setTargetBowlerId,
  partnerOptions,
}) => {
  return (
    <div className="space-y-2" data-testid="recipient-picker">
      <Label className="flex items-center gap-2 text-sm font-medium">
        <Users className="size-4 text-muted-foreground" /> Pay for
      </Label>
      <Select
        value={String(targetBowlerId)}
        onValueChange={(v) => setTargetBowlerId(Number(v))}
      >
        <SelectTrigger data-testid="select-recipient">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem
            value={String(selfBowler.id)}
            data-testid={`recipient-option-${selfBowler.id}`}
          >
            {selfBowler.name} (you)
          </SelectItem>
          {partnerOptions.map((p) => (
            <SelectItem
              key={p.id}
              value={String(p.id)}
              data-testid={`recipient-option-${p.id}`}
            >
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {targetBowlerId !== selfBowler.id && (
        <p className="text-xs text-muted-foreground">
          This payment will be recorded against your linked partner and
          attributed as paid by you.
        </p>
      )}
    </div>
  );
};
