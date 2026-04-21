import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { updateUserSchemaBase } from '@shared/schema';

// Mirrors the schema constructed in `server/routes/account.ts` for
// `PATCH /profile/:id`. Kept in sync with the route definition; if the
// route's profileUpdateSchema changes shape, update this fixture too.
const profileUpdateSchema = updateUserSchemaBase
  .pick({ name: true, email: true, phone: true })
  .extend({
    phone: z
      .string()
      .nullable()
      .optional()
      .transform((v) => (v === null ? undefined : v)),
  });

describe('profile update — phone null/undefined coercion', () => {
  it('normalizes JSON null to undefined', () => {
    const parsed = profileUpdateSchema.parse({ phone: null });
    expect(parsed.phone).toBeUndefined();
  });

  it('passes through undefined unchanged', () => {
    const parsed = profileUpdateSchema.parse({});
    expect(parsed.phone).toBeUndefined();
  });

  it('passes through a valid phone string unchanged', () => {
    const parsed = profileUpdateSchema.parse({ phone: '555-0100' });
    expect(parsed.phone).toBe('555-0100');
  });

  it('rejects a non-string non-null phone value', () => {
    const result = profileUpdateSchema.safeParse({ phone: 12345 });
    expect(result.success).toBe(false);
  });

  it('does not alter the parsed name or email when phone is null', () => {
    const parsed = profileUpdateSchema.parse({
      name: 'Audit User',
      email: 'audit@example.com',
      phone: null,
    });
    expect(parsed.name).toBe('Audit User');
    expect(parsed.email).toBe('audit@example.com');
    expect(parsed.phone).toBeUndefined();
  });
});
