import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { sanitizeUser } from '../../server/utils/api';
import { users, type User } from '@shared/schema';

// Field-name patterns we never want to leak in any user-facing response.
// If a future column on `users` matches one of these, either add it to the
// strip list in `server/utils/api.ts` or rename the column.
const SENSITIVE_NAME_PATTERN = /token|secret|password/i;

// Build a fully-populated `User` so the test exercises every column the
// schema currently defines. This way, adding a new sensitive-looking column
// to `shared/schema/users.ts` immediately trips the test below.
function makeFullyPopulatedUser(): User {
  return {
    id: 1,
    email: 'audit@example.com',
    password: 'hashed-secret-do-not-leak',
    bowlerId: 42,
    name: 'Audit User',
    phone: '+15555550100',
    avatar: 'avatar-url',
    role: 'user',
    organizationId: 7,
    locationId: 3,
    inviteToken: 'invite-token-do-not-leak',
    inviteTokenExpiry: '2099-01-01T00:00:00.000Z',
    createdAt: '2024-01-01T00:00:00.000Z',
  };
}

describe('sanitizeUser', () => {
  it('strips the known sensitive fields', () => {
    const sanitized = sanitizeUser(makeFullyPopulatedUser()) as Record<string, unknown>;
    expect(sanitized).not.toHaveProperty('password');
    expect(sanitized).not.toHaveProperty('inviteToken');
    expect(sanitized).not.toHaveProperty('inviteTokenExpiry');
  });

  it('preserves the safe fields', () => {
    const sanitized = sanitizeUser(makeFullyPopulatedUser());
    expect(sanitized.id).toBe(1);
    expect(sanitized.email).toBe('audit@example.com');
    expect(sanitized.name).toBe('Audit User');
    expect(sanitized.role).toBe('user');
    expect(sanitized.organizationId).toBe(7);
    expect(sanitized.locationId).toBe(3);
    expect(sanitized.bowlerId).toBe(42);
  });

  it('never returns any field whose name looks sensitive', () => {
    const sanitized = sanitizeUser(makeFullyPopulatedUser());
    const leaked = Object.keys(sanitized).filter(k => SENSITIVE_NAME_PATTERN.test(k));
    expect(leaked, `sanitizeUser leaked sensitive-looking fields: ${leaked.join(', ')}`).toEqual([]);
  });

  // Pin the contract to the live Drizzle schema: if a new column on `users`
  // is added with a name matching /token|secret|password/i, this test fails
  // until either `sanitizeUser` strips it or the column is renamed.
  it('strips every column on the users schema whose name looks sensitive', () => {
    const cols = Object.keys(getTableColumns(users));
    const sensitiveCols = cols.filter(c => SENSITIVE_NAME_PATTERN.test(c));
    // Build an object that has every column populated with a non-undefined
    // marker so `delete` is the only thing that can remove it.
    const fakeUser = Object.fromEntries(cols.map(c => [c, `__${c}__`])) as unknown as User;
    const sanitized = sanitizeUser(fakeUser) as Record<string, unknown>;
    for (const col of sensitiveCols) {
      expect(
        sanitized,
        `users.${col} matches the sensitive name pattern but sanitizeUser still returns it`,
      ).not.toHaveProperty(col);
    }
  });

  it('does not mutate the input user', () => {
    const input = makeFullyPopulatedUser();
    const snapshot = { ...input };
    sanitizeUser(input);
    expect(input).toEqual(snapshot);
  });
});
