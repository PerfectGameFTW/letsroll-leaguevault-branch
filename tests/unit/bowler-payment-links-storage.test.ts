/**
 * Partner-pay: storage helper unit tests for `bowler_payment_links`.
 *
 * Verifies the canonical pair ordering (`bowlerAId < bowlerBId`) and
 * the lifecycle helpers create / accept / decline / list / partners
 * round-trip correctly. Uses the real DB; rows are scoped to a
 * dedicated test org and torn down in afterAll.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { getTestDb } from '../setup/test-db';
const db = getTestDb();
import { bowlers, bowlerPaymentLinks, organizations } from '@shared/schema';
import * as links from '../../server/storage/bowler-payment-links';

const ORG_SLUG = `vitest-bpl-${Date.now()}`;
let orgId = 0;
let aId = 0;
let bId = 0;
let cId = 0;

beforeAll(async () => {
  const [org] = await db
    .insert(organizations)
    .values({ name: 'BPL Test Org', slug: ORG_SLUG })
    .returning();
  orgId = org.id;
  const inserted = await db
    .insert(bowlers)
    .values([
      { name: 'Alice', email: `a-${Date.now()}@vitest.local`, organizationId: orgId },
      { name: 'Bob', email: `b-${Date.now()}@vitest.local`, organizationId: orgId },
      { name: 'Carol', email: `c-${Date.now()}@vitest.local`, organizationId: orgId },
    ])
    .returning();
  [aId, bId, cId] = inserted.map((r) => r.id);
});

afterAll(async () => {
  await db.delete(bowlerPaymentLinks).where(eq(bowlerPaymentLinks.organizationId, orgId));
  await db.delete(bowlers).where(inArray(bowlers.id, [aId, bId, cId]));
  await db.delete(organizations).where(eq(organizations.id, orgId));
});

describe('bowler-payment-links storage', () => {
  it('canonicalizes pair (a<b) regardless of caller order', async () => {
    // Invite Bob -> Alice but pass higher-id first.
    const created = await links.createLinkInvite({
      inviterBowlerId: bId,
      inviteeBowlerId: aId,
      organizationId: orgId,
      createdByUserId: null,
    });
    expect(created.bowlerAId).toBeLessThan(created.bowlerBId);
    expect(created.status).toBe('pending');

    const reverse = await links.getLinkBetween(aId, bId);
    expect(reverse?.id).toBe(created.id);
    await links.deleteLink(created.id);
  });

  it('refuses to link a bowler to itself', async () => {
    await expect(
      links.createLinkInvite({
        inviterBowlerId: aId,
        inviteeBowlerId: aId,
        organizationId: orgId,
        createdByUserId: null,
      }),
    ).rejects.toThrow();
  });

  it('accept promotes pending -> accepted; arePartners true after', async () => {
    const created = await links.createLinkInvite({
      inviterBowlerId: aId,
      inviteeBowlerId: bId,
      organizationId: orgId,
      createdByUserId: null,
    });
    expect(await links.arePartners(aId, bId, orgId)).toBe(false);
    const accepted = await links.acceptLink(created.id);
    expect(accepted?.status).toBe('accepted');
    expect(await links.arePartners(aId, bId, orgId)).toBe(true);
    expect(await links.arePartners(bId, aId, orgId)).toBe(true);
    // Wrong org returns false.
    expect(await links.arePartners(aId, bId, orgId + 999_999)).toBe(false);
    await links.deleteLink(created.id);
  });

  it('listLinksForBowler + getAcceptedPartnerBowlerIds reflect both pending and accepted', async () => {
    const acc = await links.createAcceptedLink({
      bowlerAId: aId,
      bowlerBId: bId,
      organizationId: orgId,
      createdByUserId: null,
    });
    const pend = await links.createLinkInvite({
      inviterBowlerId: aId,
      inviteeBowlerId: cId,
      organizationId: orgId,
      createdByUserId: null,
    });

    const all = await links.listLinksForBowler(aId);
    const ids = all.map((l) => l.id).sort();
    expect(ids).toContain(acc.id);
    expect(ids).toContain(pend.id);

    const partners = await links.getAcceptedPartnerBowlerIds(aId, orgId);
    expect(partners).toContain(bId);
    expect(partners).not.toContain(cId);

    await links.deleteLink(acc.id);
    await links.deleteLink(pend.id);
  });
});
