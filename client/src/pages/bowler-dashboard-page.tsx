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
import { Loader2, AlertCircle, ArrowRight, CreditCard, Calendar, Plus, Minus, CalendarDays, Settings } from "lucide-react";
import { Link } from "wouter";
import { BowlerLayout } from "@/components/bowler-layout";
import { startOfToday, differenceInWeeks, format, addWeeks } from "date-fns";
import type { League, Payment, User, Bowler as SchemaBoswler } from "@shared/schema";
import { useBowlers } from "@/hooks/use-bowlers";
import { formatCurrency } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";

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
  const [storeCard, setStoreCard] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Debug logging for state changes
  useEffect(() => {
    console.log('[BowlerDashboard] showPaymentSetup changed to:', showPaymentSetup);
  }, [showPaymentSetup]);

  // Use custom drawer hook
  const { isDrawerOpen, setIsDrawerOpen, selectedWeeks, handleWeekChange: customHandleWeekChange } = usePaymentDrawer();

  // User and Bowler data hooks
  const { data: userResponse } = useQuery<{ success: boolean; data: User }>({
    queryKey: ['/api/user'],
    enabled: true,
  });

  const currentUser = userResponse?.data;
  const { 
    bowlers, 
    isInitialLoading: isLoadingBowlers, 
    getBowlerFirstLeagueName: getBowlerLeagueName, 
    getBowlerTeamName: getTeamName, 
    getBowlerLeagueId 
  } = useBowlers();
  
  // Find the current bowler for this user
  const bowler = useMemo(() => {
    if (DEBUG_HOOKS) {
      console.log('[BowlerDashboard] Finding current bowler for user:', currentUser); // Debug log
    }
    
    // Use the bowlerId from the current user if available
    return currentUser?.bowlerId ? bowlers.find((b: Bowler) => b.id === currentUser.bowlerId) : null;
  }, [bowlers, currentUser]);

  // Define our own function to get the league ID
  const getLeagueId = useCallback((bowler: Bowler) => {
    // First try to use the built-in leagues property if it exists
    if (bowler?.leagues && bowler.leagues.length > 0) {
      return bowler.leagues[0].leagueId;
    }
    
    // Otherwise fall back to the hook method
    return getBowlerLeagueId ? getBowlerLeagueId(bowler) : undefined;
  }, [getBowlerLeagueId]);
  
  const leagueId = bowler ? getLeagueId(bowler) : undefined;
  console.log('[BowlerDashboard] Detected leagueId:', leagueId);
              
  // Query data for the league - if we have a leagueId, use the specific endpoint
  const { data: leagueResponse, isLoading: isLoadingLeague } = useQuery<{ success: boolean; data: League | League[] }>({
    queryKey: leagueId ? ['/api/leagues', leagueId] : ['/api/leagues'],
    enabled: true, // Enable this query even without leagueId to see if we can load any leagues
  });

  console.log('[BowlerDashboard] League API response:', leagueResponse);
  
  // Handle both single league and league list responses
  const league = useMemo(() => {
    if (!leagueResponse?.data) {
      return undefined;
    }
    
    // If we got a specific league (has an 'id' property directly)
    if ('id' in leagueResponse.data) {
      return leagueResponse.data as League;
    }
    
    // If we got a list of leagues, find the one matching our leagueId
    if (Array.isArray(leagueResponse.data)) {
      if (leagueId) {
        // Find the specific league if we have a leagueId
        return leagueResponse.data.find(l => l.id === leagueId);
      } else if (leagueResponse.data.length > 0) {
        // Otherwise just use the first available league
        return leagueResponse.data[0];
      }
    }
    
    return undefined;
  }, [leagueResponse, leagueId]);
  
  // Calculate the total weeks in the season
  const totalWeeks = useMemo(() => {
    // Define the season length calculation function
    const getSeasonLength = (league?: League): number => {
      if (!league?.seasonStart || !league?.seasonEnd) {
        return 30; // Default to 30 weeks if no dates are set
      }
      
      const start = new Date(league.seasonStart);
      const end = new Date(league.seasonEnd);
      
      // Calculate the total days between start and end
      const dayDiff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
      
      // Calculate number of weeks assuming weekly games
      return Math.ceil(dayDiff / 7);
    };
    
    return getSeasonLength(league);
  }, [league]);
  
  // Calculate the weekly fee
  const weeklyFee = useMemo(() => {
    return league?.weeklyFee || 2000; // Default to $20 if not specified
  }, [league]);

  // Query payments data
  const { data: paymentsResponse, isLoading: isLoadingPayments } = useQuery<ApiResponse<Payment[]>>({
    queryKey: ['/api/payments', bowler?.id],
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
      setIsSubmitting(true);
      console.log('[BowlerDashboard] Processing payment with Square...');
      
      const amount = calculateTotalAmount();
      const result = await createPayment(
        amount,
        card,
        bowler.id, 
        league.id,
        storeCard // Use the store card state value
      );

      console.log('[BowlerDashboard] Payment successful:', result);
      
      // Show success message
      toast({
        title: "Payment Setup Successful",
        description: `Your ${selectedSchedule} payment schedule has been set up.`,
      });
      
      // Reset form and close payment setup
      setShowPaymentSetup(false);
    } catch (error) {
      console.error('[Payment Error]:', error);
      toast({
        title: "Payment Failed",
        description: typeof error === 'string' ? error : "Unable to process payment. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Memoize renderPaymentStatus - enhanced version with payment form
  const renderPaymentStatus = useMemo(() => {
    console.log('[BowlerDashboard] renderPaymentStatus called, showPaymentSetup:', showPaymentSetup);
    
    // If showPaymentSetup is true, show the payment setup form
    if (showPaymentSetup) {
      console.log('[BowlerDashboard] Showing payment setup form');
      return (
        <Card className="w-full">
          <CardHeader>
            <CardTitle>Set Up Automatic Payments</CardTitle>
            <CardDescription>Configure your payment schedule for the league</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {/* Payment Frequency Section */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium">Payment Schedule</h3>
                  <p className="text-sm text-muted-foreground">
                    Choose how often you want to be charged
                  </p>
                </div>
                
                <RadioGroup
                  value={selectedSchedule}
                  onValueChange={(value) => setSelectedSchedule(value as PaymentSchedule)}
                  className="grid grid-cols-1 md:grid-cols-3 gap-4"
                >
                  <div>
                    <RadioGroupItem value="weekly" id="weekly" className="sr-only" />
                    <Label
                      htmlFor="weekly"
                      className={`flex flex-col items-center justify-between rounded-md border-2 border-muted p-4 cursor-pointer ${
                        selectedSchedule === 'weekly' 
                          ? 'border-primary bg-primary/5' 
                          : 'hover:border-primary/50 hover:bg-primary/5'
                      }`}
                    >
                      <CalendarDays className="h-6 w-6 mb-2" />
                      <span className="text-sm font-medium">Weekly</span>
                      <span className="text-xs text-muted-foreground mt-1">
                        {formatCurrency(weeklyFee)} per week
                      </span>
                    </Label>
                  </div>
                  
                  <div>
                    <RadioGroupItem value="monthly" id="monthly" className="sr-only" />
                    <Label
                      htmlFor="monthly"
                      className={`flex flex-col items-center justify-between rounded-md border-2 border-muted p-4 cursor-pointer ${
                        selectedSchedule === 'monthly' 
                          ? 'border-primary bg-primary/5' 
                          : 'hover:border-primary/50 hover:bg-primary/5'
                      }`}
                    >
                      <Calendar className="h-6 w-6 mb-2" />
                      <span className="text-sm font-medium">Monthly</span>
                      <span className="text-xs text-muted-foreground mt-1">
                        {formatCurrency(weeklyFee * 4)} per month
                      </span>
                    </Label>
                  </div>
                  
                  <div>
                    <RadioGroupItem value="custom" id="custom" className="sr-only" />
                    <Label
                      htmlFor="custom"
                      className={`flex flex-col items-center justify-between rounded-md border-2 border-muted p-4 cursor-pointer ${
                        selectedSchedule === 'custom' 
                          ? 'border-primary bg-primary/5' 
                          : 'hover:border-primary/50 hover:bg-primary/5'
                      }`}
                    >
                      <Settings className="h-6 w-6 mb-2" />
                      <span className="text-sm font-medium">Custom</span>
                      <span className="text-xs text-muted-foreground mt-1">
                        Choose number of weeks
                      </span>
                    </Label>
                  </div>
                </RadioGroup>
              </div>
              
              {/* Custom Weeks Selector */}
              {selectedSchedule === 'custom' && (
                <div className="space-y-4 p-4 rounded-md border bg-background">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="custom-weeks">Number of Weeks</Label>
                      <span className="text-sm font-medium">
                        {formatCurrency(weeklyFee * selectedWeeks)} total
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={decrementWeeks}
                        disabled={selectedWeeks <= 1}
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <input
                        id="custom-weeks"
                        type="number"
                        min="1"
                        max={totalWeeks}
                        value={selectedWeeks}
                        onChange={(e) => handleWeekChangeWrapper(parseInt(e.target.value, 10))}
                        className="flex h-10 w-16 rounded-md border border-input bg-background px-3 py-2 text-sm text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={incrementWeeks}
                        disabled={selectedWeeks >= totalWeeks}
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  
                  {/* Season presets */}
                  <div>
                    <Label className="text-sm text-muted-foreground mb-2 block">
                      Quick Select
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {seasonPresets.map((preset) => (
                        <Button
                          key={preset.label}
                          variant="outline"
                          size="sm"
                          onClick={() => handleWeekChangeWrapper(preset.weeks)}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
              
              {/* Payment Form */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium">Payment Information</h3>
                  <p className="text-sm text-muted-foreground">
                    Enter your card details (securely processed by Square)
                  </p>
                </div>
                
                <div className="rounded-md border overflow-hidden relative">
                  {/* Square Card Form Container */}
                  <div 
                    ref={cardContainerRef} 
                    id="card-container" 
                    className="p-4 min-h-[150px] bg-background"
                  ></div>
                  
                  {/* Card Form Status Overlay */}
                  {!isInitialized && (
                    <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
                      <div className="text-center">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                        <p className="text-sm">Loading payment form...</p>
                      </div>
                    </div>
                  )}
                </div>
                
                {squareError && (
                  <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive flex items-start">
                    <AlertCircle className="h-5 w-5 mr-2 flex-shrink-0" />
                    <span>{squareError}</span>
                  </div>
                )}
                
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="store-card" 
                    checked={storeCard}
                    onCheckedChange={(checked) => setStoreCard(checked === true)} 
                  />
                  <Label htmlFor="store-card">Save card for future payments</Label>
                </div>
              </div>
              
              {/* Total Amount */}
              <div className="pt-4 border-t">
                <div className="flex justify-between items-center">
                  <span className="text-lg font-medium">Total Amount</span>
                  <span className="text-lg font-bold">{formatCurrency(calculateTotalAmount())}</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {selectedSchedule === 'weekly' && 'Charged weekly'}
                  {selectedSchedule === 'monthly' && 'Charged monthly (every 4 weeks)'}
                  {selectedSchedule === 'custom' && `One-time payment for ${selectedWeeks} weeks`}
                </p>
              </div>
              
              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row sm:justify-between gap-2">
                <Button 
                  variant="outline"
                  onClick={() => {
                    console.log('[BowlerDashboard] Returning to dashboard from payment setup');
                    setShowPaymentSetup(false);
                  }}
                >
                  Cancel
                </Button>
                <Button 
                  onClick={handleSubmitPayment}
                  disabled={!isInitialized || isSubmitting}
                  className="min-w-[200px]"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Processing...
                    </>
                  ) : (
                    <>Setup Automatic Payments</>
                  )}
                </Button>
              </div>
            </div>
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
    setShowPaymentSetup,
    selectedSchedule,
    selectedWeeks,
    weeklyFee,
    totalWeeks,
    seasonPresets,
    cardContainerRef,
    isInitialized,
    isSubmitting, 
    squareError,
    storeCard,
    incrementWeeks,
    decrementWeeks,
    handleWeekChangeWrapper,
    calculateTotalAmount,
    handleSubmitPayment
  ]);

  // Loading states combined
  const isLoadingRelatedData = isLoadingBowlers || isLoadingLeague || isLoadingPayments;
  const isInitialLoading = !userResponse;
  const isCombinedLoading = isInitialLoading || isLoadingRelatedData;

  // Debug banner while developing
  console.log('[BowlerDashboard] Loading states:', { isInitialLoading, isLoadingRelatedData, isCombinedLoading });
  console.log('[BowlerDashboard] User and bowler:', { currentUser, bowler });
  console.log('[BowlerDashboard] League:', { leagueId, league });

  // Loading and error states
  if (isInitialLoading || isLoadingRelatedData || isCombinedLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <div className="text-center">
          <h3 className="text-lg font-medium">Loading dashboard data...</h3>
          <p className="text-sm text-muted-foreground mt-1">Please wait while we retrieve your information.</p>
        </div>
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