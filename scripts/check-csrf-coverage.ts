/**
 * CSRF coverage guard (task #308, extended in task #338).
 *
 * Today CSRF protection is wired by a single global mount in
 * `server/index.ts`:
 *
 *   app.use('/api', csrfProtection)
 *
 * plus the EXEMPT_PATHS list in `server/middleware/csrf.ts`. Every
 * state-changing request to `/api/**` that isn't on EXEMPT_PATHS goes
 * through CSRF. A future contributor could add a new state-changing
 * route either:
 *
 *   1. DIRECTLY on `app` outside the `/api` prefix (e.g.
 *      `app.post('/foo', ...)` in any server-side file), or
 *
 *   2. INDIRECTLY by mounting a sub-router at a non-`/api` prefix
 *      (e.g. `app.use('/foo', myRouter)` where `myRouter` has
 *      `router.post('/bar', ...)` — effective path `/foo/bar`).
 *
 * Both patterns silently bypass the global mount. This script walks
 * every `.ts` file under `server/` (excluding `__tests__` and
 * `*.test.ts`) and:
 *
 *   a) Flags any `app.<method>('<path>', ...)` whose path doesn't
 *      start with `/api/` (case 1 above).
 *
 *   b) Tracks every `app.use('<prefix>', ..., <importedRouter>)`
 *      mount and the `router.<method>('<subpath>', ...)` calls in
 *      the imported router file, then flags any effective path
 *      (`<prefix>` + `<subpath>`) that doesn't start with `/api/`
 *      (case 2 above).
 *
 * The `EXPLICIT_NON_API_ALLOWLIST` below is the exhaustive set of
 * non-`/api` state-changing routes that have been audited and judged
 * safe (currently empty — see `docs/security/csrf-coverage.md`). To
 * add to it, document the rationale alongside the entry.
 *
 * Known limitation: nested router composition via
 * `parentRouter.use('<sub>', subRouter)` is not transitively
 * resolved. In practice every parent router in this codebase is
 * mounted under `/api/...`, so any sub-routers it composes are
 * transitively under `/api/...` too. Sub-router routes are still
 * detected by their own `router.<method>` calls; if a contributor
 * mounts a parent router at a non-`/api` prefix, the parent's own
 * direct routes will trip the guard, drawing attention to the
 * misconfigured mount.
 *
 * Exits 0 if clean, 1 if any unallowlisted bypass is found.
 *
 * Run with: `npm run check:csrf` or `tsx scripts/check-csrf-coverage.ts`.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';

const SERVER_DIR = resolve(process.cwd(), 'server');

/**
 * Exhaustive list of non-`/api` state-changing effective paths that
 * have been security-audited and judged safe. Empty by default. Add
 * an entry only with a code comment justifying why CSRF is not
 * required (e.g. an out-of-band auth factor like `x-setup-secret`,
 * or a single-use signed token in the body).
 */
const EXPLICIT_NON_API_ALLOWLIST: readonly string[] = [];

// `app.<method>('<path>', ...)` — direct routes on the Express app.
// Groups: 1=method, 2=quote, 3=path.
const APP_ROUTE_RE =
  /\bapp\s*\.\s*(post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/g;

// Capture `app.use('<prefix>', <restArgs>)`. `restArgs` may include
// middlewares and ends with the router. We pick the LAST identifier
// in `restArgs` that's a recognised import as the router.
// Groups: 1=quote, 2=prefix, 3=restArgs.
const APP_USE_RE = /\bapp\s*\.\s*use\s*\(\s*(['"`])([^'"`]+)\1\s*,\s*([^)]+)\)/g;

// `<id>.<method>('<subpath>', ...)` — any router method call. We skip
// `id === 'app'` because direct app routes are handled separately.
// Groups: 1=id, 2=method, 3=quote, 4=subpath.
const ROUTER_ROUTE_RE =
  /\b([A-Za-z_$][\w$]*)\s*\.\s*(post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\3/g;

// Default imports: `import name from 'spec'`.
const IMPORT_DEFAULT_RE = /import\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2/g;

const IDENT_RE = /\b([A-Za-z_$][\w$]*)\b/g;

interface Violation {
  method: string;
  path: string;
  source: string;
  detail?: string;
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue;
      out.push(...walkTs(full));
    } else if (
      st.isFile() &&
      name.endsWith('.ts') &&
      !name.endsWith('.d.ts') &&
      !name.endsWith('.test.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  // Tolerate `.js` extensions (common ESM-style relative imports).
  const base = resolve(dirname(fromFile), spec.replace(/\.js$/, ''));
  for (const candidate of [base + '.ts', join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function joinPaths(prefix: string, subpath: string): string {
  const cleanSub = subpath.startsWith('/') ? subpath : '/' + subpath;
  if (cleanSub === '/') return prefix;
  return prefix + cleanSub;
}

function main(): void {
  const files = walkTs(SERVER_DIR);

  // routerFile -> set of mount prefixes seen at app.use sites.
  const fileToMountPrefixes = new Map<string, Set<string>>();

  // routerFile -> direct routes registered on routers defined inside
  // that file (any local var that isn't `app`).
  const routerRoutesByFile = new Map<
    string,
    { method: string; subpath: string }[]
  >();

  const directAppRoutes: Violation[] = [];

  for (const file of files) {
    const src = stripComments(readFileSync(file, 'utf8'));

    // Build local default-import map: localName -> resolved file path.
    const importMap = new Map<string, string>();
    for (const m of src.matchAll(IMPORT_DEFAULT_RE)) {
      const localName = m[1];
      const spec = m[3];
      const resolved = resolveImport(file, spec);
      if (resolved) importMap.set(localName, resolved);
    }

    // app.use('<prefix>', ..., <router>) — record mount prefix on
    // the imported router file. We pick the LAST identifier in the
    // rest-args that's in importMap as the router.
    for (const m of src.matchAll(APP_USE_RE)) {
      const prefix = m[2];
      const restArgs = m[3];
      const idents = [...restArgs.matchAll(IDENT_RE)].map((x) => x[1]);
      let routerFile: string | null = null;
      for (let i = idents.length - 1; i >= 0; i--) {
        const candidate = importMap.get(idents[i]);
        if (candidate) {
          routerFile = candidate;
          break;
        }
      }
      if (routerFile) {
        if (!fileToMountPrefixes.has(routerFile)) {
          fileToMountPrefixes.set(routerFile, new Set());
        }
        fileToMountPrefixes.get(routerFile)!.add(prefix);
      }
    }

    // Direct app.<method>('<path>', ...) routes anywhere in server/.
    for (const m of src.matchAll(APP_ROUTE_RE)) {
      directAppRoutes.push({
        method: m[1].toUpperCase(),
        path: m[3],
        source: file,
      });
    }

    // <id>.<method>('<subpath>', ...) — router routes, attributed to
    // the file they're declared in. Skip `app` (handled above).
    const localRoutes: { method: string; subpath: string }[] = [];
    for (const m of src.matchAll(ROUTER_ROUTE_RE)) {
      if (m[1] === 'app') continue;
      localRoutes.push({ method: m[2].toUpperCase(), subpath: m[4] });
    }
    if (localRoutes.length > 0) {
      routerRoutesByFile.set(file, localRoutes);
    }
  }

  const violations: Violation[] = [];

  // Case 1: direct app.<method> routes outside /api.
  for (const r of directAppRoutes) {
    if (r.path.startsWith('/api/') || r.path === '/api') continue;
    if (EXPLICIT_NON_API_ALLOWLIST.includes(r.path)) continue;
    violations.push(r);
  }

  // Case 2: router.<method> routes whose effective mount path is
  // outside /api. A router file with no recorded mount is silently
  // skipped — either it's mounted via a pattern we don't parse, or
  // it isn't wired up yet (no live exposure to flag).
  for (const [file, routes] of routerRoutesByFile) {
    const prefixes = fileToMountPrefixes.get(file);
    if (!prefixes || prefixes.size === 0) continue;
    for (const r of routes) {
      for (const prefix of prefixes) {
        const effective = joinPaths(prefix, r.subpath);
        if (effective.startsWith('/api/') || effective === '/api') continue;
        if (EXPLICIT_NON_API_ALLOWLIST.includes(effective)) continue;
        violations.push({
          method: r.method,
          path: effective,
          source: file,
          detail: `mounted at '${prefix}' + '${r.subpath}'`,
        });
      }
    }
  }

  if (violations.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      '[check-csrf-coverage] OK — no state-changing routes outside /api detected anywhere in server/.',
    );
    return;
  }

  // eslint-disable-next-line no-console
  console.error(
    '[check-csrf-coverage] FAIL — state-changing routes outside /api detected:',
  );
  for (const v of violations) {
    const rel = relative(process.cwd(), v.source);
    const tail = v.detail ? `  [${v.detail}]` : '';
    // eslint-disable-next-line no-console
    console.error(`  - ${v.method} ${v.path}  (in ${rel})${tail}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    "\nThe global CSRF mount is `app.use('/api', csrfProtection)` — routes\n" +
      'outside /api silently bypass it. Either move the route under /api,\n' +
      'or (only with security-team sign-off) add it to\n' +
      'EXPLICIT_NON_API_ALLOWLIST in scripts/check-csrf-coverage.ts with\n' +
      'an inline justification. See docs/security/csrf-coverage.md.',
  );
  process.exit(1);
}

main();
