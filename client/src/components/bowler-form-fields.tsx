import type { Control } from "react-hook-form";
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { InsertBowler } from "@shared/schema";

interface BowlerFormFieldsProps {
  control: Control<InsertBowler>;
  watchedIsMinor: boolean;
}

export function BowlerFormFields({ control, watchedIsMinor }: BowlerFormFieldsProps) {
  return (
    <>
      <FormField
        control={control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="isMinor"
        render={({ field }) => (
          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3" data-testid="field-isMinor">
            <div className="space-y-0.5">
              <FormLabel>Minor (Youth Bowler)</FormLabel>
              <p className="text-sm text-muted-foreground">
                Email is optional for minors. Notifications and payments are routed through a guardian.
              </p>
            </div>
            <FormControl>
              <Switch
                checked={field.value === true}
                onCheckedChange={field.onChange}
                data-testid="switch-isMinor"
              />
            </FormControl>
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{watchedIsMinor ? "Email (optional)" : "Email"}</FormLabel>
            <FormControl>
              <Input
                type="email"
                {...field}
                value={field.value ?? undefined}
                onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={control}
        name="phone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Phone Number</FormLabel>
            <FormControl>
              <Input type="tel" placeholder="(555) 555-5555" {...field} value={field.value ?? ""} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}
