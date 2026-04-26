import { useState, useEffect } from "react";
import { Loader2, Send } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { csrfFetch } from "@/lib/queryClient";
import type { Payment } from "@shared/schema";

interface Props {
  payment: Payment | null;
  defaultEmail?: string;
  onClose: () => void;
}

export function ResendReceiptDialog({ payment, defaultEmail, onClose }: Props) {
  const { toast } = useToast();
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (payment) {
      setEmail(defaultEmail ?? "");
    }
  }, [payment, defaultEmail]);

  const handleSubmit = async () => {
    if (!payment) return;
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes("@")) {
      toast({
        title: "Invalid email",
        description: "Enter a valid email address.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsPending(true);
      const response = await csrfFetch(
        `/api/payments-provider/payments/${payment.id}/resend-receipt`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to resend receipt");
      }
      toast({
        title: "Receipt sent",
        description: `Receipt emailed to ${trimmed}.`,
      });
      onClose();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to resend receipt",
        variant: "destructive",
      });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={payment !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Resend Receipt</DialogTitle>
          <DialogDescription>
            Email the Square receipt link for this payment to a recipient.
            Useful when the bowler had no email on file at checkout or the
            original receipt didn't reach them.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 space-y-2">
          <Label htmlFor="resend-receipt-email">Email address</Label>
          <Input
            id="resend-receipt-email"
            type="email"
            placeholder="bowler@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
