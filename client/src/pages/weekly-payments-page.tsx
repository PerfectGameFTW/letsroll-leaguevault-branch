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
import { Loader2, ArrowLeft, Calendar as CalendarIcon } from "lucide-react";
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

interface PaymentEntry {
  bowlerId: number;
  type: string;
  amount: string;
}

export default function WeeklyPaymentsPage() {
  const params = useParams();
  const { toast } = useToast();
  const leagueId = parseInt(params.leagueId!);
  const [selectedDate, setSelectedDate] = useState<Date>();
  const [selectedTeam, setSelectedTeam] = useState<string>();
  const [paymentEntries, setPaymentEntries] = useState<{ [key: number]: PaymentEntry }>({});

  // Fetch league details
  const { data: leagueResponse, isLoading: loadingLeague } = useQuery<{ data: League }>({
    queryKey: [`/api/leagues/${leagueId}`],
  });

  // Fetch teams for this league
  const { data: teamsResponse, isLoading: loadingTeams } = useQuery<{ data: Team[] }>({
    queryKey: ["/api/teams", leagueId],
    queryFn: async () => {
      const response = await fetch(`/api/teams?leagueId=${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch teams');
      }
      return response.json();
    }
  });

  // Fetch payments for selected team and week
  const { data: paymentsResponse, isLoading: loadingPayments } = useQuery<{ data: Payment[] }>({
    queryKey: ["/api/payments", selectedTeam, selectedDate],
    queryFn: async () => {
      if (!selectedTeam || !selectedDate) {
        return { data: [] };
      }
      const response = await fetch(
        `/api/payments?teamId=${selectedTeam}&weekOf=${selectedDate.toISOString()}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch payments');
      }
      return response.json();
    },
    enabled: !!selectedTeam && !!selectedDate,
  });

  // Fetch bowlers for the selected team
  const { data: bowlerLeaguesResponse, isLoading: loadingBowlerLeagues } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues", selectedTeam, leagueId],
    queryFn: async () => {
      if (!selectedTeam) {
        return { data: [] };
      }
      const response = await fetch(`/api/bowler-leagues?teamId=${selectedTeam}&leagueId=${leagueId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch bowler leagues');
      }
      return response.json();
    },
    enabled: !!selectedTeam,
  });

  const bowlerLeagues = bowlerLeaguesResponse?.data || [];

  // Fetch bowler details
  const { data: bowlersResponse, isLoading: loadingBowlers } = useQuery<{ data: Bowler[] }>({
    queryKey: ["/api/bowlers", bowlerLeagues],
    queryFn: async () => {
      if (!bowlerLeagues.length) {
        return { data: [] };
      }
      const bowlerIds = bowlerLeagues.map(bl => bl.bowlerId);
      const response = await fetch(`/api/bowlers?ids=${bowlerIds.join(",")}`);
      if (!response.ok) {
        throw new Error('Failed to fetch bowlers');
      }
      return response.json();
    },
    enabled: bowlerLeagues.length > 0,
  });

  const league = leagueResponse?.data;
  const teams = teamsResponse?.data || [];
  const payments = paymentsResponse?.data || [];
  const bowlers = bowlersResponse?.data || [];

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

  // Payment submission mutation
  const submitPaymentMutation = useMutation({
    mutationFn: async (payment: {
      bowlerId: number;
      type: string;
      amount: number;
      weekOf: Date;
      leagueId: number;
      status: string;
    }) => {
      const response = await apiRequest("POST", "/api/payments", {
        ...payment,
        squarePaymentId: payment.type, // Store payment type in squarePaymentId for non-Square payments
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
      status: 'paid', // Cash and check payments are marked as paid immediately
    });

    // Clear the entry after successful submission
    setPaymentEntries(prev => {
      const newEntries = { ...prev };
      delete newEntries[bowlerId];
      return newEntries;
    });
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

    // If we're on the target day (e.g., Monday), use today's date
    if (currentDay === targetDay) {
      return date;
    }

    // Calculate days to go back to reach the previous target day
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
    return weeksDiff + 1; // Add 1 to start from Week 1 instead of Week 0
  };

  useEffect(() => {
    if (league?.weekDay && !selectedDate) {
      const today = startOfToday();
      const nearestBowlingDay = getNearestBowlingDay(today, league.weekDay);
      setSelectedDate(nearestBowlingDay);
    }

    if (teams.length > 0 && !selectedTeam) {
      // Find Team 1 or use the first team in the list
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

  if (loadingLeague || loadingTeams) {
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
            <CardContent>
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
                                  <SelectItem value="credit" disabled>Credit Card (Customer Portal)</SelectItem>
                                </SelectContent>
                              </Select>
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
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payments.length > 0 ? (
                          payments.map((payment) => {
                            const bowler = bowlers.find(b => b.id === payment.bowlerId);
                            return (
                              <TableRow key={payment.id}>
                                <TableCell>
                                  {bowler ? (
                                    <Link
                                      href={`/bowlers/${bowler.id}`}
                                      className="text-foreground hover:underline"
                                    >
                                      {bowler.name}
                                    </Link>
                                  ) : (
                                    'Unknown Bowler'
                                  )}
                                </TableCell>
                                <TableCell>
                                  <Badge variant={payment.squarePaymentId === 'cash' ? 'default' : 'secondary'}>
                                    {payment.squarePaymentId === 'square' ? 'Square' :
                                      payment.squarePaymentId === 'cash' ? 'Cash' :
                                      payment.squarePaymentId === 'check' ? 'Check' :
                                      'Other'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  ${(payment.amount / 100).toFixed(2)}
                                </TableCell>
                              </TableRow>
                            );
                          })
                        ) : (
                          <TableRow>
                            <TableCell colSpan={3} className="text-center text-muted-foreground">
                              No payments recorded for this week
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}