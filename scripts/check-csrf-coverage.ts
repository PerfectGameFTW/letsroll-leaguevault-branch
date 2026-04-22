/**
 * CSRF coverage guard (task #308).
 *
 * Today CSRF protection is wired by a single global mount in
 * `server/index.ts`:
 *
 *   app.use('/api', csrfProtection)
 *
 * plus the EXEMPT_PATHS list in `server/middleware/csrf.ts`. Every
 * state-changing request to `/api/**` that isn't on EXEMPT_PATHS goes
 * through CSRF. A future contributor could add a new state-changing
 * route DIRECTLY on `app` (e.g. `app.post('/foo', ...)`) outside the
 * `/api` prefix and silently bypass the global mount — there is no
 * runtime check that catches that.
 *
 * This script greps `server/index.ts` for `app.post|put|patch|delete`
 * calls and fails if any path does NOT start with `/api/`. The
 * `EXPLICIT_NON_API_ALLOWLIST` below is the exhaustive set of
 * non-`/api` state-changing routes that have been audited and judged
 * safe (currently empty — see `docs/security/csrf-coverage.md`). To
 * add to it, document the rationale alongside the entry.
 *
 * Exits 0 if clean, 1 if any unallowlisted bypass is found.
 *
 * Run with: `npm run check:csrf` or `tsx scripts/check-csrf-coverage.ts`.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const TARGET = resolve(process.cwd(), "server/index.ts");

/**
 * Exhaustive list of non-`/api` state-changing routes that have been
 * security-audited and judged safe. Empty by default. Add an entry only
 * with a code comment justifying why CSRF is not required (e.g. an
 * out-of-band auth factor like `x-setup-secret`, or a single-use signed
 * token in the body).
 */
const EXPLICIT_NON_API_ALLOWLIST: readonly string[] = [];

const ROUTE_RE =
  /\bapp\s*\.\s*(post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/g;

function stripComments(src: string): string {
  // Remove `/* ... */` block comments and `// ...` line comments. A
  // simplistic stripper is fine — `server/index.ts` doesn't contain any
  // legitimate `app.post('/foo')` inside a comment we want to honor.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function main(): void {
  const src = stripComments(readFileSync(TARGET, "utf8"));
  const violations: { method: string; path: string }[] = [];

  for (const m of src.matchAll(ROUTE_RE)) {
    const method = m[1];
    const path = m[3];
    if (path.startsWith("/api/") || path === "/api") continue;
    if (EXPLICIT_NON_API_ALLOWLIST.includes(path)) continue;
    violations.push({ method: method.toUpperCase(), path });
  }

  if (violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      "[check-csrf-coverage] OK — no state-changing routes outside /api in server/index.ts.",
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.error(
    "[check-csrf-coverage] FAIL — state-changing routes outside /api detected in server/index.ts:",
  );
  for (const v of violations) {
    // eslint-disable-next-line no-console
    console.error(`  - ${v.method} ${v.path}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    "\nThe global CSRF mount is `app.use('/api', csrfProtection)` — routes\n" +
      "outside /api silently bypass it. Either move the route under /api,\n" +
      "or (only with security-team sign-off) add it to\n" +
      "EXPLICIT_NON_API_ALLOWLIST in scripts/check-csrf-coverage.ts with\n" +
      "an inline justification. See docs/security/csrf-coverage.md.",
  );
  process.exit(1);
}

main();
