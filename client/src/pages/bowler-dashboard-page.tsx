import { FC } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useBowlers } from "@/hooks/use-bowlers";
import { useQuery } from "@tanstack/react-query";
import type { User, League, Payment } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Trophy,
  CreditCard,
  LayoutDashboard,
  Medal,
  History,
  UserCircle,
  ChevronRight,
  Menu
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";
import { differenceInWeeks, startOfToday, isValid, parseISO } from "date-fns";

interface NavItem {
  icon: typeof LayoutDashboard;
  label: string;
  href: string;
}

const navItems: NavItem[] = [
  {
    icon: LayoutDashboard,
    label: "Overview",
    href: "/bowler-dashboard"
  },
  {
    icon: History,
    label: "Payment History",
    href: "/payment-history"
  },
  {
    icon: Trophy,
    label: "My Scores",
    href: "/scores"
  },
  {
    icon: Medal,
    label: "League Standings",
    href: "/standings"
  },
  {
    icon: UserCircle,
    label: "Profile Settings",
    href: "/profile"
  }
];

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

const BowlerDashboardPage: FC = () => {
  const { toast } = useToast();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  const { data: currentUser, error: userError, isLoading: isUserLoading } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
    onError: (error) => {
      console.error("[BowlerDashboard] Error fetching user data:", error);
      toast({
        title: "Error",
        description: "Failed to load user data. Please try again later.",
        variant: "destructive",
      });
    },
  });

  const {
    bowlers,
    getBowlerTeamName,
    getBowlerFirstLeagueName,
    isInitialLoading,
    isLoadingRelatedData,
    error: bowlersError,
    getBowlerLeagueId
  } = useBowlers();

  const bowler = currentUser?.data?.bowlerId ? bowlers.find(b => b.id === currentUser.data.bowlerId) : null;
  const leagueId = bowler ? getBowlerLeagueId(bowler) : null;

  // Add league query with proper typing
  const { data: leagueResponse } = useQuery<ApiResponse<League>>({
    queryKey: [`/api/leagues/${leagueId}`],
    enabled: !!leagueId,
  });
  const league = leagueResponse?.data;

  // Add payments query with proper typing
  const { data: paymentsResponse } = useQuery<ApiResponse<Payment[]>>({
    queryKey: ["/api/payments", bowler?.id, leagueId],
    enabled: !!bowler?.id && !!leagueId,
  });
  const payments = paymentsResponse?.data || [];

  if (isUserLoading || isInitialLoading || isLoadingRelatedData) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (userError || bowlersError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Error Loading Dashboard</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-destructive">
            {userError ? "Failed to load user data" : "Failed to load bowler data"}. Please try again later.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!currentUser?.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Authentication Required</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Please log in to view your dashboard.</p>
        </CardContent>
      </Card>
    );
  }

  if (!bowler) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Profile Setup Required</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Your bowler profile has not been set up yet. Please contact a league administrator.</p>
        </CardContent>
      </Card>
    );
  }

  const teamName = getBowlerTeamName(bowler);
  const leagueName = getBowlerFirstLeagueName(bowler);

  // Financial calculations
  const totalPaidPayments = payments.filter(p => p.status === 'paid') || [];
  const totalPaidAmount = totalPaidPayments.reduce((sum, p) => sum + p.amount, 0);

  let weeksDue = 0;
  let totalSeasonDues = 0;
  let totalWeeksInSeason = 0;
  let fullSeasonAmount = 0;
  let amountPastDue = 0;

  if (league?.seasonStart && league.seasonEnd && league.weeklyFee) {
    const seasonStart = parseISO(league.seasonStart);
    const seasonEnd = parseISO(league.seasonEnd);
    const today = startOfToday();

    if (isValid(seasonStart) && isValid(seasonEnd) && isValid(today)) {
      if (today < seasonStart) {
        weeksDue = 0;
      } else if (today > seasonEnd) {
        weeksDue = Math.max(0, differenceInWeeks(seasonEnd, seasonStart));
      } else {
        weeksDue = Math.max(0, differenceInWeeks(today, seasonStart));
      }

      totalSeasonDues = league.weeklyFee * weeksDue;
      totalWeeksInSeason = differenceInWeeks(seasonEnd, seasonStart);
      fullSeasonAmount = league.weeklyFee * totalWeeksInSeason;
      amountPastDue = totalSeasonDues - totalPaidAmount;
    }
  }

  const remainingBalance = fullSeasonAmount - totalPaidAmount;

  const SideNav = () => (
    <nav className="space-y-2">
      {navItems.map((item) => {
        const isActive = location === item.href;
        return (
          <Link key={item.href} href={item.href}>
            <a
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all hover:bg-accent",
                isActive && "bg-accent"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
              {isActive && <ChevronRight className="ml-auto h-4 w-4" />}
            </a>
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop Navigation */}
      <aside className="hidden lg:block w-64 border-r px-4 py-6">
        <div className="mb-6">
          <h2 className="text-lg font-semibold">{bowler.name}</h2>
          <p className="text-sm text-muted-foreground">{leagueName}</p>
        </div>
        <SideNav />
      </aside>

      {/* Mobile Navigation */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64">
            <div className="mb-6">
              <h2 className="text-lg font-semibold">{bowler.name}</h2>
              <p className="text-sm text-muted-foreground">{leagueName}</p>
            </div>
            <SideNav />
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <main className="flex-1 px-4 py-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{bowler.name}'s Dashboard</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg border p-4 space-y-4 mt-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Current League</p>
                    <p className="text-lg font-semibold">{leagueName || "Not Assigned"}</p>
                  </div>
                  <Trophy className="h-8 w-8 text-primary opacity-50" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Team</p>
                  <p className="text-lg font-semibold">{teamName || "Not Assigned"}</p>
                </div>
              </div>

              {/* Financial Summary Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Weekly Fee</CardTitle>
                    <CardDescription>Regular payment amount</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">${((league?.weeklyFee || 0) / 100).toFixed(2)}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Amount Due to Date</CardTitle>
                    <CardDescription>
                      {weeksDue} week{weeksDue === 1 ? "" : "s"} at ${(
                        (league?.weeklyFee || 0) / 100
                      ).toFixed(2)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">${(totalSeasonDues / 100).toFixed(2)}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Amount Paid to Date</CardTitle>
                    <CardDescription>All payments received</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">${(totalPaidAmount / 100).toFixed(2)}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Amount Past Due to Date</CardTitle>
                    <CardDescription>Unpaid fees for weeks passed</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold text-destructive">${(amountPastDue / 100).toFixed(2)}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Full Season Lineage Amount Due</CardTitle>
                    <CardDescription>
                      {totalWeeksInSeason} week{totalWeeksInSeason === 1 ? "" : "s"} at ${(
                        (league?.weeklyFee || 0) / 100
                      ).toFixed(2)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">${(fullSeasonAmount / 100).toFixed(2)}</p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Full Season Remaining Balance</CardTitle>
                    <CardDescription>Amount left to pay</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">${(remainingBalance / 100).toFixed(2)}</p>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default BowlerDashboardPage;