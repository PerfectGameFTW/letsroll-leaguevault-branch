/**
 * Build / commit identification surfaced to operators (and to the
 * BETA banner via /api/health). Resolved once at module load and
 * cached — `git rev-parse` is fast but we don't want to fork a
 * subprocess on every health-check hit.
 *
 * Resolution order:
 *   1. `REPL_DEPLOYMENT_ID` (Replit deploys expose this if available)
 *   2. `git rev-parse --short HEAD` against the working tree
 *   3. Literal string `"unknown"` if both above fail (e.g. a built
 *      bundle running outside a git checkout)
 *
 * Failures are swallowed — this helper is best-effort metadata, not
 * something boot should die on. Errors are logged at debug level so
 * a missing `.git` directory doesn't spam the prod log sink.
 */

import { execSync } from 'node:child_process';
import { createLogger } from '../logger';

const log = createLogger('BuildInfo');

function readReplitDeploymentId(): string | undefined {
  const v = process.env.REPL_DEPLOYMENT_ID;
  return typeof v === 'string' && v.length > 0 ? v.slice(0, 12) : undefined;
}

function readGitShortSha(): string | undefined {
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2_000,
    }).trim();
    return sha.length > 0 ? sha : undefined;
  } catch (err) {
    log.debug('git rev-parse failed (no .git or git not on PATH):', err);
    return undefined;
  }
}

function resolveCommitSha(): string {
  return readReplitDeploymentId() ?? readGitShortSha() ?? 'unknown';
}

export const commitSha: string = resolveCommitSha();
