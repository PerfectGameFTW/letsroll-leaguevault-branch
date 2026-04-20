#!/usr/bin/env tsx
/**
 * Manual seeding entrypoint. The Vitest suite seeds itself automatically
 * via `tests/setup/global-setup.ts`, so this script is only needed when
 * you want to (re)seed the test accounts outside of a test run.
 *
 * Usage:
 *   tsx scripts/seed.ts          # idempotently ensure test users + orgs
 *   tsx scripts/seed.ts users    # same as above
 */
import { seedTestUsers } from '../tests/setup/seed-test-users';

async function main() {
  const command = process.argv[2] ?? 'users';
  switch (command) {
    case 'users':
      await seedTestUsers();
      console.log('Test users and organizations seeded.');
      break;
    default:
      console.log('Usage: tsx scripts/seed.ts [users]');
      console.log('  users   Idempotently ensure test users + organizations exist (default)');
      process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('Seeding failed:', err);
  process.exit(1);
});
