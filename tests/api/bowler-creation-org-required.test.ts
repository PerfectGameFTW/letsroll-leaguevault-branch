/**
 * Task #415 — route-level audit of every bowler-insert call site.
 *
 * Production has exactly two paths that insert into `bowlers`:
 *   - POST /api/bowlers                (server/routes/bowlers.ts)
 *   - POST /api/bowlers/bulk-import    (server/routes/bulk-import.ts,
 *                                       mounted in server/routes/index.ts)
 *
 * Both stamp `organizationId` from the caller's session before
 * delegating to `storage.createBowler`. Both refuse with a clean
 * 403 FORBIDDEN when the org cannot be derived, so the user never
 * sees the raw `bowlers.organization_id` NOT NULL DB error from
 * task #407.
 *
 * These tests pin BOTH 403 guards as a regression net. Pairs with:
 *   - tests/unit/bowler-org-not-null.test.ts  (DB-level safety net)
 *   - tests/api/auth-org-required.test.ts     (sister route guard)
 *
 * The seed `admin@example.com` user is `system_admin` with
 * `organization_id = NULL` (see scripts/seed and the `users` table),
 * which is the only realistic in-product caller without an org —
 * org_admin / user roles are blocked by the `users_role_org_required`
 * invariant from ever reaching this code path with a null org.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_URL,
  TEST_ADMIN_EMAIL,
  TEST_ADMIN_PASSWORD,
  apiPost,
  login,
} from '../helpers';

describe('Bowler creation routes — organization context guards (task #415)', () => {
  describe('POST /api/bowlers', () => {
    it('returns 403 FORBIDDEN when a system_admin posts without ?organizationId and has no session org', async () => {
      const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
      // Sanity: this whole test is about the no-org-context path. If
      // the seed admin ever gets attached to an org, the assertion
      // below would mis-fire as a "stamp succeeded" success rather
      // than the 403 we want to pin — so fail loudly here instead.
      expect(session.user.role).toBe('system_admin');
      expect(session.user.organizationId).toBeNull();

      const { status, data } = await apiPost(
        '/api/bowlers',
        {
          name: 'Vitest Org-less Bowler #415',
          email: null,
          phone: null,
          active: true,
          order: 0,
        },
        session,
      );

      expect(status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('FORBIDDEN');
      expect(data.error?.message).toMatch(/organization context required/i);
    });

    it('returns 400 when a system_admin supplies a non-numeric ?organizationId query param', async () => {
      // Pins the explicit NaN guard at server/routes/bowlers.ts:337
      // so a malformed override returns a clean 400 instead of
      // silently falling through to `callerOrgId` (which would be
      // a no-op cross-org stamp surprise) or to the DB constraint.
      const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);

      const res = await fetch(`${BASE_URL}/api/bowlers?organizationId=not-a-number`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: session.cookies,
          'x-csrf-token': session.csrfToken,
        },
        body: JSON.stringify({
          name: 'Vitest NaN Org #415',
          email: null,
          phone: null,
          active: true,
          order: 0,
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error?.message).toMatch(/invalid organization id format/i);
    });
  });

  describe('POST /api/bulk-import', () => {
    it('returns 403 FORBIDDEN when a system_admin uploads without a session org', async () => {
      const session = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
      expect(session.user.role).toBe('system_admin');
      expect(session.user.organizationId).toBeNull();

      // The org guard at server/routes/bulk-import.ts:170-173 runs
      // AFTER multer parses the file, so we must upload a valid-ish
      // CSV to reach it. The contents are never inspected because
      // the 403 fires before parseFile() is called.
      const csv = 'League Name,Team Name,Team Number,Bowler Name\nL,T,1,B\n';
      const blob = new Blob([csv], { type: 'text/csv' });
      const form = new FormData();
      form.append('file', blob, 'vitest-415.csv');

      const res = await fetch(`${BASE_URL}/api/bowlers/bulk-import`, {
        method: 'POST',
        headers: {
          Cookie: session.cookies,
          'x-csrf-token': session.csrfToken,
        },
        body: form,
      });
      const data = await res.json();

      expect(res.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.error?.code).toBe('FORBIDDEN');
      expect(data.error?.message).toMatch(/organization context required/i);
    });
  });
});
