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
  debugStatus: string;
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
  const [debugStatus, setDebugStatus] = useState('waiting');

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
      setDebugStatus('disabled');
      prevLocationIdRef.current = locationId;
      return;
    }

    if (!locationId) {
      console.log('[WalletPayments] Skipping init — no locationId yet');
      setDebugStatus('no-locationId');
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
        setDebugStatus(`init:loc=${locationId}`);
        const payments = await initializeSquare(locationId);
        if (cancelled || !mountedRef.current) return;
        setDebugStatus('square-ready');

        const amount = amountCents > 0 ? (amountCents / 100).toFixed(2) : '1.00';
        const paymentRequest = payments.paymentRequest({
          countryCode: 'US',
          currencyCode: 'USD',
          total: { amount, label: 'Total' },
        });
        paymentRequestRef.current = paymentRequest;

        let appleResult = 'skip';
        try {
          setDebugStatus('trying-apple');
          const applePay = await payments.applePay(paymentRequest);
          if (!cancelled && mountedRef.current && applePayRef.current) {
            await applePay.attach(applePayRef.current);
            applePayInstanceRef.current = applePay;
            setApplePayAvailable(true);
            appleResult = 'OK';
          } else {
            appleResult = `no-attach(c=${cancelled},m=${mountedRef.current},r=${!!applePayRef.current})`;
          }
        } catch (appleErr: any) {
          appleResult = `ERR:${appleErr?.message || appleErr}`;
        }

        let googleResult = 'skip';
        try {
          setDebugStatus('trying-google');
          const googlePay = await payments.googlePay(paymentRequest);
          if (!cancelled && mountedRef.current && googlePayRef.current) {
            await googlePay.attach(googlePayRef.current);
            googlePayInstanceRef.current = googlePay;
            setGooglePayAvailable(true);
            googleResult = 'OK';
          } else {
            googleResult = `no-attach(c=${cancelled},m=${mountedRef.current},r=${!!googlePayRef.current})`;
          }
        } catch (googleErr: any) {
          googleResult = `ERR:${googleErr?.message || googleErr}`;
        }

        if (!cancelled) initializedRef.current = true;
        setDebugStatus(`done|apple:${appleResult}|google:${googleResult}`);
      } catch (err: any) {
        setDebugStatus(`FAIL:${err?.message || err}`);
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
    debugStatus,
  };
}
