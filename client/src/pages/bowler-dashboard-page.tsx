import { FC, Suspense, lazy } from "react";
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
import { differenceInWeeks, startOfToday, isValid } from "date-fns";

// Lazy load components that aren't immediately visible
const SideNav = lazy(() => import("@/components/bowler-dashboard/side-nav"));
const FinancialSummary = lazy(() => import("@/components/bowler-dashboard/financial-summary"));

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

export const BowlerDashboardPage: FC = () => {
  const { toast } = useToast();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  // Enhanced user data query with proper caching
  const { data: currentUserResponse, isLoading: isUserLoading } = useQuery<ApiResponse<User>>({
    queryKey: ["/api/user"],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
    gcTime: 1000 * 60 * 30, // Keep in cache for 30 minutes
    retry: 3,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  const {
    bowlers,
    getBowlerTeamName,
    getBowlerFirstLeagueName,
    isInitialLoading,
    isLoadingRelatedData,
    getBowlerLeagueId
  } = useBowlers({
    isEnabled: !!currentUserResponse?.data?.bowlerId,
  });

  const currentUser = currentUserResponse?.data;
  const bowler = currentUser?.bowlerId ? bowlers.find(b => b.id === currentUser.bowlerId) : null;
  const leagueId = bowler ? getBowlerLeagueId(bowler) : null;

  // Combine league and payments queries to reduce waterfall
  const { data: combinedData, isLoading: isCombinedLoading } = useQuery({
    queryKey: [`/api/dashboard-data`, leagueId],
    enabled: !!leagueId,
    queryFn: async () => {
      const [leagueRes, paymentsRes] = await Promise.all([
        fetch(`/api/leagues/${leagueId}`),
        fetch(`/api/payments?bowlerId=${bowler?.id}&leagueId=${leagueId}`)
      ]);

      if (!leagueRes.ok || !paymentsRes.ok) {
        throw new Error('Failed to fetch dashboard data');
      }

      const [leagueData, paymentsData] = await Promise.all([
        leagueRes.json() as Promise<ApiResponse<League>>,
        paymentsRes.json() as Promise<ApiResponse<Payment[]>>
      ]);

      return {
        league: leagueData.data,
        payments: paymentsData.data
      };
    },
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });

  const league = combinedData?.league;
  const payments = combinedData?.payments || [];

  // Show loading state
  if (isUserLoading || isInitialLoading || isLoadingRelatedData || isCombinedLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Show authentication required state
  if (!currentUser) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>Authentication Required</CardTitle>
          <CardDescription>Please log in to view your dashboard</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground">
            You need to be logged in to access your bowler dashboard.
          </p>
          <Link href="/login">
            <Button className="w-full">Log In</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  // Show profile setup required state
  if (!bowler) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>Profile Setup Required</CardTitle>
          <CardDescription>Your bowler profile needs to be configured</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Please contact a league administrator to set up your bowler profile.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex min-h-screen">
      {/* Desktop Navigation */}
      <aside className="hidden lg:block w-64 border-r px-4 py-6">
        <div className="mb-6">
          <h2 className="text-lg font-semibold">{bowler?.name}</h2>
          <p className="text-sm text-muted-foreground">{getBowlerFirstLeagueName(bowler)}</p>
        </div>
        <Suspense fallback={<div>Loading navigation...</div>}>
          <SideNav />
        </Suspense>
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
              <h2 className="text-lg font-semibold">{bowler?.name}</h2>
              <p className="text-sm text-muted-foreground">{getBowlerFirstLeagueName(bowler)}</p>
            </div>
            <Suspense fallback={<div>Loading navigation...</div>}>
              <SideNav />
            </Suspense>
          </SheetContent>
        </Sheet>
      </div>

      {/* Main Content */}
      <main className="flex-1 px-4 py-6">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>{bowler?.name}'s Dashboard</CardTitle>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<div>Loading financial summary...</div>}>
                <FinancialSummary
                  bowler={bowler}
                  league={league}
                  payments={payments}
                  teamName={getBowlerTeamName(bowler)}
                  leagueName={getBowlerFirstLeagueName(bowler)}
                />
              </Suspense>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
};

export default BowlerDashboardPage;