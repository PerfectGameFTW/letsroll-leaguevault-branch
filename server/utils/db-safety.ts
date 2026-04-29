/**
 * Hostname-based DB safety guard for destructive scripts.
 *
 * This is a second, INDEPENDENT layer on top of the
 * NODE_ENV / REPLIT_DEPLOYMENT check that
 * `scripts/cleanup-test-organizations.ts` and
 * `tests/setup/seed-test-users.ts` already perform via
 * `isReplitDeploymentValue` and their own `assertSafeEnvironment`
 * helpers. NODE_ENV is a shell variable that is trivially set wrong
 * (e.g. `NODE_ENV=development` in a shell whose `DATABASE_URL`
 * still points at the production tenant). This guard fires off a
 * different, independent signal — the `DATABASE_URL` host itself —
 * so a wrong NODE_ENV alone cannot wipe a live tenant.
 *
 * Mechanism (Task #609):
 *   1. If `DEV_DB_OK=1` is set, allow. This is the explicit operator
 *      escape hatch for cases where the heuristic below false-
 *      positives (e.g. a dev Neon branch the operator names with
 *      `prod` in it on purpose).
 *   2. Otherwise, parse `DATABASE_URL` and refuse if its host
 *      contains any substring in `PROD_DB_HOST_HINTS`.
 *
 * The hint list intentionally starts generic (`prod`, `production`,
 * `live`). The current dev Neon endpoint (`ep-dawn-unit-…`) doesn't
 * match any of these, so current dev/CI flows continue to work
 * unchanged with no extra env var. When the production
 * `DATABASE_URL` host is known, append its unique substring to
 * `PROD_DB_HOST_HINTS` in the same PR that cuts the deploy — that
 * turns this guard from "catches the obvious mis-naming" into
 * "categorically blocks the prod tenant" without operator action.
 *
 * Why a generic-substring blocklist + opt-in override (instead of an
 * allow-list of dev hosts): the dev DB endpoint id rotates whenever
 * a Neon branch is recycled, and there is no existing source of
 * truth for it in this repo. Hardcoding it would create a
 * coordination burden and a foot-gun the next time it changes. The
 * blocklist + override pattern degrades safely: false positives are
 * one env var away from being unblocked, false negatives only let a
 * destructive script through if the prod host happens to share a
 * substring with the dev host (which is operator-controllable).
 */
const PROD_DB_HOST_HINTS: readonly string[] = [
  'prod',
  'production',
  'live',
  // Append the unique substring of the production DATABASE_URL host
  // here when known (e.g. its Neon endpoint id). Keeping it absent
  // for now means the current dev DB host (`ep-dawn-unit-…`) does
  // not false-positive against this list.
];

export function assertSafeDatabaseHost(scriptName: string): void {
  if (process.env.DEV_DB_OK === '1') return;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      `Refusing to run ${scriptName}: DATABASE_URL is not set, so the ` +
        'destructive-database guard cannot verify the target host. ' +
        'Set DATABASE_URL (and DEV_DB_OK=1 if you have verified the ' +
        'host is a development database).',
    );
  }

  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(
      `Refusing to run ${scriptName}: DATABASE_URL could not be parsed ` +
        'as a URL, so the destructive-database guard cannot verify the ' +
        'target host.',
    );
  }

  const matched = PROD_DB_HOST_HINTS.find((hint) => host.includes(hint));
  if (matched) {
    throw new Error(
      `Refusing to run ${scriptName}: DATABASE_URL host "${host}" matches ` +
        `production-database hint "${matched}". This script writes ` +
        'destructive changes; running it against the production tenant ' +
        'would corrupt live customer data. Set DEV_DB_OK=1 only if you ' +
        'have verified this host is actually a development database.',
    );
  }
}

export const __testing = {
  PROD_DB_HOST_HINTS,
};
