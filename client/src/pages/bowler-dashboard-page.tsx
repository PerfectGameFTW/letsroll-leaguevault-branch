// Interface definitions remain unchanged at the top
import { useState, useRef, useEffect, FC, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { createPayment } from "@/lib/square";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Drawer } from "vaul";
import { Loader2, AlertCircle, ArrowRight, CreditCard, Calendar, Plus, Minus } from "lucide-react";
import { Link } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";
import { startOfToday, differenceInWeeks, format, addWeeks } from "date-fns";
import type { League, Payment, User, Bowler as SchemaBoswler } from "@shared/schema";
import { useBowlers } from "@/hooks/use-bowlers";

// Extended Bowler type with the leagues property we need
interface Bowler extends SchemaBoswler {
  leagues?: {
    leagueId: number;
    leagueName: string;
    teamId: number;
    teamName: string;
  }[];
}

const DEBUG_HOOKS = true;

// Custom hook for drawer state management
function usePaymentDrawer() {
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [selectedWeeks, setSelectedWeeks] = useState<number>(1);
  
  const handleWeekChange = useCallback((weeks: number) => {
    setSelectedWeeks(Math.max(1, weeks));
  }, []);
  
  return {
    isDrawerOpen,
    setIsDrawerOpen,
    selectedWeeks,
    handleWeekChange
  };
}

// Type definitions remain unchanged - moved outside component
type PaymentSchedule = "weekly" | "monthly" | "custom";
interface PaymentOption {
  id: PaymentSchedule;
  label: string;
  description: string;
  calculateAmount: (weeklyFee: number, totalWeeks: number, customWeeks?: number) => number;
}
interface UpcomingPayment {
  dueDate: Date;
  amount: number;
}
interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: {
    message: string;
    code?: string;
  };
}

// Payment options constant remains unchanged
const PAYMENT_OPTIONS: PaymentOption[] = [
  {
    id: "weekly",
    label: "Weekly Automatic Payment",
    description: "Your card will be charged weekly for league dues",
    calculateAmount: (weeklyFee) => weeklyFee,
  },
  {
    id: "monthly",
    label: "Monthly Automatic Payment",
    description: "Your card will be charged monthly (4 weeks of dues)",
    calculateAmount: (weeklyFee) => weeklyFee * 4,
  },
  {
    id: "custom",
    label: "One Time Payment",
    description: "Make a single payment for your selected number of weeks",
    calculateAmount: (weeklyFee, _, customWeeks = 1) => weeklyFee * customWeeks,
  },
];

// getSeasonLength utility function remains unchanged
const getSeasonLength = (currentLeague?: League | null) => {
  if (!currentLeague?.seasonStart || !currentLeague?.seasonEnd) return 0;
  return Math.ceil(
    (new Date(currentLeague.seasonEnd).getTime() - new Date(currentLeague.seasonStart).getTime()) /
      (7 * 24 * 60 * 60 * 1000)
  );
};

export const BowlerDashboardPage: FC = () => {
  if (DEBUG_HOOKS) {
    console.log('[BowlerDashboard] Component rendering start'); // Debug log
  }

  // Initialize all state hooks at the top level
  const { toast } = useToast();
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const [showPaymentSetup, setShowPaymentSetup] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<PaymentSchedule>("weekly");
  
  // Debug logging for state changes
  useEffect(() => {
    console.log('[BowlerDashboard] showPaymentSetup changed to:', showPaymentSetup);
  }, [showPaymentSetup]);

  // Use custom drawer hook
  const { isDrawerOpen, setIsDrawerOpen, selectedWeeks, handleWeekChange: customHandleWeekChange } = usePaymentDrawer();

  // User and Bowler data hooks
  const { data: userResponse } = useQuery<{ success: boolean; data: User }>({
    queryKey: ['currentUser'],
    enabled: true,
  });

  const currentUser = userResponse?.data;
  const { bowlers } = useBowlers();
  const isLoadingBowlers = false; // Set directly since the hook doesn't expose this
  
  // Find the current bowler for this user
  const bowler = useMemo(() => {
    if (DEBUG_HOOKS) {
      console.log('[BowlerDashboard] Finding current bowler for user:', currentUser); // Debug log
    }
    
    // Use the bowlerId from the current user if available
    return currentUser?.bowlerId ? bowlers.find((b: Bowler) => b.id === currentUser.bowlerId) : null;
  }, [bowlers, currentUser]);

  // Get league ID (handle properly even if leagues property doesn't exist)
  const leagueId = bowler && 
                  (bowler as any).leagues && 
                  (bowler as any).leagues[0] && 
                  (bowler as any).leagues[0].leagueId;
              
  // Query data for the league
  const { data: leagueResponse, isLoading: isLoadingLeague } = useQuery<{ success: boolean; data: League }>({
    queryKey: ['api', 'leagues', leagueId],
    enabled: !!leagueId,
  });

  const league = leagueResponse?.data;
  
  // Calculate the total weeks in the season
  const totalWeeks = useMemo(() => getSeasonLength(league), [league]);
  
  // Calculate the weekly fee
  const weeklyFee = useMemo(() => {
    return league?.weeklyFee || 2000; // Default to $20 if not specified
  }, [league]);

  // Query payments data
  const { data: paymentsResponse, isLoading: isLoadingPayments } = useQuery<ApiResponse<Payment[]>>({
    queryKey: ['api', 'payments', bowler?.id],
    enabled: !!bowler?.id,
  });

  const payments = paymentsResponse?.data || [];
  
  // Calculate amount past due
  const amountPastDue = useMemo(() => {
    // Logic for calculating past due amount
    return 0; // Placeholder
  }, []);
  
  // Destructure values from Square payment hook - moved up in the initialization order
  const { card, isInitialized, error: squareError, initializeCard } = useSquarePayment({
    onError: (error) => {
      console.error('[Square Payment Error]:', error);
      toast({
        title: "Payment Setup Error",
        description: error,
        variant: "destructive",
      });
    }
  });

  // Initialize Square payment components when showPaymentSetup is true
  useEffect(() => {
    if (showPaymentSetup && cardContainerRef.current) {
      console.log('[BowlerDashboard] Initializing Square payment components');
      initializeCard(cardContainerRef.current);
    }
  }, [showPaymentSetup, cardContainerRef, initializeCard]);

  // Helper function to get the bowler's first league name
  const getBowlerFirstLeagueName = useCallback((bowler: Bowler) => {
    return bowler?.leagues?.[0]?.leagueName || 'No League';
  }, []);

  // Helper function to get the bowler's team name
  const getBowlerTeamName = useCallback((bowler: Bowler) => {
    return bowler?.leagues?.[0]?.teamName || 'No Team';
  }, []);

  // Helper function to get payment frequency
  const getPaymentFrequency = useCallback(() => {
    return 'weekly'; // Placeholder - actual implementation would check database
  }, []);

  // Function to calculate total payment amount
  const calculateTotalAmount = useCallback(() => {
    if (selectedSchedule === 'custom') {
      return weeklyFee * selectedWeeks;
    } else if (selectedSchedule === 'monthly') {
      return weeklyFee * 4;
    } else {
      return weeklyFee;
    }
  }, [selectedSchedule, weeklyFee, selectedWeeks]);

  // Function to handle week change with validation
  const handleWeekChangeWrapper = useCallback((weeks: number) => {
    const validWeeks = Math.min(Math.max(1, weeks), totalWeeks);
    customHandleWeekChange(validWeeks);
  }, [customHandleWeekChange, totalWeeks]);

  // Functions to increment/decrement weeks
  const incrementWeeks = useCallback(() => {
    handleWeekChangeWrapper(selectedWeeks + 1);
  }, [handleWeekChangeWrapper, selectedWeeks]);

  const decrementWeeks = useCallback(() => {
    handleWeekChangeWrapper(selectedWeeks - 1);
  }, [handleWeekChangeWrapper, selectedWeeks]);

  // Season presets for common payment periods
  const seasonPresets = useMemo(() => [
    { label: "1 Week", weeks: 1 },
    { label: "Half Season", weeks: Math.ceil(totalWeeks / 2) },
    { label: "Full Season", weeks: totalWeeks }
  ], [totalWeeks]);

  // Payment setup submission handler
  const handleSubmitPayment = async () => {
    if (!card || !league || !bowler) {
      toast({
        title: "Payment Setup Error",
        description: "Missing required information to set up payment.",
        variant: "destructive",
      });
      return;
    }

    try {
      const amount = calculateTotalAmount();
      const result = await createPayment(
        amount,
        card,
        bowler.id, 
        league.id,
        true // Store card for future payments
      );

      toast({
        title: "Payment Setup Successful",
        description: `Your payment schedule has been set up.`,
      });
      
      setShowPaymentSetup(false);
    } catch (error) {
      console.error('[Payment Error]:', error);
      toast({
        title: "Payment Failed",
        description: typeof error === 'string' ? error : "Unable to process payment. Please try again.",
        variant: "destructive",
      });
    }
  };

  // Memoize renderPaymentStatus - simplified version that focuses just on the button functionality
  const renderPaymentStatus = useMemo(() => {
    console.log('[BowlerDashboard] renderPaymentStatus called, showPaymentSetup:', showPaymentSetup);
    
    // If showPaymentSetup is true, show the payment setup form
    if (showPaymentSetup) {
      console.log('[BowlerDashboard] Showing payment setup form');
      return (
        <Card>
          <CardHeader>
            <CardTitle>Set Up Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={() => {
                console.log('[BowlerDashboard] Returning to dashboard from payment setup');
                setShowPaymentSetup(false);
              }}
            >
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      );
    }
    
    // Otherwise show the regular payment status/setup buttons
    return (
      <Card>
        <CardHeader>
          <CardTitle>Payment Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => {
              console.log('[BowlerDashboard] Update Payment Settings button clicked');
              setShowPaymentSetup(true);
            }}
            className="w-full"
          >
            Update Payment Settings
            <CreditCard className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    );
  }, [
    showPaymentSetup, 
    setShowPaymentSetup
  ]);

  // Loading states combined
  const isLoadingRelatedData = isLoadingBowlers || isLoadingLeague || isLoadingPayments;
  const isInitialLoading = !userResponse;
  const isCombinedLoading = isInitialLoading || isLoadingRelatedData;

  // Loading and error states
  if (isInitialLoading || isLoadingRelatedData || isCombinedLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

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

  if (!league) {
    return (
      <Card className="mx-auto max-w-md mt-8">
        <CardHeader>
          <CardTitle>League Data Unavailable</CardTitle>
          <CardDescription>Unable to load league information</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            Please try again later or contact support if the problem persists.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Check if user is a system admin
  const isSystemAdmin = currentUser?.isAdmin && currentUser?.isOrganizationAdmin;

  return (
    <BowlerLayout
      bowlerName={bowler.name}
      leagueName={getBowlerFirstLeagueName(bowler)}
    >
      {/* Admin navigation link - only visible to system administrators */}
      {isSystemAdmin && (
        <div className="mb-6">
          <Link href="/">
            <Button variant="outline" className="flex items-center gap-2">
              <ArrowRight className="h-4 w-4 rotate-180" />
              Back to Dashboard
            </Button>
          </Link>
        </div>
      )}
      
      <div className="space-y-6">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-3xl font-bold">{bowler.name}</CardTitle>
            {isSystemAdmin && (
              <p className="text-sm text-muted-foreground mt-1">
                You are viewing this account as a System Administrator
              </p>
            )}
          </CardHeader>
          <CardContent>
            <div className="space-y-0.5">
              <p className="text-lg">{getBowlerFirstLeagueName(bowler)}</p>
              <p className="text-base text-muted-foreground">{getBowlerTeamName(bowler)}</p>
            </div>
          </CardContent>
        </Card>

        {/* Render the payment status UI */}
        {renderPaymentStatus}
      </div>
    </BowlerLayout>
  );
};

export default BowlerDashboardPage;