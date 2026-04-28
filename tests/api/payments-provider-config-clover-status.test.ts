/**
 * Pin for task #575.
 *
 * GET /api/payments-provider/config now exposes a `providerConfigured`
 * boolean and a `missingFields` array for Clover locations, so the
 * payment form and settings page can show a friendly "Clover not
 * fully configured" message instead of failing silently at checkout.
 *
 * Without these pins, a future refactor that strips the new fields
 * (or only returns Clover details when fully configured, as the
 * pre-#575 behavior did) would silently break the partial-config UX
 * across the client.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import { locations } from '@shared/schema';
import {
  apiGet,
  login,
  TEST_ORG_A_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';
import { storage } from '../../server/storage';

import { z } from 'zod';

const cloverConfigResponseSchema = z.object({
  paymentProvider: z.string(),
  providerConfigured: z.boolean(),
  missingFields: z.array(z.string()),
  merchantId: z.string().nullable().optional(),
  publicTokenizerKey: z.string().nullable().optional(),
  environment: z.string().nullable().optional(),
  apiToken: z.string().nullable().optional(),
});
type CloverConfigResponse = z.infer<typeof cloverConfigResponseSchema>;

function parseCloverConfig(data: unknown): CloverConfigResponse {
  return cloverConfigResponseSchema.parse(data);
}

const createdLocationIds: number[] = [];

afterAll(async () => {
  if (createdLocationIds.length > 0) {
    await db.delete(locations).where(inArray(locations.id, createdLocationIds));
    createdLocationIds.length = 0;
  }
});

describe('GET /api/payments-provider/config — Clover partial-config status (task #575)', () => {
  it('reports providerConfigured=false with the full missing-field list when no Clover credentials are saved', async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const orgId = session.user.organizationId;
    expect(orgId).toBeTruthy();
    if (!orgId) throw new Error("missing organizationId");

    const [loc] = await db
      .insert(locations)
      .values({
        name: `vitest-clover-empty-${Date.now()}`,
        organizationId: orgId,
        paymentProvider: 'clover',
      })
      .returning();
    createdLocationIds.push(loc.id);

    const { status, data } = await apiGet<CloverConfigResponse>(
      `/api/payments-provider/config?locationId=${loc.id}`,
      session,
    );

    expect(status).toBe(200);
    const body = parseCloverConfig(data);
    expect(body.paymentProvider).toBe('clover');
    expect(body.providerConfigured).toBe(false);
    expect(Array.isArray(body.missingFields)).toBe(true);
    expect(body.missingFields).toEqual(
      expect.arrayContaining(['apiToken', 'merchantId', 'publicTokenizerKey']),
    );
    // environment falls back to 'sandbox' in the response, but the
    // raw config row has nothing set, so it must still be flagged as
    // missing in `missingFields` so the UI tells the admin to pick
    // one explicitly.
    expect(body.missingFields).toContain('environment');
  });

  it('reports providerConfigured=false with only the missing fields when Clover is partially configured', async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const orgId = session.user.organizationId;
    expect(orgId).toBeTruthy();
    if (!orgId) throw new Error("missing organizationId");

    const [loc] = await db
      .insert(locations)
      .values({
        name: `vitest-clover-partial-${Date.now()}`,
        organizationId: orgId,
        paymentProvider: 'clover',
      })
      .returning();
    createdLocationIds.push(loc.id);

    // merchant ID + environment present, but no API token and no
    // public tokenizer key — the exact "broken card form" scenario
    // task #575 is meant to surface as a friendly notice.
    await storage.updateLocationCloverConfig(loc.id, {
      merchantId: 'M_PARTIAL',
      environment: 'sandbox',
    });

    const { status, data } = await apiGet<CloverConfigResponse>(
      `/api/payments-provider/config?locationId=${loc.id}`,
      session,
    );

    expect(status).toBe(200);
    const body = parseCloverConfig(data);
    expect(body.paymentProvider).toBe('clover');
    expect(body.merchantId).toBe('M_PARTIAL');
    expect(body.environment).toBe('sandbox');
    expect(body.providerConfigured).toBe(false);
    expect(body.missingFields).toEqual(
      expect.arrayContaining(['apiToken', 'publicTokenizerKey']),
    );
    expect(body.missingFields).not.toContain('merchantId');
    expect(body.missingFields).not.toContain('environment');
  });

  it('reports providerConfigured=true and an empty missingFields array when Clover is fully configured', async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const orgId = session.user.organizationId;
    expect(orgId).toBeTruthy();
    if (!orgId) throw new Error("missing organizationId");

    const [loc] = await db
      .insert(locations)
      .values({
        name: `vitest-clover-full-${Date.now()}`,
        organizationId: orgId,
        paymentProvider: 'clover',
      })
      .returning();
    createdLocationIds.push(loc.id);

    await storage.updateLocationCloverConfig(loc.id, {
      apiToken: 'cv_token_full',
      merchantId: 'M_FULL',
      publicTokenizerKey: 'pk_full',
      environment: 'production',
    });

    const { status, data } = await apiGet<CloverConfigResponse>(
      `/api/payments-provider/config?locationId=${loc.id}`,
      session,
    );

    expect(status).toBe(200);
    const body = parseCloverConfig(data);
    expect(body.paymentProvider).toBe('clover');
    expect(body.providerConfigured).toBe(true);
    expect(body.missingFields).toEqual([]);
    expect(body.merchantId).toBe('M_FULL');
    expect(body.publicTokenizerKey).toBe('pk_full');
    expect(body.environment).toBe('production');
    // The Clover API token is NEVER returned to the browser — the
    // route must only signal that one is configured via the
    // missingFields/providerConfigured pair.
    expect(body.apiToken).toBeUndefined();
  });
});
