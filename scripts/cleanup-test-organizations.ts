/**
 * Cleanup script for leaked vitest organizations (task #607).
 *
 * The integration suite historically created a fresh `organizations`
 * row inside each test file's beforeAll, which over time leaked
 * hundreds of rows into the dev DB (admin Organizations page was at
 * 294 orgs at the time of writing — mostly junk like
 * `change-password-test-*`, `email-change-test-*`,
 * `vitest-csc-orga-*`, `lifecycle-org-*`, etc).
 *
 * This script deletes every `organizations` row whose slug is NOT in
 * the explicit allow-list, plus all dependent rows that would
 * otherwise block the delete (users / bowlers / leagues / locations
 * and the audit tables that have ON DELETE RESTRICT on user_id).
 *
 * Safety:
 *   - Refuses to run when NODE_ENV=production or REPLIT_DEPLOYMENT is
 *     set, unless ALLOW_TEST_CLEANUP=1 is passed.
 *   - Wraps every delete in a single transaction. A failure rolls
 *     everything back.
 *   - `--dry-run` prints what would be deleted and exits without
 *     touching the DB. Default mode also requires explicit
 *     confirmation via ALLOW_TEST_CLEANUP=1 to actually delete.
 *
 * Usage:
 *   npx tsx scripts/cleanup-test-organizations.ts --dry-run
 *   ALLOW_TEST_CLEANUP=1 npx tsx scripts/cleanup-test-organizations.ts
 */
import { and, eq, inArray, isNotNull, notInArray, sql } from 'drizzle-orm';
import { db, pool } from '../server/db';
import {
  organizations,
  users,
  bowlers,
  leagues,
  locations,
  applePayJobs,
  deletionRequests,
  adminEmailChangeAudits,
  adminProfileEditAudits,
  adminPasswordResetAudits,
  adminRoleChangeAudits,
  orphanCleanupAudits,
} from '@shared/schema';
import { isReplitDeploymentValue } from '../server/utils/replit-env';

/**
 * Slugs that must NEVER be touched by this script:
 *   - The three real production-shaped tenants on the dev DB
 *     (Perfect Game / Let's Roll Bowling / Sun Valley Lanes & Games)
 *   - The two seeded vitest baseline orgs that the refactored test
 *     suite re-uses across runs
 */
const PROTECTED_SLUGS = [
  'perfect-game',
  'lets-roll-bowling',
  'sun-valley-lanes-games',
  'vitest-org-a',
  'vitest-org-b',
];

function assertSafeEnvironment(): void {
  const nodeEnv = process.env.NODE_ENV;
  const isReplitDeployment = isReplitDeploymentValue(process.env.REPLIT_DEPLOYMENT);
  if (nodeEnv === 'production' || isReplitDeployment) {
    throw new Error(
      'Refusing to run cleanup-test-organizations: NODE_ENV=production or REPLIT_DEPLOYMENT is set. ' +
        'This script is for the dev / CI database only.',
    );
  }
}

interface CleanupCounts {
  organizations: number;
  users: number;
  bowlers: number;
  leagues: number;
  locations: number;
  emailChangeAudits: number;
  profileEditAudits: number;
  passwordResetAudits: number;
  roleChangeAudits: number;
  orphanCleanupAudits: number;
  applePayJobsNulled: number;
  deletionRequestsNulled: number;
  usersBowlerIdNulled: number;
}

async function main(): Promise<void> {
  assertSafeEnvironment();

  const dryRun = process.argv.includes('--dry-run');
  const confirmed = process.env.ALLOW_TEST_CLEANUP === '1';
  if (!dryRun && !confirmed) {
    throw new Error(
      'Refusing to run without ALLOW_TEST_CLEANUP=1 (or --dry-run). This script deletes ' +
        'organizations and all their dependent users/bowlers/leagues/locations from the ' +
        'connected database.',
    );
  }

  // --- Resolve doomed orgs --------------------------------------------------
  const doomed = await db
    .select({ id: organizations.id, slug: organizations.slug, name: organizations.name })
    .from(organizations)
    .where(notInArray(organizations.slug, PROTECTED_SLUGS));

  if (doomed.length === 0) {
    console.log('Nothing to clean up: every organization slug is in the allow-list.');
    await pool.end();
    return;
  }

  const doomedIds = doomed.map((o) => o.id);
  console.log(`Found ${doomed.length} non-protected organizations.`);
  console.log(`Protected slugs (kept): ${PROTECTED_SLUGS.join(', ')}`);
  console.log('First 10 doomed orgs:', doomed.slice(0, 10).map((o) => `${o.id}:${o.slug}`).join(', '));

  // --- Resolve doomed user / bowler ids ------------------------------------
  const doomedUserRows = await db
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.organizationId, doomedIds));
  const doomedUserIds = doomedUserRows.map((r) => r.id);

  const doomedBowlerRows = await db
    .select({ id: bowlers.id })
    .from(bowlers)
    .where(inArray(bowlers.organizationId, doomedIds));
  const doomedBowlerIds = doomedBowlerRows.map((r) => r.id);

  console.log(`  -> ${doomedUserIds.length} dependent users, ${doomedBowlerIds.length} dependent bowlers`);

  if (dryRun) {
    console.log('\n[dry-run] Not deleting. Re-run with ALLOW_TEST_CLEANUP=1 to actually clean up.');
    await pool.end();
    return;
  }

  // --- Apply deletes inside one transaction --------------------------------
  const counts: CleanupCounts = {
    organizations: 0,
    users: 0,
    bowlers: 0,
    leagues: 0,
    locations: 0,
    emailChangeAudits: 0,
    profileEditAudits: 0,
    passwordResetAudits: 0,
    roleChangeAudits: 0,
    orphanCleanupAudits: 0,
    applePayJobsNulled: 0,
    deletionRequestsNulled: 0,
    usersBowlerIdNulled: 0,
  };

  await db.transaction(async (tx) => {
    // 1. Clear RESTRICT audit rows that reference doomed users.
    if (doomedUserIds.length > 0) {
      const ec1 = await tx
        .delete(adminEmailChangeAudits)
        .where(inArray(adminEmailChangeAudits.targetUserId, doomedUserIds))
        .returning({ id: adminEmailChangeAudits.id });
      const ec2 = await tx
        .delete(adminEmailChangeAudits)
        .where(inArray(adminEmailChangeAudits.actorUserId, doomedUserIds))
        .returning({ id: adminEmailChangeAudits.id });
      counts.emailChangeAudits = ec1.length + ec2.length;

      const pe1 = await tx
        .delete(adminProfileEditAudits)
        .where(inArray(adminProfileEditAudits.targetUserId, doomedUserIds))
        .returning({ id: adminProfileEditAudits.id });
      const pe2 = await tx
        .delete(adminProfileEditAudits)
        .where(inArray(adminProfileEditAudits.actorUserId, doomedUserIds))
        .returning({ id: adminProfileEditAudits.id });
      counts.profileEditAudits = pe1.length + pe2.length;

      const pr1 = await tx
        .delete(adminPasswordResetAudits)
        .where(inArray(adminPasswordResetAudits.targetUserId, doomedUserIds))
        .returning({ id: adminPasswordResetAudits.id });
      const pr2 = await tx
        .delete(adminPasswordResetAudits)
        .where(inArray(adminPasswordResetAudits.actorUserId, doomedUserIds))
        .returning({ id: adminPasswordResetAudits.id });
      counts.passwordResetAudits = pr1.length + pr2.length;

      const rc1 = await tx
        .delete(adminRoleChangeAudits)
        .where(inArray(adminRoleChangeAudits.targetUserId, doomedUserIds))
        .returning({ id: adminRoleChangeAudits.id });
      const rc2 = await tx
        .delete(adminRoleChangeAudits)
        .where(inArray(adminRoleChangeAudits.actorUserId, doomedUserIds))
        .returning({ id: adminRoleChangeAudits.id });
      counts.roleChangeAudits = rc1.length + rc2.length;

      const oc = await tx
        .delete(orphanCleanupAudits)
        .where(inArray(orphanCleanupAudits.adminUserId, doomedUserIds))
        .returning({ id: orphanCleanupAudits.id });
      counts.orphanCleanupAudits = oc.length;

      // 2. NULL the NO ACTION FKs (apple_pay_jobs.created_by,
      //    deletion_requests.reviewed_by) that point at doomed users.
      const ap = await tx
        .update(applePayJobs)
        .set({ createdBy: null })
        .where(inArray(applePayJobs.createdBy, doomedUserIds))
        .returning({ id: applePayJobs.id });
      counts.applePayJobsNulled = ap.length;

      const dr = await tx
        .update(deletionRequests)
        .set({ reviewedBy: null })
        .where(inArray(deletionRequests.reviewedBy, doomedUserIds))
        .returning({ id: deletionRequests.id });
      counts.deletionRequestsNulled = dr.length;
    }

    // 3. Release users.bowler_id pointers into doomed bowlers (NO
    //    ACTION FK), so that the bowler delete below doesn't error.
    if (doomedBowlerIds.length > 0) {
      const ub = await tx
        .update(users)
        .set({ bowlerId: null })
        .where(inArray(users.bowlerId, doomedBowlerIds))
        .returning({ id: users.id });
      counts.usersBowlerIdNulled = ub.length;
    }

    // 4. Delete leagues -> CASCADE drops teams, games, scores,
    //    payments, payment_schedules, bowler_leagues for those leagues.
    if (doomedIds.length > 0) {
      const lg = await tx
        .delete(leagues)
        .where(inArray(leagues.organizationId, doomedIds))
        .returning({ id: leagues.id });
      counts.leagues = lg.length;
    }

    // 5. Delete bowlers -> CASCADE drops bowler_leagues, payments,
    //    scores, payment_schedules tied to those bowlers (already
    //    mostly gone via the league cascade, but bowlers can outlive
    //    a single league).
    if (doomedIds.length > 0) {
      const bw = await tx
        .delete(bowlers)
        .where(inArray(bowlers.organizationId, doomedIds))
        .returning({ id: bowlers.id });
      counts.bowlers = bw.length;
    }

    // 6. Delete users -> CASCADE drops email_change_requests; the
    //    RESTRICT audits and NO ACTION FKs above were cleared.
    if (doomedIds.length > 0) {
      const us = await tx
        .delete(users)
        .where(inArray(users.organizationId, doomedIds))
        .returning({ id: users.id });
      counts.users = us.length;
    }

    // 7. Delete locations. Leagues/users/bowlers (NO ACTION) are
    //    already gone. apple_pay_job_items.location_id is SET NULL.
    if (doomedIds.length > 0) {
      const lc = await tx
        .delete(locations)
        .where(inArray(locations.organizationId, doomedIds))
        .returning({ id: locations.id });
      counts.locations = lc.length;
    }

    // 8. Finally, delete the orgs themselves. SET NULL FKs on
    //    apple_pay_job_items, orphan_cleanup_audits (org + previous_org),
    //    admin_password_reset_audits, admin_role_change_audits clear
    //    automatically.
    const og = await tx
      .delete(organizations)
      .where(inArray(organizations.id, doomedIds))
      .returning({ id: organizations.id });
    counts.organizations = og.length;
  });

  console.log('\nCleanup complete:');
  console.log(`  organizations deleted: ${counts.organizations}`);
  console.log(`  users deleted:         ${counts.users}`);
  console.log(`  bowlers deleted:       ${counts.bowlers}`);
  console.log(`  leagues deleted:       ${counts.leagues}`);
  console.log(`  locations deleted:     ${counts.locations}`);
  console.log(`  audits deleted:        email_change=${counts.emailChangeAudits}, profile_edit=${counts.profileEditAudits}, password_reset=${counts.passwordResetAudits}, role_change=${counts.roleChangeAudits}, orphan_cleanup=${counts.orphanCleanupAudits}`);
  console.log(`  FKs nulled:            apple_pay_jobs.created_by=${counts.applePayJobsNulled}, deletion_requests.reviewed_by=${counts.deletionRequestsNulled}, users.bowler_id=${counts.usersBowlerIdNulled}`);

  // Sanity check the post-state.
  const finalOrgs = await db.select({ slug: organizations.slug }).from(organizations);
  const finalSlugs = finalOrgs.map((o) => o.slug).sort();
  console.log(`\nRemaining ${finalOrgs.length} organizations: ${finalSlugs.join(', ')}`);
  // Use the bindings just to keep eslint happy that they're imported and may be useful for future filters.
  void and; void eq; void isNotNull; void sql;

  await pool.end();
}

main().catch((err) => {
  console.error('cleanup-test-organizations failed:', err);
  process.exit(1);
});
