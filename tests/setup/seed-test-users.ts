/**
 * Idempotent seeder for the accounts the test suite depends on.
 *
 * Reuses the same env var / default convention as `tests/helpers.ts` so
 * developers can override credentials without touching this file.
 *
 * Safe to run multiple times: existing users are updated in place
 * (password rehashed, role/orgId enforced) and existing orgs are reused.
 */
import { eq } from 'drizzle-orm';
import { db } from '../../server/db';
import { organizations, users } from '@shared/schema';
import { hashPassword } from '../../server/lib/password';

/**
 * Hard guard: this seeder forcibly resets passwords / roles / org for any
 * user matching the configured test emails. Running it against a production
 * database would silently overwrite real accounts. Refuse unless we are in
 * a non-production NODE_ENV, or the operator explicitly opts in via
 * ALLOW_TEST_SEED=1.
 */
function assertSafeEnvironment(): void {
  const nodeEnv = process.env.NODE_ENV;
  const allowOverride = process.env.ALLOW_TEST_SEED === '1';
  const isReplitDeployment = !!process.env.REPLIT_DEPLOYMENT;
  if (allowOverride) return;
  if (nodeEnv === 'production' || isReplitDeployment) {
    throw new Error(
      'Refusing to run test-user seeder: NODE_ENV=production or REPLIT_DEPLOYMENT is set. ' +
        'Set ALLOW_TEST_SEED=1 only if you really intend to write test accounts to this database.',
    );
  }
}

const TEST_ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@example.com';
const TEST_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin-local-dev';
const TEST_ORG_A_EMAIL = process.env.TEST_ORG_A_EMAIL || 'testadmin@example.com';
const TEST_ORG_B_EMAIL = process.env.TEST_ORG_B_EMAIL || 'testadmin2@example.com';
const TEST_ORG_PASSWORD = process.env.TEST_ORG_PASSWORD || 'org-local-dev';

const TEST_ORG_A_SLUG = process.env.TEST_ORG_A_SLUG || 'vitest-org-a';
const TEST_ORG_B_SLUG = process.env.TEST_ORG_B_SLUG || 'vitest-org-b';

async function ensureOrganization(name: string, slug: string): Promise<number> {
  const [existing] = await db
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(organizations.slug, slug));
  if (existing) return existing.id;

  const [created] = await db
    .insert(organizations)
    .values({ name, slug, active: true })
    .returning({ id: organizations.id });
  return created.id;
}

interface UserSpec {
  email: string;
  password: string;
  name: string;
  role: 'system_admin' | 'org_admin' | 'user';
  organizationId: number | null;
}

async function ensureUser(spec: UserSpec): Promise<void> {
  const hashed = await hashPassword(spec.password);
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, spec.email));

  if (existing) {
    await db
      .update(users)
      .set({
        password: hashed,
        role: spec.role,
        organizationId: spec.organizationId,
        name: spec.name,
      })
      .where(eq(users.id, existing.id));
    return;
  }

  await db.insert(users).values({
    email: spec.email,
    password: hashed,
    name: spec.name,
    role: spec.role,
    organizationId: spec.organizationId,
  });
}

export async function seedTestUsers(): Promise<void> {
  assertSafeEnvironment();
  const orgAId = await ensureOrganization('Vitest Org A', TEST_ORG_A_SLUG);
  const orgBId = await ensureOrganization('Vitest Org B', TEST_ORG_B_SLUG);

  await ensureUser({
    email: TEST_ADMIN_EMAIL,
    password: TEST_ADMIN_PASSWORD,
    name: 'Vitest System Admin',
    role: 'system_admin',
    organizationId: null,
  });

  await ensureUser({
    email: TEST_ORG_A_EMAIL,
    password: TEST_ORG_PASSWORD,
    name: 'Vitest Org A Admin',
    role: 'org_admin',
    organizationId: orgAId,
  });

  await ensureUser({
    email: TEST_ORG_B_EMAIL,
    password: TEST_ORG_PASSWORD,
    name: 'Vitest Org B Admin',
    role: 'org_admin',
    organizationId: orgBId,
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedTestUsers()
    .then(() => {
      console.log('Test users seeded.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Failed to seed test users:', err);
      process.exit(1);
    });
}
