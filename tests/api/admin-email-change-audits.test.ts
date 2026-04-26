/**
 * GET /api/system-admin/admin-email-change-audits
 * ------------------------------------------------------------------
 * Pins the contract for the admin email-change history endpoint
 * (task #375). Two things matter on the wire:
 *
 *  1. The response carries the masked emails from the audit row, NOT
 *     the live `users.email`. Live emails could have been re-changed
 *     since the audit was written and are unnecessary PII.
 *  2. The endpoint is admin-only and supports `?targetUserId=` filter
 *     plus `?limit=&offset=` paging.
 *
 * The fixture inserts a synthetic audit row directly so the test
 * doesn't have to drive the full PATCH-profile flow end-to-end.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import {
  adminEmailChangeAudits,
  organizations,
  users,
} from '@shared/schema';
import { hashPassword } from '../../server/lib/password';
import {
  login,
  apiGet,
  type AuthSession,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_ORG_A_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

interface AuditRow {
  id: number;
  actorUserId: number;
  targetUserId: number;
  oldEmailMasked: string;
  newEmailMasked: string;
  createdAt: string;
  actorName: string | null;
  targetName: string | null;
}

interface ListBody {
  rows: AuditRow[];
  total: number;
  limit: number;
  offset: number;
}

const SUFFIX = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const TARGET_LIVE_EMAIL = `audit-target-${SUFFIX}@example.com`;
const SECONDARY_TARGET_LIVE_EMAIL = `audit-target-2-${SUFFIX}@example.com`;

describe('Admin email-change audits API', () => {
  let admin: AuthSession;
  let targetUserId = 0;
  let secondaryTargetUserId = 0;
  let createdOrgId = 0;
  let insertedAuditIds: number[] = [];

  beforeAll(async () => {
    admin = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);

    const orgSlug = `vitest-audit-${SUFFIX}`;
    const [org] = await db
      .insert(organizations)
      .values({ name: 'Vitest Audit Org', slug: orgSlug, active: true })
      .returning({ id: organizations.id });
    createdOrgId = org.id;

    const passwordHash = await hashPassword('not-used-here');
    const [target] = await db
      .insert(users)
      .values({
        name: `Audit Target ${SUFFIX}`,
        email: TARGET_LIVE_EMAIL,
        password: passwordHash,
        role: 'user',
        organizationId: createdOrgId,
      })
      .returning();
    targetUserId = target.id;

    const [secondary] = await db
      .insert(users)
      .values({
        name: `Audit Target 2 ${SUFFIX}`,
        email: SECONDARY_TARGET_LIVE_EMAIL,
        password: passwordHash,
        role: 'user',
        organizationId: createdOrgId,
      })
      .returning();
    secondaryTargetUserId = secondary.id;

    const inserted = await db
      .insert(adminEmailChangeAudits)
      .values([
        {
          actorUserId: admin.user.id,
          targetUserId,
          oldEmailMasked: 'a***@example.com',
          newEmailMasked: 'b***@example.com',
        },
        {
          actorUserId: admin.user.id,
          targetUserId: secondaryTargetUserId,
          oldEmailMasked: 'c***@example.com',
          newEmailMasked: 'd***@example.com',
        },
      ])
      .returning({ id: adminEmailChangeAudits.id });
    insertedAuditIds = inserted.map((r) => r.id);
  });

  afterAll(async () => {
    if (insertedAuditIds.length > 0) {
      await db
        .delete(adminEmailChangeAudits)
        .where(inArray(adminEmailChangeAudits.id, insertedAuditIds));
    }
    if (targetUserId) {
      await db.delete(users).where(eq(users.id, targetUserId));
    }
    if (secondaryTargetUserId) {
      await db.delete(users).where(eq(users.id, secondaryTargetUserId));
    }
    if (createdOrgId) {
      await db.delete(organizations).where(eq(organizations.id, createdOrgId));
    }
  });

  it('requires authentication', async () => {
    const { status } = await apiGet('/api/system-admin/admin-email-change-audits');
    expect(status).toBe(401);
  });

  it('rejects non-admin users', async () => {
    const orgAdmin = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const { status } = await apiGet(
      '/api/system-admin/admin-email-change-audits',
      orgAdmin,
    );
    expect(status).toBe(403);
  });

  it('returns rows with masked emails and never leaks the live user email', async () => {
    const { status, data } = await apiGet<ListBody>(
      `/api/system-admin/admin-email-change-audits?targetUserId=${targetUserId}`,
      admin,
    );
    expect(status).toBe(200);
    expect(data.success).toBe(true);
    const body = data.data;
    expect(body).toBeDefined();
    expect(body!.total).toBe(1);
    expect(body!.rows).toHaveLength(1);

    const row = body!.rows[0];
    expect(row.targetUserId).toBe(targetUserId);
    expect(row.oldEmailMasked).toBe('a***@example.com');
    expect(row.newEmailMasked).toBe('b***@example.com');
    expect(row.actorName).toBe(admin.user.name);

    // Privacy contract: live `users.email` must NOT be projected. The
    // serialized payload is the source of truth — stringify and assert
    // against the live email directly so a future field rename can't
    // sneak the address back onto the wire under another key.
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(TARGET_LIVE_EMAIL);
    expect(Object.keys(row)).not.toContain('targetEmail');
    expect(Object.keys(row)).not.toContain('email');
  });

  it('returns all relevant rows when no target filter is supplied (newest first)', async () => {
    const { status, data } = await apiGet<ListBody>(
      '/api/system-admin/admin-email-change-audits?limit=200',
      admin,
    );
    expect(status).toBe(200);
    const rows = data.data?.rows ?? [];
    const matching = rows.filter((r) => insertedAuditIds.includes(r.id));
    expect(matching).toHaveLength(2);
    // Both inserted rows share the same createdAt resolution; order
    // tiebreaks on `id DESC`, so the more recently-inserted (larger
    // id) row should appear before the older one.
    const indexFirst = rows.findIndex((r) => r.id === insertedAuditIds[1]);
    const indexSecond = rows.findIndex((r) => r.id === insertedAuditIds[0]);
    expect(indexFirst).toBeGreaterThanOrEqual(0);
    expect(indexSecond).toBeGreaterThanOrEqual(0);
    expect(indexFirst).toBeLessThan(indexSecond);
  });
});
