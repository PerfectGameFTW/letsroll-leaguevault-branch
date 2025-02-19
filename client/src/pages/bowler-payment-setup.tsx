import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, CreditCard } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useSquarePayment } from "@/hooks/use-square-payment";
import { createPayment } from "@/lib/square";
import { useParams } from "wouter";
import type { League, BowlerLeague } from "@shared/schema";

type PaymentSchedule = "weekly" | "monthly" | "half" | "full";

interface PaymentOption {
  id: PaymentSchedule;
  label: string;
  description: string;
  calculateAmount: (weeklyFee: number, totalWeeks: number) => number;
}

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
    id: "half",
    label: "Half Season Payment",
    description: "Pay for half of the season upfront (with 5% discount)",
    calculateAmount: (weeklyFee, totalWeeks) => {
      const halfSeasonAmount = weeklyFee * Math.ceil(totalWeeks / 2);
      return Math.round(halfSeasonAmount * 0.95); // 5% discount
    },
  },
  {
    id: "full",
    label: "Full Season Payment",
    description: "Pay for the entire season upfront (with 10% discount)",
    calculateAmount: (weeklyFee, totalWeeks) => {
      const fullSeasonAmount = weeklyFee * totalWeeks;
      return Math.round(fullSeasonAmount * 0.90); // 10% discount
    },
  },
];

export default function BowlerPaymentSetupPage() {
  const params = useParams();
  const { toast } = useToast();
  const bowlerId = parseInt(params.bowlerId!);
  const [selectedSchedule, setSelectedSchedule] = useState<PaymentSchedule>("weekly");
  const cardContainerRef = useRef<HTMLDivElement>(null);

  // Initialize Square payment form with enhanced error handling
  const { card, isInitialized, error: squareError, initializeCard } = useSquarePayment({
    onError: (error) => {
      console.error('[PaymentSetup] Square payment error:', error);
      toast({
        title: "Payment Setup Error",
        description: error,
        variant: "destructive",
      });
    },
  });

  // Query for bowler's league associations with improved error handling
  const { data: bowlerLeaguesResponse, error: leaguesError } = useQuery<{ data: BowlerLeague[] }>({
    queryKey: ["/api/bowler-leagues", bowlerId],
    enabled: !!bowlerId,
    onError: (error) => {
      console.error('[PaymentSetup] Error fetching bowler leagues:', error);
      toast({
        title: "Data Loading Error",
        description: "Failed to load league information. Please try again.",
        variant: "destructive",
      });
    },
  });

  const bowlerLeagues = bowlerLeaguesResponse?.data || [];

  // Get league details with improved error handling
  const { data: leagueResponse, error: leagueError } = useQuery<{ data: League }>({
    queryKey: ["/api/leagues", bowlerLeagues[0]?.leagueId],
    enabled: !!bowlerLeagues.length,
    onError: (error) => {
      console.error('[PaymentSetup] Error fetching league details:', error);
      toast({
        title: "Data Loading Error",
        description: "Failed to load league details. Please try again.",
        variant: "destructive",
      });
    },
  });

  const league = leagueResponse?.data;

  // Initialize card when container is ready with improved error handling
  useEffect(() => {
    if (cardContainerRef.current && !isInitialized) {
      console.log('[PaymentSetup] Initializing Square payment form...');
      try {
        initializeCard(cardContainerRef.current);
      } catch (error) {
        console.error('[PaymentSetup] Error initializing payment form:', error);
        toast({
          title: "Payment Setup Error",
          description: "Failed to initialize payment form. Please try again.",
          variant: "destructive",
        });
      }
    }
  }, [cardContainerRef.current, isInitialized]);

  // Calculate payment amount based on selected schedule
  const calculatePaymentAmount = () => {
    if (!league) return 0;

    const selectedOption = PAYMENT_OPTIONS.find(opt => opt.id === selectedSchedule);
    if (!selectedOption) return 0;

    const totalWeeks = Math.ceil(
      (new Date(league.seasonEnd).getTime() - new Date(league.seasonStart).getTime()) /
      (7 * 24 * 60 * 60 * 1000)
    );

    return selectedOption.calculateAmount(league.weeklyFee, totalWeeks);
  };

  // Handle payment submission with improved error handling and validation
  const handleSubmit = async () => {
    if (!card || !league) {
      console.error('[PaymentSetup] Missing required data:', { card: !!card, league: !!league });
      toast({
        title: "Payment Setup Error",
        description: "Unable to process payment at this time. Please try again later.",
        variant: "destructive",
      });
      return;
    }

    try {
      console.log('[PaymentSetup] Calculating payment amount...');
      const amount = calculatePaymentAmount();
      if (amount <= 0) {
        throw new Error("Invalid payment amount calculated");
      }

      console.log('[PaymentSetup] Processing payment...', { amount });
      const result = await createPayment(amount, card);
      console.log('[PaymentSetup] Payment result:', result);

      if (result.status === 'COMPLETED') {
        toast({
          title: "Payment Setup Successful",
          description: `Your ${selectedSchedule} payment schedule has been set up successfully.`,
        });
      } else {
        throw new Error("Payment was not completed successfully");
      }
    } catch (error) {
      console.error('[PaymentSetup] Payment error:', error);
      toast({
        title: "Payment Setup Failed",
        description: error instanceof Error ? error.message : "Failed to set up payment. Please try again.",
        variant: "destructive",
      });
    }
  };

  if (!league) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-[50vh]">
          <Loader2 className="h-8 w-8 animate-spin" />
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto space-y-8">
        <div>
          <h1 className="text-2xl font-bold">Set Up League Payments</h1>
          <p className="text-muted-foreground">
            Choose your preferred payment schedule for {league.name}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Payment Schedule</CardTitle>
            <CardDescription>
              Select how you would like to pay your league dues
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup
              value={selectedSchedule}
              onValueChange={(value) => setSelectedSchedule(value as PaymentSchedule)}
              className="space-y-4"
            >
              {PAYMENT_OPTIONS.map((option) => (
                <div key={option.id} className="flex items-center space-x-2">
                  <RadioGroupItem value={option.id} id={option.id} />
                  <Label htmlFor={option.id} className="flex flex-col">
                    <span className="font-medium">{option.label}</span>
                    <span className="text-sm text-muted-foreground">
                      {option.description}
                    </span>
                    <span className="text-sm font-semibold">
                      ${(calculatePaymentAmount() / 100).toFixed(2)}
                    </span>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment Information</CardTitle>
            <CardDescription>
              Enter your card details to set up automatic payments
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <div 
                ref={cardContainerRef} 
                className="min-h-[120px] p-4 bg-card rounded-lg border" 
              />
              {isInitialized && (
                <div className="absolute top-4 right-4">
                  <CreditCard className="h-5 w-5 text-muted-foreground" />
                </div>
              )}
            </div>
            {squareError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertCircle className="h-4 w-4" />
                <p>{squareError}</p>
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="flex-1 border-t" />
              <span>Secure payment powered by Square</span>
              <div className="flex-1 border-t" />
            </div>
          </CardContent>
          <CardFooter>
            <Button
              onClick={handleSubmit}
              disabled={!isInitialized || !!squareError}
              className="w-full"
            >
              Set Up Payment Schedule
            </Button>
          </CardFooter>
        </Card>
      </div>
    </Layout>
  );
}