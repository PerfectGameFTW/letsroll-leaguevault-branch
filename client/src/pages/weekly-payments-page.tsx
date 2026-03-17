import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, ArrowLeft, Calendar as CalendarIcon } from "lucide-react";
import { startOfToday } from "date-fns";
import type { League, Payment, Bowler, BowlerLeague } from "@shared/schema";
import { useTeams } from "@/hooks/use-teams";
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

export default function WeeklyPaymentsPage() {
  const params = useParams();
  const leagueId = parseInt(params.leagueId!);
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedTeam, setSelectedTeam] = useState<string>();

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

  const { data: leagueResponse, isLoading: loadingLeague } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    staleTime: 1000 * 60 * 30,
  });

  const { teams, isLoading: loadingTeams } = useTeams({ leagueId });

  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<{ data: Payment[] }>({
    queryKey: ["/api/payments", { teamId: selectedTeam, weekOf: selectedDate?.toISOString(), leagueId }],
    enabled: !!selectedTeam && !!selectedDate,
    staleTime: 1000 * 60,
  });

  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues", selectedTeam, leagueId],
    enabled: !!selectedTeam,
    staleTime: 1000 * 60 * 5,
  });

  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers", bowlerLeaguesResponse?.data],
    enabled: !!bowlerLeaguesResponse?.data?.length,
    staleTime: 1000 * 60 * 5,
  });

  const league = leagueResponse?.data;
  const payments = paymentsResponse?.data || [];
  const bowlerLeagues = bowlerLeaguesResponse?.data || [];
  const allBowlers = bowlersResponse?.data || [];

  const bowlers = allBowlers.filter(bowler => {
    return bowlerLeagues.some(bl => 
      bl.bowlerId === bowler.id && 
      bl.teamId === parseInt(selectedTeam || '0', 10) &&
      bl.leagueId === leagueId
    );
  });

  useEffect(() => {
    if (league?.weekDay && !selectedDate) {
      const today = startOfToday();
      const nearestBowlingDay = getNearestBowlingDay(today, league.weekDay);
      setSelectedDate(nearestBowlingDay);
    }

    if (teams.length > 0 && !selectedTeam) {
      const team1 = teams.find(t => t.number === 1) || teams[0];
      setSelectedTeam(team1.id.toString());
    }
  }, [league?.weekDay, teams, selectedDate, selectedTeam]);

  let disabledDates: { before: Date; after: Date } | undefined;
  if (league) {
    disabledDates = {
      before: new Date(league.seasonStart),
      after: new Date(league.seasonEnd),
    };
  }

  if ((loadingLeague || loadingTeams) && !league) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
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

  const selectedTeamData = teams.find(t => t.id.toString() === selectedTeam);

  return (
    <Layout>
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

            <div className="w-[200px]">
              <Select value={selectedTeam} onValueChange={setSelectedTeam}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.id.toString()} value={team.id.toString()}>
                      Team {team.number} - {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {selectedDate && selectedTeamData && (
          <Card>
            <CardHeader>
              <CardTitle>
                {selectedTeamData.name} - Week {getWeekNumber(selectedDate, league)}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {loadingPayments || loadingBowlers ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Bowler</TableHead>
                          <TableHead>Payment Type</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bowlers.map((bowler) => (
                          <PaymentEntryRow
                            key={bowler.id}
                            bowler={bowler}
                            entry={paymentEntries[bowler.id]}
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
                    onStartEdit={handleStartEdit}
                    onDelete={setPaymentToDelete}
                    isDeletePending={deletePaymentMutation.isPending}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}

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
    </Layout>
  );
}
