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
 * Nested router composition (task #397): the guard ALSO follows
 * `<parentRouter>.use('<sub>', <childRouter>)` calls. The child
 * router inherits the parent's effective prefix(es), joined with
 * `<sub>`. Propagation is fixed-point so multi-level chains
 * (grandparent → parent → child) and fan-out (the same child mounted
 * under several parents) are handled — this closes the gap where a
 * parent router that has no direct routes of its own (only
 * `router.use(...)` composition) and is accidentally mounted at a
 * non-`/api` prefix would otherwise slip through, because there'd be
 * no parent-level direct route to trip case 1 or case 2 above.
 *
 * Parser contract / unsupported forms:
 *   - `app.use(router)` and `parent.use(child)` (no string prefix)
 *     are not modelled — the regexes require a string-literal prefix
 *     as the first argument. Mount-at-root composition is rare in
 *     practice and would require a separate parsing pass.
 *   - Same-file nested composition (parent and child Router vars in
 *     the SAME source file) is intentionally NOT propagated. The
 *     file-as-router model can't distinguish parent-router routes
 *     from child-router routes when they share a file; trying to
 *     model it caused a Set-add-during-iteration crash and false
 *     positives. The convention here is one Router per file, default
 *     export, so this isn't a real-world gap.
 *   - Computed mount paths (`app.use(`/foo/${var}`, ...)`) are not
 *     modelled — the regexes only match plain string literals.
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

// Capture `<parentId>.use('<sub>', <restArgs>)` for nested router
// composition (task #397). Same shape as APP_USE_RE; we'll filter
// out `parentId === 'app'` at use-site so this regex doesn't fight
// APP_USE_RE for the same matches.
// Groups: 1=parentId, 2=quote, 3=sub, 4=restArgs.
const ROUTER_USE_RE =
  /\b([A-Za-z_$][\w$]*)\s*\.\s*use\s*\(\s*(['"`])([^'"`]+)\2\s*,\s*([^)]+)\)/g;

// `<id>.<method>('<subpath>', ...)` — any router method call. We skip
// `id === 'app'` because direct app routes are handled separately.
// Groups: 1=id, 2=method, 3=quote, 4=subpath.
const ROUTER_ROUTE_RE =
  /\b([A-Za-z_$][\w$]*)\s*\.\s*(post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\3/g;

// Default imports: `import name from 'spec'`.
const IMPORT_DEFAULT_RE = /import\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2/g;

// Local Router definitions: `const <name> = Router()` or
// `const <name> = express.Router()`. Tolerates an optional TS type
// annotation between the name and `=`.
const LOCAL_ROUTER_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:express\s*\.\s*)?Router\s*\(/g;

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

  // Composition edges discovered from `<parent>.use('<sub>', <child>)`
  // calls. Each edge says: "the child router file inherits the parent
  // router file's effective prefixes, each joined with `<sub>`". We
  // collect these in the per-file pass and propagate them to a fixed
  // point AFTER all `app.use(...)` mounts have been recorded — so the
  // direction of resolution (root mount → leaf router) is correct
  // regardless of source-file iteration order.
  interface CompositionEdge {
    parentFile: string;
    sub: string;
    childFile: string;
    sourceFile: string; // file the edge was declared in (for diagnostics)
  }
  const compositionEdges: CompositionEdge[] = [];

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

    // Local Router definitions in this file. Used to attribute
    // same-file mounts (`const r = Router(); app.use('/foo', r)`)
    // back to the file's own router routes — without this, a router
    // defined and mounted in the same file (a real pattern in this
    // codebase, e.g. `server/routes/auth.ts`) would silently bypass
    // the guard.
    const localRouterVars = new Set<string>();
    for (const m of src.matchAll(LOCAL_ROUTER_RE)) {
      localRouterVars.add(m[1]);
    }

    // app.use('<prefix>', ..., <router>) — record mount prefix on
    // either an imported router file (cross-file mount) OR the
    // current file (same-file mount on a local Router var). We pick
    // the LAST identifier in the rest-args that resolves to one of
    // those, so middlewares between the prefix and the router don't
    // fool the resolver.
    for (const m of src.matchAll(APP_USE_RE)) {
      const prefix = m[2];
      const restArgs = m[3];
      const idents = [...restArgs.matchAll(IDENT_RE)].map((x) => x[1]);
      let routerFile: string | null = null;
      for (let i = idents.length - 1; i >= 0; i--) {
        const id = idents[i];
        const importedFile = importMap.get(id);
        if (importedFile) {
          routerFile = importedFile;
          break;
        }
        if (localRouterVars.has(id)) {
          routerFile = file;
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

    // <parent>.use('<sub>', ..., <child>) — nested router composition
    // (task #397). The parent must be a LOCAL router var defined in
    // THIS file (so we can attribute its effective prefixes to this
    // file). The child must resolve to an IMPORTED router file (so we
    // can attribute the joined prefix to a different file).
    //
    // Same-file composition (parent and child both Router vars in the
    // SAME file) is intentionally NOT modelled here. It would require
    // tracking routes per Router var rather than per file, which is a
    // bigger rework than #397 calls for, and the prevailing convention
    // in this codebase is "one Router per file, exported as default" —
    // so the same-file pattern doesn't arise organically. If it ever
    // does, the parent's own routes would still trip the existing case
    // 2 check, drawing attention to the misconfigured mount.
    for (const m of src.matchAll(ROUTER_USE_RE)) {
      const parentId = m[1];
      // `app` is handled by APP_USE_RE — skip to avoid double-counting.
      if (parentId === 'app') continue;
      // Parent has to be a router defined IN this file. If it isn't,
      // we don't know which file's effective prefixes to inherit.
      if (!localRouterVars.has(parentId)) continue;
      const sub = m[3];
      const restArgs = m[4];
      const idents = [...restArgs.matchAll(IDENT_RE)].map((x) => x[1]);
      let childFile: string | null = null;
      for (let i = idents.length - 1; i >= 0; i--) {
        const id = idents[i];
        // Skip the parent itself in case it shows up in restArgs.
        if (id === parentId) continue;
        const importedFile = importMap.get(id);
        if (importedFile) {
          childFile = importedFile;
          break;
        }
        // Local router var → same-file composition; intentionally
        // skipped (see block comment above). Continue scanning rather
        // than recording a self-edge.
      }
      if (childFile && childFile !== file) {
        compositionEdges.push({
          parentFile: file,
          sub,
          childFile,
          sourceFile: file,
        });
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

  // Propagate parent → child prefixes through composition edges to a
  // fixed point. Each iteration walks every edge once; we stop when no
  // child set grows. Termination is guaranteed because every iteration
  // either adds at least one new (childFile, prefix) pair or halts,
  // and the universe of such pairs is finite. Cycles (which shouldn't
  // happen in real router graphs anyway) terminate harmlessly for the
  // same reason.
  //
  // The iteration cap is a defensive belt-and-braces against a future
  // bug in the propagation rule that would otherwise spin forever; in
  // a well-formed graph the inner loop terminates in 1 pass per chain
  // depth, so 64 is well above any plausible nesting in this codebase.
  const PROPAGATION_CAP = 64;
  let propagationExhausted = false;
  for (let pass = 0; pass < PROPAGATION_CAP; pass++) {
    let changed = false;
    for (const edge of compositionEdges) {
      const parentPrefixes = fileToMountPrefixes.get(edge.parentFile);
      if (!parentPrefixes || parentPrefixes.size === 0) continue;
      // Snapshot before iterating. Self-edges (childFile === parentFile)
      // are filtered out at edge-collection time, but a future edge that
      // happens to yield childFile === parentFile after some other code
      // path would otherwise grow the Set unboundedly via add-during-
      // iteration. Cheap belt-and-braces.
      const parentSnapshot = Array.from(parentPrefixes);
      let childSet = fileToMountPrefixes.get(edge.childFile);
      if (!childSet) {
        childSet = new Set();
        fileToMountPrefixes.set(edge.childFile, childSet);
      }
      for (const pp of parentSnapshot) {
        const combined = joinPaths(pp, edge.sub);
        if (!childSet.has(combined)) {
          childSet.add(combined);
          changed = true;
        }
      }
    }
    if (!changed) break;
    if (pass === PROPAGATION_CAP - 1) propagationExhausted = true;
  }
  // If propagation was still adding entries at the cap, the router
  // graph almost certainly contains a cycle (or the cap is too low for
  // an unusually deep chain). Either way the prefix set we computed
  // is INCOMPLETE — there could be effective paths we never visited,
  // any of which might be a non-/api bypass. Fail loudly rather than
  // silently under-report.
  if (propagationExhausted) {
    // eslint-disable-next-line no-console
    console.error(
      `[check-csrf-coverage] FAIL — composition-edge propagation did not converge in ${PROPAGATION_CAP} passes. The router-composition graph likely contains a cycle, or the chain is deeper than the cap. Effective-path computation is INCOMPLETE; results below may be missing bypasses. Investigate scripts/check-csrf-coverage.ts and the router import graph.`,
    );
    process.exit(1);
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
