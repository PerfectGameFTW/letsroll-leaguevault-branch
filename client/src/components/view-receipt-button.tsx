import { useState } from "react";
import { Loader2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { csrfFetch, queryClient } from "@/lib/queryClient";
import type { Payment } from "@shared/schema";

interface Props {
  payment: Payment;
  variant?: "icon" | "link";
}

/**
 * Opens the Square hosted receipt for a paid card payment.
 *
 * Two paths:
 * 1. Cached: `payment.receiptUrl` is already on the row -> open in a
 * new tab immediately (no network).
 * 2. Lazy backfill: legacy rows pre-#503 (and any row where Square's
 * receipt URL wasn't returned at charge time) hit
 * gET /api/payments-provider/payments/:id/receipt, which calls
 *     `provider.getPayment()` and caches the URL back to the row, then
 * we open the returned URL.
 *
 * renders nothing for non-card / unpaid / providerless rows since
 * those have no hosted receipt to show.
 */
export function ViewReceiptButton({ payment, variant = "icon" }: Props) {
  const { toast } = useToast();
  const [isFetching, setIsFetching] = useState(false);

  // Show the button for any paid card row that either has a cached
  // receipt URL or a provider payment id we can fetch by. Provider
  // resolution happens server-side in the lazy-backfill endpoint;
  // legacy CardPointe rows simply 404 cleanly and surface a toast.
  const isCardPaid =
    payment.status === "paid" &&
    (payment.type === "square" || payment.type === "credit_card");
  const hasReceipt = !!payment.receiptUrl;
  const canBackfill = !!payment.providerPaymentId;

  if (!isCardPaid || (!hasReceipt && !canBackfill)) {
    return variant === "link" ? <span className="text-muted-foreground">—</span> : null;
  }

  const openCached = () => {
    if (payment.receiptUrl) {
      window.open(payment.receiptUrl, "_blank", "noopener,noreferrer");
    }
  };

  const fetchAndOpen = async () => {
    try {
      setIsFetching(true);
      const response = await csrfFetch(
        `/api/payments-provider/payments/${payment.id}/receipt`,
      );
      const data = await response.json();
      if (!response.ok) {
        const code = data?.error?.code;
        const msg =
          code === "RECEIPT_UNAVAILABLE"
            ? "No receipt is available for this payment yet. The provider may not have generated one."
            : data?.error?.message || "Could not fetch receipt.";
        toast({ title: "Receipt unavailable", description: msg, variant: "destructive" });
        return;
      }
      const url: string | undefined = data?.data?.receiptUrl;
      if (!url) {
        toast({
          title: "Receipt unavailable",
          description: "No receipt URL was returned.",
          variant: "destructive",
        });
        return;
      }
      // Refresh payment lists so the cached URL shows up next render.
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast({
        title: "Receipt unavailable",
        description: error instanceof Error ? error.message : "Could not fetch receipt.",
        variant: "destructive",
      });
    } finally {
      setIsFetching(false);
    }
  };

  const onClick = hasReceipt ? openCached : fetchAndOpen;
  const title = hasReceipt ? "View receipt" : "Look up receipt";

  if (variant === "link") {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={isFetching}
        className="inline-flex items-center gap-1 text-sm text-primary hover:underline disabled:opacity-50"
        title={title}
      >
        {isFetching ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Receipt className="h-4 w-4" />
        )}
        {hasReceipt ? "View" : "Look up"}
      </button>
    );
  }

  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={onClick}
      disabled={isFetching}
      title={title}
    >
      {isFetching ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Receipt className="h-4 w-4 text-primary" />
      )}
    </Button>
  );
}
