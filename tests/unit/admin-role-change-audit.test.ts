/**
 * Route-level unit test for the admin-driven org-admin-status change
 * endpoint (PATCH /api/organization-admin/users/:id/admin-status). Task
 * #459 wires a persistent audit row capturing actor/target/org/old
 * role/new role/ip/UA. This test is the companion of
 * tests/unit/admin-reset-password-notification.test.ts (task #424) and
 * follows the same harness shape: a real router mounted on an isolated
 * express app with all external deps mocked.
 *
 * The audit must:
 *   - run AFTER storage.updateUserRole (so we never log a role change
 *     that didn't happen)
 *   - run BEFORE the success response is sent (so a 200 implies a
 *     queryable audit trail)
 *   - NOT run on validation/auth/authorization/last-admin-guard failures
 *   - bubble its failure to a 500 (fail-closed compliance contract)
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

const ACTING_ORG_ADMIN = {
  id: 1001,
  email: 'org-admin@vitest.local',
  name: 'Acting Org Admin',
  role: 'org_admin' as const,
  organizationId: 42,
};

const TARGET_USER_REGULAR = {
  id: 2002,
  email: 'target@vitest.local',
  name: 'Target User',
  role: 'user' as const,
  organizationId: 42,
  bowlerId: null,
  password: 'hashed:xx',
  preferredLanguage: 'en',
};

const TARGET_USER_ORGADMIN = {
  ...TARGET_USER_REGULAR,
  id: 2003,
  email: 'target-orgadmin@vitest.local',
  role: 'org_admin' as const,
};

const TARGET_USER_SYSADMIN = {
  ...TARGET_USER_REGULAR,
  id: 2004,
  email: 'target-sysadmin@vitest.local',
  role: 'system_admin' as const,
};

const TARGET_USER_CROSS_ORG = {
  ...TARGET_USER_REGULAR,
  id: 2005,
  email: 'target-cross@vitest.local',
  organizationId: 99,
};

// --- Module mocks. Hoisted by vitest. ----------------------------

const mockGetUser = vi.fn();
const mockUpdateUserRole = vi.fn();
const mockCountOrgAdmins = vi.fn(async () => 5);

vi.mock('../../server/storage', () => ({
  storage: {
    getUser: (...a: unknown[]) => mockGetUser.apply(null, a as never),
    updateUserRole: (...a: unknown[]) => mockUpdateUserRole.apply(null, a as never),
    countOrgAdmins: (...a: unknown[]) => mockCountOrgAdmins.apply(null, a as never),
  },
}));

const mockRecordAdminRoleChangeAudit = vi.fn(async () => ({ id: 1 }));

vi.mock('../../server/storage/admin-role-change-audits', () => ({
  recordAdminRoleChangeAudit: (...a: unknown[]) =>
    mockRecordAdminRoleChangeAudit.apply(null, a as never),
}));

// Task #461: the route now wraps the role update + audit insert in
// `db.transaction(...)` so they succeed or fail together. We mock
// `db.transaction` to (a) hand the inner callback a sentinel `tx`
// object so we can assert both writes received the SAME executor and
// (b) re-throw any rejection out of the callback the way drizzle
// would on rollback. Mirrors the harness shape pinned for the
// admin-driven password reset (task #458).
const TX_SENTINEL = { __isMockTx: true } as const;
const mockTransaction = vi.fn(
  async (fn: (tx: typeof TX_SENTINEL) => Promise<unknown>) => fn(TX_SENTINEL),
);

vi.mock('../../server/db', () => ({
  db: {
    transaction: (...a: unknown[]) => mockTransaction.apply(null, a as never),
  },
  pool: {},
}));

// The route file imports recordAdminPasswordResetAudit too; mock it
// so the import doesn't drag the real db client in.
vi.mock('../../server/storage/admin-password-reset-audits', () => ({
  recordAdminPasswordResetAudit: vi.fn(async () => ({ id: 0 })),
}));

// The route file pulls in auth + email helpers for the password-reset
// endpoint; we don't exercise that path here, but the imports must
// resolve, so stub them.
vi.mock('../../server/auth', () => ({
  hashPassword: vi.fn(async (pw: string) => `hashed:${pw}`),
  destroyOtherSessionsForUser: vi.fn(async () => 0),
}));

vi.mock('../../server/services/email', () => ({
  sendPasswordChangedNotification: vi.fn(async () => true),
  sendInviteEmail: vi.fn(async () => true),
  sendTemplatedEmail: vi.fn(async () => true),
  getBaseUrl: () => 'https://test.example',
  getOrgLogoUrl: () => 'https://test.example/logo.png',
}));

// Bypass the per-route rate limiter — rate-limit behavior is covered
// elsewhere; this test only cares about the audit-write wiring.
vi.mock('express-rate-limit', () => ({
  default: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  ipKeyGenerator: (ip: string) => ip,
}));

const orgAdminRouter = (await import('../../server/routes/organization-admin')).default;

// --- Test express app harness. -----------------------------------

let server: Server;
let baseUrl: string;
let actingUser: typeof ACTING_ORG_ADMIN | null = ACTING_ORG_ADMIN;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as {
      user: typeof ACTING_ORG_ADMIN | null;
      isAuthenticated: () => boolean;
      ip: string;
    }).user = actingUser;
    (req as unknown as { isAuthenticated: () => boolean }).isAuthenticated = () =>
      actingUser !== null;
    Object.defineProperty(req, 'ip', { value: '198.51.100.42', configurable: true });
    next();
  });
  app.use('/api/organization-admin', orgAdminRouter);
  await new Promise<void>(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close(err => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  actingUser = ACTING_ORG_ADMIN;
  mockGetUser.mockReset();
  mockUpdateUserRole.mockReset();
  mockUpdateUserRole.mockImplementation(async (id: number, role: string) => ({
    ...TARGET_USER_REGULAR,
    id,
    role,
  }));
  mockCountOrgAdmins.mockReset();
  mockCountOrgAdmins.mockResolvedValue(5);
  mockRecordAdminRoleChangeAudit.mockReset();
  mockRecordAdminRoleChangeAudit.mockResolvedValue({ id: 1 } as never);
  mockTransaction.mockClear();
  mockTransaction.mockImplementation(
    async (fn: (tx: typeof TX_SENTINEL) => Promise<unknown>) => fn(TX_SENTINEL),
  );
});

async function patchAdminStatus(targetId: number, body: unknown) {
  return fetch(`${baseUrl}/api/organization-admin/users/${targetId}/admin-status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/organization-admin/users/:id/admin-status — persistent audit row (task #459)', () => {
  it('writes one audit row with old=user/new=org_admin on a successful promotion, ordered after updateUserRole', async () => {
    mockGetUser.mockResolvedValueOnce({ ...TARGET_USER_REGULAR });
    const res = await patchAdminStatus(TARGET_USER_REGULAR.id, { makeOrgAdmin: true });
    expect(res.status).toBe(200);

    expect(mockRecordAdminRoleChangeAudit).toHaveBeenCalledTimes(1);
    const [auditValues] = mockRecordAdminRoleChangeAudit.mock.calls[0] as unknown as [
      {
        actorUserId: number;
        targetUserId: number;
        organizationId: number | null;
        oldRole: string;
        newRole: string;
        ipAddress: string | null;
        userAgent: string | null;
      },
    ];
    expect(auditValues.actorUserId).toBe(ACTING_ORG_ADMIN.id);
    expect(auditValues.targetUserId).toBe(TARGET_USER_REGULAR.id);
    expect(auditValues.organizationId).toBe(TARGET_USER_REGULAR.organizationId);
    expect(auditValues.oldRole).toBe('user');
    expect(auditValues.newRole).toBe('org_admin');
    expect(auditValues.ipAddress).toBe('198.51.100.42');
    expect(typeof auditValues.userAgent === 'string' || auditValues.userAgent === null).toBe(true);

    // Strict ordering: audit row must be written AFTER the role row
    // (otherwise we record a change that hasn't actually happened) and
    // BEFORE the response is sent (so a successful 200 implies a
    // queryable audit trail). The 200 response status proves the
    // audit completed before the response was flushed.
    const updateOrder = mockUpdateUserRole.mock.invocationCallOrder[0];
    const auditOrder = mockRecordAdminRoleChangeAudit.mock.invocationCallOrder[0];
    expect(updateOrder).toBeLessThan(auditOrder);
  });

  it('writes one audit row with old=org_admin/new=user on a successful demotion', async () => {
    mockGetUser.mockResolvedValueOnce({ ...TARGET_USER_ORGADMIN });
    // Plenty of remaining org admins so the last-admin guard does not
    // fire — this test is about the demotion happy path.
    mockCountOrgAdmins.mockResolvedValueOnce(5);
    const res = await patchAdminStatus(TARGET_USER_ORGADMIN.id, { makeOrgAdmin: false });
    expect(res.status).toBe(200);

    expect(mockRecordAdminRoleChangeAudit).toHaveBeenCalledTimes(1);
    const [auditValues] = mockRecordAdminRoleChangeAudit.mock.calls[0] as unknown as [
      { oldRole: string; newRole: string; targetUserId: number },
    ];
    expect(auditValues.oldRole).toBe('org_admin');
    expect(auditValues.newRole).toBe('user');
    expect(auditValues.targetUserId).toBe(TARGET_USER_ORGADMIN.id);
  });

  it('a system_admin caller can change roles cross-org and the audit captures the target org', async () => {
    actingUser = {
      id: 9000,
      email: 'sysadmin@vitest.local',
      name: 'Sys Admin',
      role: 'system_admin',
      organizationId: null,
    } as unknown as typeof ACTING_ORG_ADMIN;
    mockGetUser.mockResolvedValueOnce({ ...TARGET_USER_CROSS_ORG });
    try {
      const res = await patchAdminStatus(TARGET_USER_CROSS_ORG.id, { makeOrgAdmin: true });
      expect(res.status).toBe(200);
      expect(mockRecordAdminRoleChangeAudit).toHaveBeenCalledTimes(1);
      const [auditValues] = mockRecordAdminRoleChangeAudit.mock.calls[0] as unknown as [
        { actorUserId: number; organizationId: number | null },
      ];
      expect(auditValues.actorUserId).toBe(9000);
      // organizationId is the TARGET's org — that's what makes the
      // row queryable per-tenant even when a system_admin acts.
      expect(auditValues.organizationId).toBe(TARGET_USER_CROSS_ORG.organizationId);
    } finally {
      actingUser = ACTING_ORG_ADMIN;
    }
  });

  it('does NOT write an audit row when the request body is missing makeOrgAdmin', async () => {
    mockGetUser.mockResolvedValueOnce({ ...TARGET_USER_REGULAR });
    const res = await patchAdminStatus(TARGET_USER_REGULAR.id, { somethingElse: true });
    expect(res.status).toBe(400);
    expect(mockRecordAdminRoleChangeAudit).not.toHaveBeenCalled();
    expect(mockUpdateUserRole).not.toHaveBeenCalled();
  });

  it('does NOT write an audit row when the target user does not exist', async () => {
    mockGetUser.mockResolvedValueOnce(undefined);
    const res = await patchAdminStatus(999_999, { makeOrgAdmin: true });
    expect(res.status).toBe(404);
    expect(mockRecordAdminRoleChangeAudit).not.toHaveBeenCalled();
    expect(mockUpdateUserRole).not.toHaveBeenCalled();
  });

  it('does NOT write an audit row when an org_admin tries to modify a system_admin', async () => {
    mockGetUser.mockResolvedValueOnce({ ...TARGET_USER_SYSADMIN });
    const res = await patchAdminStatus(TARGET_USER_SYSADMIN.id, { makeOrgAdmin: false });
    expect(res.status).toBe(403);
    expect(mockRecordAdminRoleChangeAudit).not.toHaveBeenCalled();
    expect(mockUpdateUserRole).not.toHaveBeenCalled();
  });

  it('does NOT write an audit row when an org_admin reaches across organizations', async () => {
    mockGetUser.mockResolvedValueOnce({ ...TARGET_USER_CROSS_ORG });
    const res = await patchAdminStatus(TARGET_USER_CROSS_ORG.id, { makeOrgAdmin: true });
    expect(res.status).toBe(403);
    expect(mockRecordAdminRoleChangeAudit).not.toHaveBeenCalled();
    expect(mockUpdateUserRole).not.toHaveBeenCalled();
  });

  it('does NOT write an audit row when the last-org-admin guard fires', async () => {
    mockGetUser.mockResolvedValueOnce({ ...TARGET_USER_ORGADMIN });
    // Only one org admin remaining — demotion must be blocked.
    mockCountOrgAdmins.mockResolvedValueOnce(1);
    const res = await patchAdminStatus(TARGET_USER_ORGADMIN.id, { makeOrgAdmin: false });
    expect(res.status).toBe(400);
    expect(mockRecordAdminRoleChangeAudit).not.toHaveBeenCalled();
    expect(mockUpdateUserRole).not.toHaveBeenCalled();
  });

  it('does NOT write an audit row when the caller is unauthenticated', async () => {
    actingUser = null;
    try {
      const res = await patchAdminStatus(TARGET_USER_REGULAR.id, { makeOrgAdmin: true });
      expect(res.status).toBe(401);
      expect(mockRecordAdminRoleChangeAudit).not.toHaveBeenCalled();
      expect(mockUpdateUserRole).not.toHaveBeenCalled();
      expect(mockGetUser).not.toHaveBeenCalled();
    } finally {
      actingUser = ACTING_ORG_ADMIN;
    }
  });

  it('does NOT write an audit row when the caller is a regular user (role check)', async () => {
    actingUser = {
      ...ACTING_ORG_ADMIN,
      id: 5005,
      role: 'user' as unknown as 'org_admin',
    };
    try {
      const res = await patchAdminStatus(TARGET_USER_REGULAR.id, { makeOrgAdmin: true });
      expect(res.status).toBe(403);
      expect(mockRecordAdminRoleChangeAudit).not.toHaveBeenCalled();
      expect(mockUpdateUserRole).not.toHaveBeenCalled();
      expect(mockGetUser).not.toHaveBeenCalled();
    } finally {
      actingUser = ACTING_ORG_ADMIN;
    }
  });

  // Task #461: the role update and the audit insert run inside a
  // single `db.transaction(...)`. These tests pin the contract at
  // the route level — both writes share the same `tx` executor, and
  // when the audit insert rejects the rollback semantics are
  // preserved (the rejection escapes the transaction callback so
  // drizzle would ROLLBACK the role update in production). Without
  // the transaction wrapper, a maintainer could re-introduce the
  // partial-write window the task fixed.
  describe('atomicity with the role update (task #461)', () => {
    it('runs the role update and the audit insert inside the same db.transaction', async () => {
      mockGetUser.mockResolvedValueOnce({ ...TARGET_USER_REGULAR });
      const res = await patchAdminStatus(TARGET_USER_REGULAR.id, { makeOrgAdmin: true });
      expect(res.status).toBe(200);

      // The route must open exactly one transaction for the change
      // — not two separate ones, and not zero (which would mean the
      // writes can diverge again).
      expect(mockTransaction).toHaveBeenCalledTimes(1);

      // Both writes must have received the SAME executor handed to
      // them by `db.transaction(...)`. If a future refactor passed
      // `db` (the top-level connection) instead of `tx` to either
      // call, that write would commit OUTSIDE the transaction and
      // the rollback contract would silently break.
      expect(mockUpdateUserRole).toHaveBeenCalledTimes(1);
      const updateCall = mockUpdateUserRole.mock.calls[0] as unknown as [
        number,
        string,
        unknown,
      ];
      expect(updateCall[2]).toBe(TX_SENTINEL);

      expect(mockRecordAdminRoleChangeAudit).toHaveBeenCalledTimes(1);
      const auditCall = mockRecordAdminRoleChangeAudit.mock.calls[0] as unknown as [
        Record<string, unknown>,
        unknown,
      ];
      expect(auditCall[1]).toBe(TX_SENTINEL);
    });

    it('rolls back (transaction rejects) and surfaces 500 when the audit insert throws — the role update ran inside the rolled-back transaction so no row is observable outside it', async () => {
      mockGetUser.mockResolvedValueOnce({ ...TARGET_USER_REGULAR });
      mockRecordAdminRoleChangeAudit.mockRejectedValueOnce(
        new Error('DB unavailable'),
      );

      // Track whether the transaction callback rejected — that is
      // what makes drizzle ROLLBACK the role update at the DB
      // level. Without this propagation the write would commit even
      // though the audit failed.
      let txRejected = false;
      mockTransaction.mockImplementationOnce(
        async (fn: (tx: typeof TX_SENTINEL) => Promise<unknown>) => {
          try {
            return await fn(TX_SENTINEL);
          } catch (err) {
            txRejected = true;
            throw err;
          }
        },
      );

      const res = await patchAdminStatus(TARGET_USER_REGULAR.id, {
        makeOrgAdmin: true,
      });
      expect(res.status).toBe(500);

      // The transaction MUST have rejected so drizzle would issue
      // ROLLBACK in production. If a future refactor swallowed the
      // audit error inside the callback, this assertion fails and
      // the rollback contract is gone.
      expect(txRejected).toBe(true);

      // `storage.updateUserRole` was invoked (so a maintainer can
      // see we tried to write the role), but it ran inside the
      // failed transaction so the row is not observable outside it.
      // We assert the executor was the SAME `tx` that the audit
      // threw under — proving both writes share one rollback fate.
      expect(mockUpdateUserRole).toHaveBeenCalledTimes(1);
      const updateCall = mockUpdateUserRole.mock.calls[0] as unknown as [
        number,
        string,
        unknown,
      ];
      expect(updateCall[2]).toBe(TX_SENTINEL);
    });
  });
});
