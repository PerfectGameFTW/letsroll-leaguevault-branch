import { useCallback, useEffect, useState } from "react";

/**
 * Shared 429 cooldown state for auth forms. Holds an "until" timestamp,
 * ticks once a second only while active, and exposes a disabled-flag +
 * remaining seconds for the UI to render a countdown banner.
 */
export function useThrottleCountdown(): {
  isThrottled: boolean;
  remainingSeconds: number;
  throttle: (seconds: number) => void;
  clear: () => void;
} {
  const [throttledUntil, setThrottledUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (throttledUntil == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [throttledUntil]);

  useEffect(() => {
    if (throttledUntil != null && now >= throttledUntil) {
      setThrottledUntil(null);
    }
  }, [now, throttledUntil]);

  const remainingSeconds =
    throttledUntil != null ? Math.max(0, Math.ceil((throttledUntil - now) / 1000)) : 0;
  const isThrottled = throttledUntil != null && remainingSeconds > 0;

  const throttle = useCallback((seconds: number) => {
    // Clamp to at least 1s so a near-zero Retry-After still paints the banner.
    const safe = Math.max(1, Math.floor(seconds));
    setThrottledUntil(Date.now() + safe * 1000);
  }, []);

  const clear = useCallback(() => setThrottledUntil(null), []);

  return { isThrottled, remainingSeconds, throttle, clear };
}

/** Human-friendly remaining-time phrase for the throttle banner. */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "any moment now";
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const m = Math.ceil(seconds / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

// Used when the server returns 429 without Retry-After / RateLimit-Reset.
// Kept under the typical 15-min auth-limiter window so the local banner
// clears before the server-side window does.
export const DEFAULT_THROTTLE_FALLBACK_SECONDS = 300;
