/**
 * Regression tests for POST /api/payments-provider/apple-pay/register-domain
 * (task #278).
 *
 * Pins the org_admin tenant-isolation invariant so a future refactor of
 * `getPaymentProvider` cannot reintroduce the gap:
 *   - missing locationId -> 400 VALIDATION_ERROR (NOT a fall-through to
 *     `getPaymentProvider(null)`)
 *   - locationId belonging to another org -> 403 FORBIDDEN
 *   - valid locationId belonging to the caller's org -> request passes
 *     validation and reaches the provider layer (here: 422
 *     PROVIDER_NOT_CONFIGURED because the test org has no Square config)
 */
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../../server/db';
import { organizations, locations } from '@shared/schema';
import {
  apiPost,
  login,
  TEST_ORG_A_EMAIL,
  TEST_ORG_B_EMAIL,
  TEST_ORG_PASSWORD,
} from '../helpers';

const TEST_ORG_A_SLUG = process.env.TEST_ORG_A_SLUG || 'vitest-org-a';

const createdLocationIds: number[] = [];

afterAll(async () => {
  if (createdLocationIds.length > 0) {
    await db.delete(locations).where(inArray(locations.id, createdLocationIds));
    createdLocationIds.length = 0;
  }
});

const ENDPOINT = '/api/payments-provider/apple-pay/register-domain';

// Derive the suffix from APP_DOMAIN (defaults to the production literal) so
// this integration test isn't pinned to the production hostname when the
// env points at a staging or preview suffix (task #294).
const APP_DOMAIN_SUFFIX = process.env.APP_DOMAIN ?? 'leaguevault.app';

function expectedDomainFor(slug: string): string {
  return `${slug}.${APP_DOMAIN_SUFFIX}`;
}

describe('POST /apple-pay/register-domain — org_admin locationId enforcement', () => {
  it('rejects org_admin call with no locationId (400 VALIDATION_ERROR)', async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const res = await apiPost(
      ENDPOINT,
      { domain: expectedDomainFor(TEST_ORG_A_SLUG) },
      session,
    );

    expect(res.status).toBe(400);
    expect(res.data.success).toBe(false);
    expect(res.data.error?.code).toBe('VALIDATION_ERROR');
    expect(res.data.error?.message).toMatch(/locationId/i);
  });

  it('rejects org_admin call with explicit null locationId (400 VALIDATION_ERROR)', async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const res = await apiPost(
      ENDPOINT,
      { domain: expectedDomainFor(TEST_ORG_A_SLUG), locationId: null },
      session,
    );

    expect(res.status).toBe(400);
    expect(res.data.error?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects org_admin call with a non-integer locationId like "123abc" (400 VALIDATION_ERROR)', async () => {
    // Pins the strict parser: a permissive `parseInt("123abc")` would
    // coerce this to 123 and silently look up the wrong location.
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const res = await apiPost(
      ENDPOINT,
      { domain: expectedDomainFor(TEST_ORG_A_SLUG), locationId: '123abc' },
      session,
    );

    expect(res.status).toBe(400);
    expect(res.data.error?.code).toBe('VALIDATION_ERROR');
  });

  it("rejects org_admin call with another org's locationId (403 FORBIDDEN)", async () => {
    const sessionA = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const sessionB = await login(TEST_ORG_B_EMAIL, TEST_ORG_PASSWORD);

    expect(sessionB.user.organizationId).toBeTruthy();

    // Create a location belonging to org B and try to use it from org A.
    const [otherLocation] = await db
      .insert(locations)
      .values({
        name: `vitest-applepay-other-org-loc-${Date.now()}`,
        organizationId: sessionB.user.organizationId!,
      })
      .returning();
    createdLocationIds.push(otherLocation.id);

    const res = await apiPost(
      ENDPOINT,
      {
        domain: expectedDomainFor(TEST_ORG_A_SLUG),
        locationId: otherLocation.id,
      },
      sessionA,
    );

    expect(res.status).toBe(403);
    expect(res.data.error?.code).toBe('FORBIDDEN');
    expect(res.data.error?.message).toMatch(/organization/i);
  });

  it('passes validation for an org_admin with a locationId in their own org', async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    expect(session.user.organizationId).toBeTruthy();

    const [ownLocation] = await db
      .insert(locations)
      .values({
        name: `vitest-applepay-own-loc-${Date.now()}`,
        organizationId: session.user.organizationId!,
      })
      .returning();
    createdLocationIds.push(ownLocation.id);

    const res = await apiPost(
      ENDPOINT,
      {
        domain: expectedDomainFor(TEST_ORG_A_SLUG),
        locationId: ownLocation.id,
      },
      session,
    );

    // The validation layer must accept the request and hand it off to
    // `getPaymentProvider`. The vitest org has no Square config, so
    // `getPaymentProvider` throws ProviderNotConfiguredError, which the
    // route surfaces as 422. We assert on that specific outcome rather
    // than 400/403 to prove validation passed and the request reached
    // the provider boundary as intended.
    expect(res.status).toBe(422);
    expect(res.data.error?.code).toBe('PROVIDER_NOT_CONFIGURED');
  });
});

describe('POST /apple-pay/register-domain — domain validation still runs first', () => {
  it("rejects an org_admin call whose domain doesn't match their org (403)", async () => {
    const session = await login(TEST_ORG_A_EMAIL, TEST_ORG_PASSWORD);
    const [otherOrg] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, session.user.organizationId!));
    expect(otherOrg).toBeTruthy();

    const res = await apiPost(
      ENDPOINT,
      { domain: `someone-elses-tenant.${APP_DOMAIN_SUFFIX}`, locationId: 1 },
      session,
    );

    expect(res.status).toBe(403);
    expect(res.data.error?.code).toBe('FORBIDDEN');
  });
});
