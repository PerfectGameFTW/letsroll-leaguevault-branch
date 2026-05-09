/**
 * Production / dev entry point.
 *
 * The full boot lives in `server/app.ts` so the per-worker test
 * harness (`server/test-entry.ts`, Task #699) can reuse the same
 * factory with `suppressBackgroundWorkers: true`. Keep this file a
 * thin one-liner so `npm run dev` keeps using the canonical path.
 */
import { createApp } from './app';

await createApp();
