import type {
  SquareClient,
  SquareEnvironment as SquareEnvironmentT,
  SquareError as SquareErrorT,
  CreatePaymentRequest,
  CatalogObject,
  BaseClientOptions,
} from 'square';
import { createRequire } from 'node:module';
import crypto from 'crypto';

// Lazy-load the `square` SDK (task #692). The package is multi-MB
// and pulls a large dependency tree; deferring it until the first
// real Square code path executes keeps cold-start (and unit-test
// import-time) lean.
//
// Two access paths share one cache:
//   - `getSquareSdkAsync()` uses dynamic `await import('square')` so
//     vitest's `vi.mock('square', ...)` ESM module-mock is honored.
//     This is the path async production code (and the SDK probe)
//     takes on first use.
//   - `getSquareSdk()` (sync) returns the cached module if a prior
//     async call already loaded it; otherwise it falls back to
//     `createRequire('square')` for synchronous `instanceof`
//     discrimination in catch blocks. In production the cache is
//     always primed by `buildSquareClient` before any catch runs.
const _squareRequire = createRequire(import.meta.url);
let _squareSdk: typeof import('square') | null = null;
async function getSquareSdkAsync(): Promise<typeof import('square')> {
  if (_squareSdk === null) {
    _squareSdk = await import('square');
  }
  return _squareSdk;
}
function getSquareSdk(): typeof import('square') {
  if (_squareSdk === null) {
    _squareSdk = _squareRequire('square') as typeof import('square');
  }
  return _squareSdk;
}
// Local re-exposed value handles. Each is lazily resolved on first
// access so test files that never construct or catch a Square error
// don't pay the SDK import cost transitively.
function getSquareErrorCtor(): typeof SquareErrorT {
  return getSquareSdk().SquareError;
}
import { storage } from '../storage';
import { createLogger } from '../logger';
import { isDev } from '../config';
import {
  ProviderNotConfiguredError,
  PaymentProviderError,
  CardOwnershipMismatchError,
} from './payment-errors';
import {
  ensureDefinitions,
  repairDefinition,
  repairAllDefinitions,
  upsertCustomerStringAttribute,
  LEAGUE_NAME_KEY,
  LEAGUE_SEASON_KEY,
} from './square-custom-attributes';
import { squareCatalogCapAlerter } from './square-catalog-cap-alerts';
import type {
  PaymentProvider,
  CatalogProvider,
  WalletProvider,
  PaymentResult,
  RefundResult,
  SavedCard,
  PaymentCustomer,
  PaymentVerification,
  OrderLineItem,
  CatalogCategory,
  CatalogItem,
} from './payment-provider';

const log = createLogger("SquareService");

/**
 * Square's CreateCard / CreateCustomer endpoints cap `idempotency_key`
 * at 45 characters. Anything longer is rejected with
 * `INVALID_REQUEST_ERROR / VALUE_TOO_LONG` and the call fails — which
 * is what bit task #671 in production after the v40 SDK migration
 * (the pre-fix code sent the full 64-char SHA-256 hex digest, and a
 * post-fix `.slice(0, 40)` was easy to silently drop in a refactor).
 *
 * `buildSquareIdempotencyKey` centralises the format so:
 *   - The output is deterministic for the same inputs (so retries
 *     dedupe inside Square's idempotency window).
 *   - The output is unique enough to avoid cross-bowler / cross-card
 *     collisions (32 hex chars = 128 bits of entropy).
 *   - The output has a short, human-readable prefix so a stuck request
 *     in Square's dashboard is grep-able back to the call site.
 *   - The output length is asserted at runtime to be ≤45, so any
 *     future change to the prefix or hash slice that would push it
 *     over the limit fails loud during tests / dev rather than only
 *     in production. Pinned by `square.test.ts`.
 */
export const SQUARE_IDEMPOTENCY_MAX_LENGTH = 45;
export function buildSquareIdempotencyKey(prefix: string, ...parts: string[]): string {
  const hash = crypto
    .createHash('sha256')
    .update(parts.join(':'))
    .digest('hex')
    .slice(0, 32);
  const key = `${prefix}-${hash}`;
  if (key.length > SQUARE_IDEMPOTENCY_MAX_LENGTH) {
    throw new Error(
      `Square idempotency key exceeded ${SQUARE_IDEMPOTENCY_MAX_LENGTH} chars: ${key.length} (prefix='${prefix}')`,
    );
  }
  return key;
}

/**
 * Safety cap on catalog pagination (Task #613). Square paginates
 * `catalog.list` and `catalog.searchItems` with a `cursor`; without a
 * cap, a stuck or pathological cursor (e.g. an SDK bug that never
 * unsets it) would loop forever and pin a request. The cap is
 * deliberately well above any plausible real-world catalog size — a
 * legitimate organization that hits this limit is itself a signal
 * worth investigating, hence the `warn` log.
 */
const CATALOG_PAGINATION_MAX_ITEMS = 5_000;
const CATALOG_PAGINATION_MAX_PAGES = 20;

/**
 * Walk a Square catalog cursor until it is empty (or a safety cap is
 * hit), accumulating every CatalogObject across all pages. Used by
 * `listCatalogCategories` and both branches of `listCatalogItems` so
 * the cursor-handling and the safety cap live in exactly one place.
 *
 * `fetchPage` is the per-call differentiator:
 *   - `catalog.list` returns a `Page<CatalogObject>` whose cursor lives
 *     at `page.response?.cursor`.
 *   - `catalog.searchItems` returns the response body directly with
 *     `cursor` at the top level.
 * The caller adapts whichever shape they use into a uniform
 * `{ objects, nextCursor }` for this helper.
 */
async function paginateCatalogObjects(
  fetchPage: (cursor: string | undefined) => Promise<{
    objects: CatalogObject[];
    nextCursor: string | undefined;
  }>,
  context: string,
): Promise<{
  objects: CatalogObject[];
  truncated: boolean;
  truncationReason: 'max_items' | 'max_pages' | null;
}> {
  const all: CatalogObject[] = [];
  let cursor: string | undefined;
  let pages = 0;
  let truncated = false;
  let truncationReason: 'max_items' | 'max_pages' | null = null;
  do {
    const { objects, nextCursor } = await fetchPage(cursor);
    all.push(...objects);
    pages += 1;
    cursor = nextCursor;
    if (all.length >= CATALOG_PAGINATION_MAX_ITEMS) {
      log.warn(
        `${context}: hit MAX_ITEMS=${CATALOG_PAGINATION_MAX_ITEMS} cap after ${pages} page(s); ` +
          'stopping pagination. Some catalog items may be missing from the response.',
      );
      truncated = true;
      truncationReason = 'max_items';
      break;
    }
    if (pages >= CATALOG_PAGINATION_MAX_PAGES && cursor) {
      log.warn(
        `${context}: hit MAX_PAGES=${CATALOG_PAGINATION_MAX_PAGES} cap with cursor still set; ` +
          `${all.length} object(s) returned. Some catalog items may be missing from the response.`,
      );
      truncated = true;
      truncationReason = 'max_pages';
      break;
    }
  } while (cursor);
  return { objects: all, truncated, truncationReason };
}

/**
 * The `Square-Version` header that `square@44.0.1`'s baked-in default
 * sends on every outbound request. Audited and pinned in
 * `docs/square-api-version-audit.md` §1, with the operator pre-flight
 * checklist for bumping it in §6.
 *
 * This constant exists so a CI test (Task #614) can assert that the
 * SDK's default header still matches what the audit reviewed. If a
 * future `square` upgrade ships a different default (e.g. `square@45`
 * with a new pinned version), the test will fail loudly and force the
 * operator to re-run the audit before merging the SDK bump — which
 * matters because changing the wire version changes response shapes
 * across every call site at once.
 *
 * Update path when this needs to change:
 *   1. Re-run the per-release diff in `docs/square-api-version-audit.md` §5
 *      for the new window.
 *   2. Update both this constant and the version table in §1 of the
 *      audit doc in the same commit.
 *   3. Walk the operator pre-flight checklist in §6 before the bump
 *      lands in production.
 */
export const SQUARE_EXPECTED_VERSION = '2026-01-22' as const;

/**
 * Build a `SquareClient` from raw credentials, picking
 * Production vs Sandbox using the existing token/appId heuristic.
 *
 * Exported so the version-header CI test (Task #614) can construct
 * a client through the *same* code path the production
 * `getSquareClient` does — otherwise the test would silently miss
 * drift in how the client is constructed (e.g. someone adding a
 * `version: '2025-01-23'` override here).
 *
 * `extraOptions` is intentionally narrow: the production-derived
 * `token` and `environment` are written *after* the spread, so they
 * always win over anything in `extraOptions` (a test cannot
 * accidentally change which token or environment we exercise).
 * Production callers always pass none.
 */
export async function buildSquareClient(
  accessToken: string,
  appId?: string,
  extraOptions?: Partial<BaseClientOptions>,
): Promise<SquareClient> {
  const cleanToken = accessToken.replace(/[^\x20-\x7E]/g, '').trim();
  const isProductionAppId = appId ? (appId.length > 0 && !appId.includes('sandbox-')) : true;
  const isProductionToken = cleanToken.startsWith('EAAAEv') || cleanToken.startsWith('EAAAl7');
  const sdk = await getSquareSdkAsync();
  const SquareEnvironment: typeof SquareEnvironmentT = sdk.SquareEnvironment;
  const environment = (isProductionAppId || isProductionToken) ? SquareEnvironment.Production : SquareEnvironment.Sandbox;
  // v40+ flat-client SDK shape (task #603 / Phase 2 of #600). Note the
  // option key is `token` now, not `accessToken`, and the environment
  // values are URLs from the SquareEnvironment record (Production /
  // Sandbox), not the legacy `Environment` enum.
  return new sdk.SquareClient({ ...extraOptions, token: cleanToken, environment });
}

/**
 * Runtime Square-Version header guard (task #627).
 *
 * Background: the CI test in `__tests__/square-version-header.test.ts`
 * (task #614) catches `Square-Version` drift on the lockfile that's
 * about to merge. But a deploy-time SDK upgrade — a hotfix `npm i
 * square@latest` rolled directly into the deploy artifact, a
 * `package-lock.json` regen during CI, or any other bump that ships
 * to production without re-running the merge-gating test on the
 * bumped lockfile — could still float a different wire version into
 * production unnoticed. Drift matters because changing
 * `Square-Version` changes response shapes across every Square call
 * site at once (see `docs/square-api-version-audit.md` §1).
 *
 * This runtime guard re-uses the same fake-fetcher capture trick the
 * CI test relies on: build a `SquareClient` whose `fetcher` records
 * the headers and short-circuits the network call, fire one
 * `payments.get` against it, and compare the captured
 * `Square-Version` value against `SQUARE_EXPECTED_VERSION`. The
 * probe is memoized per process: it runs once at server boot (from
 * `server/index.ts`) and is also kicked off lazily on the first
 * `getSquareClient()` call — whichever happens first.
 *
 * Failure modes:
 *   - **Drift detected.** Logs a `[PAGE] Square SDK Square-Version
 *     header drift` line at `error` priority with `expected`,
 *     `actual`, and a runbook pointer to
 *     `docs/square-api-version-audit.md` §6. Subsequent
 *     `getSquareClient()` calls return `null` so the provider refuses
 *     to initialize — admin-facing routes surface that as the same
 *     `PROVIDER_NOT_CONFIGURED` 422 they'd see if Square credentials
 *     were missing. That's a strong, unambiguous signal — better than
 *     letting a drifted SDK silently parse responses against an
 *     unaudited wire version.
 *   - **Probe could not capture (e.g. SDK mocked in tests).** Logs an
 *     `info` line and treats the check as non-conclusive — does NOT
 *     refuse to initialize. The CI test (#614) is still the canonical
 *     guard against drift; this runtime probe is defense-in-depth and
 *     must not break unit tests that mock the `square` module.
 */
import {
  registerThirdPartyPin,
  verifyThirdPartyPin,
  _setThirdPartyPinProbeForTests,
  _resetThirdPartyPinsForTests,
  type PinProbeResult,
  type PinProbeFn,
} from './third-party-pin-verifier';

async function defaultProbeSquareSdkVersion(): Promise<PinProbeResult> {
  const captured: Array<Record<string, unknown>> = [];
  // Mirrors the fake fetcher pattern in
  // `__tests__/square-version-header.test.ts`: capture the headers
  // the SDK assembles and short-circuit before any real network call.
  // Typed via `BaseClientOptions['fetcher']` (which the SDK declares
  // as `core.FetchFunction`). The returned `FailedResponse` shape is
  // assignable to `APIResponse<R, Fetcher.Error>` for any `R`, so no
  // cast is needed.
  const fetcher: BaseClientOptions['fetcher'] = async (args) => {
    captured.push(args.headers ?? {});
    const rawResponse = new Response(null, { status: 599, statusText: 'short-circuited' });
    return {
      ok: false,
      error: { reason: 'unknown', errorMessage: 'short-circuited by sdk-version probe' },
      rawResponse,
    };
  };

  let probe: SquareClient;
  try {
    // Production-shaped token prefix so `buildSquareClient`'s heuristic
    // routes to the Production environment URL — same path
    // production traffic exercises. No real call leaves the process
    // because `fetcher` short-circuits.
    probe = await buildSquareClient(
      'EAAAEvSDK_VERSION_PROBE_NOT_A_REAL_SECRET',
      undefined,
      { fetcher },
    );
  } catch {
    // SDK couldn't be constructed at all (e.g. constructor signature
    // changed). Don't fail-shut — the CI test will catch real drift.
    return { ok: true, actual: undefined, reason: 'no-captured-request' };
  }

  try {
    await probe.payments.get({ paymentId: 'sdk-version-probe' });
  } catch {
    // Expected: the fake fetcher returns `ok: false` so the SDK
    // throws downstream. Also catches the case where the SDK is
    // mocked in tests and `payments.get` is undefined — handled by
    // the `no-captured-request` branch below.
  }

  const headers = captured[0];
  if (!headers) {
    return { ok: true, actual: undefined, reason: 'no-captured-request' };
  }
  // Per the test (and Square's fetcher impl), header keys are
  // lowercased before dispatch. Wire literal is `Square-Version`;
  // case-insensitive match is what counts.
  const raw = headers['square-version'];
  const version = typeof raw === 'string' ? raw : undefined;
  if (version !== SQUARE_EXPECTED_VERSION) {
    return { ok: false, actual: version, reason: 'drift' };
  }
  return { ok: true, actual: version };
}

/**
 * Register Square against the generic third-party pin verifier
 * framework (task #651). Square keeps its own legacy log lines
 * (so the on-call grep convention `[PAGE] Square SDK Square-Version
 * header drift` from task #627 stays stable) instead of using
 * `makeDefaultPinOnResult`. New providers should prefer the default
 * formatter unless they have a similar back-compat constraint.
 */
const SQUARE_REMEDIATION =
  'Pin the `square` package back to a version whose Square-Version equals SQUARE_EXPECTED_VERSION, or re-run the audit in §1/§5 and update SQUARE_EXPECTED_VERSION + §1 in the same commit.';

registerThirdPartyPin({
  provider: 'square',
  pinName: 'Square-Version header',
  expected: SQUARE_EXPECTED_VERSION,
  probe: defaultProbeSquareSdkVersion,
  runbook: 'docs/square-api-version-audit.md §6',
  onResult: (outcome) => {
    if (outcome.ok && outcome.actual === undefined) {
      log.info(
        'Square SDK Square-Version probe could not capture an outgoing request — runtime version check skipped (CI test #614 remains the canonical guard).',
      );
    } else if (outcome.ok) {
      log.info('Square SDK Square-Version verified at runtime', {
        version: outcome.actual,
        expected: SQUARE_EXPECTED_VERSION,
      });
    } else {
      log.error(
        '[PAGE] Square SDK Square-Version header drift detected at runtime — refusing to initialize Square provider',
        {
          expected: SQUARE_EXPECTED_VERSION,
          actual: outcome.actual ?? null,
          runbook: 'docs/square-api-version-audit.md §6',
          remediation: SQUARE_REMEDIATION,
        },
      );
    }
  },
});

/**
 * Reset the memoized verification result and the probe implementation.
 * Test-only — never call from production code. Used by
 * `__tests__/square-version-runtime-guard.test.ts` so each test case
 * starts from a clean cache.
 */
export function _resetSquareSdkVersionVerificationForTests(): void {
  _resetThirdPartyPinsForTests('square');
}

/**
 * Replace the probe implementation. Test-only — used to inject a
 * synthetic captured Square-Version header without standing up a
 * real `SquareClient`. Pass `null` to restore the default probe.
 *
 * The legacy probe-result shape (`{ok, version, reason?}`) is
 * adapted into the generic `PinProbeResult` shape (`{ok, actual,
 * reason?}`) so existing test cases keep compiling.
 */
type LegacyProbeResult =
  | { ok: true; version: string; reason?: undefined }
  | { ok: true; version: undefined; reason: 'no-captured-request' }
  | { ok: false; version: string | undefined; reason: 'drift' };

export function _setSquareSdkVersionProbeForTests(
  probe: (() => Promise<LegacyProbeResult>) | null,
): void {
  if (!probe) {
    _setThirdPartyPinProbeForTests('square', null);
    return;
  }
  const adapted: PinProbeFn = async () => {
    const r = await probe();
    if (r.ok && r.reason === 'no-captured-request') {
      return { ok: true, actual: undefined, reason: 'no-captured-request' };
    }
    if (r.ok) {
      return { ok: true, actual: r.version };
    }
    return { ok: false, actual: r.version, reason: 'drift' };
  };
  _setThirdPartyPinProbeForTests('square', adapted);
}

/**
 * Run (or return the memoized result of) the runtime Square-Version
 * header check. Safe to call eagerly at server boot AND lazily from
 * `getSquareClient()` — the first caller wins, every subsequent
 * caller awaits the same promise.
 *
 * Returns `{ ok, version }` for back-compat with existing call
 * sites; the underlying outcome flows through the generic
 * `verifyThirdPartyPin('square')`.
 */
export async function verifySquareSdkVersion(): Promise<{
  ok: boolean;
  version: string | undefined;
}> {
  const outcome = await verifyThirdPartyPin('square');
  return { ok: outcome.ok, version: outcome.actual };
}

export class SquarePaymentProvider implements PaymentProvider, CatalogProvider, WalletProvider {
  readonly providerName = 'square';
  readonly locationId: number;

  constructor(locationId: number) {
    this.locationId = locationId;
  }

  /**
   * Diagnostic-only accessor: returns the underlying Square SDK
   * client so one-off scripts (e.g. `scripts/list-square-attr-defs.ts`)
   * can inspect seller state without laundering the private through
   * a `as unknown as` double-cast (which the lint config bans).
   * Production code paths must continue to use the typed methods on
   * this provider.
   */
  async getSquareClientForDiagnostics(): Promise<SquareClient | null> {
    return this.getSquareClient();
  }

  private async getSquareClient(): Promise<SquareClient | null> {
    // Runtime Square-Version header guard (task #627). The probe is
    // memoized per process so this is a single fast resolution after
    // the first call (or after `server/index.ts`'s eager call at
    // boot, whichever happens first). Drift causes us to refuse to
    // hand back a client at all — same null contract that "no
    // credentials" already uses, so route layers fall back to
    // PROVIDER_NOT_CONFIGURED instead of letting a drifted SDK
    // exchange responses against an unaudited wire version.
    const verification = await verifySquareSdkVersion();
    if (!verification.ok) {
      log.error(
        `Refusing Square client for location ${this.locationId}: Square-Version header drift (expected ${SQUARE_EXPECTED_VERSION}, got ${verification.version ?? 'unknown'}). See docs/square-api-version-audit.md §6.`,
      );
      return null;
    }
    try {
      const creds = await storage.getLocationSquareConfig(this.locationId);
      if (creds?.accessToken && creds.accessToken.trim().length > 0) {
        return await buildSquareClient(creds.accessToken, creds.appId);
      }
      log.warn(`No Square credentials configured for location ${this.locationId}`);
      return null;
    } catch (err) {
      log.warn(`Error fetching credentials for location ${this.locationId}:`, err);
      return null;
    }
  }

  private async getSquareLocationId(): Promise<string> {
    try {
      const creds = await storage.getLocationSquareConfig(this.locationId);
      if (creds?.locationId && creds.locationId.trim().length > 0) {
        return creds.locationId.trim();
      }
    } catch {
      // no-op
    }
    return '';
  }

  async processPayment(
    sourceId: string,
    amount: number,
    storeCard?: boolean,
    customerId?: string,
    buyerEmail?: string,
    idempotencyKey?: string,
  ): Promise<PaymentResult> {
    const client = await this.getSquareClient();
    if (!client) {
      // Surface the structured "not configured" signal so the
      // /api/payments-provider/payments route maps it to 422
      // PROVIDER_NOT_CONFIGURED instead of 500. See task #332.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }

    try {
      if (!sourceId || !amount) {
        throw new PaymentProviderError(
          'Missing required payment information',
          'INVALID_REQUEST',
        );
      }

      if (amount <= 0 || !Number.isInteger(amount)) {
        throw new PaymentProviderError(
          'Invalid payment amount',
          'INVALID_AMOUNT',
        );
      }

      const paymentRequest: CreatePaymentRequest = {
        sourceId,
        idempotencyKey: idempotencyKey || `${Date.now()}-${Math.random()}`,
        amountMoney: {
          amount: BigInt(amount),
          currency: 'USD'
        },
        autocomplete: true
      };

      if (customerId) {
        paymentRequest.customerId = customerId;
      }

      if (buyerEmail) {
        paymentRequest.buyerEmailAddress = buyerEmail;
      }

      const response = await client.payments.create(paymentRequest);

      if (!response?.payment) {
        throw new PaymentProviderError(
          'Unable to process payment',
          'INVALID_RESPONSE',
        );
      }

      const payment = response.payment;
      const cardDetails = payment.cardDetails?.card;

      return {
        id: payment.id,
        status: payment.status,
        card: {
          last4: cardDetails?.last4 ?? '****',
          brand: cardDetails?.cardBrand ?? 'UNKNOWN'
        },
        // capture Square's hosted-receipt URL + short
        // receipt number off the CreatePayment response so the
        // route can persist them on the payments row.
        receiptUrl: payment.receiptUrl,
        receiptNumber: payment.receiptNumber,
      };
    } catch (error) {
      // PaymentProviderError throws above (or ProviderNotConfiguredError
      // from getSquareClient) are already user-safe — re-throw them
      // verbatim so the route's catch sees the original code/message
      // rather than the generic PAYMENT_FAILED below.
      if (
        error instanceof PaymentProviderError ||
        error instanceof ProviderNotConfiguredError
      ) {
        throw error;
      }
      // v40+ flat-client SDK exposes structured errors directly on the
      // SquareError instance (`.errors[]`, `.statusCode`, `.body`); the
      // legacy `.result.errors[]` wrapper is gone. We capture the first
      // `detail` for server-side logs only — never forwarded to the user.
      const apiErr = error instanceof getSquareErrorCtor() ? error : null;
      const detail = apiErr?.errors?.[0]?.detail;
      if (apiErr?.statusCode === 400) {
        throw new PaymentProviderError(
          'Invalid payment information. Please check your card details.',
          'INVALID_REQUEST',
          detail,
        );
      }
      if (apiErr?.statusCode === 401) {
        throw new PaymentProviderError(
          'Payment system is temporarily unavailable. Please try again later.',
          'SYSTEM_ERROR',
          detail,
        );
      }
      if (apiErr?.statusCode === 402) {
        throw new PaymentProviderError(
          'Your payment was declined. Please try a different card.',
          'PAYMENT_DECLINED',
          detail,
        );
      }
      throw new PaymentProviderError(
        'Unable to process your payment. Please try again later.',
        'PAYMENT_FAILED',
        detail,
      );
    }
  }

  async createOrderWithPayment(
    sourceId: string,
    amount: number,
    lineItems: OrderLineItem[],
    storeCard?: boolean,
    customerId?: string,
    buyerEmail?: string,
    idempotencyKey?: string,
  ): Promise<PaymentResult> {
    const [client, squareLocationId] = await Promise.all([
      this.getSquareClient(),
      this.getSquareLocationId(),
    ]);

    if (!client) {
      // Same structured "not configured" contract as processPayment.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }

    if (!squareLocationId) {
      throw new PaymentProviderError(
        'Square location not configured for this location',
        'CONFIGURATION_ERROR',
      );
    }

    try {
      const locationId = squareLocationId;
      const orderResponse = await client.orders.create({
        order: {
          locationId,
          lineItems,
        },
        idempotencyKey: idempotencyKey ? `${idempotencyKey}-order` : `order-${Date.now()}-${Math.random()}`,
      });

      const order = orderResponse.order;
      if (!order?.id) {
        throw new Error('Failed to create order');
      }

      log.info('Order created:', order.id);

      const paymentRequest: CreatePaymentRequest = {
        sourceId,
        idempotencyKey: idempotencyKey ? `${idempotencyKey}-pay` : `pay-${Date.now()}-${Math.random()}`,
        amountMoney: {
          amount: BigInt(amount),
          currency: 'USD',
        },
        orderId: order.id,
        locationId,
        autocomplete: true,
      };

      if (customerId) {
        paymentRequest.customerId = customerId;
      }

      if (buyerEmail) {
        paymentRequest.buyerEmailAddress = buyerEmail;
      }

      const paymentResponse = await client.payments.create(paymentRequest);

      if (!paymentResponse?.payment) {
        throw new PaymentProviderError(
          'Unable to process payment',
          'INVALID_RESPONSE',
        );
      }

      const payment = paymentResponse.payment;
      const cardDetails = payment.cardDetails?.card;

      return {
        id: payment.id,
        status: payment.status,
        orderId: order.id,
        card: {
          last4: cardDetails?.last4 ?? '****',
          brand: cardDetails?.cardBrand ?? 'UNKNOWN',
        },
        // same hosted-receipt capture as processPayment.
        receiptUrl: payment.receiptUrl,
        receiptNumber: payment.receiptNumber,
      };
    } catch (error) {
      log.error('Order+Payment error:', error);
      // Re-throw already-typed errors verbatim so the route's catch
      // sees the original `userMessage`/`code` we set above (or the
      // PNCE from getSquareClient/getSquareLocationId).
      if (
        error instanceof PaymentProviderError ||
        error instanceof ProviderNotConfiguredError
      ) {
        throw error;
      }
      const apiErr = error instanceof getSquareErrorCtor() ? error : null;
      const detail = apiErr?.errors?.[0]?.detail;
      if (apiErr?.statusCode === 402) {
        throw new PaymentProviderError(
          'Your payment was declined. Please try a different card.',
          'PAYMENT_DECLINED',
          detail,
        );
      }
      if (apiErr?.statusCode === 401) {
        // Same mapping as processPayment above: a Square auth failure
        // (revoked / expired access token, wrong app id, etc.) is a
        // server-side credential problem the admin can't action with
        // a card retry — surface SYSTEM_ERROR so the toast tells them
        // it's a temporary infra issue rather than a declined card.
        // Pinned by tests/unit/square-charge-failures.test.ts (#619).
        throw new PaymentProviderError(
          'Payment system is temporarily unavailable. Please try again later.',
          'SYSTEM_ERROR',
          detail,
        );
      }
      if (apiErr?.statusCode === 400) {
        // Raw `detail` is captured for logs only — the user gets the
        // hand-authored sentence regardless of what Square returned.
        throw new PaymentProviderError(
          'Payment could not be processed. Please check your details and try again.',
          'INVALID_REQUEST',
          detail,
        );
      }
      throw new PaymentProviderError(
        'Payment processing failed. Please try again.',
        'PAYMENT_FAILED',
        detail,
      );
    }
  }

  async refundPayment(
    paymentId: string,
    amountInCents: number,
    reason?: string,
  ): Promise<RefundResult> {
    const client = await this.getSquareClient();
    if (!client) {
      // /api/payments/:id/refund maps this to 422 PROVIDER_NOT_CONFIGURED
      // so admins can tell "Square isn't connected for this location"
      // apart from "Square rejected the refund". See task #332.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }

    try {
      const idempotencyKey = `refund-${paymentId}-${Date.now()}`;

      const response = await client.refunds.refundPayment({
        idempotencyKey,
        paymentId,
        amountMoney: {
          amount: BigInt(amountInCents),
          currency: 'USD',
        },
        reason: reason || 'Refund processed via LeagueVault',
      });

      const refund = response.refund;
      if (!refund || !refund.id) {
        throw new Error('Refund response missing refund data');
      }

      log.info(`Refund processed: ${refund.id}, status: ${refund.status}`);
      return {
        refundId: refund.id,
        status: refund.status || 'PENDING',
      };
    } catch (error) {
      log.error('Refund error:', error);
      // Re-throw already-typed errors verbatim so the route's catch
      // sees the original `userMessage`/`code` (and the PNCE from
      // getSquareClient never gets re-wrapped into REFUND_FAILED).
      if (
        error instanceof PaymentProviderError ||
        error instanceof ProviderNotConfiguredError
      ) {
        throw error;
      }

      // Parity with processPayment / createOrderWithPayment above and
      // CloverPaymentProvider.refundPayment below: collapse any Square
      // SDK error shape into a typed PaymentProviderError so the refund
      // route can show admins the actionable reason (declined card,
      // validation error, system error) instead of a generic wall.
      // v40+ flat-client SDK exposes structured errors directly on the
      // SquareError instance (`.errors[]`, `.statusCode`); the legacy
      // `.result.errors[]` wrapper is gone. Raw Square `detail` is
      // captured for logs only — never forwarded as the user-facing
      // `userMessage` (task #514).
      const apiErr = error instanceof getSquareErrorCtor() ? error : null;
      const detail = apiErr?.errors?.[0]?.detail;
      if (apiErr?.statusCode === 401 || apiErr?.statusCode === 403) {
        throw new PaymentProviderError(
          'Payment system is temporarily unavailable. Please try again later.',
          'SYSTEM_ERROR',
          detail,
        );
      }
      if (apiErr?.statusCode === 402) {
        throw new PaymentProviderError(
          'Your payment was declined. Please try a different card.',
          'PAYMENT_DECLINED',
          detail,
        );
      }
      if (typeof apiErr?.statusCode === 'number' && apiErr.statusCode >= 400 && apiErr.statusCode < 500) {
        throw new PaymentProviderError(
          'Invalid payment information. Please check your card details.',
          'INVALID_REQUEST',
          detail,
        );
      }
      throw new PaymentProviderError(
        'Refund could not be processed.',
        'REFUND_FAILED',
        detail,
      );
    }
  }

  async saveCardOnFile(
    sourceId: string,
    customerId: string,
  ): Promise<SavedCard | null> {
    const client = await this.getSquareClient();
    if (!client) {
      // Throw the structured "not configured" error so the
      // POST /cards/:bowlerId route surfaces 422
      // PROVIDER_NOT_CONFIGURED. The opportunistic save-card
      // call inside POST /payments wraps this in a try/catch
      // that just logs, so it stays non-fatal there. Task #332.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }

    try {
      if (isDev) log.info('Saving card on file for customer:', customerId.substring(0, 10) + '...');
      const response = await client.cards.create({
        // Use the centralised builder so we can never silently
        // re-introduce the >45-char idempotency_key bug that broke
        // every save-card call after the v40 SDK migration (task
        // #671). The format is deterministic per (sourceId, customerId)
        // so post-deploy retries still dedupe inside Square's window.
        idempotencyKey: buildSquareIdempotencyKey('lv-card', sourceId, customerId),
        sourceId,
        card: {
          customerId,
        },
      });

      const card = response.card;
      if (card?.id) {
        return { id: card.id, last4: card.last4 ?? '', brand: card.cardBrand ?? '' };
      }
      return null;
    } catch (error) {
      log.error('Failed to save card on file:', error instanceof Error ? error.message : error);
      // Re-throw as a typed PaymentProviderError so the standalone
      // POST /api/cards/:bowlerId route surfaces a real `userMessage`
      // / `code` via buildPaymentErrorResponse instead of the generic
      // "Failed to save card on file" 500 (task #671). The opportunistic
      // save-card call inside POST /payments wraps the throw in its own
      // try/catch (charges.ts ~309) so it stays non-fatal there — the
      // payment still completes; we just don't get a saved card.
      if (
        error instanceof PaymentProviderError ||
        error instanceof ProviderNotConfiguredError
      ) {
        throw error;
      }
      const apiErr = error instanceof getSquareErrorCtor() ? error : null;
      const detail = apiErr?.errors?.[0]?.detail;
      if (apiErr?.statusCode === 400) {
        throw new PaymentProviderError(
          'Invalid payment information. Please check your card details and try again.',
          'INVALID_REQUEST',
          detail,
        );
      }
      if (apiErr?.statusCode === 401) {
        throw new PaymentProviderError(
          'Payment system is temporarily unavailable. Please try again later.',
          'SYSTEM_ERROR',
          detail,
        );
      }
      throw new PaymentProviderError(
        'Could not save card on file. Please try again.',
        'SAVE_CARD_FAILED',
        detail,
      );
    }
  }

  async listCardsOnFile(
    customerId: string,
  ): Promise<SavedCard[]> {
    const client = await this.getSquareClient();
    if (!client) {
      // Intentionally degraded: GET /cards/:bowlerId is a read
      // path that already treats "no provider configured" as
      // "no saved cards" and returns []. Throwing here would
      // turn a benign empty list into a 500 in the route's
      // outer catch. Task #332 — kept silent on purpose.
      return [];
    }

    try {
      // v40+ flat-client `cards.list` returns a Page<Card>. We're only
      // interested in the first page (Square caps the response at 25
      // cards per the API docs, which is well below any single bowler's
      // realistic saved-card count).
      const page = await client.cards.list({ customerId });
      const cards = page.data ?? [];
      return cards
        .filter(c => c.enabled)
        .map(c => ({
          id: c.id!,
          last4: c.last4 || '****',
          brand: c.cardBrand || 'UNKNOWN',
          expMonth: Number(c.expMonth) || 0,
          expYear: Number(c.expYear) || 0,
        }));
    } catch (error) {
      log.error('Failed to list cards on file:', error instanceof Error ? error.message : error);
      return [];
    }
  }

  async disableCard(
    cardId: string,
    customerId: string,
  ): Promise<void> {
    const client = await this.getSquareClient();
    if (!client) {
      // DELETE /cards/:bowlerId/:cardId maps PNCE → 422
      // PROVIDER_NOT_CONFIGURED. Task #332.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }

    const listPage = await client.cards.list({ customerId });
    const cards = listPage.data ?? [];
    const cardBelongsToCustomer = cards.some(c => c.id === cardId);
    if (!cardBelongsToCustomer) {
      // Typed tenancy-violation error (task #620). The DELETE card
      // route matches this on `instanceof` to map to 403 — see
      // server/routes/payments-provider/cards.ts. Pre-#620 this was a
      // plain `new Error(...)` and the route picked it out via
      // `error.constructor === Error` + a substring check on the
      // message, which would have mapped any other plain Error
      // bubbling out of the provider chain into the same 403.
      throw new CardOwnershipMismatchError();
    }

    await client.cards.disable({ cardId });
  }

  async createOrUpdateCustomer(
    name: string,
    email: string,
    phone?: string | null,
    // Optional `bowler:<id>` reference (task #429). When provided we
    // pass it through as Square's `referenceId` so the seller can see
    // the LeagueVault bowler id directly in the Square dashboard.
    referenceId?: string | null,
  ): Promise<PaymentCustomer | null> {
    const client = await this.getSquareClient();
    if (!client) {
      // POST /customers, the bowler-update sync, the bowler-create
      // sync, and the user-update sync all already catch
      // ProviderNotConfiguredError — the route maps it to 422 and
      // the background syncs log it and continue. Returning null
      // here used to leak as a generic 500 from the customers
      // route. Task #332.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }

    try {
      if (isDev) log.info('Searching for customer with email:', email);
      const searchResponse = await client.customers.search({
        query: {
          filter: {
            emailAddress: {
              exact: email.toLowerCase()
            }
          }
        }
      });

      // v40+ flat-client returns the response body directly (no
      // `.result` wrapper). An undefined response means a transport-
      // level oddity rather than a Square-rejected request — surface
      // it so the catch below maps it to our generic error.
      if (!searchResponse) {
        throw new Error('API Error: Invalid search response');
      }

      let customerId: string;
      const [firstName, ...lastNameParts] = name.split(' ');
      const lastName = lastNameParts.join(' ');
      const phoneNumber = phone || undefined;
      // Only include referenceId in the payload when a non-empty value
      // was supplied. Sending `referenceId: undefined` is a no-op, but
      // sending `null` would CLEAR an existing reference on the Square
      // side — which we never want from this code path.
      const referenceIdField =
        referenceId && referenceId.trim().length > 0
          ? { referenceId: referenceId.trim() }
          : {};

      if (searchResponse.customers?.[0]?.id) {
        if (isDev) log.info('Found existing customer, updating...');
        customerId = searchResponse.customers[0].id;
        // v40+ folds the customerId into the request body itself.
        const updateResponse = await client.customers.update({
          customerId,
          givenName: firstName,
          familyName: lastName || '',
          emailAddress: email.toLowerCase(),
          ...(phoneNumber && { phoneNumber }),
          ...referenceIdField,
        });

        if (!updateResponse?.customer) {
          throw new Error('API Error: Invalid update response');
        }

        if (isDev) log.info('Customer updated successfully:', updateResponse.customer.id);
      } else {
        if (isDev) log.info('No existing customer found, creating new...');
        const customerResponse = await client.customers.create({
          // Same centralised builder as saveCardOnFile (task #671):
          // Square's customers.create endpoint shares the 45-char cap,
          // and the original 40-char SHA-256 slice was equally fragile
          // to a refactor silently dropping the truncation.
          idempotencyKey: buildSquareIdempotencyKey('lv-cust', email.toLowerCase(), name),
          givenName: firstName,
          familyName: lastName || '',
          emailAddress: email.toLowerCase(),
          ...(phoneNumber && { phoneNumber }),
          ...referenceIdField,
        });

        if (!customerResponse?.customer?.id) {
          throw new Error('API Error: Invalid create response');
        }

        customerId = customerResponse.customer.id;
        if (isDev) log.info('New customer created successfully:', customerId);
      }

      return {
        id: customerId,
        name,
        email
      };
    } catch (error) {
      log.error('Customer operation error:', {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack
        } : error,
        input: { name, email }
      });
      throw new Error('Failed to create/update Square customer: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  // Per-Square-seller bootstrap cache for the league_name/league_season
  // custom attribute definitions (task #429). Keyed by locationId
  // because that's the unit our credentials are addressed by, even
  // though definitions are seller-scoped on Square's side. In the
  // multi-location-same-seller case we may issue a couple of redundant
  // "already exists" requests on first hits — those return fast and
  // are treated as success by `ensureDefinitions`.
  //
  // We deliberately only cache a TRUE result. A false (failure) flips
  // the cache to absent so the next call retries — otherwise a brief
  // Square outage during cold-start would poison the cache for the
  // life of the process.
  private static readonly definitionsBootstrapped = new Map<number, true>();

  /**
   * Test-only: clear the per-process bootstrap cache so unit tests
   * can verify the lazy-bootstrap path runs again.
   */
  static __clearDefinitionsBootstrapCacheForTests(): void {
    SquarePaymentProvider.definitionsBootstrapped.clear();
  }

  private async ensureDefinitionsOnce(client: SquareClient): Promise<boolean> {
    if (SquarePaymentProvider.definitionsBootstrapped.get(this.locationId)) {
      return true;
    }
    const ok = await ensureDefinitions(client);
    if (ok) {
      SquarePaymentProvider.definitionsBootstrapped.set(this.locationId, true);
    }
    return ok;
  }

  /**
   * Public bootstrap entry point used by the startup pass in
   * `server/index.ts`. Pre-creates the league_name + league_season
   * custom-attribute definitions on this seller account so the very
   * first customer-attr write of the process is fast (and so the
   * definitions exist even before any bowler has been synced this
   * boot). NON-FATAL: any failure leaves the cache empty so the lazy
   * path retries on next use.
   */
  async ensureCustomAttributeDefinitions(): Promise<boolean> {
    let client: SquareClient | null;
    try {
      client = await this.getSquareClient();
    } catch {
      return false;
    }
    if (!client) return false;
    return this.ensureDefinitionsOnce(client);
  }

  /**
   * Pushes the bowler's current league_name + league_season strings to
   * the customer's Square profile (task #429). NON-FATAL by contract —
   * see `Failure semantics` below — the customer record itself is
   * always considered the primary write and must never be rolled back
   * because of an attribute upsert failure.
   *
   * Failure semantics:
   *   - "Definition does not exist yet" → bootstrap once, retry once.
   *     If bootstrap *itself* failed, leave the cache empty so the
   *     next call retries.
   *   - Hard upsert failure → log + return ok:false so the caller can
   *     flip `bowlers.payment_sync_pending_at`. The retry sweep picks
   *     it up on the next tick.
   *   - Provider not configured → return ok:true and skip silently.
   *     There is no Square customer to update on this location, so
   *     there is nothing to retry.
   *
   * Empty strings ARE written: that's how we tell Square "this bowler
   * is no longer in any leagues" rather than leaving a stale value
   * from a previous sync.
   */
  async syncCustomerLeagueAttributes(
    customerId: string,
    bowlerId: number,
    attributes: { leagueName: string; leagueSeason: string },
  ): Promise<{ ok: boolean }> {
    let client: SquareClient | null;
    try {
      client = await this.getSquareClient();
    } catch (err) {
      log.warn('Custom-attr sync: failed to get Square client', {
        locationId: this.locationId,
        error: err instanceof Error ? { name: err.name, message: err.message } : err,
      });
      return { ok: false };
    }
    if (!client) {
      // Same convention as the rest of the provider: missing creds
      // means "skip silently", not "fail loudly". The caller already
      // gated on Square being configured for this location.
      return { ok: true };
    }

    // Lazy bootstrap. The first call per cold-start per Square seller
    // pays the cost of two definition-create round trips; everything
    // after that is in-memory cached.
    let bootstrapped = await this.ensureDefinitionsOnce(client);

    const writeBoth = async (): Promise<{
      ok: boolean;
      definitionMissing: boolean;
      missingKeys: string[];
    }> => {
      const nameRes = await upsertCustomerStringAttribute(
        client!,
        customerId,
        LEAGUE_NAME_KEY,
        attributes.leagueName,
        bowlerId,
      );
      const seasonRes = await upsertCustomerStringAttribute(
        client!,
        customerId,
        LEAGUE_SEASON_KEY,
        attributes.leagueSeason,
        bowlerId,
      );
      const ok = nameRes.ok && seasonRes.ok;
      const missingKeys: string[] = [];
      if (!nameRes.ok && nameRes.reason === 'definition_missing') missingKeys.push(LEAGUE_NAME_KEY);
      if (!seasonRes.ok && seasonRes.reason === 'definition_missing') missingKeys.push(LEAGUE_SEASON_KEY);
      return { ok, definitionMissing: missingKeys.length > 0, missingKeys };
    };

    let result = await writeBoth();
    // Force one bootstrap + single retry when EITHER:
    //   (a) we never successfully bootstrapped this process (cold-
    //       start failure), OR
    //   (b) the cache says we DID bootstrap but Square still rejected
    //       the upsert with definition-missing — meaning the
    //       definition was deleted out-of-band (e.g. a seller manually
    //       removed it from their Square dashboard, or another app on
    //       the same seller account did so via the API). Bust the
    //       cache so the next call also re-bootstraps.
    if (!result.ok && (!bootstrapped || result.definitionMissing)) {
      if (result.definitionMissing && bootstrapped) {
        log.warn('Custom-attr sync: definition missing despite cached bootstrap; busting cache', {
          bowlerId,
          customerId,
          locationId: this.locationId,
        });
        SquarePaymentProvider.definitionsBootstrapped.delete(this.locationId);
      }
      log.info('Custom-attr sync: retrying after forced bootstrap', { bowlerId, customerId });
      bootstrapped = await ensureDefinitions(client);
      if (bootstrapped) {
        SquarePaymentProvider.definitionsBootstrapped.set(this.locationId, true);
        result = await writeBoth();
      }
    }

    // Last-ditch self-heal: if the upsert STILL reports definition_missing
    // after we successfully re-bootstrapped, the only consistent
    // explanation is a stale/broken definition on the seller account
    // (e.g. a definition created by a previous deploy with the now-
    // rejected `developer.squareup.com/...` schema URI). Square keeps
    // the orphan record by name, so `create` returns "already exists"
    // and bootstrap reports success — but `upsert` against the broken
    // record fails with "No matching definition found for value".
    //
    // We delete and recreate the offending key(s) by spec, then retry
    // once. This is bounded (at most one repair pass per call) and
    // gated on `definitionMissing` so a vanilla transient upsert
    // failure doesn't trigger destructive seller-side writes.
    if (!result.ok && result.definitionMissing) {
      log.warn('Custom-attr sync: definition still missing after re-bootstrap; running repair', {
        bowlerId,
        customerId,
        locationId: this.locationId,
        keys: result.missingKeys,
      });
      let anyRepaired = false;
      for (const key of result.missingKeys) {
        const repaired = await repairDefinition(client, key);
        anyRepaired = anyRepaired || repaired;
      }
      // Bust the per-process cache regardless — even on partial repair
      // we want the next call to take the full ensureDefinitions path.
      SquarePaymentProvider.definitionsBootstrapped.delete(this.locationId);
      if (anyRepaired) {
        SquarePaymentProvider.definitionsBootstrapped.set(this.locationId, true);
        result = await writeBoth();
      }
    }

    if (!result.ok) {
      log.warn('Custom-attr sync: leaving bowler flagged for retry', {
        bowlerId,
        customerId,
        locationId: this.locationId,
      });
    }
    return { ok: result.ok };
  }

  /**
   * Operator-initiated repair: delete and recreate the seller-scoped
   * customer custom-attribute definitions for this location's Square
   * account. Used by `scripts/repair-square-customer-attr-definitions.ts`
   * to unstick the "stale broken definition" state described in
   * `syncCustomerLeagueAttributes`.
   *
   * Returns a per-key success map. Caller is responsible for any
   * downstream bowler unsticking (resetting `payment_sync_attempts`
   * so the retry sweep picks them up).
   */
  async repairCustomerAttributeDefinitions(): Promise<Record<string, boolean>> {
    const client = await this.getSquareClient();
    if (!client) {
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }
    const result = await repairAllDefinitions(client);
    // Bust the per-process bootstrap cache so the next sync call
    // re-runs ensureDefinitions against the freshly recreated state.
    SquarePaymentProvider.definitionsBootstrapped.delete(this.locationId);
    return result;
  }

  /**
   * Delete a Square customer record. Used by the automated account-data
   * deletion flow. Square responds with NOT_FOUND for unknown customers;
   * we swallow that to keep this idempotent.
   */
  async deleteCustomer(customerId: string): Promise<void> {
    const client = await this.getSquareClient();
    if (!client) {
      // Account-deletion explicitly catches PNCE and records
      // `error: '<message>'` on the per-target audit summary so
      // operators can see "Square wasn't connected for that
      // location" rather than a vague provider failure.
      // Task #332.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }
    try {
      await client.customers.delete({ customerId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (/NOT_FOUND|not found/i.test(msg)) {
        if (isDev) log.info('Square customer already absent, treating as deleted', { customerId });
        return;
      }
      throw error;
    }
  }

  async getPayment(
    paymentId: string,
  ): Promise<PaymentVerification | null> {
    const client = await this.getSquareClient();
    if (!client) {
      // Intentionally degraded: GET /payments/:id/verify is a
      // diagnostic read used by the admin reconciliation UI. It
      // wraps the call in a try/catch that already turns PNCE
      // (from the factory) and any thrown verification error
      // into a "providerPayment: null" response. Returning null
      // here keeps that contract stable. Task #332.
      log.warn('Cannot verify payment — no Square client for location:', this.locationId);
      return null;
    }

    try {
      const response = await client.payments.get({ paymentId });
      const payment = response.payment;
      if (!payment) return null;

      return {
        id: payment.id!,
        status: payment.status || 'UNKNOWN',
        amountMoney: {
          amount: String(payment.amountMoney?.amount ?? 0),
          currency: payment.amountMoney?.currency || 'USD',
        },
        createdAt: payment.createdAt || '',
        updatedAt: payment.updatedAt || '',
        sourceType: payment.sourceType || 'UNKNOWN',
        cardBrand: payment.cardDetails?.card?.cardBrand,
        last4: payment.cardDetails?.card?.last4,
        orderId: payment.orderId,
        // surface receipt fields off GetPayment so the
        // "View receipt" route can lazily backfill an older row.
        receiptUrl: payment.receiptUrl,
        receiptNumber: payment.receiptNumber,
      };
    } catch (error) {
      log.error('Failed to retrieve Square payment:', paymentId, error instanceof Error ? error.message : error);
      return null;
    }
  }

  validateCardId(cardId: string | null): boolean {
    if (!cardId) return false;
    return cardId.startsWith('ccof:');
  }

  /**
   * Fire-and-forget: page support that this tenant just hit the
   * Square catalog pagination safety cap (Task #644). Never thrown:
   * a failure to alert must not turn a degraded-but-working catalog
   * read into a 500. The alerter itself dedupes per-location across
   * a multi-hour window so a chatty admin page can't spam support.
   */
  private fireCatalogCapAlert(
    reason: 'max_items' | 'max_pages',
    context: string,
  ): void {
    void (async () => {
      try {
        const loc = await storage.getLocation(this.locationId);
        const organizationId = loc?.organizationId ?? null;
        const result = await squareCatalogCapAlerter.notifyCapHit({
          organizationId,
          locationId: this.locationId,
          reason,
          context,
        });
        if (result === 'failed') {
          log.warn('Square catalog cap alert send returned failed', {
            locationId: this.locationId,
            organizationId,
            reason,
            context,
          });
        }
      } catch (err) {
        log.error('Square catalog cap alert dispatch threw', {
          locationId: this.locationId,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  }

  async listCatalogCategories(): Promise<{ categories: CatalogCategory[]; truncated: boolean }> {
    const client = await this.getSquareClient();
    if (!client) {
      // Intentionally degraded: GET /catalog/categories already
      // converts a factory-level PNCE into an empty list (the
      // admin UI shows a "no catalog yet" empty state in that
      // case). Throwing here would turn that into a 500 inside
      // the route's outer catch. Task #332.
      return { categories: [], truncated: false };
    }

    try {
      // v40+ flat-client `catalog.list` returns a Page<CatalogObject>;
      // we walk the cursor through the shared `paginateCatalogObjects`
      // helper so the safety cap (Task #613) applies here too even
      // though categories rarely approach it.
      const { objects: allObjects, truncated, truncationReason } = await paginateCatalogObjects(
        async (cursor) => {
          const page = await client.catalog.list({ cursor, types: 'CATEGORY' });
          return {
            objects: page.data ?? [],
            nextCursor: page.response?.cursor || undefined,
          };
        },
        'listCatalogCategories',
      );
      if (truncated && truncationReason) {
        this.fireCatalogCapAlert(truncationReason, 'listCatalogCategories');
      }

      // v40+ CatalogObject is a discriminated union via `type`. Narrow
      // to the CATEGORY variant so `categoryData` is reachable, and
      // drop any object missing an id (now `string | undefined` on the
      // SDK side — in practice always present for persisted objects).
      const seen = new Set<string>();
      const deduped = allObjects
        .filter((cat): cat is CatalogObject & { type: 'CATEGORY' } => cat.type === 'CATEGORY')
        .filter((cat) => !cat.isDeleted && cat.id)
        .map((cat) => ({
          id: cat.id ?? '',
          name: cat.categoryData?.name || 'Unnamed Category',
        }))
        .filter((cat) => {
          const key = cat.name.toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      if (isDev) log.info(`Categories: ${allObjects.length} raw -> ${deduped.length} deduped`);
      return { categories: deduped, truncated };
    } catch (error) {
      log.error('Catalog categories error:', error);
      throw new Error('Failed to fetch catalog categories: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  async listCatalogItems(categoryId?: string): Promise<{ items: CatalogItem[]; truncated: boolean }> {
    const client = await this.getSquareClient();
    if (!client) {
      // Intentionally degraded: same contract as
      // listCatalogCategories above. Task #332.
      return { items: [], truncated: false };
    }

    try {
      // The mapper is identical for both branches (search-by-category
      // and the unscoped list). Pulled out so the discriminated-union
      // narrowing on `type === 'ITEM'` lives in one place, and so a
      // future tweak to the consumer-facing CatalogItem shape only has
      // to be made once.
      type ItemObject = CatalogObject & { type: 'ITEM' };
      type VariationObject = CatalogObject & { type: 'ITEM_VARIATION' };
      const isItemObject = (obj: CatalogObject): obj is ItemObject => obj.type === 'ITEM';
      const isVariationObject = (obj: CatalogObject): obj is VariationObject =>
        obj.type === 'ITEM_VARIATION';
      const toCatalogItem = (item: ItemObject): CatalogItem => {
        // CatalogItem.variations is itself a CatalogObject[] (the
        // discriminated wrapper, not CatalogItemVariation directly), so
        // narrow each entry to the ITEM_VARIATION variant before reading
        // `itemVariationData`.
        const variations = (item.itemData?.variations ?? [])
          .filter(isVariationObject)
          .map((v) => ({
            id: v.id ?? '',
            name: v.itemVariationData?.name || 'Default',
            price: v.itemVariationData?.priceMoney?.amount
              ? Number(v.itemVariationData.priceMoney.amount)
              : null,
            currency: v.itemVariationData?.priceMoney?.currency || 'USD',
          }));

        return {
          id: item.id ?? '',
          name: item.itemData?.name || 'Unnamed Item',
          description: item.itemData?.description || '',
          variations,
        };
      };

      // Both branches paginate via Square's `cursor` until the response
      // stops returning one (Task #613). Pre-#613, both branches read
      // only the first page, so any organization whose Square catalog
      // grew past Square's default page size silently lost items in
      // the admin UI with no signal. The shared `paginateCatalogObjects`
      // helper enforces a safety cap (5,000 items / 20 pages) and
      // logs a `warn` if hit so a runaway loop can't masquerade as a
      // huge catalog.
      if (categoryId) {
        // SearchCatalogItemsResponse exposes `cursor` directly on the
        // response body (no Page<> wrapper here, unlike `catalog.list`).
        const { objects: allItems, truncated, truncationReason } = await paginateCatalogObjects(
          async (cursor) => {
            const response = await client.catalog.searchItems({
              categoryIds: [categoryId],
              cursor,
            });
            return {
              objects: response.items ?? [],
              nextCursor: response.cursor || undefined,
            };
          },
          `listCatalogItems(categoryId=${categoryId})`,
        );
        if (truncated && truncationReason) {
          this.fireCatalogCapAlert(
            truncationReason,
            `listCatalogItems(categoryId=${categoryId})`,
          );
        }
        // `searchItems` returns CatalogObject[] in v40+; narrow to the
        // ITEM variant so `itemData` is reachable on the union.
        return {
          items: allItems.filter(isItemObject).map(toCatalogItem),
          truncated,
        };
      }

      const { objects: allObjects, truncated, truncationReason } = await paginateCatalogObjects(
        async (cursor) => {
          const page = await client.catalog.list({ cursor, types: 'ITEM' });
          return {
            objects: page.data ?? [],
            nextCursor: page.response?.cursor || undefined,
          };
        },
        'listCatalogItems',
      );
      if (truncated && truncationReason) {
        this.fireCatalogCapAlert(truncationReason, 'listCatalogItems');
      }
      return {
        items: allObjects.filter(isItemObject).map(toCatalogItem),
        truncated,
      };
    } catch (error) {
      log.error('Catalog list error:', error);
      throw new Error('Failed to fetch catalog items: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  async registerApplePayDomain(domain: string): Promise<{ success: boolean; message: string }> {
    const client = await this.getSquareClient();
    if (!client) {
      // Throw the structured "not configured" error so callers (the
      // sync register-domain route, the async Apple Pay worker, and
      // the org auto-registration helper) can distinguish "the
      // provider isn't set up at all" from "Square accepted the
      // request and rejected the domain". The route maps this to 422
      // PROVIDER_NOT_CONFIGURED; the worker/helper already log it.
      throw new ProviderNotConfiguredError(
        'Square client not configured for this location',
        this.locationId,
      );
    }

    try {
      await client.applePay.registerDomain({ domainName: domain });
      log.info(`Apple Pay domain registered: ${domain}`);
      return { success: true, message: `Domain ${domain} registered for Apple Pay` };
    } catch (error) {
      // v40+ flat-client SDK exposes structured errors directly on the
      // SquareError instance — no `.result` wrapper. We read the first
      // `detail` for the operator-facing message.
      const detail =
        error instanceof getSquareErrorCtor() ? error.errors?.[0]?.detail : undefined;
      log.error('Apple Pay domain registration error:', detail || error);
      return { success: false, message: detail || 'Failed to register domain for Apple Pay' };
    }
  }
}
