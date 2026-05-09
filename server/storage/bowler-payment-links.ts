import { and, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  bowlerPaymentLinks,
  type BowlerPaymentLink,
  type InsertBowlerPaymentLink,
  type LinkStatus,
} from "@shared/schema";

/**
 * Pairs are stored canonically with `bowlerAId < bowlerBId` so the
 * unique-pair index is direction-agnostic. Helpers normalize callers'
 * inputs through `pair()` before reading or writing.
 */
function pair(a: number, b: number): { a: number; b: number } {
  if (a === b) {
    throw new Error("bowler cannot link to itself");
  }
  return a < b ? { a, b } : { a: b, b: a };
}

export async function createLinkInvite(input: {
  inviterBowlerId: number;
  inviteeBowlerId: number;
  organizationId: number;
  createdByUserId: number | null;
}): Promise<BowlerPaymentLink> {
  const { a, b } = pair(input.inviterBowlerId, input.inviteeBowlerId);
  const insert: InsertBowlerPaymentLink = {
    bowlerAId: a,
    bowlerBId: b,
    organizationId: input.organizationId,
    status: "pending",
    createdByUserId: input.createdByUserId,
  };
  const [row] = await db.insert(bowlerPaymentLinks).values(insert).returning();
  return row;
}

export async function createAcceptedLink(input: {
  bowlerAId: number;
  bowlerBId: number;
  organizationId: number;
  createdByUserId: number | null;
}): Promise<BowlerPaymentLink> {
  const { a, b } = pair(input.bowlerAId, input.bowlerBId);
  const [row] = await db
    .insert(bowlerPaymentLinks)
    .values({
      bowlerAId: a,
      bowlerBId: b,
      organizationId: input.organizationId,
      status: "accepted",
      createdByUserId: input.createdByUserId,
    })
    .returning();
  if (row && row.status === "accepted" && !row.respondedAt) {
    const [updated] = await db
      .update(bowlerPaymentLinks)
      .set({ respondedAt: new Date().toISOString() })
      .where(eq(bowlerPaymentLinks.id, row.id))
      .returning();
    return updated;
  }
  return row;
}

export async function getLinkBetween(
  bowlerAId: number,
  bowlerBId: number,
): Promise<BowlerPaymentLink | undefined> {
  const { a, b } = pair(bowlerAId, bowlerBId);
  const [row] = await db
    .select()
    .from(bowlerPaymentLinks)
    .where(
      and(eq(bowlerPaymentLinks.bowlerAId, a), eq(bowlerPaymentLinks.bowlerBId, b)),
    )
    .limit(1);
  return row;
}

export async function getLinkById(id: number): Promise<BowlerPaymentLink | undefined> {
  const [row] = await db
    .select()
    .from(bowlerPaymentLinks)
    .where(eq(bowlerPaymentLinks.id, id))
    .limit(1);
  return row;
}

export async function listLinksForBowler(
  bowlerId: number,
  opts?: { status?: LinkStatus },
): Promise<BowlerPaymentLink[]> {
  const conditions = [
    or(eq(bowlerPaymentLinks.bowlerAId, bowlerId), eq(bowlerPaymentLinks.bowlerBId, bowlerId)),
  ];
  if (opts?.status) {
    conditions.push(eq(bowlerPaymentLinks.status, opts.status));
  }
  return db
    .select()
    .from(bowlerPaymentLinks)
    .where(and(...conditions));
}

export async function listLinksForOrg(
  organizationId: number,
  opts?: { status?: LinkStatus },
): Promise<BowlerPaymentLink[]> {
  const conditions = [eq(bowlerPaymentLinks.organizationId, organizationId)];
  if (opts?.status) {
    conditions.push(eq(bowlerPaymentLinks.status, opts.status));
  }
  return db
    .select()
    .from(bowlerPaymentLinks)
    .where(and(...conditions));
}

export async function acceptLink(id: number): Promise<BowlerPaymentLink | undefined> {
  const [row] = await db
    .update(bowlerPaymentLinks)
    .set({ status: "accepted", respondedAt: new Date().toISOString() })
    .where(and(eq(bowlerPaymentLinks.id, id), eq(bowlerPaymentLinks.status, "pending")))
    .returning();
  return row;
}

export async function deleteLink(id: number): Promise<void> {
  await db.delete(bowlerPaymentLinks).where(eq(bowlerPaymentLinks.id, id));
}

/**
 * Scrub each bowler's id from the OTHER bowler's combined-autopay
 * `additionalBowlerIds` arrays when a link is removed. The UPDATE is
 * org-scoped at write time by joining against leagues belonging to the
 * link's organization.
 */
export async function pruneSchedulesForRemovedLink(
  link: Pick<BowlerPaymentLink, "bowlerAId" | "bowlerBId" | "organizationId">,
): Promise<{ id: number; bowlerId: number; removedPartnerId: number }[]> {
  const { paymentSchedules, leagues } = await import("@shared/schema");
  const affected: { id: number; bowlerId: number; removedPartnerId: number }[] = [];

  const orgLeagues = await db
    .select({ id: leagues.id })
    .from(leagues)
    .where(eq(leagues.organizationId, link.organizationId));
  const orgLeagueIds = orgLeagues.map((l) => l.id);
  if (orgLeagueIds.length === 0) return affected;

  const directions: Array<[number, number]> = [
    [link.bowlerAId, link.bowlerBId],
    [link.bowlerBId, link.bowlerAId],
  ];
  for (const [ownerBowlerId, partnerBowlerId] of directions) {
    const updated = await db
      .update(paymentSchedules)
      .set({
        additionalBowlerIds: sql`array_remove(${paymentSchedules.additionalBowlerIds}, ${partnerBowlerId})`,
      })
      .where(
        and(
          eq(paymentSchedules.bowlerId, ownerBowlerId),
          inArray(paymentSchedules.leagueId, orgLeagueIds),
          sql`${partnerBowlerId} = ANY(${paymentSchedules.additionalBowlerIds})`,
        ),
      )
      .returning({ id: paymentSchedules.id });
    for (const row of updated) {
      affected.push({ id: row.id, bowlerId: ownerBowlerId, removedPartnerId: partnerBowlerId });
    }
  }
  return affected;
}

export async function arePartners(
  bowlerAId: number,
  bowlerBId: number,
  organizationId: number,
): Promise<boolean> {
  if (bowlerAId === bowlerBId) return true;
  const link = await getLinkBetween(bowlerAId, bowlerBId);
  return !!link && link.status === "accepted" && link.organizationId === organizationId;
}

export async function getAcceptedPartnerBowlerIds(
  bowlerId: number,
  organizationId: number,
): Promise<number[]> {
  const rows = await db
    .select({ a: bowlerPaymentLinks.bowlerAId, b: bowlerPaymentLinks.bowlerBId })
    .from(bowlerPaymentLinks)
    .where(
      and(
        eq(bowlerPaymentLinks.organizationId, organizationId),
        eq(bowlerPaymentLinks.status, "accepted"),
        or(eq(bowlerPaymentLinks.bowlerAId, bowlerId), eq(bowlerPaymentLinks.bowlerBId, bowlerId)),
      ),
    );
  return rows.map((r) => (r.a === bowlerId ? r.b : r.a));
}

export async function countLinksForBowler(bowlerId: number): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)` })
    .from(bowlerPaymentLinks)
    .where(or(eq(bowlerPaymentLinks.bowlerAId, bowlerId), eq(bowlerPaymentLinks.bowlerBId, bowlerId)));
  return Number(row?.c ?? 0);
}
