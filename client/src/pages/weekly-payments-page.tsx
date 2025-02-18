import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
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
import { Loader2, ArrowLeft, Calendar as CalendarIcon, Trash2 } from "lucide-react";
import { format, differenceInWeeks, startOfToday, subDays } from "date-fns";
import type { League, Team, Payment, Bowler, BowlerLeague } from "@shared/schema";
import { useParams, Link } from "wouter";
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
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PaymentEntry {
  bowlerId: number;
  type: string;
  amount: string;
  checkNumber?: string;
}

export default function WeeklyPaymentsPage() {
  const params = useParams();
  const { toast } = useToast();
  const leagueId = parseInt(params.leagueId!);
  const [paymentToDelete, setPaymentToDelete] = useState<number | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedTeam, setSelectedTeam] = useState<string>();
  const [paymentEntries, setPaymentEntries] = useState<{ [key: number]: PaymentEntry }>({});
  const [editingPayment, setEditingPayment] = useState<{id: number, amount: string} | null>(null);

  // Fetch league details with longer stale time
  const { data: leagueResponse, isLoading: loadingLeague } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
    staleTime: 1000 * 60 * 30, // 30 minutes
  });

  // Fetch teams for this league
  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ data: Team[] }>({
    queryKey: ["/api/teams", leagueId],
    staleTime: 1000 * 60 * 15, // 15 minutes
  });

  // Update the payments query to include all relevant parameters
  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<{ data: Payment[] }>({
    queryKey: ["/api/payments", { teamId: selectedTeam, weekOf: selectedDate?.toISOString(), leagueId }],
    enabled: !!selectedTeam && !!selectedDate,
    staleTime: 1000 * 60, // 1 minute
  });

  // Fetch bowlers for the selected team - only if we have teams and a selected team
  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues", selectedTeam, leagueId],
    enabled: !!selectedTeam,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Only fetch bowler details if we have bowler leagues
  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers", bowlerLeaguesResponse?.data],
    enabled: !!bowlerLeaguesResponse?.data?.length,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const league = leagueResponse?.data;
  const teams = teamsResponse?.data || [];
  const payments = paymentsResponse?.data || [];
  const bowlerLeagues = bowlerLeaguesResponse?.data || [];
  const allBowlers = bowlersResponse?.data || [];

  // Debug logs for incoming data
  console.log('Selected Team ID:', selectedTeam);
  console.log('Bowler Leagues:', bowlerLeagues);
  console.log('All Bowlers:', allBowlers);
  console.log('League ID:', leagueId);

  // Filter bowlers for the selected team
  const bowlers = allBowlers.filter(bowler => {
    const isAssigned = bowlerLeagues.some(bl => 
      bl.bowlerId === bowler.id && 
      bl.teamId === parseInt(selectedTeam || '0', 10) &&
      bl.leagueId === leagueId
    );
    console.log(`Bowler ${bowler.name} (${bowler.id}) assigned to team ${selectedTeam}: ${isAssigned}`);
    return isAssigned;
  });

  console.log('Filtered Bowlers:', bowlers);

  // Handle payment input changes
  const handlePaymentTypeChange = (bowlerId: number, type: string) => {
    setPaymentEntries(prev => ({
      ...prev,
      [bowlerId]: {
        ...prev[bowlerId],
        bowlerId,
        type,
      }
    }));
  };

  const handleAmountChange = (bowlerId: number, amount: string) => {
    setPaymentEntries(prev => ({
      ...prev,
      [bowlerId]: {
        ...prev[bowlerId],
        bowlerId,
        amount: amount.replace(/[^0-9.]/g, ''),
      }
    }));
  };

  const handleCheckNumberChange = (bowlerId: number, checkNumber: string) => {
    setPaymentEntries(prev => ({
      ...prev,
      [bowlerId]: {
        ...prev[bowlerId],
        bowlerId,
        checkNumber,
      }
    }));
  };

  // Payment submission mutation
  const submitPaymentMutation = useMutation({
    mutationFn: async (payment: {
      bowlerId: number;
      type: string;
      amount: number;
      weekOf: Date;
      leagueId: number;
      status: string;
      checkNumber?: string;
    }) => {
      const response = await apiRequest("POST", "/api/payments", {
        ...payment,
        weekOf: payment.weekOf.toISOString(),
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({
        title: "Payment recorded",
        description: "The payment has been successfully recorded.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error recording payment",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmitPayment = async (bowlerId: number) => {
    const entry = paymentEntries[bowlerId];
    if (!entry?.type || !entry?.amount || !selectedDate) return;

    const amountInCents = Math.round(parseFloat(entry.amount) * 100);
    if (isNaN(amountInCents)) return;

    await submitPaymentMutation.mutate({
      bowlerId,
      leagueId,
      type: entry.type,
      amount: amountInCents,
      weekOf: selectedDate,
      status: 'paid',
      checkNumber: entry.type === 'check' ? entry.checkNumber : undefined,
    });

    // Clear the entry after successful submission
    setPaymentEntries(prev => {
      const newEntries = { ...prev };
      delete newEntries[bowlerId];
      return newEntries;
    });
  };

  // Delete payment mutation
  const deletePaymentMutation = useMutation({
    mutationFn: async (id: number) => {
      console.log('[Frontend] Deleting payment:', id);
      const response = await apiRequest("DELETE", `/api/payments/${id}`);
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }
      return id;
    },
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: ["/api/payments"] });
      const previousPayments = queryClient.getQueryData<{ data: Payment[] }>(["/api/payments"]);

      if (previousPayments?.data) {
        queryClient.setQueryData<{ data: Payment[] }>(["/api/payments"], {
          data: previousPayments.data.filter(payment => payment.id !== deletedId)
        });
      }
      return { previousPayments };
    },
    onError: (error: Error, _, context) => {
      if (context?.previousPayments) {
        queryClient.setQueryData(["/api/payments"], context.previousPayments);
      }
      toast({
        title: "Error deleting payment",
        description: error.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      setPaymentToDelete(null);
      toast({
        title: "Payment deleted",
        description: "The payment has been successfully deleted.",
      });
    },
  });

  const handleDelete = async (id: number) => {
    try {
      await deletePaymentMutation.mutateAsync(id);
    } catch (error) {
      console.error('[Frontend] Error in handleDelete:', error);
    }
  };

  const getNearestBowlingDay = (date: Date, weekDay: string): Date => {
    const weekDayMap: { [key: string]: number } = {
      'sunday': 0,
      'monday': 1,
      'tuesday': 2,
      'wednesday': 3,
      'thursday': 4,
      'friday': 5,
      'saturday': 6
    };

    const targetDay = weekDayMap[weekDay.toLowerCase()];
    const currentDay = date.getDay();

    if (currentDay === targetDay) {
      return date;
    }

    let daysToSubtract = currentDay - targetDay;
    if (daysToSubtract <= 0) {
      daysToSubtract += 7;
    }

    return subDays(date, daysToSubtract);
  };

  const getWeekNumber = (date: Date): number => {
    if (!league?.seasonStart) return 0;
    const seasonStart = new Date(league.seasonStart);
    const weeksDiff = differenceInWeeks(date, seasonStart);
    return weeksDiff + 1;
  };

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

  const isDateDisabled = (date: Date) => {
    if (!league?.weekDay) return false;

    const weekDayMap: { [key: string]: number } = {
      'sunday': 0,
      'monday': 1,
      'tuesday': 2,
      'wednesday': 3,
      'thursday': 4,
      'friday': 5,
      'saturday': 6
    };

    const bowlingDayNumber = weekDayMap[league.weekDay.toLowerCase()];
    return date.getDay() !== bowlingDayNumber;
  };

  // Add update payment mutation
  const updatePaymentMutation = useMutation({
    mutationFn: async ({ id, amount }: { id: number; amount: number }) => {
      const response = await apiRequest("PATCH", `/api/payments/${id}`, {
        amount,
      });
      if (!response.ok) {
        const error = await response.text();
        throw new Error(error);
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({
        title: "Success",
        description: "Payment amount has been updated.",
      });
      setEditingPayment(null);
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating payment",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleStartEdit = (payment: Payment) => {
    setEditingPayment({
      id: payment.id,
      amount: (payment.amount / 100).toFixed(2),
    });
  };

  const handleCancelEdit = () => {
    setEditingPayment(null);
  };

  const handleSaveEdit = async (id: number) => {
    if (!editingPayment) return;

    const amount = editingPayment.amount.trim();
    if (!amount || isNaN(parseFloat(amount))) {
      toast({
        title: "Invalid amount",
        description: "Please enter a valid number",
        variant: "destructive",
      });
      return;
    }

    // Convert amount to cents as integer
    const amountInCents = Math.round(parseFloat(amount) * 100);

    await updatePaymentMutation.mutate({
      id,
      amount: amountInCents,
    });
  };


  // Show loading state only for initial league and team data
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
                      `Week ${getWeekNumber(selectedDate)}`
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
                        const dayDisabled = isDateDisabled(date);
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
                {selectedTeamData.name} - Week {getWeekNumber(selectedDate)}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {loadingPayments || loadingBowlers ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Payment Entry Interface */}
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
                          <TableRow key={bowler.id}>
                            <TableCell>{bowler.name}</TableCell>
                            <TableCell>
                              <Select
                                value={paymentEntries[bowler.id]?.type || ""}
                                onValueChange={(value) => handlePaymentTypeChange(bowler.id, value)}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select type" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="cash">Cash</SelectItem>
                                  <SelectItem value="check">Check</SelectItem>
                                </SelectContent>
                              </Select>
                              {paymentEntries[bowler.id]?.type === 'check' && (
                                <Input
                                  className="mt-2"
                                  placeholder="Check number"
                                  value={paymentEntries[bowler.id]?.checkNumber || ""}
                                  onChange={(e) => handleCheckNumberChange(bowler.id, e.target.value)}
                                />
                              )}
                            </TableCell>
                            <TableCell>
                              <Input
                                type="text"
                                placeholder="0.00"
                                value={paymentEntries[bowler.id]?.amount || ""}
                                onChange={(e) => handleAmountChange(bowler.id, e.target.value)}
                              />
                            </TableCell>
                            <TableCell>
                              <Button
                                onClick={() => handleSubmitPayment(bowler.id)}
                                disabled={
                                  !paymentEntries[bowler.id]?.type ||
                                  !paymentEntries[bowler.id]?.amount ||
                                  (paymentEntries[bowler.id]?.type === 'check' && !paymentEntries[bowler.id]?.checkNumber) ||
                                  submitPaymentMutation.isPending
                                }
                                size="sm"
                              >
                                {submitPaymentMutation.isPending && (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                Record Payment
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Payment History */}
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Bowler</TableHead>
                          <TableHead>Payment Type</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead className="w-[100px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payments?.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="text-center">
                              No payment history
                            </TableCell>
                          </TableRow>
                        ) : (
                          payments?.map((payment) => {
                            const bowler = bowlers.find(b => b.id === payment.bowlerId);

                            return (
                              <TableRow key={payment.id}>
                                <TableCell>{bowler?.name || 'Unknown Bowler'}</TableCell>
                                <TableCell>
                                  <Badge variant="outline">
                                    {payment.type === 'cash' ? 'Cash' :
                                      payment.type === 'check' ? `Check #${payment.checkNumber}` :
                                      payment.type}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  ${(payment.amount / 100).toFixed(2)}
                                </TableCell>
                                <TableCell>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => handleStartEdit(payment)}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-4 w-4 text-primary">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125" />
                                    </svg>
                                  </Button>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    onClick={() => setPaymentToDelete(payment.id)}
                                    disabled={deletePaymentMutation.isPending}
                                  >
                                    {deletePaymentMutation.isPending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-4 w-4 text-destructive" />
                                    )}
                                  </Button>
                                </TableCell>
                              </TableRow>
                            );
                          })
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Payment Edit Dialog */}
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

        {/* Delete Confirmation Dialog */}
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