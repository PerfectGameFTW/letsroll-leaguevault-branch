import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, Calendar as CalendarIcon } from "lucide-react";
import { PageLoadingState } from "@/components/page-states";
import { startOfToday } from "date-fns";
import type { League, Payment, ApiResponse } from "@shared/schema";
import { useParams, Link } from "wouter";
import { PaymentEntryRow } from "@/components/payment-entry-row";
import { PaymentHistoryTable } from "@/components/payment-history-table";
import { useWeeklyPayments, getNearestBowlingDay, getWeekNumber, isDateDisabled } from "@/hooks/use-weekly-payments";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface EnrichedBowlerLeague {
  id: number;
  bowlerId: number;
  leagueId: number;
  teamId: number;
  bowler: { id: number; name: string; email: string | null; active: boolean } | null;
  team: { id: number; name: string; number: number; leagueId: number } | null;
  league: { id: number; name: string; description: string | null; active: boolean } | null;
}

export default function WeeklyPaymentsPage() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId!);
  const [selectedDate, setSelectedDate] = useState<Date>();

  const {
    paymentEntries,
    paymentToDelete,
    setPaymentToDelete,
    editingPayment,
    setEditingPayment,
    handlePaymentTypeChange,
    handleAmountChange,
    handleCheckNumberChange,
    handleSubmitPayment,
    handleDelete,
    handleStartEdit,
    handleSaveEdit,
    submitPaymentMutation,
    deletePaymentMutation,
    updatePaymentMutation,
  } = useWeeklyPayments(leagueId);

  const { data: userResponse } = useQuery<ApiResponse<any>>({
    queryKey: ["/api/user"],
    staleTime: 1000 * 60 * 5,
  });
  const isAdmin = userResponse?.data?.role === 'system_admin' || userResponse?.data?.role === 'org_admin';

  const { data: leagueResponse, isLoading: loadingLeague } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    staleTime: 1000 * 60 * 30,
  });

  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<{ data: EnrichedBowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues", { leagueId, enriched: true }],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      params.set("leagueId", String(leagueId));
      params.set("enriched", "true");
      const response = await fetch(`/api/bowler-leagues?${params.toString()}`, {
        credentials: "include",
        headers: { "Accept": "application/json" },
        signal,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || "Failed to fetch bowlers");
      }
      return response.json();
    },
    staleTime: 1000 * 60 * 5,
  });

  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<{ data: Payment[] }>({
    queryKey: ["/api/payments", { leagueId, weekOf: selectedDate?.toISOString() }],
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams();
      if (selectedDate) params.set("weekOf", selectedDate.toISOString());
      params.set("leagueId", String(leagueId));
      const response = await fetch(`/api/payments?${params.toString()}`, {
        credentials: "include",
        headers: { "Accept": "application/json" },
        signal,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData?.error?.message || "Failed to fetch payments");
      }
      return response.json();
    },
    enabled: !!selectedDate,
    staleTime: 1000 * 60,
  });

  const league = leagueResponse?.data;
  const payments = paymentsResponse?.data || [];
  const enrichedBowlerLeagues = bowlerLeaguesResponse?.data || [];

  const sortedBowlerLeagues = useMemo(() => {
    return [...enrichedBowlerLeagues]
      .filter(bl => bl.bowler)
      .sort((a, b) => {
        const aTeam = a.team?.number ?? Infinity;
        const bTeam = b.team?.number ?? Infinity;
        const teamDiff = aTeam - bTeam;
        if (teamDiff !== 0) return teamDiff;
        return (a.bowler?.name ?? "").localeCompare(b.bowler?.name ?? "");
      });
  }, [enrichedBowlerLeagues]);

  const bowlers = useMemo(() => {
    return sortedBowlerLeagues
      .map(bl => bl.bowler!)
      .filter((bowler, index, self) => self.findIndex(b => b.id === bowler.id) === index);
  }, [sortedBowlerLeagues]);

  const bowlerTeamMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const bl of sortedBowlerLeagues) {
      if (bl.bowler) {
        map.set(bl.bowler.id, bl.team?.name ?? "Unassigned");
      }
    }
    return map;
  }, [sortedBowlerLeagues]);

  useEffect(() => {
    if (league?.weekDay && !selectedDate) {
      const today = startOfToday();
      const nearestBowlingDay = getNearestBowlingDay(
        today,
        league.weekDay,
        league.skipDates ?? [],
        league.cancelledDates ?? []
      );
      setSelectedDate(nearestBowlingDay);
    }
  }, [league?.weekDay, selectedDate]);

  let disabledDates: { before: Date; after: Date } | undefined;
  if (league) {
    disabledDates = {
      before: new Date(league.seasonStart),
      after: new Date(league.seasonEnd),
    };
  }

  if ((loadingLeague || loadingBowlerLeagues) && !league) {
    return (
      <Layout>
        <PageLoadingState />
      </Layout>
    );
  }

  if (!league) {
    return (
      <Layout>
        <div className="text-center">League not found</div>
      </Layout>
    );
  }

  return (
    <Layout>
      <ErrorBoundary level="section">
      <div className="space-y-6">
        <Link
          href={`/leagues/${leagueId}`}
          className="text-muted-foreground hover:text-foreground flex items-center mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to League Dashboard
        </Link>

        <div className="flex flex-col space-y-4">
          <h1 className="text-2xl font-bold">{league.name}: Weekly Payments</h1>

          <div className="flex gap-4">
            <div className="w-[200px]">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !selectedDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {selectedDate ? (
                      `Week ${getWeekNumber(selectedDate, league)}`
                    ) : (
                      <span>Select a week</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={selectedDate}
                    onSelect={setSelectedDate}
                    disabled={(date) => {
                      if (disabledDates) {
                        const beforeDisabled = date < disabledDates.before;
                        const afterDisabled = date > disabledDates.after;
                        const dayDisabled = isDateDisabled(date, league);
                        return beforeDisabled || afterDisabled || dayDisabled;
                      }
                      return false;
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        </div>

        <ErrorBoundary level="section">
        {selectedDate && (
          <Card>
            <CardHeader>
              <CardTitle>
                Week {getWeekNumber(selectedDate, league)}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {loadingPayments || loadingBowlerLeagues ? (
                <PageLoadingState fullPage={false} />
              ) : (
                <div className="space-y-6">
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Bowler</TableHead>
                          <TableHead>Team</TableHead>
                          <TableHead>Payment Type</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {sortedBowlerLeagues.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                              No bowlers found in this league
                            </TableCell>
                          </TableRow>
                        )}
                        {sortedBowlerLeagues.map((bl) => (
                          <PaymentEntryRow
                            key={bl.id}
                            bowler={bl.bowler!}
                            teamName={bl.team?.name ?? "Unassigned"}
                            entry={paymentEntries[bl.bowler!.id]}
                            onPaymentTypeChange={handlePaymentTypeChange}
                            onAmountChange={handleAmountChange}
                            onCheckNumberChange={handleCheckNumberChange}
                            onSubmit={(bowlerId) => handleSubmitPayment(bowlerId, selectedDate)}
                            isSubmitting={submitPaymentMutation.isPending}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <PaymentHistoryTable
                    payments={payments}
                    bowlers={bowlers}
                    bowlerTeamMap={bowlerTeamMap}
                    onStartEdit={handleStartEdit}
                    onDelete={setPaymentToDelete}
                    isDeletePending={deletePaymentMutation.isPending}
                    isAdmin={isAdmin}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
        </ErrorBoundary>

        <Dialog open={editingPayment !== null} onOpenChange={(open) => !open && setEditingPayment(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Payment Amount</DialogTitle>
              <DialogDescription>
                Update the payment amount below.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="amount">Amount ($)</Label>
                <Input
                  id="amount"
                  value={editingPayment?.amount || ""}
                  onChange={(e) => setEditingPayment(prev =>
                    prev ? { ...prev, amount: e.target.value } : null
                  )}
                  placeholder="0.00"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEditingPayment(null)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => editingPayment && handleSaveEdit(editingPayment.id)}
                disabled={updatePaymentMutation.isPending}
              >
                {updatePaymentMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : "Save Changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={paymentToDelete !== null} onOpenChange={() => setPaymentToDelete(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Payment</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this payment? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setPaymentToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => handleDelete(paymentToDelete!)}
                disabled={deletePaymentMutation.isPending}
              >
                {deletePaymentMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : "Delete"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      </ErrorBoundary>
    </Layout>
  );
}
