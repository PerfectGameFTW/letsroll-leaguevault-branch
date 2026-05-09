/**
 * Unit tests for the two pure helpers introduced by task #429:
 *
 *   1. `getSeasonLabel` (`shared/season-utils.ts`) — moved from the
 *      client into shared so the server-side Square custom-attribute
 *      sync produces the EXACT same string users see in-app. These
 *      tests pin the season-boundary cases (Dec/Jan/Feb → Winter,
 *      Mar–May → Spring, etc.) and the cross-year fall-back.
 *
 *   2. `isAlreadyExistsError` (`server/services/square-custom-
 *      attributes.ts`) — the duplicate-definition detector that
 *      makes `ensureDefinitions` idempotent. Both observed Square
 *      response shapes (modern HTTP 409 and legacy 400+detail) MUST
 *      be classified as success, otherwise every cold start would
 *      log a spurious bootstrap failure.
 *
 * Both helpers are stateless and dependency-free, so this file does
 * not need any storage / Express / Square mocks.
 */
import { describe, expect, it } from 'vitest';
import { SquareError } from 'square';
import { getSeasonLabel } from '../../shared/season-utils';
import {
  isAlreadyExistsError,
  isDefinitionMissingError,
  ensureDefinitions,
  type SquareCustomAttrDefinitionsClient,
} from '../../server/services/square-custom-attributes';

describe('getSeasonLabel', () => {
  it('labels a same-year December start as Winter (current year suffix)', () => {
    // December → Winter only triggers when start+end are the same
    // calendar year (cross-year ranges fall into the YY/YY branch
    // first — covered by its own test below). A short Dec→Dec mini-
    // season is the realistic case.
    expect(getSeasonLabel('2025-12-01', '2025-12-31')).toBe("Winter '25 Season");
  });

  it('labels a January start as Winter', () => {
    expect(getSeasonLabel('2025-01-15', '2025-04-01')).toBe("Winter '25 Season");
  });

  it('labels a February start as Winter', () => {
    expect(getSeasonLabel('2025-02-01', '2025-05-01')).toBe("Winter '25 Season");
  });

  it('labels a March start as Spring', () => {
    expect(getSeasonLabel('2025-03-10', '2025-06-10')).toBe("Spring '25 Season");
  });

  it('labels a May start as Spring (boundary at month index 4)', () => {
    expect(getSeasonLabel('2025-05-31', '2025-08-31')).toBe("Spring '25 Season");
  });

  it('labels a June start as Summer', () => {
    expect(getSeasonLabel('2025-06-01', '2025-09-01')).toBe("Summer '25 Season");
  });

  it('labels an August start as Summer (boundary at month index 7)', () => {
    expect(getSeasonLabel('2025-08-15', '2025-11-15')).toBe("Summer '25 Season");
  });

  it('labels a September start as Fall', () => {
    expect(getSeasonLabel('2025-09-01', '2025-12-01')).toBe("Fall '25 Season");
  });

  it('labels a same-year November start as Fall', () => {
    // Same-year November end (short fall mini-season) hits the Fall
    // branch. A typical Sept→May fall league straddles two years and
    // is covered by the cross-year fallback test below instead.
    expect(getSeasonLabel('2025-11-01', '2025-12-15')).toBe("Fall '25 Season");
  });

  it('uses the cross-year `YY/YY Season` fallback when start and end span different years', () => {
    // Cross-year leagues (typical fall-to-spring league) should NOT
    // get a season name — the year-pair label is the only sensible
    // way to disambiguate two leagues that started on the same
    // calendar week one year apart.
    expect(getSeasonLabel('2025-09-01', '2026-04-30')).toBe('25/26 Season');
  });

  it('accepts Date objects as well as ISO strings', () => {
    // Both the client (form data, ISO strings) and the server (DB
    // rows, Date objects) call this — pinning both call shapes here
    // protects the server side from accidentally regressing.
    expect(getSeasonLabel(new Date('2025-09-01'), new Date('2025-12-01'))).toBe(
      "Fall '25 Season",
    );
  });
});

describe('isAlreadyExistsError', () => {
  it('returns false for null/undefined', () => {
    expect(isAlreadyExistsError(undefined)).toBe(false);
    expect(isAlreadyExistsError(null)).toBe(false);
  });

  it('returns false for a plain Error', () => {
    expect(isAlreadyExistsError(new Error('network exploded'))).toBe(false);
  });

  it('classifies HTTP 409 as already-exists', () => {
    // Modern Square shape: bare statusCode on the SquareError. This
    // is the path the v44+ SDK takes today; pinning it makes sure a
    // future SDK upgrade that drops the legacy 400+detail shape still
    // keeps cold-start bootstrap idempotent.
    expect(isAlreadyExistsError(new SquareError({ statusCode: 409 }))).toBe(true);
  });

  it('classifies an errors[].code === CONFLICT as already-exists', () => {
    // v44 flat-client shape: structured errors live directly on the
    // SquareError (no `.result.errors` wrapper). Constructed here by
    // passing `body: { errors: [...] }` to the SquareError ctor —
    // see node_modules/square/errors/SquareError.js.
    expect(
      isAlreadyExistsError(
        new SquareError({
          statusCode: 400,
          body: { errors: [{ code: 'CONFLICT', detail: 'definition exists' }] },
        }),
      ),
    ).toBe(true);
  });

  it('classifies an errors[].code === ALREADY_EXISTS as already-exists', () => {
    expect(
      isAlreadyExistsError(
        new SquareError({
          statusCode: 400,
          body: { errors: [{ code: 'ALREADY_EXISTS' }] },
        }),
      ),
    ).toBe(true);
  });

  it('classifies BAD_REQUEST + duplicate-key detail as already-exists', () => {
    // Legacy Square response shape: HTTP 400 with a free-form detail
    // string mentioning duplication. We must treat this as success or
    // every cold start logs a bogus bootstrap failure for sellers
    // whose definitions were created before the SDK was upgraded.
    expect(
      isAlreadyExistsError(
        new SquareError({
          statusCode: 400,
          body: {
            errors: [
              {
                code: 'BAD_REQUEST',
                detail: 'A custom attribute definition with that key already exists.',
              },
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  it('does NOT classify a generic BAD_REQUEST as already-exists', () => {
    // Important regression pin: a real validation failure (bad
    // schema, missing field) returns BAD_REQUEST too. We must NOT
    // swallow it as success — that would mask a true bootstrap bug.
    expect(
      isAlreadyExistsError(
        new SquareError({
          statusCode: 400,
          body: {
            errors: [{ code: 'BAD_REQUEST', detail: 'Schema is invalid: missing $ref.' }],
          },
        }),
      ),
    ).toBe(false);
  });

  it('does NOT classify an empty errors array as already-exists', () => {
    expect(
      isAlreadyExistsError(new SquareError({ statusCode: 400, body: { errors: [] } })),
    ).toBe(false);
  });
});

describe('isDefinitionMissingError (task #680)', () => {
  it('returns false for non-SquareError values', () => {
    expect(isDefinitionMissingError(undefined)).toBe(false);
    expect(isDefinitionMissingError(null)).toBe(false);
    expect(isDefinitionMissingError(new Error('boom'))).toBe(false);
  });

  it('classifies HTTP 404 as definition-missing', () => {
    expect(isDefinitionMissingError(new SquareError({ statusCode: 404 }))).toBe(true);
  });

  it('classifies a NOT_FOUND errors[].code with definition-related detail as definition-missing', () => {
    expect(
      isDefinitionMissingError(
        new SquareError({
          statusCode: 404,
          body: {
            errors: [
              { code: 'NOT_FOUND', detail: 'Custom attribute definition not found.' },
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  it("classifies Square's BAD_REQUEST `No matching definition found for value` shape (production-log fixture)", () => {
    // Pinned from the production log shape that left three bowlers in
    // org 3 stuck for nearly a day (task #680). HTTP 400 / BAD_REQUEST,
    // detail mentions "No matching definition found for value", and
    // field is `key`. Without recognising this shape, the bust-cache /
    // re-bootstrap / retry path in `syncCustomerLeagueAttributes`
    // never fires when a definition is deleted out-of-band.
    expect(
      isDefinitionMissingError(
        new SquareError({
          statusCode: 400,
          body: {
            errors: [
              {
                code: 'BAD_REQUEST',
                detail: 'No matching definition found for value',
                field: 'key',
              },
            ],
          },
        }),
      ),
    ).toBe(true);
  });

  it('does NOT classify an unrelated BAD_REQUEST as definition-missing', () => {
    // Sanity check: a generic validation error (e.g. invalid value
    // type) must NOT be treated as definition-missing — that would
    // trigger pointless re-bootstraps for unrelated failures.
    expect(
      isDefinitionMissingError(
        new SquareError({
          statusCode: 400,
          body: {
            errors: [
              { code: 'BAD_REQUEST', detail: 'Value must be a string.', field: 'value' },
            ],
          },
        }),
      ),
    ).toBe(false);
  });
});

describe('ensureDefinitions schema shape (task #680)', () => {
  // Pin the JSON schema we send to Square's
  // `customAttributeDefinitions.create`. The previous URI host
  // (`developer.squareup.com/schemas/v1/common.json`) was rejected by
  // Square with `BAD_REQUEST: Unsupported schema URI encountered: ...`
  // so a schema regression here would silently break smart-list
  // attribute writes for every Square seller.
  it('sends the squarecdn.com $ref shape that Square currently accepts', async () => {
    const captured: Array<Record<string, unknown>> = [];
    // ensureDefinitions accepts a structural minimum
    // (`SquareCustomAttrDefinitionsClient`) declared alongside the
    // helper, so this test fake satisfies the parameter type directly
    // — no `as unknown as SquareClient` laundering required.
    const fakeClient: SquareCustomAttrDefinitionsClient = {
      customers: {
        customAttributeDefinitions: {
          async create(input) {
            captured.push(
              input.customAttributeDefinition.schema as Record<string, unknown>,
            );
            return { customAttributeDefinition: { key: 'k' } };
          },
        },
      },
    };

    const ok = await ensureDefinitions(fakeClient);

    expect(ok).toBe(true);
    // Two definitions get created (league_name + league_season); both
    // must carry the same string-schema $ref.
    expect(captured).toHaveLength(2);
    for (const schema of captured) {
      expect(schema).toEqual({
        $ref: 'https://developer-production-s.squarecdn.com/schemas/v1/common.json#squareup.common.String',
      });
    }
  });
});
