import { useState, useEffect, useRef, useCallback } from "react";
import { initializeSquare } from "@/lib/square";
import type { SquarePaymentRequest, SquareWalletPayment } from "@/lib/square";

interface UseWalletPaymentsOptions {
  locationId?: number | null;
  amountCents: number;
  enabled: boolean;
  onTokenReceived: (token: string, walletType: 'apple_pay' | 'google_pay') => Promise<void>;
  onError: (error: string) => void;
}

interface UseWalletPaymentsReturn {
  applePayAvailable: boolean;
  googlePayAvailable: boolean;
  applePayRef: React.RefObject<HTMLDivElement>;
  googlePayRef: React.RefObject<HTMLDivElement>;
  handleApplePayClick: () => Promise<void>;
  handleGooglePayClick: () => Promise<void>;
  isProcessing: boolean;
  cleanup: () => void;
}

export function useWalletPayments({
  locationId,
  amountCents,
  enabled,
  onTokenReceived,
  onError,
}: UseWalletPaymentsOptions): UseWalletPaymentsReturn {
  const [applePayAvailable, setApplePayAvailable] = useState(false);
  const [googlePayAvailable, setGooglePayAvailable] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  const applePayRef = useRef<HTMLDivElement>(null!);
  const googlePayRef = useRef<HTMLDivElement>(null!);
  const paymentRequestRef = useRef<SquarePaymentRequest | null>(null);
  const applePayInstanceRef = useRef<SquareWalletPayment | null>(null);
  const googlePayInstanceRef = useRef<SquareWalletPayment | null>(null);
  const mountedRef = useRef(true);
  const initializedRef = useRef(false);
  const onTokenReceivedRef = useRef(onTokenReceived);
  const onErrorRef = useRef(onError);

  onTokenReceivedRef.current = onTokenReceived;
  onErrorRef.current = onError;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (paymentRequestRef.current && amountCents > 0) {
      try {
        paymentRequestRef.current.update({
          total: {
            amount: (amountCents / 100).toFixed(2),
            label: 'Total',
          },
        });
      } catch (err) {
        console.error('[WalletPayments] Error updating payment request:', err);
      }
    }
  }, [amountCents]);

  const prevLocationIdRef = useRef<number | null | undefined>(undefined);

  const destroyInstances = useCallback(() => {
    try { applePayInstanceRef.current?.destroy(); } catch {}
    try { googlePayInstanceRef.current?.destroy(); } catch {}
    applePayInstanceRef.current = null;
    googlePayInstanceRef.current = null;
    paymentRequestRef.current = null;
    initializedRef.current = false;
    setApplePayAvailable(false);
    setGooglePayAvailable(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (initializedRef.current) {
        destroyInstances();
      }
      prevLocationIdRef.current = locationId;
      return;
    }

    if (!locationId) {
      console.log('[WalletPayments] Skipping init — no locationId yet');
      prevLocationIdRef.current = locationId;
      return;
    }

    const locationChanged = prevLocationIdRef.current !== undefined && prevLocationIdRef.current !== locationId;
    if (locationChanged && initializedRef.current) {
      destroyInstances();
    }
    prevLocationIdRef.current = locationId;

    if (initializedRef.current) return;

    let cancelled = false;

    async function init() {
      try {
        console.log('[WalletPayments] Initializing with locationId:', locationId, 'enabled:', enabled, 'amountCents:', amountCents);
        const payments = await initializeSquare(locationId);
        if (cancelled || !mountedRef.current) return;
        console.log('[WalletPayments] Square payments initialized, creating payment request...');

        const amount = amountCents > 0 ? (amountCents / 100).toFixed(2) : '1.00';
        const paymentRequest = payments.paymentRequest({
          countryCode: 'US',
          currencyCode: 'USD',
          total: { amount, label: 'Total' },
        });
        paymentRequestRef.current = paymentRequest;
        console.log('[WalletPayments] Payment request created, initializing wallets...');

        try {
          console.log('[WalletPayments] Attempting Apple Pay init...');
          const applePay = await payments.applePay(paymentRequest);
          console.log('[WalletPayments] Apple Pay object created, attaching...', 'ref exists:', !!applePayRef.current);
          if (!cancelled && mountedRef.current && applePayRef.current) {
            await applePay.attach(applePayRef.current);
            applePayInstanceRef.current = applePay;
            setApplePayAvailable(true);
            console.log('[WalletPayments] Apple Pay initialized and attached successfully');
          } else {
            console.log('[WalletPayments] Apple Pay skipped attach - cancelled:', cancelled, 'mounted:', mountedRef.current, 'ref:', !!applePayRef.current);
          }
        } catch (appleErr: any) {
          console.warn('[WalletPayments] Apple Pay not available:', appleErr?.message || appleErr);
        }

        try {
          console.log('[WalletPayments] Attempting Google Pay init...');
          const googlePay = await payments.googlePay(paymentRequest);
          console.log('[WalletPayments] Google Pay object created, attaching...', 'ref exists:', !!googlePayRef.current);
          if (!cancelled && mountedRef.current && googlePayRef.current) {
            await googlePay.attach(googlePayRef.current);
            googlePayInstanceRef.current = googlePay;
            setGooglePayAvailable(true);
            console.log('[WalletPayments] Google Pay initialized and attached successfully');
          } else {
            console.log('[WalletPayments] Google Pay skipped attach - cancelled:', cancelled, 'mounted:', mountedRef.current, 'ref:', !!googlePayRef.current);
          }
        } catch (googleErr: any) {
          console.warn('[WalletPayments] Google Pay not available:', googleErr?.message || googleErr);
        }

        if (!cancelled) initializedRef.current = true;
        console.log('[WalletPayments] Initialization complete');
      } catch (err: any) {
        console.error('[WalletPayments] Failed to initialize:', err?.message || err);
      }
    }

    const timer = setTimeout(init, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled, locationId, destroyInstances]);

  const handleApplePayClick = useCallback(async () => {
    if (!applePayInstanceRef.current || isProcessing) return;
    if (amountCents <= 0) {
      onErrorRef.current('Please enter a valid payment amount');
      return;
    }
    setIsProcessing(true);
    try {
      const result = await applePayInstanceRef.current.tokenize();
      if (result.status === 'OK' && result.token) {
        await onTokenReceivedRef.current(result.token, 'apple_pay');
      } else if (result.status === 'CANCEL') {
        // User cancelled - do nothing
      } else {
        const errorMsg = result.errors?.map(e => e.message).join(', ') || 'Apple Pay payment was not completed';
        onErrorRef.current(errorMsg);
      }
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : 'Apple Pay failed');
    } finally {
      if (mountedRef.current) setIsProcessing(false);
    }
  }, [isProcessing, amountCents]);

  const handleGooglePayClick = useCallback(async () => {
    if (!googlePayInstanceRef.current || isProcessing) return;
    if (amountCents <= 0) {
      onErrorRef.current('Please enter a valid payment amount');
      return;
    }
    setIsProcessing(true);
    try {
      const result = await googlePayInstanceRef.current.tokenize();
      if (result.status === 'OK' && result.token) {
        await onTokenReceivedRef.current(result.token, 'google_pay');
      } else if (result.status === 'CANCEL') {
        // User cancelled - do nothing
      } else {
        const errorMsg = result.errors?.map(e => e.message).join(', ') || 'Google Pay payment was not completed';
        onErrorRef.current(errorMsg);
      }
    } catch (err) {
      onErrorRef.current(err instanceof Error ? err.message : 'Google Pay failed');
    } finally {
      if (mountedRef.current) setIsProcessing(false);
    }
  }, [isProcessing, amountCents]);

  const cleanup = destroyInstances;

  return {
    applePayAvailable,
    googlePayAvailable,
    applePayRef,
    googlePayRef,
    handleApplePayClick,
    handleGooglePayClick,
    isProcessing,
    cleanup,
  };
}
