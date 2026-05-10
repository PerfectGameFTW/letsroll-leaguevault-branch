/**
 * Per-worker setup, DB-only variant (Task #700).
 *
 * Used by the `parallel-isolated` and `serial-fk-bypass` projects, which
 * don't make HTTP calls against a spawned Express. We still want each
 * worker to own an isolated cloned-from-template DB so storage-level
 * tests don't fight over rows, but spawning a per-worker Express is
 * pure overhead for these suites.
 *
 * The full HTTP-spawning variant lives in `per-worker-setup.ts` and is
 * used only by the `parallel` project (the bulk of HTTP-driven
 * tests/api/** suites).
 */
import { cloneTemplateForWorker } from './per-worker-setup';

await cloneTemplateForWorker();
