import { describe, it, expect, beforeAll } from 'vitest';
import {
  login,
  apiGet,
  apiPost,
  type AuthSession,
  TEST_ORG_A_EMAIL,
  TEST_ORG_B_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

interface OrgUser {
  id: number;
  email: string;
  organizationId: number | null;
}

interface League {
  id: number;
  name: string;
  organizationId: number | null;
}

function hasStringEmail(value: unknown): value is { email: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { email?: unknown }).email === 'string'
  );
}

function hasNumericId(value: unknown): value is { id: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { id?: unknown }).id === 'number'
  );
}

function collectEmails(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data.filter(hasStringEmail).map((u) => u.email.toLowerCase());
}

function collectIds(data: unknown): number[] {
  if (!Array.isArray(data)) return [];
  return data.filter(hasNumericId).map((u) => u.id);
}

describe('Organization Isolation', () => {
  let sessionA: AuthSession;
  let sessionB: AuthSession;
  let orgBLeagueId: number | null = null;

  beforeAll(async () => {
    sessionA = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    sessionB = await login(TEST_ORG_B_EMAIL, TEST_ORG_PASSWORD);

    // Make sure org B owns at least one league so we can test cross-org
    // fetch-by-id as org A. Reuse the first existing league when present.
    const existing = await apiGet<League[]>('/api/leagues', sessionB);
    if (existing.status === 200 && Array.isArray(existing.data.data) && existing.data.data.length > 0) {
      orgBLeagueId = existing.data.data[0].id;
    } else {
      const created = await apiPost<League>(
        '/api/leagues',
        {
          name: 'Vitest Org B Isolation League',
          seasonStart: new Date().toISOString(),
          seasonEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          weekDay: 'Monday',
          weeklyFee: 2000,
        },
        sessionB,
      );
      const createdLeague = created.data.data;
      if (created.status === 201 && hasNumericId(createdLeague)) {
        orgBLeagueId = createdLeague.id;
      }
    }
  });

  describe('organization visibility', () => {
    it('org A admin should NOT be able to list all organizations (admin-only)', async () => {
      const { status } = await apiGet<OrgUser[]>('/api/organizations', sessionA);
      expect(status).toBe(403);
    });

    it('org B admin should NOT be able to list all organizations (admin-only)', async () => {
      const { status } = await apiGet<OrgUser[]>('/api/organizations', sessionB);
      expect(status).toBe(403);
    });
  });

  describe('user isolation', () => {
    it('org A admin should see own organization users', async () => {
      expect(sessionA.user.organizationId).toBeTruthy();
      const { status, data } = await apiGet<OrgUser[]>(
        `/api/org-admin/users?organizationId=${sessionA.user.organizationId}`,
        sessionA,
      );
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('org A admin should NOT see org B users (server scopes to caller org)', async () => {
      expect(sessionB.user.organizationId).toBeTruthy();
      const { status, data } = await apiGet<OrgUser[]>(
        `/api/org-admin/users?organizationId=${sessionB.user.organizationId}`,
        sessionA,
      );
      // The endpoint either denies the cross-org request outright, or
      // (more commonly) silently ignores the org id and returns the
      // caller's own users. Either way, no org B user must be returned.
      expect([200, 403]).toContain(status);
      if (status === 200 && Array.isArray(data.data)) {
        const emails = collectEmails(data.data);
        const ids = collectIds(data.data);
        // Strong leak check: org B's known admin must never appear in a
        // list returned to org A, by either email or user id.
        expect(emails).not.toContain(TEST_ORG_B_EMAIL.toLowerCase());
        expect(ids).not.toContain(sessionB.user.id);
        // And every returned user must be scoped to org A.
        for (const u of data.data) {
          expect(u.organizationId).toBe(sessionA.user.organizationId);
        }
      }
    });

    it('org B admin should NOT see org A users (server scopes to caller org)', async () => {
      expect(sessionA.user.organizationId).toBeTruthy();
      const { status, data } = await apiGet<OrgUser[]>(
        `/api/org-admin/users?organizationId=${sessionA.user.organizationId}`,
        sessionB,
      );
      expect([200, 403]).toContain(status);
      if (status === 200 && Array.isArray(data.data)) {
        const emails = collectEmails(data.data);
        const ids = collectIds(data.data);
        expect(emails).not.toContain(TEST_ORG_A_EMAIL.toLowerCase());
        expect(ids).not.toContain(sessionA.user.id);
        for (const u of data.data) {
          expect(u.organizationId).toBe(sessionB.user.organizationId);
        }
      }
    });
  });

  describe('league isolation', () => {
    it('org A admin should see their leagues', async () => {
      const { status, data } = await apiGet<League[]>('/api/leagues', sessionA);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      // No league belonging to org B may show up in org A's list.
      if (Array.isArray(data.data)) {
        for (const l of data.data) {
          expect(l.organizationId).toBe(sessionA.user.organizationId);
        }
        if (orgBLeagueId != null) {
          const ids = collectIds(data.data);
          expect(ids).not.toContain(orgBLeagueId);
        }
      }
    });

    it('org B admin should see their leagues', async () => {
      const { status, data } = await apiGet<League[]>('/api/leagues', sessionB);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      if (Array.isArray(data.data)) {
        for (const l of data.data) {
          expect(l.organizationId).toBe(sessionB.user.organizationId);
        }
      }
    });

    it('org B admin should NOT access org A leagues via org endpoint', async () => {
      expect(sessionA.user.organizationId).toBeTruthy();
      const { status } = await apiGet<League[]>(
        `/api/organizations/${sessionA.user.organizationId}/leagues`,
        sessionB,
      );
      expect(status).toBe(403);
    });

    it('org A admin fetching a known org B league by id must get a definitive 403/404', async () => {
      // Skip if we couldn't get/create an org B league (shouldn't happen in
      // normal CI, but bail out clearly rather than silently passing).
      expect(orgBLeagueId, 'expected an org B league id to test against').not.toBeNull();
      const { status, data } = await apiGet<League>(
        `/api/leagues/${orgBLeagueId}`,
        sessionA,
      );
      expect([403, 404]).toContain(status);
      expect(data.success).toBe(false);
      // Even error payloads must not leak the league's org id back to the caller.
      const payload = JSON.stringify(data);
      expect(payload).not.toContain(`"organizationId":${sessionB.user.organizationId}`);
    });
  });
});
