import { db } from "../db";
import { eq, and, lte, gte, sql } from "drizzle-orm";
import { payments, leagues, bowlers, type PaymentSchedule } from "@shared/schema";
import { providerNameToPaymentType } from "@shared/schema/constants";
import { logger } from "../logger";
import { getPaymentProvider, ProviderNotConfiguredError } from "./payment-provider-factory";
import { buildPaymentErrorResponse } from "../utils/payment-error-response";
import type { PaymentProvider, OrderLineItem } from "./payment-provider";

export interface ChargeResult {
  status: 'success' | 'error';
  paymentId?: string;
  error?: string;
  cardId?: string;
  providerRef?: Record<string, string>;
  providerName?: string;
  // Square hosted-receipt fields; undefined for Clover.
  receiptUrl?: string;
  receiptNumber?: string;
  // True when a Square charge ran without buyer email (no auto-receipt).
  buyerEmailMissing?: boolean;
}

export type PaymentResult = ChargeResult;

async function fetchBowlerPaymentInfo(bowlerId: number) {
  const bowler = await db.select().from(bowlers).where(eq(bowlers.id, bowlerId)).then(r => r[0]);
  return {
    buyerEmail: bowler?.email || undefined,
    paymentCustomerId: bowler?.paymentCustomerId || undefined,
  };
}

export function buildLineItems(
  league: typeof leagues.$inferSelect,
  quantity: string
): OrderLineItem[] {
  const lineItems: OrderLineItem[] = [];
  if (league.lineageItemVariationId) {
    lineItems.push({ catalogObjectId: league.lineageItemVariationId, quantity });
  }
  if (league.prizeFundItemVariationId) {
    lineItems.push({ catalogObjectId: league.prizeFundItemVariationId, quantity });
  }
  return lineItems;
}

export async function executeCharge(
  provider: PaymentProvider,
  cardId: string,
  amount: number,
  lineItems: OrderLineItem[],
  paymentCustomerId: string | undefined,
  buyerEmail: string | undefined
): Promise<ChargeResult> {
  // Square auto-emails its receipt only when buyerEmailAddress is set.
  const buyerEmailMissing = provider.providerName === 'square' && !buyerEmail;
  if (buyerEmailMissing) {
    logger.warn('[PaymentExecution] Square charge issued without buyer email — no auto-receipt will be sent', {
      providerName: provider.providerName,
      amount,
    });
  }

  if (lineItems.length > 0) {
    try {
      const orderResult = await provider.createOrderWithPayment(
        cardId,
        amount,
        lineItems,
        false,
        paymentCustomerId,
        buyerEmail
      );
      if (!orderResult.id) {
        return { status: 'error', error: 'Order payment succeeded but no payment ID returned', providerName: provider.providerName };
      }
      return {
        status: 'success',
        paymentId: orderResult.id,
        providerRef: orderResult.providerRef,
        providerName: provider.providerName,
        receiptUrl: orderResult.receiptUrl,
        receiptNumber: orderResult.receiptNumber,
        buyerEmailMissing,
      };
    } catch (error) {
      // Surface the typed PaymentProviderError.userMessage instead
      // of the raw `error.message` so the failed-payment row's
      // `notes` ("Failed payment: …" — see payment-lifecycle.ts)
      // carries the actionable provider reason an admin can act on,
      // not "Unknown error" or a leaked SDK string. Task #605.
      const { userMessage } = buildPaymentErrorResponse(
        error,
        error instanceof Error ? error.message : 'Unknown error',
        'PAYMENT_ERROR',
      );
      return { status: 'error', error: userMessage, providerName: provider.providerName };
    }
  } else {
    try {
      const processResult = await provider.processPayment(
        cardId,
        amount,
        false,
        paymentCustomerId,
        buyerEmail,
        undefined,
      );
      if (processResult?.id) {
        return {
          status: 'success',
          paymentId: processResult.id,
          providerRef: processResult.providerRef,
          providerName: provider.providerName,
          receiptUrl: processResult.receiptUrl,
          receiptNumber: processResult.receiptNumber,
          buyerEmailMissing,
        };
      }
      return { status: 'error', error: 'Payment processing failed', providerName: provider.providerName };
    } catch (error) {
      // Mirror the createOrderWithPayment branch above so the
      // no-line-items processPayment path (autopay / scheduled
      // executions when the league has no catalog item ids) also
      // routes typed PaymentProviderError / ProviderNotConfiguredError
      // failures through the shared helper. Without this, a typed
      // provider failure on this branch would propagate out raw and
      // the caller's failed-payment row would carry the leaked
      // `error.message` (or "Unknown error") instead of the actionable
      // sanitized provider reason. Task #605.
      const { userMessage } = buildPaymentErrorResponse(
        error,
        error instanceof Error ? error.message : 'Unknown error',
        'PAYMENT_ERROR',
      );
      return { status: 'error', error: userMessage, providerName: provider.providerName };
    }
  }
}

export async function executeChargeForLocation(
  cardId: string,
  amount: number,
  lineItems: OrderLineItem[],
  locationId: number | null,
  paymentCustomerId: string | undefined,
  buyerEmail: string | undefined
): Promise<ChargeResult> {
  try {
    const provider = await getPaymentProvider(locationId);
    return executeCharge(provider, cardId, amount, lineItems, paymentCustomerId, buyerEmail);
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) {
      // Use the helper's canonical not-configured message instead of
      // interpolating the raw `e.message` (which can include the
      // location id or processor name). Task #605.
      const { userMessage } = buildPaymentErrorResponse(e, '', 'PAYMENT_ERROR');
      return { status: 'error', error: userMessage };
    }
    throw e;
  }
}

export async function executeScheduledPayment(
  scheduleRecord: PaymentSchedule,
  league: typeof leagues.$inferSelect,
  jobId: string
): Promise<ChargeResult> {
  const { buyerEmail, paymentCustomerId } = await fetchBowlerPaymentInfo(scheduleRecord.bowlerId);

  const locationId = league?.locationId ?? null;
  let provider;
  try {
    provider = await getPaymentProvider(locationId);
  } catch (e) {
    if (e instanceof ProviderNotConfiguredError) {
      // Same canonical message as the interactive charge path —
      // the failed-payment row's `notes` should not embed internal
      // location ids. Task #605.
      const { userMessage } = buildPaymentErrorResponse(e, '', 'PAYMENT_ERROR');
      return { status: 'error', error: userMessage };
    }
    throw e;
  }

  if (!paymentCustomerId && provider.validateCardId(scheduleRecord.paymentCardId)) {
    logger.warn(`[PaymentScheduler] Card-on-file charge for ${jobId} has no customer ID — provider may reject the payment`, {
      bowlerId: scheduleRecord.bowlerId,
    });
  }

  const weeklyFee = league?.weeklyFee || 0;
  const scheduledQty = weeklyFee > 0 && scheduleRecord.amount % weeklyFee === 0
    ? String(scheduleRecord.amount / weeklyFee)
    : '1';
  const lineItems = buildLineItems(league, scheduledQty);

  return executeCharge(
    provider,
    scheduleRecord.paymentCardId!,
    scheduleRecord.amount,
    lineItems,
    paymentCustomerId,
    buyerEmail
  );
}

export function computePaymentSplit(
  amount: number,
  league: typeof leagues.$inferSelect
): { lineageAmount: number | undefined; prizeFundAmount: number | undefined } {
  const lineageAmount = (league?.lineageFee != null && (league?.weeklyFee ?? 0) > 0)
    ? Math.round(amount * league.lineageFee / league.weeklyFee)
    : undefined;
  const prizeFundAmount = (league?.prizeFundFee != null && (league?.weeklyFee ?? 0) > 0)
    ? Math.round(amount * league.prizeFundFee / league.weeklyFee)
    : undefined;
  return { lineageAmount, prizeFundAmount };
}

export async function createPaymentRecord(
  scheduleRecord: PaymentSchedule,
  amount: number,
  status: 'paid' | 'failed',
  league: typeof leagues.$inferSelect,
  paymentId?: string,
  notes?: string,
  weekOf?: string,
  tx?: typeof db,
  providerRef?: Record<string, string>,
  providerName?: string,
  // Receipt context threaded from executeCharge; Square-only.
  receipt?: {
    receiptUrl?: string;
    receiptNumber?: string;
    buyerEmailMissing?: boolean;
  },
): Promise<void> {
  const target = tx ?? db;
  const { lineageAmount, prizeFundAmount } = computePaymentSplit(amount, league);

  await target.insert(payments).values({
    bowlerId: scheduleRecord.bowlerId,
    leagueId: scheduleRecord.leagueId,
    amount,
    lineageAmount: status === 'paid' ? lineageAmount : undefined,
    prizeFundAmount: status === 'paid' ? prizeFundAmount : undefined,
    status,
    type: providerNameToPaymentType(providerName || ''),
    weekOf: weekOf ?? scheduleRecord.nextPaymentDate,
    providerPaymentId: paymentId,
    cloverChargeId: providerRef?.cloverChargeId,
    receiptUrl: receipt?.receiptUrl,
    receiptNumber: receipt?.receiptNumber,
    receiptEmailMissing:
      status === 'paid' && providerName === 'square'
        ? receipt?.buyerEmailMissing ?? false
        : false,
    notes,
  });
}

export async function getTotalPaidInSeason(
  bowlerId: number,
  leagueId: number,
  seasonStart: Date,
  seasonEnd: Date
): Promise<number> {
  const totalPaidResult = await db
    .select({ total: sql<number>`COALESCE(SUM(${payments.amount}), 0)` })
    .from(payments)
    .where(and(
      eq(payments.bowlerId, bowlerId),
      eq(payments.leagueId, leagueId),
      eq(payments.status, 'paid'),
      gte(payments.weekOf, seasonStart.toISOString()),
      lte(payments.weekOf, seasonEnd.toISOString())
    ));
  return Number(totalPaidResult[0]?.total || 0);
}
