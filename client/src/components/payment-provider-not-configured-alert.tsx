import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  CLOVER_FIELD_LABELS,
  SQUARE_FIELD_LABELS,
  type RequiredCloverField,
  type RequiredSquareField,
} from "@shared/schema";

interface PaymentProviderNotConfiguredAlertProps {
  isClover: boolean;
  missingFields: (RequiredCloverField | RequiredSquareField)[];
  isAdmin: boolean;
  onOpenSettings: () => void;
}

export function PaymentProviderNotConfiguredAlert({
  isClover,
  missingFields,
  isAdmin,
  onOpenSettings,
}: PaymentProviderNotConfiguredAlertProps) {
  const providerLabel = isClover ? 'Clover' : 'Square';
  const providerFieldLabels: Record<string, string> = isClover
    ? CLOVER_FIELD_LABELS
    : SQUARE_FIELD_LABELS;
  const labelForMissingField = (f: RequiredCloverField | RequiredSquareField): string =>
    providerFieldLabels[f] ?? f;

  return (
    <Alert
      variant="destructive"
      data-testid={
        isClover
          ? "alert-clover-not-configured"
          : "alert-square-not-configured"
      }
    >
      <AlertTriangle className="size-4" />
      <AlertTitle>{providerLabel} isn't fully set up for this location</AlertTitle>
      <AlertDescription>
        <p className="text-sm">
          Card payments are unavailable until every required {providerLabel}{' '}
          credential is filled in.
        </p>
        {missingFields.length > 0 && (
          <p className="text-xs mt-2">
            Missing:{" "}
            <span className="font-medium">
              {missingFields
                .map((f) => labelForMissingField(f))
                .join(", ")}
            </span>
            .
          </p>
        )}
        <p className="text-xs mt-2">
          {isAdmin
            ? `Finish configuring ${providerLabel} in Settings to enable card payments. Cash and check payments still work in the meantime.`
            : `Ask your league admin to finish configuring ${providerLabel} in Settings, then try again. Cash and check payments still work in the meantime.`}
        </p>
        {isAdmin && (
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid={
                isClover
                  ? "button-clover-not-configured-open-settings"
                  : "button-square-not-configured-open-settings"
              }
              onClick={onOpenSettings}
            >
              Open Settings
            </Button>
          </div>
        )}
      </AlertDescription>
    </Alert>
  );
}
