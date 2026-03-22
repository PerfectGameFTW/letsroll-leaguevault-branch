import { describe, it, expect } from 'vitest';
import { login, apiGet, apiPost } from '../helpers';

describe('Organizations API', () => {
  const ADMIN_EMAIL = 'admin@example.com';
  const ADMIN_PASSWORD = 'fJ8#kL2@pQ5$rT9&';

  describe('when authenticated as admin', () => {
    it('should log in as admin', async () => {
      const session = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
      expect(session.user.email).toBe(ADMIN_EMAIL);
      expect(session.cookies).toBeTruthy();
      expect(session.csrfToken).toBeTruthy();
    });

    it('should list organizations', async () => {
      const session = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
      const { status, data } = await apiGet('/api/organizations', session);
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('should create an organization with admin', async () => {
      const session = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
      const slug = `test-org-${Date.now()}`;
      const { status, data } = await apiPost(
        '/api/organizations',
        {
          name: 'Vitest Test Organization',
          slug,
          adminData: {
            email: `orgadmin-${Date.now()}@example.com`,
            password: 'xM7&tN3!zP9$vB1#',
            name: 'Test Org Admin',
          },
        },
        session,
      );
      expect(status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toHaveProperty('name', 'Vitest Test Organization');
      expect(data.data).toHaveProperty('slug', slug);
    });

    it('should list organizations including newly created one', async () => {
      const session = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
      const { data } = await apiGet('/api/organizations', session);
      expect(data.success).toBe(true);
      const orgs = data.data as Array<{ name: string }>;
      expect(orgs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('when not authenticated', () => {
    it('should reject unauthenticated organization listing', async () => {
      const { status } = await apiGet('/api/organizations');
      expect(status).toBeGreaterThanOrEqual(401);
    });
  });
});
