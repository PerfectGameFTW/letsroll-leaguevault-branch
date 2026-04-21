/**
 * Integration tests for the `users_role_org_required` invariant at the
 * route layer:
 *   - POST /api/auth/register without an organizationId returns
 *     400 ORG_REQUIRED.
 */
import { describe, expect, it } from 'vitest';
import { BASE_URL } from '../helpers';

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@vitest.local`;
}

describe('POST /api/auth/register — non-admin org requirement', () => {
  it('returns 400 ORG_REQUIRED when no organizationId is supplied', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail('register-no-org'),
        password: 'CorrectHorseBatteryStaple1!',
        name: 'No Org Sign Up',
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.success).toBe(false);
    expect(data.error?.code).toBe('ORG_REQUIRED');
  });

  it('returns 400 ORG_REQUIRED when organizationId is the empty string', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail('register-empty-org'),
        password: 'CorrectHorseBatteryStaple1!',
        name: 'Empty Org Sign Up',
        organizationId: '',
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error?.code).toBe('ORG_REQUIRED');
  });

  it('returns 400 ORG_REQUIRED when organizationId is non-numeric', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: uniqueEmail('register-nan-org'),
        password: 'CorrectHorseBatteryStaple1!',
        name: 'NaN Org Sign Up',
        organizationId: 'not-a-number',
      }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error?.code).toBe('ORG_REQUIRED');
  });
});
