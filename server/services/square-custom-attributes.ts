/**
 * Square Customer Custom Attribute helpers (task #429).
 *
 * The bowler-customer sync writes two seller-scoped attributes onto
 * every Square customer record so admins can build Smart Lists in
 * Square Marketing without leaving Square:
 *
 *   league_name   — alphabetical comma-joined list of leagues the
 *                   bowler is currently in (active rows only).
 *   league_season — distinct season labels (e.g. "Fall '25 Season"),
 *                   chronological by `seasonStart`.
 *
 * Each attribute requires a one-time *definition* per Square seller
 * account. `ensureDefinitions` creates both definitions and treats
 * "already exists" (HTTP 409 / `BAD_REQUEST` with a duplicate-key
 * detail) as success so it is safe to call on every cold start AND
 * lazily before each upsert.
 *
 * The definitions are intentionally *neutral* (no LeagueVault wording
 * or branding leaks into the seller's Square dashboard) per the task
 * spec: keys + names use generic "League Name" / "League Season".
 *
 * Visibility is `VISIBILITY_READ_ONLY` — the documented setting that
 * surfaces the attribute in Square's Customer Directory UI and in
 * Square Marketing Smart List filters, while preventing other Square
 * apps from overwriting our values.
 *
 * This module is intentionally STATELESS: it takes a Square `Client`
 * from the caller (the SquarePaymentProvider) so it can be unit-
 * tested with a mock client and so it has no circular dependency on
 * `square-provider.ts`. Per-seller bootstrap caching lives on the
 * provider where the locationId is naturally available.
 */
import type { SquareClient, SquareError as SquareErrorT } from 'square';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

// Lazy-load `square` (task #692). Only `SquareError` is used as a
// runtime value in this module (for `instanceof` discrimination in
// the helpers). Defer the multi-MB SDK import until the first call
// site actually needs to introspect a thrown error.
const _squareRequire = createRequire(import.meta.url);
let _squareSdk: typeof import('square') | null = null;
function getSquareErrorCtor(): typeof SquareErrorT {
  if (_squareSdk === null) {
    _squareSdk = _squareRequire('square') as typeof import('square');
  }
  return _squareSdk.SquareError;
}
import { createLogger } from '../logger';

const log = createLogger('SquareCustomAttrs');

export const LEAGUE_NAME_KEY = 'league_name';
export const LEAGUE_SEASON_KEY = 'league_season';

// Square requires a $ref-style JSON schema to mark the attribute as a
// free-form string (vs Selection / Number / Boolean / Address). The
// previous host (`developer.squareup.com/schemas/v1/common.json`) is
// rejected today with `BAD_REQUEST: Unsupported schema URI
// encountered: ...`. The currently-accepted host (verified end-to-
// end against a live seller and matching every example in
// `node_modules/square/reference.md` for
// `customAttributeDefinitions.create`) is
// `developer-production-s.squarecdn.com/schemas/v1/common.json`.
// Note the `/schemas/v1/` path segment — the bare `/i/common.json`
// host is rejected with the same "Unsupported schema URI" error.
// The SDK accepts the schema as a free-form `Record<string,
// unknown>` so we pass it raw.
const STRING_SCHEMA = {
  $ref: 'https://developer-production-s.squarecdn.com/schemas/v1/common.json#squareup.common.String',
} as const;

interface DefinitionSpec {
  key: string;
  name: string;
  description: string;
}

const DEFINITIONS: DefinitionSpec[] = [
  {
    key: LEAGUE_NAME_KEY,
    name: 'League Name',
    description:
      'Comma-separated list of leagues this customer is currently in. Updated automatically.',
  },
  {
    key: LEAGUE_SEASON_KEY,
    name: 'League Season',
    description:
      'Comma-separated list of season labels for the leagues this customer is in. Updated automatically.',
  },
];

/**
 * Detects "the definition already exists" responses across the two
 * shapes Square has been observed to return:
 *   - HTTP 409 (`statusCode === 409`) — modern responses
 *   - HTTP 400 with `errors[].code === 'BAD_REQUEST'` and the message
 *     mentioning a duplicate key — older surfaces
 * Both are SUCCESS for our idempotent bootstrap.
 */
export function isAlreadyExistsError(err: unknown): boolean {
  if (!(err instanceof getSquareErrorCtor())) return false;
  if (err.statusCode === 409) return true;
  // v40+ flat-client SDK exposes structured errors directly on the
  // SquareError instance; the legacy `.result.errors[]` wrapper is
  // gone. Same `category` / `code` / `detail` / `field` fields.
  const errors = err.errors;
  if (!errors?.length) return false;
  return errors.some((e) => {
    const code = (e.code ?? '').toUpperCase();
    if (code === 'CONFLICT' || code === 'ALREADY_EXISTS') return true;
    const detail = (e.detail ?? '').toLowerCase();
    return code === 'BAD_REQUEST' && /already (exists|in use|defined)|duplicate/.test(detail);
  });
}

/**
 * Structural minimum of `SquareClient` that ensureDefinitions /
 * createDefinition actually exercises — just the
 * `customers.customAttributeDefinitions.create` surface. Declared as
 * its own interface so tests can pass a hand-rolled fake without
 * needing to launder a partial through `as unknown as SquareClient`
 * (which the repo lint config bans). The real `SquareClient` is
 * structurally compatible with this type, so production callers pass
 * it unchanged.
 */
export interface SquareCustomAttrDefinitionsClient {
  customers: {
    customAttributeDefinitions: {
      create(input: {
        customAttributeDefinition: {
          key: string;
          name: string;
          description?: string;
          // Narrow to the literal union Square's SDK exposes so the
          // real `SquareClient` is structurally assignable to this
          // interface (function parameters are contravariant — a
          // looser `string` here would reject the SDK signature).
          visibility?: 'VISIBILITY_HIDDEN' | 'VISIBILITY_READ_ONLY' | 'VISIBILITY_READ_WRITE_VALUES';
          schema?: Record<string, unknown> | null;
        };
        idempotencyKey?: string;
      }): Promise<unknown>;
    };
  };
}

async function createDefinition(
  client: SquareCustomAttrDefinitionsClient,
  spec: DefinitionSpec,
): Promise<'created' | 'exists' | 'failed'> {
  try {
    // v40+ flat-client SDK nests the customer custom attribute
    // definition resource under `customers.customAttributeDefinitions`.
    await client.customers.customAttributeDefinitions.create({
      customAttributeDefinition: {
        key: spec.key,
        name: spec.name,
        description: spec.description,
        visibility: 'VISIBILITY_READ_ONLY',
        schema: STRING_SCHEMA as unknown as Record<string, unknown>,
      },
      // Idempotency-key shape preserved across the v40 SDK upgrade so
      // a retry post-deploy still dedupes against any in-flight pre-
      // upgrade definition-create on Square's side. Per-seller
      // bootstrap is rare and re-running the create with the same key
      // is exactly what the "already exists" branch was designed for.
      idempotencyKey: `leaguevault-${spec.key}-def-v1`,
    });
    log.info('Created Square customer custom attribute definition', { key: spec.key });
    return 'created';
  } catch (err) {
    if (isAlreadyExistsError(err)) {
      return 'exists';
    }
    log.warn('Failed to create Square custom attribute definition', {
      key: spec.key,
      error: err instanceof Error ? { name: err.name, message: err.message } : err,
    });
    return 'failed';
  }
}

/**
 * Creates both `league_name` and `league_season` definitions on the
 * Square seller account behind `client`. Idempotent: safe to call on
 * every cold start AND lazily before each customer attribute upsert.
 *
 * Returns true when both definitions are known to exist (created or
 * pre-existing). Returns false on hard API failure — the caller must
 * treat false as NON-FATAL and continue with the customer write.
 */
export async function ensureDefinitions(
  client: SquareCustomAttrDefinitionsClient,
): Promise<boolean> {
  let allOk = true;
  for (const spec of DEFINITIONS) {
    const status = await createDefinition(client, spec);
    if (status === 'failed') allOk = false;
  }
  return allOk;
}

/**
 * Detects "the definition for this key does not exist on this seller"
 * responses. Square returns these as HTTP 404 with a `NOT_FOUND` error
 * code whose detail mentions the missing custom-attribute definition.
 * The caller's recovery path is to (re-)bootstrap the definitions and
 * retry the upsert once.
 */
export function isDefinitionMissingError(err: unknown): boolean {
  if (!(err instanceof getSquareErrorCtor())) return false;
  // v40+ flat-client SDK exposes structured errors directly on the
  // SquareError instance (`.errors[]`, `.statusCode`, `.body`); the
  // legacy `.result.errors[]` wrapper is gone.
  const errors = err.errors;
  if (errors?.length) {
    for (const e of errors) {
      const code = (e.code ?? '').toUpperCase();
      const detail = (e.detail ?? '').toLowerCase();
      const field = (e.field ?? '').toLowerCase();
      if (code === 'NOT_FOUND' && /custom[_ ]?attribute|definition/.test(detail)) {
        return true;
      }
      // Square's actual response when a customer custom-attribute
      // upsert references a key with no seller-side definition is
      // HTTP 400 / `BAD_REQUEST` with detail "No matching definition
      // found for value" and field=`key` — NOT a 404. Without this
      // branch the recovery path in
      // `square-provider.syncCustomerLeagueAttributes` (bust cache,
      // re-bootstrap, retry once) never fires when a definition is
      // deleted out-of-band on the seller account, leaving every
      // bowler in that org stuck in the payment-sync retry queue.
      if (
        code === 'BAD_REQUEST' &&
        field === 'key' &&
        /no matching definition/.test(detail)
      ) {
        return true;
      }
    }
  }
  // Some surfaces return a bare 404 without per-error detail. Treat a
  // 404 on the upsert path as definition-missing too — the customer
  // record was already verified by the caller before we got here.
  return err.statusCode === 404;
}

export type UpsertAttributeResult =
  | { ok: true }
  | { ok: false; reason: 'definition_missing' | 'other' };

/**
 * Upserts a single string custom attribute on a Square customer.
 *
 * On failure, returns a discriminated result so the caller can
 * distinguish "definition was deleted out-of-band" (recoverable via
 * bootstrap + retry) from any other error (flag the bowler for the
 * background retry sweep).
 */
export async function upsertCustomerStringAttribute(
  client: SquareClient,
  customerId: string,
  key: string,
  value: string,
  bowlerId: number | string,
): Promise<UpsertAttributeResult> {
  try {
    // Idempotency key includes a short hash of the payload so:
    //   - A true retry of the SAME write (transient network error,
    //     duplicate fire from two routes) reuses the same key and
    //     Square correctly dedupes inside its idempotency window.
    //   - A REAL update (league rename, season change, bowler joins
    //     a new league) gets a fresh key and is not blocked by a
    //     previous-payload entry that Square would otherwise either
    //     dedupe-with-stale-result or reject as a conflict.
    // Square's idempotency-key limit is 45 chars; a 12-hex-char SHA-
    // 1 prefix gives 2^48 collision space per (bowler,key) which is
    // far beyond anything we'd hit in practice. Shape preserved across
    // the v40 SDK upgrade so post-deploy retries dedupe against any
    // pre-upgrade upsert still in flight on Square's side.
    const valueHash = createHash('sha1').update(value).digest('hex').slice(0, 12);
    // v40+ flat-client SDK nests the customer custom attribute resource
    // under `customers.customAttributes` and folds (customerId, key)
    // into the request body itself.
    await client.customers.customAttributes.upsert({
      customerId,
      key,
      customAttribute: {
        value,
      },
      idempotencyKey: `lv-${bowlerId}-${key}-${valueHash}`,
    });
    return { ok: true };
  } catch (err) {
    const definitionMissing = isDefinitionMissingError(err);
    log.warn('Failed to upsert customer custom attribute', {
      customerId,
      key,
      bowlerId,
      definitionMissing,
      error: err instanceof Error ? { name: err.name, message: err.message } : err,
    });
    return { ok: false, reason: definitionMissing ? 'definition_missing' : 'other' };
  }
}
