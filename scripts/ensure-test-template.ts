/**
 * Cheap guard around `build-test-template.ts` (Task #699 / Phase 1,
 * extended for Neon-branches mode in Task #723).
 *
 * Decides whether to rebuild the test template:
 *
 *   1. If the schema-input hash differs from `.local/test-template-hash`,
 *      rebuild (covers schema/seed/invariants drift).
 *
 *   2. In Neon-branches mode, additionally verify the template branch
 *      actually exists in the Neon project even when the hash matches.
 *      Without this, a manually-deleted template branch (or one wiped
 *      by a teammate's reset) would silently leave the hash file
 *      claiming "up-to-date" and the next per-pool branch create would
 *      fail with "parent branch not found". We rebuild on absence so
 *      the next clone can succeed.
 */
import { existsSync, readFileSync } from 'node:fs';
import { assertSafeDatabaseHost } from '../server/utils/db-safety';
import { buildTestTemplate, computeTemplateHash } from './build-test-template';
import {
  findBranchByName,
  getNeonConfig,
  TEMPLATE_BRANCH_NAME,
} from '../tests/setup/neon-branches';

const HASH_FILE = '.local/test-template-hash';

export async function ensureTestTemplate(): Promise<void> {
  const expected = computeTemplateHash();
  let actual: string | null = null;
  if (existsSync(HASH_FILE)) {
    actual = readFileSync(HASH_FILE, 'utf8').trim();
  }

  if (actual !== expected) {
    console.log('[ensure-test-template] hash drift detected; rebuilding template…');
    await buildTestTemplate();
    return;
  }

  // Hash matches — but in Neon-branches mode, also confirm the
  // template branch is still present. (This is a single ~150ms API
  // call; cheap enough to do on every test run.)
  //
  // Host-allow-list rail (Task #723 review): refuse to talk to the
  // Neon control plane unless the connected DB host is on the dev
  // allow-list. `cleanupTestDbs` and `cloneTemplate` apply the same
  // guard; this fast path was previously bypassing it. Memoised once
  // per process inside `assertSafeDatabaseHost`.
  assertSafeDatabaseHost('ensure-test-template');
  const cfg = getNeonConfig();
  if (cfg) {
    const branch = await findBranchByName(cfg, TEMPLATE_BRANCH_NAME);
    if (!branch) {
      console.log(
        `[ensure-test-template] hash up-to-date but Neon template branch ` +
          `"${TEMPLATE_BRANCH_NAME}" missing; rebuilding…`,
      );
      await buildTestTemplate();
      return;
    }
  }

  console.log('[ensure-test-template] hash up-to-date; skipping rebuild.');
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  ensureTestTemplate().catch((err) => {
    console.error('[ensure-test-template] failed:', err);
    process.exit(1);
  });
}
