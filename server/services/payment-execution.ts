import { db } from "../db";
import { eq, and, lte, gte, sql } from "drizzle-orm";
import { payments, leagues, bowlers, type PaymentSchedule } from "@shared/schema";
import { logger } from "../logger";
import { getPaymentProvider } from "./payment-provider-factory";
import type { PaymentProvider, OrderLineItem } from "./payment-provider";

export interface ChargeResult {
  status: 'success' | 'error';
  paymentId?: string;
  error?: string;
  cardId?: string;
  providerRef?: {
    cardpointeRetref?: string;
    cardpointeAuthcode?: string;
  };
}

export type PaymentResult = ChargeResult;

async function fetchBowlerPaymentInfo(bowlerId: number) {
  const bowler = await db.select().from(bowlers).where(eq(bowlers.id, bowlerId)).then(r => r[0]);
  return {
    buyerEmail: bowler?.email || undefined,
    paymentCustomerId: bowler?.paymentCustomerId || undefined,
  };
}

function buildLineItems(
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
        return { status: 'error', error: 'Order payment succeeded but no payment ID returned' };
      }
      return { status: 'success', paymentId: orderResult.id, providerRef: orderResult.providerRef };
    } catch (error) {
      return { status: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  } else {
    const processResult = await provider.processPayment(
      cardId,
      amount,
      false,
      paymentCustomerId,
      buyerEmail,
      undefined,
    );
    if (processResult?.id) {
      return { status: 'success', paymentId: processResult.id, providerRef: processResult.providerRef };
    }
    return { status: 'error', error: 'Payment processing failed' };
  }
}

export async function executeSquareCharge(
  cardId: string,
  amount: number,
  lineItems: OrderLineItem[],
  locationId: number | null,
  paymentCustomerId: string | undefined,
  buyerEmail: string | undefined
): Promise<ChargeResult> {
  const provider = await getPaymentProvider(locationId);
  if (!provider) {
    return { status: 'error', error: 'No payment provider configured for this location' };
  }
  return executeCharge(provider, cardId, amount, lineItems, paymentCustomerId, buyerEmail);
}

export async function executeScheduledPayment(
  scheduleRecord: PaymentSchedule,
  league: typeof leagues.$inferSelect,
  jobId: string
): Promise<ChargeResult> {
  const { buyerEmail, paymentCustomerId } = await fetchBowlerPaymentInfo(scheduleRecord.bowlerId);

  const locationId = league?.locationId ?? null;
  const provider = await getPaymentProvider(locationId);
  if (!provider) {
    return { status: 'error', error: 'No payment provider configured for this location' };
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
  providerRef?: { cardpointeRetref?: string; cardpointeAuthcode?: string },
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
    type: 'credit_card',
    weekOf: weekOf ?? scheduleRecord.nextPaymentDate,
    providerPaymentId: paymentId,
    cardpointeRetref: providerRef?.cardpointeRetref,
    cardpointeAuthcode: providerRef?.cardpointeAuthcode,
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
