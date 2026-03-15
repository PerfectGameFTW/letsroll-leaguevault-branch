import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSquarePayment } from "@/hooks/use-square-payment";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { InsertPayment, Bowler, League } from "@shared/schema";
import { insertPaymentSchema } from "@shared/schema";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { Loader2, AlertCircle, CreditCard, Info, AlertTriangle, Wallet } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SavedCard {
  id: string;
  last4: string;
  brand: string;
  expMonth: number;
  expYear: number;
}

interface PaymentFormProps {
  open: boolean;
  onClose: () => void;
  bowlers: Bowler[];
  leagueId?: number;
}

export function PaymentForm({ open, onClose, bowlers, leagueId }: PaymentFormProps) {
  const { toast } = useToast();
  const cardContainerRef = useRef<HTMLDivElement>(null);
  const [isSquareReady, setIsSquareReady] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [activePaymentMethod, setActivePaymentMethod] = useState<'credit' | 'cash' | 'check'>('credit');
  const [squareLoadFailed, setSquareLoadFailed] = useState(false);
  const [cardMode, setCardMode] = useState<'new' | 'saved'>('new');
  const [selectedSavedCardId, setSelectedSavedCardId] = useState<string>('');
  const initializationAttempted = useRef(false);
  const queryClient = useQueryClient();

  const { data: leagueData } = useQuery<{ success: boolean; data: League }>({
    queryKey: ['/api/leagues', leagueId],
    enabled: !!leagueId,
  });
  const leagueInfo = leagueData?.data;

  const form = useForm<InsertPayment>({
    resolver: zodResolver(insertPaymentSchema),
    defaultValues: {
      amount: 2000,
      weekOf: new Date(),
      status: "paid",
      type: "cash",
      leagueId: leagueId,
      storeCard: false, // Default value for the store card option
    },
  });

  const {
    card,
    isInitialized,
    error: squareError,
    initializeCard,
    cleanupCard,
  } = useSquarePayment({
    onError: (error) => {
      form.setValue("type", "cash");
      toast({
        title: "Payment Form Notice",
        description: "Credit card form unavailable. Please try another payment method.",
        variant: "default",
      });
    },
  });

  useEffect(() => {
    if (leagueId) {
      form.setValue('leagueId', leagueId, { shouldDirty: false });
    }
  }, [leagueId]);

  const paymentType = form.watch("type");
  const selectedBowlerId = form.watch("bowlerId");

  const { data: savedCardsResponse } = useQuery<{ success: boolean; data: SavedCard[] }>({
    queryKey: [`/api/square/cards/${selectedBowlerId}`],
    enabled: !!selectedBowlerId && paymentType === 'credit_card',
    staleTime: 1000 * 60 * 5,
    retry: false,
  });
  const savedCards = savedCardsResponse?.data || [];

  useEffect(() => {
    if (savedCards.length > 0 && paymentType === 'credit_card') {
      setCardMode('saved');
      setSelectedSavedCardId(savedCards[0].id);
    } else {
      setCardMode('new');
      setSelectedSavedCardId('');
    }
  }, [savedCards.length, selectedBowlerId, paymentType]);

  useEffect(() => {
    if (!open || paymentType !== "credit_card") {
      if (isInitialized) {
        cleanupCard();
        setIsSquareReady(false);
        initializationAttempted.current = false;
      }
      return;
    }

    // Prevent reinitializing an already initialized or in-progress initialization
    if (!cardContainerRef.current) {
      return;
    }
    
    if (isInitialized) {
      setIsSquareReady(true);
      return;
    }
    
    if (initializationAttempted.current && isSquareReady) {
      return;
    }

    initializationAttempted.current = true;
    setPaymentError(null);
    
    const container = cardContainerRef.current;
    
    // Create a timeout to detect if initialization gets stuck
    const initTimeout = setTimeout(() => {
      if (!isSquareReady) {
        setPaymentError('Failed to initialize payment form in a timely manner');
        // Fall back to cash payment
        form.setValue("type", "cash", { shouldDirty: false });
        initializationAttempted.current = false; // Allow retry on next attempt
        toast({
          title: "Payment Option Changed",
          description: "Credit card processing unavailable at this time. Switched to cash payment.",
          variant: "default",
        });
      }
    }, 5000);
    
    setTimeout(() => {
      initializeCard(container)
        .then(() => {
          setIsSquareReady(true);
          clearTimeout(initTimeout);
        })
        .catch((error) => {
          setIsSquareReady(false);
          setPaymentError(error instanceof Error ? error.message : 'Failed to initialize payment form');
          initializationAttempted.current = false; // Reset to allow retries
          clearTimeout(initTimeout);
          
          // Fall back to cash payment
          form.setValue("type", "cash", { shouldDirty: false });
          toast({
            title: "Payment Form Notice",
            description: "Credit card form unavailable. Please try another payment method.",
            variant: "default",
          });
        });
    }, 300);
    
    // Cleanup function
    return () => {
      clearTimeout(initTimeout);
    };
  }, [open, paymentType, isInitialized, isSquareReady, cleanupCard, initializeCard, toast, form]);

  useEffect(() => {
    if (!open) {
      form.reset();
      setCardMode('new');
      setSelectedSavedCardId('');
    }
  }, [open]);

  const onSubmit = async (data: InsertPayment) => {
    try {
      setPaymentError(null);

      if (data.type === 'credit_card') {
        if (cardMode === 'saved' && selectedSavedCardId) {
          const response = await fetch('/api/square/payments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              sourceId: selectedSavedCardId,
              amount: data.amount,
              bowlerId: data.bowlerId,
              leagueId: data.leagueId,
              storeCard: false,
            }),
          });

          const responseData = await response.json();
          if (!response.ok) {
            throw new Error(responseData.error?.message || 'Failed to process payment');
          }

          toast({ title: "Success", description: "Payment processed with saved card" });
          queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
          onClose();
          return;
        }

        if (!card) {
          throw new Error('Credit card form not initialized');
        }

        const tokenizationOptions = data.storeCard ? {
          cardOnFile: true,
          verificationMethod: 'EXTERNAL',
          verificationDetails: {
            amount: data.amount.toString(),
            currencyCode: 'USD',
            intent: 'STORE'
          }
        } : undefined;
        
        const result = await card.tokenize(tokenizationOptions);

        if (result.status !== 'OK' || !result.token) {
          const errors = result.errors || [];
          const errorMessage = errors.map((e: { message: string }) => e.message).join(', ') || 'Card validation failed';
          throw new Error(errorMessage);
        }

        const response = await fetch('/api/square/payments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceId: result.token,
            amount: data.amount,
            bowlerId: data.bowlerId,
            leagueId: data.leagueId,
            storeCard: data.storeCard || false,
          }),
        });

        const responseData = await response.json();
        if (!response.ok) {
          throw new Error(responseData.error?.message || 'Failed to process payment');
        }

        toast({ title: "Success", description: "Payment processed successfully" });
        if (data.storeCard) {
          queryClient.invalidateQueries({ queryKey: [`/api/square/cards/${data.bowlerId}`] });
        }
        queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
        onClose();
        return;
      }

      const response = await fetch('/api/payments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const responseData = await response.json();

      if (!response.ok) {
        throw new Error(responseData.error?.message || 'Failed to process payment');
      }

      toast({ title: "Success", description: "Payment recorded successfully" });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      onClose();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Failed to process payment";
      setPaymentError(errorMessage);
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record Payment</DialogTitle>
        </DialogHeader>

        {(leagueInfo?.squareLineageItemName || leagueInfo?.squarePrizeFundItemName) && (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              <div className="space-y-1">
                <div>Weekly fee: <span className="font-medium">${(leagueInfo.weeklyFee / 100).toFixed(2)}</span></div>
                {leagueInfo.squareLineageItemName && (
                  <div className="text-xs text-muted-foreground">Lineage: {leagueInfo.squareLineageItemName}</div>
                )}
                {leagueInfo.squarePrizeFundItemName && (
                  <div className="text-xs text-muted-foreground">Prize Fund: {leagueInfo.squarePrizeFundItemName}</div>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {paymentError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{paymentError}</AlertDescription>
              </Alert>
            )}

            <FormField
              control={form.control}
              name="bowlerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Bowler</FormLabel>
                  <FormControl>
                    <select
                      {...field}
                      className="w-full p-2 border rounded"
                      value={field.value || ""}
                      onChange={(e) => {
                        const value = e.target.value ? parseInt(e.target.value, 10) : undefined;
                        field.onChange(value);
                      }}
                    >
                      <option value="">Select a bowler</option>
                      {bowlers.map((bowler) => (
                        <option key={bowler.id} value={bowler.id}>
                          {bowler.name}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage>
                    {form.formState.errors.bowlerId?.message ||
                     (!field.value && "Please select a bowler")}
                  </FormMessage>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount ($)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      {...field}
                      onChange={(e) => {
                        const dollars = parseFloat(e.target.value);
                        field.onChange(Math.round(dollars * 100));
                      }}
                      value={(field.value / 100).toFixed(2)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="weekOf"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Week Of</FormLabel>
                  <FormControl>
                    <Input
                      type="date"
                      {...field}
                      value={field.value instanceof Date ? field.value.toISOString().split('T')[0] : ''}
                      onChange={(e) => field.onChange(new Date(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Replace Radio Buttons with Tabs for better UX */}
            <div className="mb-4">
              <Tabs 
                value={paymentType === "credit_card" ? "credit" : (paymentType === "check" ? "check" : "cash")}
                onValueChange={(value) => {
                  if (value === "credit") {
                    form.setValue("type", "credit_card");
                  } else if (value === "check") {
                    form.setValue("type", "check");
                  } else {
                    form.setValue("type", "cash");
                  }
                }}
                className="w-full"
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger 
                    value="cash" 
                    className="flex items-center gap-2"
                  >
                    Cash
                  </TabsTrigger>
                  <TabsTrigger 
                    value="check" 
                    className="flex items-center gap-2"
                  >
                    Check
                  </TabsTrigger>
                  <TabsTrigger 
                    disabled={squareLoadFailed}
                    value="credit" 
                    className="flex items-center gap-2"
                  >
                    <CreditCard className="h-4 w-4" />
                    Credit Card
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="credit">
                  {squareLoadFailed ? (
                    <Alert variant="destructive" className="mb-4">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertTitle>Credit Card Processing Unavailable</AlertTitle>
                      <AlertDescription>
                        Credit card processing is temporarily unavailable. Please use cash or check payment methods instead.
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </TabsContent>
                
                <TabsContent value="cash">
                  <Alert className="mb-4">
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      Recording a cash payment. The payment will be marked as paid immediately.
                    </AlertDescription>
                  </Alert>
                </TabsContent>
                
                <TabsContent value="check">
                  <Alert className="mb-4">
                    <Info className="h-4 w-4" />
                    <AlertDescription>
                      Recording a check payment. Don't forget to add the check number below.
                    </AlertDescription>
                  </Alert>
                </TabsContent>
              </Tabs>
            </div>
            
            {/* Hidden field for the form validation */}
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem className="hidden">
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="hidden"
                    >
                      <RadioGroupItem value="cash" id="cash" />
                      <RadioGroupItem value="check" id="check" />
                      <RadioGroupItem value="credit_card" id="credit_card" />
                    </RadioGroup>
                  </FormControl>
                </FormItem>
              )}
            />

            {paymentType === "check" && (
              <FormField
                control={form.control}
                name="checkNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Check Number</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {paymentType === "credit_card" && (
              <div className="space-y-4">
                {savedCards.length > 0 && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant={cardMode === 'saved' ? 'default' : 'outline'}
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        if (cardMode === 'saved') return;
                        cleanupCard();
                        setIsSquareReady(false);
                        initializationAttempted.current = false;
                        setCardMode('saved');
                        setSelectedSavedCardId(savedCards[0].id);
                      }}
                    >
                      <Wallet className="h-4 w-4 mr-1" />
                      Saved Card
                    </Button>
                    <Button
                      type="button"
                      variant={cardMode === 'new' ? 'default' : 'outline'}
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        if (cardMode === 'new') return;
                        cleanupCard();
                        setIsSquareReady(false);
                        initializationAttempted.current = false;
                        setCardMode('new');
                        setSelectedSavedCardId('');
                      }}
                    >
                      <CreditCard className="h-4 w-4 mr-1" />
                      New Card
                    </Button>
                  </div>
                )}

                {cardMode === 'saved' && savedCards.length > 0 && (
                  <div className="space-y-3">
                    <Select
                      value={selectedSavedCardId}
                      onValueChange={setSelectedSavedCardId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a saved card" />
                      </SelectTrigger>
                      <SelectContent>
                        {savedCards.map((sc) => (
                          <SelectItem key={sc.id} value={sc.id}>
                            {sc.brand} •••• {sc.last4} (exp {String(sc.expMonth).padStart(2, '0')}/{sc.expYear})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Alert>
                      <Wallet className="h-4 w-4" />
                      <AlertDescription>
                        Payment will be charged to the selected saved card.
                      </AlertDescription>
                    </Alert>
                  </div>
                )}

                <div className={cardMode === 'saved' && savedCards.length > 0 ? 'hidden' : ''}>
                  <div className="min-h-[200px] border rounded-lg bg-card">
                    <div ref={cardContainerRef} className="p-4" />
                    {!isSquareReady && (
                      <div className="flex items-center justify-center p-4">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        <p className="ml-2 text-sm text-muted-foreground">
                          Loading credit card form...
                        </p>
                      </div>
                    )}
                  </div>
                  
                  {squareError && (
                    <div className="p-3 text-sm border border-destructive bg-destructive/10 text-destructive rounded-md">
                      <p><strong>Credit Card Form Error:</strong> {squareError}</p>
                      <p className="mt-1 text-xs">Consider using Cash or Check payment instead.</p>
                    </div>
                  )}
                  
                  <div className="flex items-center space-x-2">
                    <FormField
                      control={form.control}
                      name="storeCard"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center space-x-2 space-y-0">
                          <FormControl>
                            <Checkbox
                              id="storeCard"
                              checked={field.value}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                          <label 
                            htmlFor="storeCard" 
                            className="text-sm font-medium leading-none cursor-pointer"
                          >
                            Save card for future payments
                          </label>
                        </FormItem>
                      )}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  form.formState.isSubmitting || 
                  (paymentType === "credit_card" && cardMode === 'new' && !isSquareReady) ||
                  (paymentType === "credit_card" && cardMode === 'saved' && !selectedSavedCardId)
                }
              >
                {form.formState.isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  "Submit Payment"
                )}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}