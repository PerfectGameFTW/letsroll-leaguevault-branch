import { FormControl, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

interface PaymentReceiptEmailFieldProps {
  value: string;
  onChange: (value: string) => void;
}

export function PaymentReceiptEmailField({ value, onChange }: PaymentReceiptEmailFieldProps) {
  return (
    <FormItem>
      <FormLabel>
        Email for receipt <span className="text-destructive">*</span>
      </FormLabel>
      <FormControl>
        <Input
          type="email"
          placeholder="bowler@example.com"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </FormControl>
      <p className="text-xs text-muted-foreground">
        This bowler has no email on file. Add one to send a Square receipt.
      </p>
    </FormItem>
  );
}
