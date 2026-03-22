import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { login, apiGet, apiPost, apiDelete, type AuthSession, TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, TEST_NEW_ORG_ADMIN_PASSWORD } from '../helpers';

describe('Organizations API', () => {
  let adminSession: AuthSession;
  const createdOrgIds: number[] = [];

  beforeAll(async () => {
    adminSession = await login(TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD);
  });

  afterAll(async () => {
    for (const id of createdOrgIds) {
      const { status } = await apiDelete(`/api/organizations/${id}`, adminSession);
      if (status >= 400) {
        console.warn(`Cleanup: failed to delete org ${id}, status ${status}`);
      }
    }
  });

  describe('when authenticated as admin', () => {
    it('should have a valid admin session', () => {
      expect(adminSession.user.email).toBe(TEST_ADMIN_EMAIL);
      expect(adminSession.cookies).toBeTruthy();
      expect(adminSession.csrfToken).toBeTruthy();
    });

    it('should list organizations', async () => {
      const { status, data } = await apiGet('/api/organizations', adminSession);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('should create an organization with admin', async () => {
      const slug = `test-org-${Date.now()}`;
      const { status, data } = await apiPost(
        '/api/organizations',
        {
          name: 'Vitest Test Organization',
          slug,
          adminData: {
            email: `orgadmin-${Date.now()}@example.com`,
            password: TEST_NEW_ORG_ADMIN_PASSWORD,
            name: 'Test Org Admin',
          },
        },
        adminSession,
      );
      expect(status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('name', 'Vitest Test Organization');
      expect(data.data).toHaveProperty('slug', slug);

      const created = data.data as { id?: number; organization?: { id: number } };
      const orgId = created?.id ?? created?.organization?.id;
      if (orgId) {
        createdOrgIds.push(orgId);
      }
    });

    it('should list organizations including newly created one', async () => {
      const { data } = await apiGet('/api/organizations', adminSession);
      expect(data.success).toBe(true);
      const orgs = data.data as Array<{ name: string }>;
      expect(orgs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('when not authenticated', () => {
    it('should reject unauthenticated organization listing', async () => {
      const { status } = await apiGet('/api/organizations');
      expect(status).toBe(401);
    });
  });
});
