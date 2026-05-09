/**
 * Task #332 contract pin (mocked-route variant).
 *
 * The previous end-to-end test for this contract spun up the real
 * test database, seeded a location/league/team and then exercised
 * `POST /api/payments-provider/customers` so the unconfigured Square
 * provider would throw `ProviderNotConfiguredError` (PNCE) and the
 * route would map it to `422 PROVIDER_NOT_CONFIGURED`. The whole
 * fixture chain just to provoke a single thrown PNCE was overkill,
 * required the file to live in the serial `serial-fk-bypass` vitest
 * project, and slowed the suite down for no extra coverage.
 *
 * This rewrite mounts the real `customers` router on a tiny Express
 * app, mocks `getProviderForLeague` so it directly throws PNCE, and
 * asserts the same 422 + `error.code === 'PROVIDER_NOT_CONFIGURED'`
 * envelope. The only thing the original test actually pinned was the
 * route's catch branch wiring — which is exactly what this version
 * exercises, without any DB writes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const mockStorage = {
  getTeam: vi.fn(),
  getLeague: vi.fn(),
};
vi.mock('../../server/storage', () => ({ storage: mockStorage }));

const mockGetProviderForLeague = vi.fn();
vi.mock('../../server/routes/payments-provider/shared', () => ({
  getProviderForLeague: (...a: unknown[]) => mockGetProviderForLeague(...a),
}));

vi.mock('../../server/middleware/rate-limit.js', () => ({
  paymentLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// eslint-disable-next-line local/factory-must-use-schema -- mocked logger, not a schema row
const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
vi.mock('../../server/logger', () => ({ logger: fakeLogger, createLogger: () => fakeLogger }));

vi.mock('../../server/services/payment-provider-factory', async () => {
  const actual = await vi.importActual<
    typeof import('../../server/services/payment-provider-factory')
  >('../../server/services/payment-provider-factory');
  return {
    ...actual,
    getPaymentProvider: vi.fn(),
  };
});

const customersRouter = (await import('../../server/routes/payments-provider/customers')).default;
const { ProviderNotConfiguredError } = await import(
  '../../server/services/payment-provider-factory'
);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Stand in for passport — the route uses req.user.organizationId
  // for the access check; pretend we're a same-org caller.
  app.use((req, _res, next) => {
    // The route only reads `req.user.organizationId` for the
    // same-org access check, so a partial shape is sufficient. The
    // real `User` type carries 16+ fields (name, email, password,
    // etc.) we have no use for here. Assigning through a typed
    // record keeps the codebase's `no-restricted-syntax` rule (no
    // `as unknown as Foo`) happy.
    Object.assign(req, {
      user: { id: 1, role: 'org_admin', organizationId: 42 },
    });
    next();
  });
  app.use('/api/payments-provider', customersRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe('POST /api/payments-provider/customers — 422 PROVIDER_NOT_CONFIGURED contract (task #332)', () => {
  it('maps a PNCE thrown by the provider to 422 PROVIDER_NOT_CONFIGURED', async () => {
    mockStorage.getTeam.mockResolvedValue({ id: 7, leagueId: 99 });
    mockStorage.getLeague.mockResolvedValue({ id: 99, organizationId: 42, locationId: 5 });
    mockGetProviderForLeague.mockRejectedValue(
      new ProviderNotConfiguredError('Square is not configured for location 5', 5),
    );

    const res = await fetch(`${baseUrl}/api/payments-provider/customers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: 7, name: 'Test Customer', email: 'pnce@example.com' }),
    });
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.success).toBe(false);
    expect(body.error?.code).toBe('PROVIDER_NOT_CONFIGURED');
  });
});
