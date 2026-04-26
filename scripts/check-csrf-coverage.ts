/**
 * CSRF coverage guard (task #308, extended in tasks #338, #397, #446).
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
 * Nested router composition (task #397, refined in #446): the guard
 * ALSO follows `<parentRouter>.use('<sub>', <childRouter>)` calls.
 * The child router inherits the parent's effective prefix(es), joined
 * with `<sub>`. Propagation is fixed-point so multi-level chains
 * (grandparent → parent → child) and fan-out (the same child mounted
 * under several parents) are handled — this closes the gap where a
 * parent router that has no direct routes of its own (only
 * `router.use(...)` composition) and is accidentally mounted at a
 * non-`/api` prefix would otherwise slip through, because there'd be
 * no parent-level direct route to trip case 1 or case 2 above.
 *
 * To do the propagation precisely, routes and mount prefixes are
 * tracked per `(file, routerVarName)` pair rather than per file. That
 * lets the script distinguish a parent Router var's routes from a
 * child Router var's routes when both are declared in the same source
 * file, so same-file composition propagates correctly without
 * conflating the two routers' route sets (#446). For cross-file
 * mounts, a default import resolves to its source file's
 * `export default <name>` Router var; if no explicit name is exported
 * (rare in this codebase — the convention is `export default router`),
 * the prefix is conservatively attributed to every local Router var
 * in the imported file, which preserves the prior file-as-router
 * behavior for that edge case.
 *
 * Parser contract / unsupported forms:
 *   - State-changing verbs covered: POST, PUT, PATCH, DELETE, and
 *     `.all()`. The Express `.all()` form registers a single handler
 *     for EVERY HTTP method (including the four explicit verbs above),
 *     so it's a state-changing mount and is flagged the same way.
 *     Plain `.get()` is intentionally not covered (GETs aren't
 *     state-changing for CSRF purposes).
 *   - `app.use(router)` and `parent.use(child)` (no string prefix)
 *     are not modelled — the regexes require a string-literal prefix
 *     as the first argument. Mount-at-root composition is rare in
 *     practice and would require a separate parsing pass.
 *   - Cross-file composition (`parent.use('<sub>', importedChild)`)
 *     resolves the child via its source file's `export default <name>`
 *     declaration. The captured `<name>` is admitted as a Router var
 *     for the purposes of route/mount attribution even if it isn't a
 *     literal `Router()` declaration in that file (catches factory-
 *     style routers like `const r = createRouter(); export default r;`,
 *     which the per-var model would otherwise silently lose track of).
 *     Files that default-export an inline expression
 *     (`export default Router()` or `export default createRouter()`)
 *     instead of a named var are still not resolved — the regex needs
 *     an identifier to bind the mount to.
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
// `all` is included in the alternation because `app.all(path, handler)`
// registers the handler for EVERY HTTP method (including POST/PUT/PATCH/
// DELETE), so an `.all()` mount outside `/api/` would silently bypass
// CSRF just like an explicit verb would.
// Groups: 1=method, 2=quote, 3=path.
const APP_ROUTE_RE =
  /\bapp\s*\.\s*(all|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/g;

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
// `all` is included for the same reason as in APP_ROUTE_RE: a
// `router.all('<subpath>', handler)` mount registers the handler for
// every HTTP method, so it's state-changing and must be flagged when
// its effective path falls outside `/api/`.
// Groups: 1=id, 2=method, 3=quote, 4=subpath.
const ROUTER_ROUTE_RE =
  /\b([A-Za-z_$][\w$]*)\s*\.\s*(all|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\3/g;

// Default imports: `import name from 'spec'`.
const IMPORT_DEFAULT_RE = /import\s+([A-Za-z_$][\w$]*)\s+from\s+(['"])([^'"]+)\2/g;

// Local Router definitions: `const <name> = Router()` or
// `const <name> = express.Router()`. Tolerates an optional TS type
// annotation between the name and `=`.
const LOCAL_ROUTER_RE =
  /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:express\s*\.\s*)?Router\s*\(/g;

// `export default <name>;` — used to map a default-imported router
// (in some other file) back to the specific Router var declared in
// THIS file. Only matters when `<name>` resolves to a local Router
// var (the call site filters non-Router defaults out).
const EXPORT_DEFAULT_RE = /\bexport\s+default\s+([A-Za-z_$][\w$]*)\s*;?/g;

const IDENT_RE = /\b([A-Za-z_$][\w$]*)\b/g;

interface Violation {
  method: string;
  path: string;
  source: string;
  detail?: string;
}

// A `RouterKey` identifies a specific Router var inside a specific
// file. NUL is used as the separator so a literal occurrence in a
// path (vanishingly unlikely, but defensively impossible) cannot
// collide with the file/var boundary.
type RouterKey = string;
const KEY_SEP = '\u0000';

function makeKey(file: string, varName: string): RouterKey {
  return file + KEY_SEP + varName;
}

function unpackKey(key: RouterKey): { file: string; varName: string } {
  const idx = key.indexOf(KEY_SEP);
  return { file: key.slice(0, idx), varName: key.slice(idx + 1) };
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

  // Cache stripped sources so the two passes don't re-read+re-strip
  // every file. The script is fast either way; this just keeps the
  // intent (one parse per file) explicit.
  const srcByFile = new Map<string, string>();
  for (const file of files) {
    srcByFile.set(file, stripComments(readFileSync(file, 'utf8')));
  }

  // ------------------------------------------------------------------
  // Pass 1: per-file discovery.
  //
  // We need to know two things up front before we can attribute mount
  // prefixes to specific Router vars:
  //   - Which identifiers in each file are local `Router()` vars.
  //   - Which (if any) of those vars is the file's `export default`.
  //
  // Pass 2 then uses this to resolve cross-file `app.use('/foo',
  // importedRouter)` mounts down to the actual Router var declared
  // inside the imported file, instead of attributing the prefix to
  // the file as a whole.
  // ------------------------------------------------------------------
  const fileToLocalRouterVars = new Map<string, Set<string>>();
  const fileToDefaultExportVar = new Map<string, string>();
  for (const file of files) {
    const src = srcByFile.get(file)!;
    const vars = new Set<string>();
    for (const m of src.matchAll(LOCAL_ROUTER_RE)) vars.add(m[1]);
    // Last `export default <name>` wins (a file shouldn't have more
    // than one, but matchAll gives a deterministic outcome either
    // way). The captured name is admitted as a Router var even if
    // it isn't a literal `Router()` declaration — that catches
    // factory patterns (`const r = createRouter(); export default r;`)
    // where `r` isn't matched by LOCAL_ROUTER_RE but is still the
    // file's effective Router. Without this, a default-import of
    // such a file mounted at non-/api would have no resolvable target
    // for either the prefix attribution or the route attribution,
    // and the bypass would silently slip past the guard. False-
    // positive risk is negligible: `export default someUnrelatedFn`
    // would only matter if some other file did `app.use('/x',
    // importedFn)` AND that file had a `someUnrelatedFn.<method>(...)`
    // call somewhere, which is a non-pattern.
    let lastDefault: string | undefined;
    for (const m of src.matchAll(EXPORT_DEFAULT_RE)) {
      lastDefault = m[1];
    }
    if (lastDefault !== undefined) {
      vars.add(lastDefault);
      fileToDefaultExportVar.set(file, lastDefault);
    }
    fileToLocalRouterVars.set(file, vars);
  }

  // Resolve a file that is being default-imported elsewhere down to
  // the set of `RouterKey`s the import targets.
  //   - Preferred path: the file has an explicit `export default <name>`
  //     where `<name>` is a local Router var. Returns one key.
  //   - Fallback: no recognised default-export name. Conservatively
  //     return every local Router var in the file. With the prevailing
  //     "one Router per file" convention this is identical to the
  //     preferred path; if the convention is broken in some future file
  //     it over-attributes (might surface a spurious extra effective
  //     path) rather than under-attributing (silently missing a
  //     bypass), which is the right side to err on for a CSRF guard.
  function resolveDefaultImportTargets(importedFile: string): RouterKey[] {
    const explicit = fileToDefaultExportVar.get(importedFile);
    if (explicit !== undefined) return [makeKey(importedFile, explicit)];
    const vars = fileToLocalRouterVars.get(importedFile);
    if (!vars || vars.size === 0) return [];
    return Array.from(vars, (v) => makeKey(importedFile, v));
  }

  // ------------------------------------------------------------------
  // Pass 2: collect mount prefixes, composition edges, and routes,
  // all keyed per (file, routerVarName) pair.
  // ------------------------------------------------------------------

  // RouterKey -> set of mount prefixes seen for that specific Router
  // var (from `app.use(...)` sites in pass 2 plus anything propagated
  // through composition edges in the propagation loop below).
  const varToMountPrefixes = new Map<RouterKey, Set<string>>();

  // RouterKey -> direct routes registered on THAT EXACT Router var
  // (not on the file as a whole — this is the per-var precision that
  // makes same-file composition work without conflating the parent's
  // and child's route sets, #446).
  const routerRoutesByVar = new Map<RouterKey, { method: string; subpath: string }[]>();

  // Composition edges discovered from `<parent>.use('<sub>', <child>)`
  // calls. Each edge says: "the child Router var inherits the parent
  // Router var's effective prefixes, each joined with `<sub>`."
  // Cross-file (child is a default-imported router) and same-file
  // (child is another local Router var in the same file) are both
  // modelled. Propagation runs to a fixed point AFTER all `app.use`
  // mounts have been recorded so the direction of resolution
  // (root mount → leaf router) is correct regardless of source-file
  // iteration order.
  interface CompositionEdge {
    parentKey: RouterKey;
    sub: string;
    childKey: RouterKey;
    sourceFile: string; // file the edge was declared in (for diagnostics)
  }
  const compositionEdges: CompositionEdge[] = [];

  const directAppRoutes: Violation[] = [];

  function addPrefix(key: RouterKey, prefix: string): void {
    let s = varToMountPrefixes.get(key);
    if (!s) {
      s = new Set();
      varToMountPrefixes.set(key, s);
    }
    s.add(prefix);
  }

  for (const file of files) {
    const src = srcByFile.get(file)!;
    const localRouterVars = fileToLocalRouterVars.get(file)!;

    // Build local default-import map: localName -> resolved file path.
    const importMap = new Map<string, string>();
    for (const m of src.matchAll(IMPORT_DEFAULT_RE)) {
      const localName = m[1];
      const spec = m[3];
      const resolved = resolveImport(file, spec);
      if (resolved) importMap.set(localName, resolved);
    }

    // app.use('<prefix>', ..., <router>) — record mount prefix on
    // either the imported router's per-file default-export Router var
    // (cross-file mount) OR a same-file local Router var. We pick
    // the LAST identifier in the rest-args that resolves to one of
    // those, so middlewares between the prefix and the router don't
    // fool the resolver.
    for (const m of src.matchAll(APP_USE_RE)) {
      const prefix = m[2];
      const restArgs = m[3];
      const idents = [...restArgs.matchAll(IDENT_RE)].map((x) => x[1]);
      for (let i = idents.length - 1; i >= 0; i--) {
        const id = idents[i];
        const importedFile = importMap.get(id);
        if (importedFile) {
          for (const targetKey of resolveDefaultImportTargets(importedFile)) {
            addPrefix(targetKey, prefix);
          }
          break;
        }
        if (localRouterVars.has(id)) {
          addPrefix(makeKey(file, id), prefix);
          break;
        }
      }
    }

    // <parent>.use('<sub>', ..., <child>) — nested router composition
    // (#397, refined in #446 to handle same-file parent+child).
    //
    // Parent must be a LOCAL Router var in this file (so we can
    // attribute its effective prefixes to a known key). Child can be
    // either an IMPORTED router (cross-file edge) OR another local
    // Router var (same-file edge) — both are now first-class.
    for (const m of src.matchAll(ROUTER_USE_RE)) {
      const parentId = m[1];
      // `app` is handled by APP_USE_RE — skip to avoid double-counting.
      if (parentId === 'app') continue;
      if (!localRouterVars.has(parentId)) continue;
      const parentKey = makeKey(file, parentId);
      const sub = m[3];
      const restArgs = m[4];
      const idents = [...restArgs.matchAll(IDENT_RE)].map((x) => x[1]);
      for (let i = idents.length - 1; i >= 0; i--) {
        const id = idents[i];
        // Skip the parent itself in case it shows up in restArgs.
        if (id === parentId) continue;
        const importedFile = importMap.get(id);
        if (importedFile) {
          for (const childKey of resolveDefaultImportTargets(importedFile)) {
            compositionEdges.push({ parentKey, sub, childKey, sourceFile: file });
          }
          break;
        }
        if (localRouterVars.has(id)) {
          const childKey = makeKey(file, id);
          compositionEdges.push({ parentKey, sub, childKey, sourceFile: file });
          break;
        }
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
    // the EXACT (file, id) pair they were called on. Skip `app`
    // (handled above) and any `<id>` that isn't a recognised local
    // Router var in this file: such a call has no resolvable mount
    // chain in this guard's model (the id might be an imported router
    // mutated cross-file, a non-Router object that happens to have a
    // `.post` method, etc.), so attributing routes to it would be
    // noise rather than coverage.
    for (const m of src.matchAll(ROUTER_ROUTE_RE)) {
      const id = m[1];
      if (id === 'app') continue;
      if (!localRouterVars.has(id)) continue;
      const key = makeKey(file, id);
      let routes = routerRoutesByVar.get(key);
      if (!routes) {
        routes = [];
        routerRoutesByVar.set(key, routes);
      }
      routes.push({ method: m[2].toUpperCase(), subpath: m[4] });
    }
  }

  // Propagate parent → child prefixes through composition edges to a
  // fixed point. Each iteration walks every edge once; we stop when no
  // child set grows. Termination is guaranteed because every iteration
  // either adds at least one new (childKey, prefix) pair or halts,
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
      const parentPrefixes = varToMountPrefixes.get(edge.parentKey);
      if (!parentPrefixes || parentPrefixes.size === 0) continue;
      // Snapshot before iterating. A self-edge (parentKey === childKey)
      // would otherwise grow the Set during iteration. The check below
      // would still terminate via PROPAGATION_CAP, but the snapshot
      // makes the iteration itself well-defined regardless.
      const parentSnapshot = Array.from(parentPrefixes);
      let childSet = varToMountPrefixes.get(edge.childKey);
      if (!childSet) {
        childSet = new Set();
        varToMountPrefixes.set(edge.childKey, childSet);
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
  // graph almost certainly contains a cycle (or the chain is deeper
  // than the cap). Either way the prefix set we computed is
  // INCOMPLETE — there could be effective paths we never visited,
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
  // outside /api. A Router var with no recorded mount is silently
  // skipped — either it's mounted via a pattern we don't parse, or
  // it isn't wired up yet (no live exposure to flag).
  for (const [key, routes] of routerRoutesByVar) {
    const prefixes = varToMountPrefixes.get(key);
    if (!prefixes || prefixes.size === 0) continue;
    const { file } = unpackKey(key);
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
