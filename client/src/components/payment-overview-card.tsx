import { FC, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Loader2, CreditCard, CalendarDays, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatCurrency } from "@/lib/utils";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { DEFAULT_TIMEZONE } from "@shared/schema";
import type { League } from "@shared/schema";

interface ScheduleData {
  id: number;
  frequency: string;
  nextPaymentDate: string;
  amount: number;
  active: boolean;
  leagueTimezone?: string;
}

interface FinancialsData {
  fullSeasonAmount: number;
  totalDueToDate: number;
  totalPaid: number;
  amountPastDue: number;
  remainingBalance: number;
  finalTwoWeeks: {
    amount: number;
    isPaid: boolean;
    isPastDue: boolean;
    dueByWeek: number;
    dueByDate: Date | null;
  };
}

interface PaymentOverviewCardProps {
  league: League;
  weeklyFee: number;
  financials: FinancialsData;
  activeSchedule?: ScheduleData;
  bowlerId: number;
  onSetupPayment: (mode: 'autopay' | 'onetime') => void;
}

export const PaymentOverviewCard: FC<PaymentOverviewCardProps> = ({
  league,
  weeklyFee,
  financials,
  activeSchedule,
  bowlerId,
  onSetupPayment,
}) => {
  const { toast } = useToast();
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  const cancelScheduleMutation = useMutation({
    mutationFn: async (scheduleId: number) => {
      return apiRequest(`/api/payment-schedules/${scheduleId}`, 'DELETE');
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: [`/api/payment-schedules/${bowlerId}/${league.id}`] });
      setShowCancelConfirm(false);
      toast({ title: "Auto-pay cancelled", description: "Your automatic payment schedule has been cancelled." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to cancel auto-pay. Please try again.", variant: "destructive" });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payment Overview</CardTitle>
      </CardHeader>
      <CardContent className="pt-6 space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Full Season Total Due</span>
            <span className="text-sm font-medium">{formatCurrency(financials.fullSeasonAmount)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Weekly Fee</span>
            <span className="text-sm font-medium">{formatCurrency(weeklyFee)}/week</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Amount Due to Date</span>
            <span className="text-sm font-medium">{formatCurrency(financials.totalDueToDate)}</span>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Amount Paid to Date</span>
            <span className="text-sm font-medium">{formatCurrency(financials.totalPaid)}</span>
          </div>

          {financials.amountPastDue > 0 && (
            <div className="flex items-center justify-between rounded-md bg-destructive/10 px-3 py-2">
              <span className="text-sm font-medium text-destructive flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Past Due
              </span>
              <span className="text-sm font-bold text-destructive">{formatCurrency(financials.amountPastDue)}</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Full Season Remaining Balance</span>
            <span className="text-sm font-medium">{formatCurrency(financials.remainingBalance)}</span>
          </div>

          {financials.remainingBalance <= 0 && financials.totalPaid > 0 && (
            <div className="flex items-center justify-center gap-2 rounded-md bg-green-500/10 px-3 py-3">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="text-sm font-semibold text-green-600">Season Paid in Full</span>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Payment Schedule</span>
            <span className="text-sm font-medium">
              {activeSchedule
                ? activeSchedule.frequency === 'upfront'
                  ? `Full season (${formatCurrency(activeSchedule.amount)})`
                  : `Auto-pay: ${formatCurrency(activeSchedule.amount)}/${activeSchedule.frequency === 'weekly' ? 'week' : 'month'}`
                : 'No payment set up'}
            </span>
          </div>

          {activeSchedule && (
            <div className="flex items-center justify-between pl-5">
              <span className="text-xs text-muted-foreground">Next payment</span>
              <span className="text-xs text-muted-foreground">
                {formatInTimeZone(new Date(activeSchedule.nextPaymentDate), activeSchedule.leagueTimezone || DEFAULT_TIMEZONE, 'MMM d, yyyy h:mm a')}
              </span>
            </div>
          )}

          {league.paymentMode !== 'upfront' && financials.finalTwoWeeks.amount > 0 && !financials.finalTwoWeeks.isPaid && (
            <div className={`flex items-center justify-between rounded-md px-3 py-2 ${
              financials.finalTwoWeeks.isPastDue ? 'bg-destructive/10' : 'bg-muted'
            }`}>
              <div className="flex flex-col gap-0.5">
                <span className={`text-sm font-medium flex items-center gap-1.5 ${
                  financials.finalTwoWeeks.isPastDue ? 'text-destructive' : ''
                }`}>
                  {financials.finalTwoWeeks.isPastDue
                    ? <AlertTriangle className="h-3.5 w-3.5" />
                    : <CalendarDays className="h-3.5 w-3.5" />
                  }
                  Final 2 Weeks
                </span>
                <span className="text-xs text-muted-foreground pl-5">
                  Due by Week {financials.finalTwoWeeks.dueByWeek}
                  {financials.finalTwoWeeks.dueByDate && ` (${format(financials.finalTwoWeeks.dueByDate, 'MMM d, yyyy')})`}
                </span>
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <span className={`text-sm font-bold ${
                  financials.finalTwoWeeks.isPastDue ? 'text-destructive' : ''
                }`}>
                  {formatCurrency(financials.finalTwoWeeks.amount)}
                </span>
                <span className={`text-xs font-medium ${
                  financials.finalTwoWeeks.isPastDue ? 'text-destructive' : 'text-muted-foreground'
                }`}>
                  {financials.finalTwoWeeks.isPastDue ? 'Past Due' : 'Due'}
                </span>
              </div>
            </div>
          )}
        </div>

        <Separator />

        {activeSchedule && !showCancelConfirm && (
          <Button
            variant="ghost"
            onClick={() => setShowCancelConfirm(true)}
            className="w-full text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            Cancel Auto-Pay
          </Button>
        )}

        {activeSchedule && showCancelConfirm && (
          <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm font-medium">Are you sure you want to cancel auto-pay?</p>
            <p className="text-xs text-muted-foreground">You will need to set it up again if you change your mind.</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowCancelConfirm(false)} className="flex-1" size="sm">
                Keep It
              </Button>
              <Button
                variant="destructive"
                onClick={() => cancelScheduleMutation.mutate(activeSchedule.id)}
                disabled={cancelScheduleMutation.isPending}
                className="flex-1"
                size="sm"
              >
                {cancelScheduleMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Yes, Cancel
              </Button>
            </div>
          </div>
        )}

        {!activeSchedule && financials.remainingBalance > 0 && league.paymentMode === 'upfront' && (
          <div className="space-y-2">
            <Button className="w-full" onClick={() => onSetupPayment('autopay')}>
              Pay Full Season ({formatCurrency(financials.fullSeasonAmount)})
              <CreditCard className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}

        {!activeSchedule && financials.remainingBalance > 0 && league.paymentMode !== 'upfront' && (
          <div className="space-y-2">
            <Button onClick={() => onSetupPayment('autopay')} className="w-full">
              {financials.amountPastDue > 0
                ? `Pay ${formatCurrency(financials.amountPastDue)} & Set Up Auto-Pay`
                : 'Set Up Auto-Pay'}
              <CreditCard className="ml-2 h-4 w-4" />
            </Button>
            <Button variant="outline" onClick={() => onSetupPayment('onetime')} className="w-full">
              Make One-Time Payment
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
