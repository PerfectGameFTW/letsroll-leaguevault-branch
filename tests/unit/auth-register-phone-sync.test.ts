/**
 * Task #677: confirms that POST /api/auth/register, after linking a
 * freshly self-registered user to an existing bowler row, copies the
 * user's phone onto the bowler ("user wins") and fires the external
 * resync exactly when an actual write happened.
 *
 * Two scenarios are covered:
 *   1. bowler.phone is null + user.phone is set →
 *        syncUserPhoneToBowler returns 'updated' →
 *        fireBowlerExternalResync is called.
 *   2. bowler.phone already matches user.phone (e.g. admin keyed it
 *      in earlier) →
 *        syncUserPhoneToBowler returns 'skipped_already_matching' →
 *        fireBowlerExternalResync is NOT called.
 *
 * Strategy mirrors `tests/unit/auth-no-token-leak.test.ts`: mount the
 * real `registerAuthRoutes` on a tiny express app with every
 * external dep mocked.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

vi.mock('../../server/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockGetUserByEmail = vi.fn<(email: string) => Promise<unknown>>();
const mockCreateUser = vi.fn<(data: unknown) => Promise<unknown>>();
const mockGetBowlerByEmail = vi.fn<(email: string, orgId: number) => Promise<unknown>>();
const mockGetBowlerByEmailSystemAdmin = vi.fn<(email: string) => Promise<unknown>>();
const mockIsBowlerLinked = vi.fn<(id: number) => Promise<boolean>>();
const mockLinkUserToBowler = vi.fn<(userId: number, bowlerId: number) => Promise<undefined>>(
  async () => undefined,
);
const mockGetBowlerLeagues = vi.fn<(filter: unknown) => Promise<unknown[]>>(async () => []);
const mockGetBowler = vi.fn<(id: number) => Promise<unknown>>();
const mockUpdateBowler = vi.fn<(id: number, patch: unknown) => Promise<unknown>>();
const mockGetUser = vi.fn<(id: number) => Promise<unknown>>();
const mockGetOrganization = vi.fn<(id: number) => Promise<unknown>>(async () => null);

vi.mock('../../server/storage', () => ({
  storage: {
    getUserByEmail: (email: string) => mockGetUserByEmail(email),
    createUser: (data: unknown) => mockCreateUser(data),
    getBowlerByEmail: (email: string, orgId: number) => mockGetBowlerByEmail(email, orgId),
    getBowlerByEmailSystemAdmin: (email: string) => mockGetBowlerByEmailSystemAdmin(email),
    isBowlerLinked: (id: number) => mockIsBowlerLinked(id),
    linkUserToBowler: (userId: number, bowlerId: number) =>
      mockLinkUserToBowler(userId, bowlerId),
    getBowlerLeagues: (filter: unknown) => mockGetBowlerLeagues(filter),
    getBowler: (id: number) => mockGetBowler(id),
    updateBowler: (id: number, patch: unknown) => mockUpdateBowler(id, patch),
    getUser: (id: number) => mockGetUser(id),
    getOrganization: (id: number) => mockGetOrganization(id),
    setUserOrganization: vi.fn(async () => undefined),
    getLeague: vi.fn(async () => null),
    updateUser: vi.fn(async () => undefined),
    clearUserInviteToken: vi.fn(async () => undefined),
    invalidatePendingEmailChangeRequestsForUser: vi.fn(async () => 0),
    setUserInviteToken: vi.fn(async () => undefined),
    getUserByInviteToken: vi.fn(async () => null),
  },
}));

vi.mock('../../server/services/email', () => ({
  sendTemplatedEmail: vi.fn(async () => true),
  sendPasswordChangedNotification: vi.fn(async () => true),
  getBaseUrl: () => 'https://test.example',
  getOrgLogoUrl: () => '',
  sendPasswordResetFallbackEmail: vi.fn(async () => true),
}));

vi.mock('../../server/services/email.js', () => ({
  sendTemplatedEmail: vi.fn(async () => true),
  sendPasswordChangedNotification: vi.fn(async () => true),
  getBaseUrl: () => 'https://test.example',
  getOrgLogoUrl: () => '',
  sendPasswordResetFallbackEmail: vi.fn(async () => true),
}));

const mockFireBowlerExternalResync = vi.fn();
vi.mock('../../server/services/bowler-resync', () => ({
  fireBowlerExternalResync: (bowlerId: number, orgId: number | null | undefined) =>
    mockFireBowlerExternalResync(bowlerId, orgId),
  runBowlerExternalResync: vi.fn(async () => undefined),
}));
vi.mock('../../server/services/bowler-resync.js', () => ({
  fireBowlerExternalResync: (bowlerId: number, orgId: number | null | undefined) =>
    mockFireBowlerExternalResync(bowlerId, orgId),
  runBowlerExternalResync: vi.fn(async () => undefined),
}));

vi.mock('../../server/auth', () => ({
  destroyOtherSessionsForUser: vi.fn(async () => 0),
  hashPassword: vi.fn(async (pw: string) => `hashed:${pw}`),
  safeTokenCompare: () => true,
}));

vi.mock('../../server/lib/password', () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed:${pw}`),
  safeTokenCompare: () => true,
}));

vi.mock('../../server/middleware/subdomain', () => ({
  checkUserBelongsToOrg: vi.fn(async () => true),
}));

vi.mock('../../server/middleware/csrf', () => ({
  csrfProtection: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('express-rate-limit', () => ({
  default: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  ipKeyGenerator: (ip: string) => ip,
}));

vi.mock('passport', () => ({
  default: {
    authenticate: (..._args: unknown[]) =>
      (_req: Request, _res: Response, _next: NextFunction) => {
        /* unused in these tests */
      },
    initialize: () => (_req: Request, _res: Response, next: NextFunction) => next(),
    session: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  },
}));

vi.mock('../../server/utils/rate-limit-store', () => ({
  createSharedRateLimitStore: () => undefined,
}));

vi.mock('../../server/config', () => ({
  isDev: true,
  env: {},
}));

const { registerAuthRoutes } = await import('../../server/routes/auth');

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      session: {},
      login: (_u: unknown, cb: (e: unknown) => void) => cb(null),
    });
    Object.defineProperty(req, 'ip', { value: '198.51.100.1', configurable: true });
    next();
  });
  registerAuthRoutes(app);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
});

const REG_BODY_BASE = {
  email: 'newbie@example.com',
  password: 'CorrectHorseBatteryStaple-2026!',
  name: 'New Bie',
  organizationId: '5',
};

describe('POST /api/auth/register — phone sync to linked bowler', () => {
  it('overwrites a null bowler.phone with the registering user phone and fires resync', async () => {
    mockGetUserByEmail.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({
      id: 99,
      email: REG_BODY_BASE.email,
      name: REG_BODY_BASE.name,
      phone: '5559876',
      role: 'user',
      organizationId: 5,
    });
    mockGetBowlerByEmail.mockResolvedValue({
      id: 42,
      email: REG_BODY_BASE.email,
      name: 'Existing Bowler',
      phone: null,
      organizationId: 5,
    });
    mockIsBowlerLinked.mockResolvedValue(false);
    // syncUserPhoneToBowler reads user + bowler, then calls updateBowler.
    mockGetUser.mockResolvedValue({ id: 99, phone: '5559876' });
    mockGetBowler.mockResolvedValue({
      id: 42,
      phone: null,
      organizationId: 5,
    });
    mockUpdateBowler.mockResolvedValue({
      id: 42,
      phone: '5559876',
      organizationId: 5,
    });

    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...REG_BODY_BASE, phone: '5559876' }),
    });
    expect(res.status).toBe(201);
    expect(mockLinkUserToBowler).toHaveBeenCalledWith(99, 42);
    expect(mockUpdateBowler).toHaveBeenCalledWith(42, { phone: '5559876' });
    expect(mockFireBowlerExternalResync).toHaveBeenCalledWith(42, 5);
  });

  it('does NOT write or fire resync when bowler.phone already matches', async () => {
    mockGetUserByEmail.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({
      id: 100,
      email: REG_BODY_BASE.email,
      name: REG_BODY_BASE.name,
      phone: '5551111',
      role: 'user',
      organizationId: 5,
    });
    mockGetBowlerByEmail.mockResolvedValue({
      id: 43,
      email: REG_BODY_BASE.email,
      name: 'Existing Bowler',
      phone: '5551111',
      organizationId: 5,
    });
    mockIsBowlerLinked.mockResolvedValue(false);
    mockGetUser.mockResolvedValue({ id: 100, phone: '5551111' });
    mockGetBowler.mockResolvedValue({
      id: 43,
      phone: '5551111',
      organizationId: 5,
    });

    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...REG_BODY_BASE, phone: '5551111' }),
    });
    expect(res.status).toBe(201);
    expect(mockLinkUserToBowler).toHaveBeenCalledWith(100, 43);
    expect(mockUpdateBowler).not.toHaveBeenCalled();
    expect(mockFireBowlerExternalResync).not.toHaveBeenCalled();
  });

  it('does NOT fire resync when the registering user has no phone', async () => {
    mockGetUserByEmail.mockResolvedValue(null);
    mockCreateUser.mockResolvedValue({
      id: 101,
      email: REG_BODY_BASE.email,
      name: REG_BODY_BASE.name,
      phone: null,
      role: 'user',
      organizationId: 5,
    });
    mockGetBowlerByEmail.mockResolvedValue({
      id: 44,
      email: REG_BODY_BASE.email,
      name: 'Existing Bowler',
      phone: null,
      organizationId: 5,
    });
    mockIsBowlerLinked.mockResolvedValue(false);
    mockGetUser.mockResolvedValue({ id: 101, phone: null });
    mockGetBowler.mockResolvedValue({ id: 44, phone: null, organizationId: 5 });

    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...REG_BODY_BASE, phone: undefined }),
    });
    expect(res.status).toBe(201);
    expect(mockLinkUserToBowler).toHaveBeenCalledWith(101, 44);
    expect(mockUpdateBowler).not.toHaveBeenCalled();
    expect(mockFireBowlerExternalResync).not.toHaveBeenCalled();
  });
});
