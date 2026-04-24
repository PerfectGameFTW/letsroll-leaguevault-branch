import { useCallback, useEffect, useState } from "react";

/**
 * Shared throttle / cooldown UI primitive (tasks #355, #411).
 *
 * The change-password card, the login form, and the forgot-password
 * form all surface 429 responses by blocking the submit button and
 * showing a friendly "you've been throttled, try again in N seconds"
 * banner. They used to each maintain their own timer state — this
 * hook holds it once.
 *
 * Usage:
 *
 *     const { isThrottled, remainingSeconds, throttle } =
 *         useThrottleCountdown();
 *     // …on a 429 response:
 *     throttle(retryAfterSeconds ?? 300);
 *     // …in the JSX:
 *     {isThrottled && <Alert>Try again in {formatCountdown(remainingSeconds)}</Alert>}
 *
 * The hook ticks once a second only while throttled; the interval
 * is torn down as soon as the window elapses, so an idle form
 * costs nothing.
 */
export function useThrottleCountdown(): {
  /** True while the cooldown window is in the future. */
  isThrottled: boolean;
  /** Whole seconds remaining until the cooldown ends (0 when idle). */
  remainingSeconds: number;
  /** Begin (or extend) a cooldown of `seconds` from now. */
  throttle: (seconds: number) => void;
  /** End the cooldown immediately, e.g. on a successful retry. */
  clear: () => void;
} {
  const [throttledUntil, setThrottledUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tick once a second while throttled so the visible countdown
  // re-renders. We deliberately do NOT tick when idle — there's no
  // banner to update and no point burning a timer slot.
  useEffect(() => {
    if (throttledUntil == null) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [throttledUntil]);

  // Once the window has elapsed, clear `throttledUntil` so the
  // banner disappears and the next tick effect tears down the
  // interval. Done in an effect (not derived) so the state change
  // re-renders consumers that gate the submit button on
  // `isThrottled`.
  useEffect(() => {
    if (throttledUntil != null && now >= throttledUntil) {
      setThrottledUntil(null);
    }
  }, [now, throttledUntil]);

  const remainingSeconds =
    throttledUntil != null ? Math.max(0, Math.ceil((throttledUntil - now) / 1000)) : 0;
  const isThrottled = throttledUntil != null && remainingSeconds > 0;

  const throttle = useCallback((seconds: number) => {
    // Clamp to at least one second so the banner appears for at
    // least one paint even when the server returns a very small
    // (or zero) Retry-After. Negative input would otherwise read
    // as "already past" and immediately tear the banner back down.
    const safe = Math.max(1, Math.floor(seconds));
    setThrottledUntil(Date.now() + safe * 1000);
  }, []);

  const clear = useCallback(() => setThrottledUntil(null), []);

  return { isThrottled, remainingSeconds, throttle, clear };
}

/**
 * Render a remaining-seconds count as a human phrase suitable for
 * the throttle banner. Kept here next to `useThrottleCountdown`
 * because every consumer of the hook also wants this exact wording.
 */
export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "any moment now";
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const m = Math.ceil(seconds / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

/**
 * Default cooldown to apply when the server returned a 429 but did
 * NOT include a Retry-After / RateLimit-Reset header. 5 minutes is
 * deliberately less than the typical 15-minute auth-limiter window
 * so the user is nudged to the recovery flow instead of waiting in
 * silence; once the real window elapses on the server they'll be
 * able to retry even though our local banner already cleared.
 */
export const DEFAULT_THROTTLE_FALLBACK_SECONDS = 300;
