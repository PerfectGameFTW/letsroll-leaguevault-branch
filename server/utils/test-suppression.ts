/**
 * Test-only "kick suppression" headers (#569, #571).
 *
 * Each background worker the dev server runs that mutates rows the
 * test suite reads is paired with a header that, when present AND
 * `NODE_ENV !== 'production'`, short-circuits the route's worker
 * kick. Without this, the dev server's live worker shares a DB with
 * the vitest suite and races test assertions by acting on rows tests
 * just inserted (#569 was the original incident on apple-pay; #571
 * generalises the convention to every other route-kicked worker).
 *
 * The NODE_ENV check is the security gate: production deploys ignore
 * the header regardless of value, so the convention cannot be abused
 * to disable a production worker by spoofing the header.
 *
 * Convention for adding a new worker:
 *   1. Pick a header name of the shape `x-test-suppress-<worker>-kick`
 *      and export it as a constant from this file.
 *   2. Gate the worker kick at the route boundary with
 *      `isTestKickSuppressed(req, HEADER)`.
 *   3. Add the new header to `tests/helpers.ts:withTestBypassHeader`
 *      so every test request is shielded by default.
 */
export function isTestKickSuppressed(
  req: { headers: Record<string, unknown> },
  headerName: string,
): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return req.headers[headerName] === '1';
}

/** Suppresses `applePayWorker.kick()` / `enqueue` kick in dev (#569). */
export const APPLE_PAY_WORKER_KICK_HEADER = 'x-test-suppress-apple-pay-kick';

/**
 * Suppresses `paymentScheduler.{add,update,remove}Schedule` calls from
 * route handlers in dev (#571). Skipping the call leaves the DB rows
 * the route just wrote intact — the singleton scheduler doesn't write
 * any of the schedule rows itself, it only sets up node-schedule
 * timers and is the wakeup side of the equation. Without this, a
 * test POST/PATCH/DELETE on `/api/payment-schedules` (or a league
 * timezone change in `/api/leagues/:id`, or a paid-in-full auto-cancel
 * in `/api/payments-provider/payments`) registers/cancels a node-
 * schedule job in the dev server's singleton, which can fire mid-test
 * and process a payment for a row another test file is asserting on.
 */
export const PAYMENT_SCHEDULER_KICK_HEADER = 'x-test-suppress-payment-scheduler-kick';
