import { and, eq, sql } from "drizzle-orm";
import { db } from "../db.js";
import {
  bowlerGuardians,
  bowlers,
  users,
  type BowlerGuardian,
  type InsertBowlerGuardian,
  type UpdateBowlerGuardian,
} from "@shared/schema";

export async function getGuardiansForChild(childBowlerId: number): Promise<BowlerGuardian[]> {
  return db
    .select()
    .from(bowlerGuardians)
    .where(eq(bowlerGuardians.childBowlerId, childBowlerId))
    .orderBy(bowlerGuardians.id);
}

export async function getChildrenForGuardian(
  guardianUserId: number,
  organizationId: number,
): Promise<BowlerGuardian[]> {
  return db
    .select()
    .from(bowlerGuardians)
    .where(
      and(
        eq(bowlerGuardians.guardianUserId, guardianUserId),
        eq(bowlerGuardians.organizationId, organizationId),
      ),
    )
    .orderBy(bowlerGuardians.id);
}

export async function getGuardianRow(id: number): Promise<BowlerGuardian | undefined> {
  const [row] = await db.select().from(bowlerGuardians).where(eq(bowlerGuardians.id, id));
  return row;
}

export async function getGuardianForPair(
  childBowlerId: number,
  guardianUserId: number,
): Promise<BowlerGuardian | undefined> {
  const [row] = await db
    .select()
    .from(bowlerGuardians)
    .where(
      and(
        eq(bowlerGuardians.childBowlerId, childBowlerId),
        eq(bowlerGuardians.guardianUserId, guardianUserId),
      ),
    );
  return row;
}

export async function isUserGuardianOfBowler(
  guardianUserId: number,
  childBowlerId: number,
): Promise<boolean> {
  const row = await getGuardianForPair(childBowlerId, guardianUserId);
  return !!row;
}

/**
 * Insert a guardian row for `childBowlerId` and `guardianUserId`. If
 * `isPrimaryContact` is true, demote any other primary-contact rows for
 * the same child first to honor the partial unique index. Wrapped in a
 * transaction so the demote+insert are atomic.
 */
export async function createGuardian(input: InsertBowlerGuardian): Promise<BowlerGuardian> {
  return db.transaction(async (tx) => {
    if (input.isPrimaryContact) {
      await tx
        .update(bowlerGuardians)
        .set({ isPrimaryContact: false })
        .where(
          and(
            eq(bowlerGuardians.childBowlerId, input.childBowlerId),
            eq(bowlerGuardians.isPrimaryContact, true),
          ),
        );
    }
    const [row] = await tx.insert(bowlerGuardians).values(input).returning();
    return row;
  });
}

export async function updateGuardian(
  id: number,
  patch: UpdateBowlerGuardian,
): Promise<BowlerGuardian | undefined> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(bowlerGuardians)
      .where(eq(bowlerGuardians.id, id));
    if (!existing) return undefined;
    if (patch.isPrimaryContact === true) {
      await tx
        .update(bowlerGuardians)
        .set({ isPrimaryContact: false })
        .where(
          and(
            eq(bowlerGuardians.childBowlerId, existing.childBowlerId),
            eq(bowlerGuardians.isPrimaryContact, true),
          ),
        );
    }
    const [row] = await tx
      .update(bowlerGuardians)
      .set(patch)
      .where(eq(bowlerGuardians.id, id))
      .returning();
    return row;
  });
}

export async function deleteGuardian(id: number): Promise<void> {
  await db.delete(bowlerGuardians).where(eq(bowlerGuardians.id, id));
}

export async function countGuardiansForChild(childBowlerId: number): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(bowlerGuardians)
    .where(eq(bowlerGuardians.childBowlerId, childBowlerId));
  return Number(row?.c ?? 0);
}

export async function getPrimaryContactGuardian(
  childBowlerId: number,
): Promise<{ guardian: BowlerGuardian; user: { id: number; email: string; name: string; phone: string | null } } | undefined> {
  const rows = await db
    .select({
      guardian: bowlerGuardians,
      user: { id: users.id, email: users.email, name: users.name, phone: users.phone },
    })
    .from(bowlerGuardians)
    .innerJoin(users, eq(users.id, bowlerGuardians.guardianUserId))
    .where(
      and(
        eq(bowlerGuardians.childBowlerId, childBowlerId),
        eq(bowlerGuardians.isPrimaryContact, true),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Returns the contact email/phone/name to use for a given bowler. For
 * adult bowlers, this is the bowler's own email/phone. For minor
 * bowlers, this is the primary-contact guardian's email/phone (or
 * undefined when there is no primary guardian — callers should treat
 * undefined as "no deliverable contact" and surface a data-integrity
 * warning rather than silently swallow the send).
 */
export async function resolveBowlerContact(bowlerId: number): Promise<
  { email: string | null; phone: string | null; name: string; viaGuardianUserId?: number } | undefined
> {
  const [bowler] = await db.select().from(bowlers).where(eq(bowlers.id, bowlerId));
  if (!bowler) return undefined;
  if (!bowler.isMinor) {
    return { email: bowler.email, phone: bowler.phone, name: bowler.name };
  }
  const primary = await getPrimaryContactGuardian(bowlerId);
  if (!primary) return undefined;
  return {
    email: primary.user.email,
    phone: primary.user.phone,
    name: bowler.name,
    viaGuardianUserId: primary.user.id,
  };
}
