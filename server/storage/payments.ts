import { eq, and, desc, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  payments, paymentSchedules, leagues, bowlerLeagues,
  type Payment, type InsertPayment, type UpdatePayment,
  type PaymentSchedule, type InsertPaymentSchedule,
  type PaginatedResult,
} from "@shared/schema";
import { createLogger } from '../logger';

const log = createLogger("StoragePayments");

export async function getPayments(bowlerId?: number, leagueId?: number, teamId?: number, weekOf?: Date, organizationId?: number): Promise<Payment[]> {
  try {
    log.info('Getting payments with filters:', {
      bowlerId,
      leagueId,
      teamId,
      weekOf: weekOf?.toISOString(),
      organizationId,
    });

    const conditions = [];

    if (bowlerId !== undefined) {
      conditions.push(eq(payments.bowlerId, bowlerId));
    }
    if (leagueId !== undefined) {
      conditions.push(eq(payments.leagueId, leagueId));
    }
    if (teamId !== undefined) {
      const bowlerLeaguesSubquery = db
        .select({ bowler_id: bowlerLeagues.bowlerId })
        .from(bowlerLeagues)
        .where(and(
          eq(bowlerLeagues.teamId, teamId),
          leagueId !== undefined ? eq(bowlerLeagues.leagueId, leagueId) : undefined
        ))
        .as('bl');

      conditions.push(sql`${payments.bowlerId} IN (SELECT "bowler_id" FROM ${bowlerLeaguesSubquery})`);
    }
    if (weekOf !== undefined) {
      const startDate = new Date(weekOf);
      startDate.setHours(0, 0, 0, 0);
      const endDate = new Date(weekOf);
      endDate.setHours(23, 59, 59, 999);
      conditions.push(sql`${payments.weekOf} BETWEEN ${startDate} AND ${endDate}`);
    }
    if (organizationId !== undefined) {
      conditions.push(sql`${payments.leagueId} IN (SELECT "id" FROM ${leagues} WHERE ${leagues.organizationId} = ${organizationId})`);
    }

    const query = db.select().from(payments);

    if (conditions.length > 0) {
      query.where(and(...conditions));
    }

    query.orderBy(desc(payments.weekOf));

    const results = await query;

    log.info('Payment query results:', {
      count: results.length,
      samples: results.slice(0, 2).map(p => ({
        id: p.id,
        amount: p.amount,
        bowlerId: p.bowlerId,
        type: p.type,
        status: p.status,
        weekOf: p.weekOf
      }))
    });

    return results;
  } catch (error) {
    log.error('Error getting payments:', error);
    throw error;
  }
}

export async function getPaymentsPaginated(
  filters: { bowlerId?: number; leagueId?: number; teamId?: number; weekOf?: Date; organizationId?: number },
  page: number,
  limit: number
): Promise<PaginatedResult<Payment>> {
  const conditions = [];

  if (filters.bowlerId !== undefined) {
    conditions.push(eq(payments.bowlerId, filters.bowlerId));
  }
  if (filters.leagueId !== undefined) {
    conditions.push(eq(payments.leagueId, filters.leagueId));
  }
  if (filters.teamId !== undefined) {
    const bowlerLeaguesSubquery = db
      .select({ bowler_id: bowlerLeagues.bowlerId })
      .from(bowlerLeagues)
      .where(and(
        eq(bowlerLeagues.teamId, filters.teamId),
        filters.leagueId !== undefined ? eq(bowlerLeagues.leagueId, filters.leagueId) : undefined
      ))
      .as('bl');
    conditions.push(sql`${payments.bowlerId} IN (SELECT "bowler_id" FROM ${bowlerLeaguesSubquery})`);
  }
  if (filters.weekOf !== undefined) {
    const startDate = new Date(filters.weekOf);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(filters.weekOf);
    endDate.setHours(23, 59, 59, 999);
    conditions.push(sql`${payments.weekOf} BETWEEN ${startDate} AND ${endDate}`);
  }
  if (filters.organizationId !== undefined) {
    conditions.push(sql`${payments.leagueId} IN (SELECT "id" FROM ${leagues} WHERE ${leagues.organizationId} = ${filters.organizationId})`);
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(payments)
    .where(whereClause);
  const total = Number(countResult?.count ?? 0);

  const offset = (page - 1) * limit;
  const query = db.select().from(payments);
  if (whereClause) {
    query.where(whereClause);
  }
  query.orderBy(desc(payments.weekOf));
  query.limit(limit);
  query.offset(offset);

  const items = await query;

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getPaymentById(id: number): Promise<Payment | undefined> {
  const [result] = await db.select().from(payments).where(eq(payments.id, id));
  return result;
}

export async function getPaymentByIdempotencyKey(key: string): Promise<Payment | undefined> {
  const [result] = await db.select().from(payments).where(eq(payments.idempotencyKey, key)).limit(1);
  return result;
}

export async function createPayment(payment: InsertPayment): Promise<Payment> {
  const [result] = await db.insert(payments).values(payment).returning();
  return result;
}

export async function updatePayment(id: number, payment: UpdatePayment): Promise<Payment> {
  const [result] = await db
    .update(payments)
    .set(payment)
    .where(eq(payments.id, id))
    .returning();
  return result;
}

export async function refundPayment(id: number, squareRefundId?: string, reason?: string): Promise<Payment> {
  const [result] = await db
    .update(payments)
    .set({
      status: 'refunded',
      squareRefundId: squareRefundId || null,
      refundReason: reason || null,
      refundedAt: new Date().toISOString(),
    })
    .where(eq(payments.id, id))
    .returning();
  return result;
}

export async function deletePayment(id: number): Promise<void> {
  await db.delete(payments).where(eq(payments.id, id));
}

export async function createPaymentSchedule(schedule: InsertPaymentSchedule): Promise<PaymentSchedule> {
  const [result] = await db.insert(paymentSchedules).values(schedule).returning();
  return result;
}

export async function getPaymentSchedule(bowlerId: number, leagueId: number): Promise<PaymentSchedule | undefined> {
  const [result] = await db
    .select()
    .from(paymentSchedules)
    .where(
      and(
        eq(paymentSchedules.bowlerId, bowlerId),
        eq(paymentSchedules.leagueId, leagueId),
        eq(paymentSchedules.active, true)
      )
    );
  return result;
}

export async function getPaymentScheduleById(id: number): Promise<PaymentSchedule | undefined> {
  const [result] = await db
    .select()
    .from(paymentSchedules)
    .where(eq(paymentSchedules.id, id));
  return result;
}

export async function getActiveSchedulesByLeague(leagueId: number): Promise<PaymentSchedule[]> {
  return db
    .select()
    .from(paymentSchedules)
    .where(
      and(
        eq(paymentSchedules.leagueId, leagueId),
        eq(paymentSchedules.active, true)
      )
    );
}

export async function deactivatePaymentSchedule(id: number): Promise<void> {
  await db
    .update(paymentSchedules)
    .set({ active: false })
    .where(eq(paymentSchedules.id, id));
}

export async function updatePaymentScheduleFields(
  id: number,
  fields: Partial<Pick<PaymentSchedule, 'frequency' | 'amount' | 'nextPaymentDate' | 'squareCardId'>>
): Promise<PaymentSchedule> {
  const [updated] = await db
    .update(paymentSchedules)
    .set(fields)
    .where(eq(paymentSchedules.id, id))
    .returning();
  return updated;
}

export async function updatePaymentScheduleCard(bowlerId: number, leagueId: number, cardId: string): Promise<void> {
  try {
    log.info('Updating payment schedule card:', {
      bowlerId,
      leagueId,
      cardIdLength: cardId.length
    });

    await db
      .update(paymentSchedules)
      .set({ squareCardId: cardId })
      .where(
        and(
          eq(paymentSchedules.bowlerId, bowlerId),
          eq(paymentSchedules.leagueId, leagueId),
          eq(paymentSchedules.active, true)
        )
      );

    log.info('Successfully updated payment schedule card');
  } catch (error) {
    log.error('Error updating payment schedule card:', {
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error,
      input: { bowlerId, leagueId, cardIdLength: cardId.length }
    });
    throw error;
  }
}
