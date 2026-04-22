/**
 * Regression guards for `GET /api/system-admin/deletion-requests/pending-count`
 * (task #312).
 *
 * The admin sidebar polls this endpoint every 60s to drive the
 * "Deletion Requests" badge. Two contracts must hold or the badge
 * silently leaks data or misleads admins:
 *
 *   1. The endpoint is system-admin only. An anonymous caller must get
 *      401, an org_admin must get 403 — never the count. A refactor
 *      that drops `requireAdmin` would otherwise expose the queue size
 *      (and the existence of pending account-deletion requests) to
 *      anyone with a valid session.
 *
 *   2. The returned count reflects ONLY rows whose status is `pending`.
 *      A refactor that swaps in `countDeletionRequests()` without the
 *      `{ status: 'pending' }` filter would silently return the total
 *      (including completed/rejected rows) and the badge would never
 *      clear.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiGet,
  login,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  TEST_ORG_A_EMAIL,
  TEST_ORG_PASSWORD,
  type AuthSession,
} from '../helpers';
import { storage } from '../../server/storage';

const PATH = '/api/system-admin/deletion-requests/pending-count';

describe('GET /api/system-admin/deletion-requests/pending-count', () => {
  let sysAdmin: AuthSession;
  let orgAdmin: AuthSession;

  // Per-run unique email prefix. The deletion_requests table has no
  // delete helper exposed and tests run against a shared dev DB, so we
  // tag rows with a timestamp + random suffix to guarantee no
  // collisions with concurrent runs and to make manual cleanup easy.
  const runTag = `pending-count-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Track every row we create so we can compute exact deltas and so
  // an aborted test still leaves a traceable trail in the audit log.
  const seededIds: number[] = [];

  beforeAll(async () => {
    sysAdmin = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
    orgAdmin = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    // Sanity: org_admin is intentionally NOT a system admin so the
    // 403 case below is meaningful. Without this, a misconfigured
    // fixture could turn the 403 assertion into a false positive.
    expect(sysAdmin.user.role).toBe('system_admin');
    expect(orgAdmin.user.role).not.toBe('system_admin');
    expect(orgAdmin.user.role).not.toBe('admin');
  });

  afterAll(async () => {
    // Best-effort: mark the seeded pending rows as rejected so they
    // stop showing up in the badge for any developer poking the dev
    // DB. We do NOT hard-delete (no helper exists, and the audit
    // trail is intentional).
    if (!sysAdmin) return;
    for (const id of seededIds) {
      try {
        const row = await storage.getDeletionRequest(id);
        if (row?.status === 'pending') {
          await storage.updateDeletionRequestStatus(
            id,
            'rejected',
            sysAdmin.user.id,
            `cleanup: ${runTag}`,
          );
        }
      } catch {
        // Cleanup is best-effort; a failure here must not mask a
        // real test failure surfaced by vitest.
      }
    }
  });

  it('rejects an anonymous caller with 401', async () => {
    const { status, data } = await apiGet(PATH);
    expect(status).toBe(401);
    expect(data.success).toBe(false);
    // The count must never appear in an unauthenticated response,
    // not even as a side-channel inside the error envelope.
    expect(data.data).toBeUndefined();
  });

  it('rejects an org_admin with 403', async () => {
    const { status, data } = await apiGet(PATH, orgAdmin);
    expect(status).toBe(403);
    expect(data.success).toBe(false);
    expect(data.data).toBeUndefined();
  });

  it('returns the count of status=pending rows for a system admin', async () => {
    // Establish a baseline against the live DB rather than asserting
    // an absolute count: the dev DB may already contain unrelated
    // rows from other tests or manual exploration. We then assert
    // the delta after seeding, which is the part the route actually
    // controls.
    const baseline = await apiGet<{ count: number }>(PATH, sysAdmin);
    expect(baseline.status).toBe(200);
    expect(baseline.data.success).toBe(true);
    expect(typeof baseline.data.data?.count).toBe('number');
    const baselineCount = baseline.data.data!.count;

    // Seed: 2 pending + 1 completed + 1 rejected. The two non-pending
    // rows are the guard against a refactor that returns the total
    // count instead of filtered-by-status.
    const pendingA = await storage.createDeletionRequest({
      email: `${runTag}-pending-a@example.test`,
      reason: 'pending-count regression test',
      ipAddress: null,
      userAgent: null,
    });
    seededIds.push(pendingA.id);
    const pendingB = await storage.createDeletionRequest({
      email: `${runTag}-pending-b@example.test`,
      reason: 'pending-count regression test',
      ipAddress: null,
      userAgent: null,
    });
    seededIds.push(pendingB.id);

    const completed = await storage.createDeletionRequest({
      email: `${runTag}-completed@example.test`,
      reason: 'pending-count regression test',
      ipAddress: null,
      userAgent: null,
    });
    seededIds.push(completed.id);
    await storage.updateDeletionRequestStatus(
      completed.id,
      'completed',
      sysAdmin.user.id,
      `seed: ${runTag}`,
    );

    const rejected = await storage.createDeletionRequest({
      email: `${runTag}-rejected@example.test`,
      reason: 'pending-count regression test',
      ipAddress: null,
      userAgent: null,
    });
    seededIds.push(rejected.id);
    await storage.updateDeletionRequestStatus(
      rejected.id,
      'rejected',
      sysAdmin.user.id,
      `seed: ${runTag}`,
    );

    const after = await apiGet<{ count: number }>(PATH, sysAdmin);
    expect(after.status).toBe(200);
    expect(after.data.success).toBe(true);
    // Exactly 2 of the 4 seeded rows are pending. If the route stops
    // applying the status filter (e.g. by calling
    // `countDeletionRequests()` with no args), this delta becomes 4
    // and the assertion fails. If a refactor swaps to a list-then-
    // length pattern that limits results, the delta could be < 2.
    expect(after.data.data!.count).toBe(baselineCount + 2);
  });
});
