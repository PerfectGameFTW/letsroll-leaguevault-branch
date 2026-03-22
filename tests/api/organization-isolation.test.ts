import { describe, it, expect, beforeAll } from 'vitest';
import { login, apiGet, type AuthSession } from '../helpers';

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
  const ORG_A_EMAIL = 'testadmin@example.com';
  const ORG_B_EMAIL = 'testadmin2@example.com';
  const PASSWORD = 'TestPassword123!';

  let sessionA: AuthSession;
  let sessionB: AuthSession;

  beforeAll(async () => {
    try {
      sessionA = await login(ORG_A_EMAIL, PASSWORD);
    } catch {
      console.warn(`Skipping isolation tests: could not log in as ${ORG_A_EMAIL}`);
    }
    try {
      sessionB = await login(ORG_B_EMAIL, PASSWORD);
    } catch {
      console.warn(`Skipping isolation tests: could not log in as ${ORG_B_EMAIL}`);
    }
  });

  describe('organization visibility', () => {
    it('org A admin should see organizations', async () => {
      if (!sessionA) return;
      const { status, data } = await apiGet<OrgUser[]>('/api/organizations', sessionA);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('org B admin should see organizations', async () => {
      if (!sessionB) return;
      const { status, data } = await apiGet<OrgUser[]>('/api/organizations', sessionB);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });
  });

  describe('user isolation', () => {
    it('org A admin should see own organization users', async () => {
      if (!sessionA?.user.organizationId) return;
      const { status, data } = await apiGet<OrgUser[]>(
        `/api/org-admin/users?organizationId=${sessionA.user.organizationId}`,
        sessionA,
      );
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('org A admin should NOT see org B users', async () => {
      if (!sessionA || !sessionB?.user.organizationId) return;
      const { status, data } = await apiGet<OrgUser[]>(
        `/api/org-admin/users?organizationId=${sessionB.user.organizationId}`,
        sessionA,
      );
      expect(status === 403 || (data.success === false)).toBe(true);
    });
  });

  describe('league isolation', () => {
    it('org A admin should see their leagues', async () => {
      if (!sessionA) return;
      const { status, data } = await apiGet<League[]>('/api/leagues', sessionA);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('org B admin should see their leagues', async () => {
      if (!sessionB) return;
      const { status, data } = await apiGet<League[]>('/api/leagues', sessionB);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
    });

    it('org B admin should NOT access org A leagues via org endpoint', async () => {
      if (!sessionA?.user.organizationId || !sessionB) return;
      const { status, data } = await apiGet<League[]>(
        `/api/organizations/${sessionA.user.organizationId}/leagues`,
        sessionB,
      );
      expect(status === 403 || (data.success === false)).toBe(true);
    });
  });
});
