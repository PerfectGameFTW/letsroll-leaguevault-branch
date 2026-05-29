import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { League } from "@shared/schema";

interface PaymentFeeInfoAlertProps {
  league: League;
}

export function PaymentFeeInfoAlert({ league }: PaymentFeeInfoAlertProps) {
  return (
    <Alert>
      <Info className="size-4" />
      <AlertDescription>
        <div className="space-y-1">
          <div>Weekly fee: <span className="font-medium">${(league.weeklyFee / 100).toFixed(2)}</span></div>
          {league.squareLineageItemName && (
            <div className="text-xs text-muted-foreground">Lineage: {league.squareLineageItemName}</div>
          )}
          {league.squarePrizeFundItemName && (
            <div className="text-xs text-muted-foreground">Prize Fund: {league.squarePrizeFundItemName}</div>
          )}
        </div>
      </AlertDescription>
    </Alert>
  );
}
