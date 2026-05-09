/**
 * Per-worker test app entry (Task #699).
 *
 * Spawned as a child process by the vitest global setup in Phase 2:
 * each worker sets `DATABASE_URL` to its own cloned-from-template
 * database, then forks this script to get an isolated Express
 * instance on a kernel-assigned port. We print the port on stdout
 * once listening so the parent can wire its HTTP client at it.
 */
import { createApp } from './app';

const created = await createApp({
  port: 0,
  suppressBackgroundWorkers: true,
});

// Single, easy-to-grep stdout line for the parent to scrape.
process.stdout.write(`[ready] port=${created.port}\n`);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await created.close();
  } catch (err) {
    // Best-effort; don't mask the signal exit.
    console.error(`[test-entry] close() threw on ${signal}:`, err);
  }
  process.exit(0);
}
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
process.on('SIGINT', () => { void shutdown('SIGINT'); });
