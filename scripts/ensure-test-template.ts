/**
 * Cheap guard around `build-test-template.ts` (Task #699 / Phase 1).
 *
 * Compares the current schema-input hash against
 * `.local/test-template-hash`. If they differ (or the hash file is
 * missing), invokes `buildTestTemplate()` to rebuild the template DB.
 *
 * Phase 2 will call this from the vitest globalSetup so a stale
 * template never leaks into a test run; until then it's a manual
 * convenience.
 */
import { existsSync, readFileSync } from 'node:fs';
import { buildTestTemplate, computeTemplateHash } from './build-test-template';

const HASH_FILE = '.local/test-template-hash';

export async function ensureTestTemplate(): Promise<void> {
  const expected = computeTemplateHash();
  let actual: string | null = null;
  if (existsSync(HASH_FILE)) {
    actual = readFileSync(HASH_FILE, 'utf8').trim();
  }
  if (actual === expected) {
    console.log('[ensure-test-template] hash up-to-date; skipping rebuild.');
    return;
  }
  console.log('[ensure-test-template] hash drift detected; rebuilding template…');
  await buildTestTemplate();
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  ensureTestTemplate().catch((err) => {
    console.error('[ensure-test-template] failed:', err);
    process.exit(1);
  });
}
