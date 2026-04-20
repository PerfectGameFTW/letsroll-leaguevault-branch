import { describe, it, expect, beforeAll } from 'vitest';
import { login, apiGet, type AuthSession, TEST_ORG_A_EMAIL, TEST_ORG_B_EMAIL, TEST_ORG_PASSWORD } from '../helpers';

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

describe('Organization Isolation', () => {
  let sessionA: AuthSession;
  let sessionB: AuthSession;

  beforeAll(async () => {
    sessionA = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    sessionB = await login(TEST_ORG_B_EMAIL, TEST_ORG_PASSWORD);
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
        for (const u of data.data) {
          expect(u.organizationId).toBe(sessionA.user.organizationId);
        }
      }
    });
  });

  describe('league isolation', () => {
    it('org A admin should see their leagues', async () => {
      const { status, data } = await apiGet<League[]>('/api/leagues', sessionA);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('org B admin should see their leagues', async () => {
      const { status, data } = await apiGet<League[]>('/api/leagues', sessionB);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('org B admin should NOT access org A leagues via org endpoint', async () => {
      expect(sessionA.user.organizationId).toBeTruthy();
      const { status } = await apiGet<League[]>(
        `/api/organizations/${sessionA.user.organizationId}/leagues`,
        sessionB,
      );
      expect(status).toBe(403);
    });
  });
});
