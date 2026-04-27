/**
 * Project-wide guard against logging secret-bearing fields.
 *
 * Companion to the per-surface `assertNoTokenLeak` regression tests
 * (task #307 / #396) and to the broader `log.debug` PII guard
 * (`scripts/check-log-debug-pii.ts`, task #389 / #405).
 *
 * The per-surface tests are precise but only cover the auth surfaces
 * that someone remembered to write a test for. A new route added next
 * quarter that does:
 *
 *   log.info('login attempt', { password: req.body.password });
 *   log.warn(`csrf header: ${req.headers['x-csrf-token']}`);
 *   log.error('Reset failed for', { resetToken });
 *
 * would not be caught by any existing guard until someone notices.
 *
 * Task #432 introduced the original server-side scan. Task #515
 * extended the same machinery to the React client and shared code,
 * because the browser console is just as much a secret-leak surface
 * (it gets shipped to error trackers like Sentry, gets pasted into
 * user-supplied bug-report screenshots, etc).
 *
 * The script parses every `.ts` (and on the client, `.tsx`) file under
 * the configured surface roots with the TypeScript compiler API and
 * walks each call to a known log method:
 *
 *   log.<level>(...)        logger.<level>(...)        console.<level>(...)
 *   log?.<level>(...)       logger?.<level>(...)       console?.<level>(...)
 *   log['<level>'](...)     logger['<level>'](...)     console['<level>'](...)
 *
 * where <level> ∈ {debug, info, warn, error, trace, fatal, log}.
 *
 * Inside each argument subtree it flags as a leak any of the
 * forbidden shapes for that surface (see SERVER_SURFACE /
 * CLIENT_SURFACE below). Common shapes shared across surfaces:
 *
 *   - PropertyAccessExpression whose property name (case-insensitive)
 *     matches the surface's `forbiddenPropertyNames` set. Catches
 *     `req.body.password`, `result.token`, `data.csrfToken`, etc. —
 *     including optional-chain (`req?.body?.token`) and computed-string
 *     forms (`req.body['password']`).
 *
 *   - Bare Identifier whose name (case-insensitive) is in the surface's
 *     `forbiddenIdentifiersStrict` set. These names have no benign
 *     meaning in this codebase — every variable named `csrfToken` or
 *     `inviteToken` IS the secret. Flagged in any value-reference
 *     position, including as a property-access receiver
 *     (`csrfToken.length`).
 *
 *   - Bare Identifier in `forbiddenIdentifiersValueOnly` flagged ONLY
 *     in value-reference positions where it stands alone (a direct
 *     argument, a template interpolation `${token}`, a shorthand
 *     property `{ token }`), NOT when it is the receiver of a further
 *     property access (`token.id` — common metadata access on payment
 *     / api tokens where the secret bytes live in a different field).
 *     The property-access check above still catches `req.body.token` /
 *     `result.token`, so the dangerous shapes are not blind spots.
 *
 *   - ElementAccessExpression with a string-literal argument matching
 *     the surface's `forbiddenHeaderKeys` set (`x-csrf-token`,
 *     `x-setup-secret`).
 *
 * Client-only additions (because the React client never touches Express
 * `req.headers` but does talk to react-hook-form):
 *
 *   - CallExpression where the receiver method name is in
 *     `forbiddenFormGetterMethods` (`getValues`, `watch`,
 *     `getFieldState`) AND the first string-literal argument is in
 *     `forbiddenFormFieldKeys`. Catches the realistic blind-spot
 *     `console.log('attempt', form.getValues('password'))`.
 *
 * Suppression: a call site can opt out with an inline comment
 *   // secret-log-ok: <reason>
 * or a block-form `/* secret-log-ok: <reason> *\/`. The reason is
 * required (must contain at least one alphanumeric char) so reviewers
 * can audit why the suppression is safe — typically because the
 * "leak" is a structural label, not a value (e.g.
 * `log.warn('csrfToken missing')`). Every active suppression is
 * documented in `docs/security/no-secrets-in-logs.md`.
 *
 * Default mode prints a report and exits 0 (advisory). With
 * `--strict` it exits 1 on any breach. Surface is selected with
 * `--surface=server` (default) or `--surface=client`. The vitest
 * forcing functions (`tests/unit/check-no-secrets-in-logs.test.ts`
 * and `tests/unit/check-no-secrets-in-logs-client.test.ts`) run
 * `--strict` against the real codebase per surface and assert exit 0
 * — that is how this becomes a CI gate without editing the locked
 * `package.json`.
 *
 * Run with:
 *   tsx scripts/check-no-secrets-in-logs.ts                      # server, advisory
 *   tsx scripts/check-no-secrets-in-logs.ts --strict              # server, CI gate
 *   tsx scripts/check-no-secrets-in-logs.ts --surface=client --strict
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const STRICT = process.argv.includes('--strict');

const LOG_ROOTS = new Set(['log', 'logger', 'console']);
const LOG_LEVELS = new Set([
  'debug',
  'info',
  'warn',
  'error',
  'trace',
  'fatal',
  'log',
]);

/**
 * Per-surface configuration. Each surface declares its own roots
 * (which directories to walk), file extensions (server is `.ts`-only,
 * client also reads `.tsx`), and forbidden-shape sets. Keeping the
 * sets per-surface lets us tune client-only patterns
 * (`form.getValues('password')`) without false-positiving the server
 * scan, and lets us add server-only patterns (`x-setup-secret` is a
 * bootstrap-admin header that never appears in client code) without
 * polluting the client scan.
 */
export interface Surface {
  name: 'server' | 'client';
  roots: string[];
  fileExtensions: string[];
  forbiddenPropertyNames: Set<string>;
  forbiddenIdentifiersStrict: Set<string>;
  forbiddenIdentifiersValueOnly: Set<string>;
  forbiddenHeaderKeys: Set<string>;
  forbiddenFormGetterMethods: Set<string>;
  forbiddenFormFieldKeys: Set<string>;
}

const SHARED_SECRET_PROPS = [
  'password',
  'token',
  'invitetoken',
  'setupsecret',
  'csrftoken',
  'resettoken',
];

const SHARED_HEADER_KEYS = ['x-csrf-token', 'x-setup-secret'];

export const SERVER_SURFACE: Surface = {
  name: 'server',
  roots: [resolve(process.cwd(), 'server')],
  fileExtensions: ['.ts'],
  forbiddenPropertyNames: new Set(SHARED_SECRET_PROPS),
  forbiddenIdentifiersStrict: new Set([
    'invitetoken',
    'setupsecret',
    'csrftoken',
    'resettoken',
  ]),
  // `token` is in the brief's list but has more benign uses than the
  // strict set above — `token.id`, `token.kind`, etc., commonly
  // reference internal payment-token / api-token metadata where the
  // secret bytes live in a different field.
  forbiddenIdentifiersValueOnly: new Set(['token']),
  forbiddenHeaderKeys: new Set(SHARED_HEADER_KEYS),
  forbiddenFormGetterMethods: new Set(),
  forbiddenFormFieldKeys: new Set(),
};

export const CLIENT_SURFACE: Surface = {
  name: 'client',
  roots: [
    resolve(process.cwd(), 'client/src'),
    resolve(process.cwd(), 'shared'),
  ],
  fileExtensions: ['.ts', '.tsx'],
  // The client uses react-hook-form's `currentPassword` / `newPassword`
  // / `confirmPassword` field names verbatim across the change-password,
  // set-password, and admin reset-password flows. Each is just as much
  // a leak risk as bare `password`.
  forbiddenPropertyNames: new Set([
    ...SHARED_SECRET_PROPS,
    'currentpassword',
    'newpassword',
    'confirmpassword',
  ]),
  forbiddenIdentifiersStrict: new Set([
    'invitetoken',
    'setupsecret',
    'csrftoken',
    'resettoken',
    'currentpassword',
    'newpassword',
    'confirmpassword',
  ]),
  // The brief calls out "password input value to the browser console"
  // as the realistic client-side leak. Bare `password` standing alone
  // in a value position is the canonical shape; `password.length`
  // (property-access receiver) is benign metadata, the property-access
  // rule above already catches `data.password`.
  forbiddenIdentifiersValueOnly: new Set(['token', 'password']),
  forbiddenHeaderKeys: new Set(SHARED_HEADER_KEYS),
  // react-hook-form readers. A `console.log('x', form.getValues('password'))`
  // pulls the live value out of the controlled input and dumps it. Same
  // for `form.watch('password')`. `form.getFieldState('password')` is
  // metadata-only (touched / dirty / errors), not the value, but its
  // presence inside a log line is still the kind of pattern reviewers
  // want to catch — flagged for symmetry.
  forbiddenFormGetterMethods: new Set(['getValues', 'watch', 'getFieldState']),
  forbiddenFormFieldKeys: new Set([
    'password',
    'currentpassword',
    'newpassword',
    'confirmpassword',
    'token',
    'csrftoken',
    'invitetoken',
    'setupsecret',
    'resettoken',
  ]),
};

const SURFACES: Record<'server' | 'client', Surface> = {
  server: SERVER_SURFACE,
  client: CLIENT_SURFACE,
};

const SUPPRESSION_LOCATE_RE = /\bsecret-log-ok\s*:/i;
function commentSuppresses(commentText: string): boolean {
  const m = SUPPRESSION_LOCATE_RE.exec(commentText);
  if (!m) return false;
  let rest = commentText.slice(m.index + m[0].length);
  if (commentText.startsWith('/*')) {
    const end = rest.lastIndexOf('*/');
    if (end !== -1) rest = rest.slice(0, end);
  }
  return /[A-Za-z0-9]/.test(rest);
}

/**
 * Scope-introducing nodes: any node that hosts its own `let` /
 * `const` / parameter bindings. Mirrors the helper of the same
 * name in `scripts/check-log-debug-pii.ts` so the two guards
 * agree on what counts as a scope (var hoisting, parameter
 * shadowing, destructuring, catch clauses, etc.).
 */
function isScopeIntroducingNode(node: ts.Node): boolean {
  if (ts.isSourceFile(node)) return true;
  if (ts.isBlock(node)) return true;
  if (ts.isFunctionDeclaration(node)) return true;
  if (ts.isFunctionExpression(node)) return true;
  if (ts.isArrowFunction(node)) return true;
  if (ts.isMethodDeclaration(node)) return true;
  if (ts.isConstructorDeclaration(node)) return true;
  if (ts.isGetAccessorDeclaration(node)) return true;
  if (ts.isSetAccessorDeclaration(node)) return true;
  if (ts.isForStatement(node)) return true;
  if (ts.isForInStatement(node)) return true;
  if (ts.isForOfStatement(node)) return true;
  if (ts.isCatchClause(node)) return true;
  return false;
}

function nearestScope(node: ts.Node): ts.Node {
  let n: ts.Node | undefined = node.parent;
  while (n && !isScopeIntroducingNode(n)) n = n.parent;
  return n ?? node.getSourceFile();
}

function isFunctionScope(node: ts.Node): boolean {
  return (
    ts.isSourceFile(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  );
}

function nearestFunctionScope(node: ts.Node): ts.Node {
  let n: ts.Node | undefined = node.parent;
  while (n && !isFunctionScope(n)) n = n.parent;
  return n ?? node.getSourceFile();
}

function isVarDeclaration(decl: ts.VariableDeclaration): boolean {
  const list = decl.parent;
  if (list && ts.isVariableDeclarationList(list)) {
    return (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
  }
  return false;
}

/**
 * A binding resolves to one of four classifications:
 *
 *   - 'forbidden' — the local holds a secret string (initialized
 *     from a forbidden property access / element access / identifier
 *     / form-reader call, possibly via single-hop or multi-hop alias).
 *     A use of the local in a value-reference position inside a log
 *     call is a leak.
 *
 *   - 'helper' — the local IS a function (function declaration,
 *     arrow function expression, or function expression) whose body
 *     returns a forbidden expression. A CALL to the local inside a
 *     log call is a leak — the return value carries the secret out.
 *     Task #541's headline case (`log.info(pickPassword(req))`).
 *
 *   - 'methodHost' — the local IS an object-with-methods or a class
 *     constructor (or an instance of one). A property-access call
 *     (`helpers.pickPassword(req)`, `obj.helper.pick(req)`,
 *     `h.pick(req)`, `new H().pick(req)`) whose method name resolves
 *     to a forbidden-return method on the host is a leak.
 *     Task #548's headline case — covers the natural bypass of
 *     routing the helper through a property access so the bare
 *     identifier rule from #541 does not match.
 *
 *   - 'other' — the name is bound here but to something benign.
 *     Load-bearing for shadowing: a `const pw = 'fixture'` in an
 *     inner scope must mask any same-named outer alias so the inner
 *     `pw` is NOT treated as a secret.
 */
interface MethodHost {
  // Methods on this host whose return value is a forbidden expression.
  // Keyed by method name; the value is the underlying reason text
  // (`property access ending in .password`, etc.) so the report can
  // point the reviewer at the real secret source.
  methods: Map<string, string>;
  // Sub-hosts reachable via a property access on this host. Lets a
  // nested object literal `{ helper: { pick: () => req.body.password } }`
  // be flagged via `obj.helper.pick(req)` — the brief explicitly
  // calls out `obj.helper.pick(req)` as one of the shapes to catch.
  nested: Map<string, MethodHost>;
}
type Binding =
  | { kind: 'forbidden'; reason: string }
  | { kind: 'helper'; reason: string }
  | { kind: 'methodHost'; host: MethodHost }
  | { kind: 'other' };

/**
 * tsconfig.json path aliases. Mirrors the `paths` map in
 * `tsconfig.json` so cross-file import resolution can resolve
 * `@shared/foo` / `@/components/Bar` / etc. to the on-disk file.
 *
 * Order matters: the longer prefix (`@shared/`, `@components/`)
 * must be tried before the shorter `@/` so we don't mis-match
 * `@shared/x` as `@/shared/x`.
 */
const TSCONFIG_PATH_ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['@shared/', 'shared/'],
  ['@server/', 'server/'],
  ['@components/', 'client/src/components/'],
  ['@lib/', 'client/src/lib/'],
  ['@hooks/', 'client/src/hooks/'],
  ['@ui/', 'client/src/components/ui/'],
  ['@/', 'client/src/'],
];

/**
 * Resolve an `import ... from '<spec>'` module specifier to an
 * on-disk source file path within the project. Returns null for
 * bare-package imports (those go to `node_modules` and are out of
 * scope for the same-package helper heuristic) and for any spec
 * the resolver cannot find on disk.
 *
 * Handles relative specs (`./foo`, `../bar/baz`), `tsconfig.json`
 * path aliases (`@shared/foo`, `@/components/Bar`), and the common
 * pattern of importing a `.ts` file via its emitted `.js`
 * extension (`./foo.js` -> `./foo.ts`).
 */
function resolveImportPath(
  fromFile: string,
  spec: string,
  surface: Surface,
): string | null {
  let base: string | null = null;
  for (const [alias, target] of TSCONFIG_PATH_ALIASES) {
    if (spec === alias.slice(0, -1)) {
      base = resolve(process.cwd(), target.slice(0, -1));
      break;
    }
    if (spec.startsWith(alias)) {
      base = resolve(process.cwd(), target + spec.slice(alias.length));
      break;
    }
  }
  if (base === null) {
    if (spec.startsWith('.')) {
      base = resolve(dirname(fromFile), spec);
    } else {
      // Bare package — out of scope for the same-package heuristic.
      return null;
    }
  }
  // Strip JS-style extensions; TS source often imports the emitted
  // `.js` form (`./helpers.js`) under `moduleResolution: bundler`.
  let stripped = base;
  for (const ext of ['.js', '.jsx', '.mjs', '.cjs']) {
    if (stripped.endsWith(ext)) {
      stripped = stripped.slice(0, -ext.length);
      break;
    }
  }
  // Try direct file with each surface-known extension; also fall
  // back to `.ts` so a `.tsx` file that imports a `.ts` helper
  // (server surface declares `.ts` only, but a re-import from a
  // shared location is still scannable) still resolves.
  const exts = Array.from(new Set([...surface.fileExtensions, '.ts']));
  for (const ext of exts) {
    if (existsSync(stripped + ext)) return stripped + ext;
  }
  for (const ext of exts) {
    const idx = join(stripped, 'index' + ext);
    if (existsSync(idx)) return idx;
  }
  return null;
}

/**
 * Classify a function's return value. Returns a forbidden
 * classification when ANY return statement (or, for an
 * expression-bodied arrow function, the body expression itself)
 * matches a forbidden shape — meaning calling this function
 * inside a log call would surface the secret.
 *
 * The walk explicitly does NOT descend into nested function
 * declarations / expressions / arrow functions / methods — those
 * have their own return-value semantics and a `return` statement
 * inside an inner function does NOT count as a return of the
 * outer function.
 *
 * `scopes` is optional; when provided, the underlying
 * `classifyInitializer` can resolve plain-identifier returns
 * (`return pw;` where `pw` is a same-file alias for
 * `req.body.password`) — the same mechanism that closes the
 * multi-hop alias gap from task #540, applied here to the
 * intra-helper case.
 */
function classifyFunctionReturn(
  fn:
    | ts.FunctionDeclaration
    | ts.FunctionExpression
    | ts.ArrowFunction
    | ts.MethodDeclaration,
  surface: Surface,
  scopes?: Map<ts.Node, Map<string, Binding>>,
): { kind: 'forbidden'; reason: string } | null {
  // Arrow function with expression body (`(req) => req.body.password`).
  // `classifyInitializer` may now also return a 'helper' alias
  // classification (task #550 — `const alias = pickPassword`); a
  // function that RETURNS a helper alias is NOT itself a forbidden
  // helper (the returned function is a value, not the secret), so
  // narrow to forbidden here.
  if (ts.isArrowFunction(fn) && fn.body && !ts.isBlock(fn.body)) {
    const cls = classifyInitializer(fn.body, surface, scopes);
    return cls && cls.kind === 'forbidden' ? cls : null;
  }
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return null;
  let result: { kind: 'forbidden'; reason: string } | null = null;
  const visit = (n: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isGetAccessorDeclaration(n) ||
      ts.isSetAccessorDeclaration(n)
    ) {
      // Do not descend into nested functions — their `return`s
      // belong to themselves, not to the enclosing function.
      return;
    }
    if (ts.isReturnStatement(n) && n.expression) {
      const cls = classifyInitializer(n.expression, surface, scopes);
      if (cls && cls.kind === 'forbidden' && !result) result = cls;
    }
    n.forEachChild(visit);
  };
  visit(body);
  return result;
}

/**
 * Strip transparent wrappers from an expression. The forbidden
 * shapes we care about at every caller (arrow / function expression /
 * object literal / class expression / new expression) are all
 * structurally invisible through paren AND through TS-only wrappers
 * (`as`, `<T>`, `!`, `satisfies`) — none alter the runtime value, so
 * looking through them keeps the alias-classification and method-host
 * detection from being trivially bypassed by a wrapper noise like
 * `const x = req.body.password as any`. Task #562 broadened this from
 * paren-only to the full transparent set; `isTransparentExpressionWrapper`
 * is the same predicate `unwrapTransparentCallee` (task #560) uses, so
 * adding a new transparent wrapper kind in one place fixes it for both
 * the call-site and the alias paths at once.
 */
function unwrapTransparentWrappers(expr: ts.Expression): ts.Expression {
  let n: ts.Expression = expr;
  while (isTransparentExpressionWrapper(n)) n = n.expression;
  return n;
}

/**
 * Build a MethodHost description for an object literal. Each property
 * whose value is an arrow / function expression with a forbidden
 * return is recorded as a forbidden-method on the host. Each property
 * whose value is itself an object literal recursively becomes a
 * nested host so `obj.helper.pick(req)` resolves end-to-end.
 *
 * Method-shorthand syntax (`{ pick(req) { return req.body.password; } }`)
 * is just a `MethodDeclaration` on the object-literal AST, so it is
 * picked up by the same loop.
 *
 * Returns null when the literal contains no forbidden methods AND no
 * non-empty nested hosts — keeps the binding map sparse so a benign
 * config-style object doesn't get a `methodHost` binding.
 */
function buildObjectLiteralMethodHost(
  obj: ts.ObjectLiteralExpression,
  surface: Surface,
  scopes?: Map<ts.Node, Map<string, Binding>>,
): MethodHost | null {
  const methods = new Map<string, string>();
  const nested = new Map<string, MethodHost>();
  for (const prop of obj.properties) {
    let name: string | null = null;
    if ('name' in prop && prop.name) {
      const pn = prop.name;
      if (ts.isIdentifier(pn) || ts.isStringLiteralLike(pn)) {
        name = pn.text;
      }
    }
    if (!name) continue;
    if (ts.isPropertyAssignment(prop)) {
      const init = unwrapTransparentWrappers(prop.initializer);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        const cls = classifyFunctionReturn(init, surface, scopes);
        if (cls) methods.set(name, cls.reason);
      } else if (ts.isObjectLiteralExpression(init)) {
        const sub = buildObjectLiteralMethodHost(init, surface, scopes);
        if (sub) nested.set(name, sub);
      } else if (ts.isClassExpression(init)) {
        const sub = buildClassMethodHost(init, surface, scopes);
        if (sub) nested.set(name, sub);
      }
    } else if (ts.isMethodDeclaration(prop)) {
      const cls = classifyFunctionReturn(prop, surface, scopes);
      if (cls) methods.set(name, cls.reason);
    }
  }
  if (methods.size === 0 && nested.size === 0) return null;
  return { methods, nested };
}

/**
 * Build a MethodHost description for a class declaration / class
 * expression. Each `MethodDeclaration` whose body returns a forbidden
 * expression contributes a forbidden-method entry. `static` and
 * instance methods are folded into the same map: a class binding
 * is consulted both for direct static calls (`H.pick(req)`) and for
 * instance calls (`new H().pick(req)` / `h.pick(req)` after `const
 * h = new H()`), and the runtime distinction between the two would
 * only matter for false-positive avoidance — but a method that is
 * declared on a class with the same name in either form IS callable
 * at the syntactic shape we care about, so unifying them is the
 * conservative choice.
 *
 * Constructors / accessors are intentionally skipped: a constructor
 * is invoked via `new`, not as a property-access call, and the
 * accessor get / set syntax does not match the call shape we flag.
 */
function buildClassMethodHost(
  cls: ts.ClassDeclaration | ts.ClassExpression,
  surface: Surface,
  scopes?: Map<ts.Node, Map<string, Binding>>,
): MethodHost | null {
  const methods = new Map<string, string>();
  for (const member of cls.members) {
    if (!ts.isMethodDeclaration(member)) continue;
    const pn = member.name;
    if (!ts.isIdentifier(pn) && !ts.isStringLiteralLike(pn)) continue;
    const c = classifyFunctionReturn(member, surface, scopes);
    if (c) methods.set(pn.text, c.reason);
  }
  if (methods.size === 0) return null;
  return { methods, nested: new Map() };
}

/**
 * Per-surface cache of `<exported helper name> -> Binding` for files
 * that have been parsed for cross-file helper detection. Keyed by
 * `<absolute path>:<surface name>` so a file that exports the same
 * function name under both surfaces (the shared/ tree) still gets
 * surface-specific classification.
 *
 * The map is set BEFORE populating to break import cycles —
 * `getExportedHelpers(A)` invoked while resolving B's imports while
 * resolving A's imports finds the in-progress empty map and
 * returns it instead of recursing forever.
 */
const EXPORT_HELPER_CACHE = new Map<string, Map<string, Binding>>();

function hasExportModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function hasDefaultModifier(node: ts.Node): boolean {
  if (!ts.canHaveModifiers(node)) return false;
  const mods = ts.getModifiers(node);
  return mods?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
}

/**
 * Sentinel key used in the exported-helpers map for a file's default
 * export. Default imports (`import name from './helpers'`) bind a
 * caller-chosen local name to whatever the source file's default
 * export resolves to, so the cross-file resolver records the helper
 * under this fixed key and the import walk looks it up by the same
 * key — independent of the local name the importing file picks.
 */
const DEFAULT_EXPORT_KEY = 'default';

/**
 * Parse `file` and extract the top-level exports whose shape can
 * carry a secret out of the importing file's log calls. Used by
 * `collectScopedBindings` to seed the importing file's source-file
 * scope with the appropriate binding for each `import … from
 * './path'` specifier.
 *
 * Recognized helper-function export shapes (task #541, extended in
 * task #549 for default exports):
 *
 *   export function pickPassword(req) { return req.body.password; }
 *   export const pickPassword = (req) => req.body.password;
 *   export const pickPassword = function (req) { return req.body.password; };
 *   export default function pickPassword(req) { return req.body.password; }
 *   export default function (req) { return req.body.password; }
 *   export default (req) => req.body.password;                // ExportAssignment
 *   export default function (req) { return req.body.password; }; // ExportAssignment
 *
 * Recognized method-host export shapes (task #553) — same machinery
 * the in-file pass 4 uses, applied across the module boundary so a
 * helper hidden behind a property access still resolves through an
 * `import { helpers, H } from './helpers'` chain:
 *
 *   export const helpers = { pickPassword: (req) => req.body.password };
 *   export const H = class { pick(req) { return req.body.password; } };
 *   export class H { pick(req) { return req.body.password; } }
 *
 * The named-export object-literal / class binding is recorded under
 * the variable / class name as a `methodHost` binding; the importing
 * file's pass 6 binds the same `methodHost` under the local
 * (possibly aliased) import name, and the existing call-site walk
 * (`scanArgForSecrets`) resolves `helpers.pickPassword(req)` /
 * `new H().pick(req)` / `h.pick(req)` against it just as it would
 * for a same-file host.
 *
 * Re-export shapes (task #556) — the barrel-file pattern
 * `export { x } from './y'`. The walk recursively asks the resolved
 * source for its helpers and copies the selected entries into the
 * current file's helpers map under the re-exported names:
 *
 *   export { foo } from './helpers';            // named re-export
 *   export { foo as bar } from './helpers';     // renamed re-export
 *   export * from './helpers';                  // wildcard (named only;
 *                                               //   default is NOT
 *                                               //   forwarded, per spec)
 *   export { default as foo } from './helpers'; // default-as-named
 *                                               //   (interacts with #549)
 *
 * Namespace re-exports (`export * as ns from './y'`) remain out of
 * scope — they would need a new binding kind so a consumer's
 * `ns.foo(req)` could resolve.
 */
function getExportedHelpers(
  file: string,
  surface: Surface,
): Map<string, Binding> {
  const cacheKey = `${file}:${surface.name}`;
  const cached = EXPORT_HELPER_CACHE.get(cacheKey);
  if (cached) return cached;
  const map = new Map<string, Binding>();
  // Set early so cyclic imports don't re-enter and recurse.
  EXPORT_HELPER_CACHE.set(cacheKey, map);
  let src: string;
  try {
    src = readFileSync(file, 'utf8');
  } catch {
    return map;
  }
  const sf = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindForFile(file),
  );
  // Build scopes for the imported file too — covers helpers that
  // route through a same-file alias before returning
  // (`function f(req) { const pw = req.body.password; return pw; }`).
  const importedScopes = collectScopedBindings(sf, surface);
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && hasExportModifier(stmt)) {
      // `export function foo() {}` (named export) records under the
      // function's name. `export default function foo() {}` and
      // `export default function () {}` both record under the default
      // sentinel: the consumer can only reach them via a default
      // import, regardless of the function's source-file name.
      const cls = classifyFunctionReturn(stmt, surface, importedScopes);
      if (cls) {
        const key = hasDefaultModifier(stmt)
          ? DEFAULT_EXPORT_KEY
          : stmt.name?.text;
        if (key) {
          map.set(key, { kind: 'helper', reason: cls.reason });
        }
      }
    } else if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const init = unwrapTransparentWrappers(decl.initializer);
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          const cls = classifyFunctionReturn(init, surface, importedScopes);
          if (cls) {
            map.set(decl.name.text, { kind: 'helper', reason: cls.reason });
          }
        } else if (ts.isObjectLiteralExpression(init)) {
          // task #553: `export const helpers = { pick: (req) => req.body.password }`.
          // Same shape pass 4 records for in-file object literals,
          // recorded here under the export name so an importing file
          // sees `helpers` as a methodHost.
          const host = buildObjectLiteralMethodHost(init, surface, importedScopes);
          if (host) {
            map.set(decl.name.text, { kind: 'methodHost', host });
          }
        } else if (ts.isClassExpression(init)) {
          // task #553: `export const H = class { pick(req) { … } }`.
          // Class expression assigned to an exported binding —
          // mirrors the variable-initialized class-expression branch
          // of pass 4 (`visitMethodHosts`).
          const host = buildClassMethodHost(init, surface, importedScopes);
          if (host) {
            map.set(decl.name.text, { kind: 'methodHost', host });
          }
        }
      }
    } else if (
      ts.isClassDeclaration(stmt) &&
      hasExportModifier(stmt) &&
      stmt.name &&
      !hasDefaultModifier(stmt)
    ) {
      // task #553: `export class H { pick(req) { return req.body.password; } }`.
      // Named-export class — recorded under the class name so an
      // importing `import { H } from './helpers'` (and a subsequent
      // `new H().pick(req)` or `const h = new H(); h.pick(req)`)
      // can resolve through the same methodHost the in-file pass 4
      // would have produced. Default-exported classes
      // (`export default class { … }`) are intentionally out of
      // scope — the brief calls out NAMED exports, and the helper
      // path's DEFAULT_EXPORT_KEY semantics for default imports
      // would need additional plumbing to round-trip a class via
      // `import H from './helpers'` (no consumer in this codebase
      // does so today, so deferring keeps the change minimal).
      const host = buildClassMethodHost(stmt, surface, importedScopes);
      if (host) {
        map.set(stmt.name.text, { kind: 'methodHost', host });
      }
    } else if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      // `export default <expr>` — covers the ExportAssignment shapes
      // listed in the brief: arrow function or function expression.
      // (`export = …` CommonJS-style assignment is intentionally
      // skipped; default-import semantics don't apply to it.)
      const init = unwrapTransparentWrappers(stmt.expression);
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        const cls = classifyFunctionReturn(init, surface, importedScopes);
        if (cls) {
          map.set(DEFAULT_EXPORT_KEY, { kind: 'helper', reason: cls.reason });
        }
      } else if (ts.isIdentifier(init)) {
        // task #555: `export default <Identifier>` — the natural
        // bypass of #549's ExportAssignment branch. The expression
        // is just an identifier referring to a function declared
        // (or const-bound) earlier in the same file:
        //
        //   function pickPassword(req) { return req.body.password; }
        //   export default pickPassword;
        //
        // Look the identifier up in the imported file's source-file
        // scope (populated by `collectScopedBindings` passes 1+3,
        // which classify same-file function declarations and
        // arrow/function-expression-initialized variables as
        // 'helper' bindings when their body returns a forbidden
        // expression). Record the resolved helper under the default
        // sentinel so a default-import in the consumer flags the
        // call site identically to `export default function …`.
        const sourceScope = importedScopes.get(sf);
        const binding = sourceScope?.get(init.text);
        if (binding && binding.kind === 'helper') {
          map.set(DEFAULT_EXPORT_KEY, { kind: 'helper', reason: binding.reason });
        }
      }
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteralLike(stmt.moduleSpecifier)
    ) {
      // task #556: re-exports forward another file's helpers under
      // the current file's exports. Both task #541 and task #549
      // deliberately skipped these; barrel files
      // (`server/utils/index.ts`) commonly route helpers through
      // `export { foo } from './helpers'`, so a consumer importing
      // from the barrel would otherwise see an empty helpers map
      // and the rule would not fire.
      //
      // The recursive `getExportedHelpers` walk uses the
      // EXPORT_HELPER_CACHE (set early — see comment above the
      // cache declaration) to keep cyclic re-export graphs linear.
      const resolved = resolveImportPath(
        file,
        stmt.moduleSpecifier.text,
        surface,
      );
      if (!resolved || resolved === file) continue;
      const reExported = getExportedHelpers(resolved, surface);
      if (reExported.size === 0) continue;
      if (stmt.exportClause === undefined) {
        // `export * from './helpers'` — wildcard. Per the
        // ECMAScript spec, `export *` does NOT forward the
        // source's default export, so we copy every NAMED entry
        // but skip the DEFAULT_EXPORT_KEY entry. Existing entries
        // in `map` (an in-file declaration earlier in the file, or
        // a more-specific named re-export) win over the wildcard
        // — matches ES module precedence, where a local
        // declaration shadows a wildcard re-export of the same
        // name.
        for (const [k, v] of reExported) {
          if (k === DEFAULT_EXPORT_KEY) continue;
          if (!map.has(k)) {
            map.set(k, v);
          }
        }
      } else if (ts.isNamedExports(stmt.exportClause)) {
        // `export { foo } from './helpers'` — named re-export.
        // `export { foo as bar } from './helpers'` — renamed.
        // `export { default as foo } from './helpers'` — pulls
        // the source's default export through under the new
        // name; the resolver looks it up under DEFAULT_EXPORT_KEY
        // (task #549). The symmetric `export { foo as default }
        // from './helpers'` (named-as-default) is also handled —
        // we explicitly map a target name of 'default' to
        // DEFAULT_EXPORT_KEY so the intent survives any future
        // refactor of the sentinel value.
        for (const el of stmt.exportClause.elements) {
          const sourceName = el.propertyName
            ? el.propertyName.text
            : el.name.text;
          const targetName = el.name.text;
          const srcKey =
            sourceName === 'default' ? DEFAULT_EXPORT_KEY : sourceName;
          const targetKey =
            targetName === 'default' ? DEFAULT_EXPORT_KEY : targetName;
          const helper = reExported.get(srcKey);
          if (helper) {
            map.set(targetKey, helper);
          }
        }
      }
      // `export * as ns from './helpers'` (NamespaceExport
      // exportClause) is intentionally out of scope: it would
      // require a new binding kind representing a "namespace of
      // helpers" so an importing file's `ns.foo(req)` could
      // resolve. Tracked separately (overlaps with task #558's
      // namespace-import work).
    }
  }
  return map;
}

/**
 * Classify a variable initializer / assignment RHS. Returns a
 * forbidden binding (with the reason text the scanner would have
 * produced if the expression appeared directly inside a log call)
 * when the initializer matches one of the forbidden shapes —
 * otherwise null.
 *
 * Multi-hop alias chains (task #540): when the RHS is a plain
 * Identifier that does not itself match a forbidden-name set, we
 * look it up in the partially-built `scopes` map. If that lookup
 * resolves to a forbidden binding (set by an earlier declaration
 * or assignment in the same file), the new binding inherits the
 * forbidden classification and the reason text is wrapped so the
 * report still points at the original property access.
 *
 *   const pw   = req.body.password;        // pw   forbidden
 *   const same = pw;                        // same forbidden (this hop)
 *   const last = same;                      // last forbidden (next hop)
 *   log.info(`pw=${last}`);                 // flagged
 *
 * This is the bridge that closes the gap left after task #516
 * (single-hop alias). Source-order traversal in `collectScopedBindings`
 * means each hop only consults bindings already recorded for prior
 * statements / declarations, which is exactly the semantics we want
 * — a later TDZ-violating reference is conservatively classified
 * against any outer same-named binding.
 */
function classifyInitializer(
  init: ts.Expression,
  surface: Surface,
  scopes?: Map<ts.Node, Map<string, Binding>>,
): { kind: 'forbidden' | 'helper'; reason: string } | null {
  // task #547: unwrap parentheses so `(req.body.password ?? '')`
  // resolves the same as the unparenthesized form. Parens are a
  // structurally invisible wrapper for the purposes of leak
  // classification; the existing property-access / identifier /
  // form-reader branches all benefit from this normalization too.
  // task #562: broadened to ALL transparent wrappers (`as`, `<T>`,
  // `!`, `satisfies`) — `const x = req.body.password as any` would
  // otherwise alias-record `x` as benign and let `log.info(x)` slip
  // past, mirroring the call-site bypass closed in task #560.
  if (isTransparentExpressionWrapper(init)) {
    return classifyInitializer(init.expression, surface, scopes);
  }
  // task #547: walk through `??` and `||` operands so a forbidden
  // RHS hidden behind a default value (`req.body.password ?? ''`)
  // gets classified the same as the bare property access. Either
  // operand reaching a forbidden shape is enough — the alias is
  // conservatively forbidden, and the original property-access
  // reason is preserved by recursion so the report still points at
  // the real source.
  // task #550: extended to also propagate the 'helper' alias kind
  // through these branches — `const fn = a || pickPassword` could
  // resolve to the helper at runtime, and a subsequent `log.info(fn(req))`
  // would leak. Forbidden still wins over helper when both sides
  // classify, so a `req.body.password ?? pickPasswordAlias` stays
  // reported as the more-specific forbidden source.
  if (
    ts.isBinaryExpression(init) &&
    (init.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      init.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    const left = classifyInitializer(init.left, surface, scopes);
    const right = classifyInitializer(init.right, surface, scopes);
    if (left?.kind === 'forbidden') return left;
    if (right?.kind === 'forbidden') return right;
    if (left) return left;
    if (right) return right;
  }
  // task #547: same idea for ternaries — `cond ? req.body.token :
  // null` could yield the secret on the truthy branch and must be
  // treated as forbidden. Walking both branches keeps the rule
  // symmetric (the secret can sit on either side).
  // task #550: also propagate 'helper' through both branches, with
  // the same forbidden-wins precedence as the binary-operator case.
  if (ts.isConditionalExpression(init)) {
    const t = classifyInitializer(init.whenTrue, surface, scopes);
    const f = classifyInitializer(init.whenFalse, surface, scopes);
    if (t?.kind === 'forbidden') return t;
    if (f?.kind === 'forbidden') return f;
    if (t) return t;
    if (f) return f;
  }
  if (ts.isPropertyAccessExpression(init)) {
    const name = init.name.text.toLowerCase();
    if (surface.forbiddenPropertyNames.has(name)) {
      return {
        kind: 'forbidden',
        reason: `property access ending in .${init.name.text}`,
      };
    }
  }
  if (ts.isElementAccessExpression(init)) {
    const a = init.argumentExpression;
    if (ts.isStringLiteralLike(a)) {
      const lit = a.text.toLowerCase();
      if (
        surface.forbiddenHeaderKeys.has(lit) ||
        surface.forbiddenPropertyNames.has(lit)
      ) {
        return {
          kind: 'forbidden',
          reason: `element access [${JSON.stringify(a.text)}]`,
        };
      }
    }
  }
  if (ts.isIdentifier(init)) {
    const lc = init.text.toLowerCase();
    if (
      surface.forbiddenIdentifiersStrict.has(lc) ||
      surface.forbiddenIdentifiersValueOnly.has(lc)
    ) {
      return {
        kind: 'forbidden',
        reason: `bare identifier '${init.text}'`,
      };
    }
    // Multi-hop alias propagation. If the RHS identifier is itself
    // a known forbidden alias from an earlier binding in scope,
    // classify this initializer as forbidden too. Wraps the prior
    // reason so the chain stays auditable in the report (e.g.
    // `local 'pw' aliasing property access ending in .password`).
    //
    // task #550: extended to also propagate the 'helper' kind. Task
    // #541 records helper functions as `{ kind: 'helper', ... }`
    // bindings; without this branch, `const alias = pickPassword`
    // recorded `alias` as 'other' and `log.info(alias(req))` slipped
    // past — the bare-identifier helper-call rule from #541 only
    // matched when the call expression's callee resolved directly
    // to a helper. Mirroring the forbidden propagation here closes
    // the gap in the same way #540 closed the multi-hop forbidden
    // chain. The new pass-7 in `collectScopedBindings` re-walks
    // declarations + assignments after passes 3 & 5 so this
    // branch can actually see helper bindings (pass 1 runs before
    // helpers are recorded).
    if (scopes) {
      const prior = resolveIdentifierBinding(init, scopes);
      if (prior) {
        if (prior.kind === 'forbidden') {
          return {
            kind: 'forbidden',
            reason: `local '${init.text}' aliasing ${prior.reason}`,
          };
        }
        if (prior.kind === 'helper') {
          return {
            kind: 'helper',
            reason: `local '${init.text}' aliasing ${prior.reason}`,
          };
        }
      }
    }
  }
  if (
    ts.isCallExpression(init) &&
    surface.forbiddenFormGetterMethods.size > 0 &&
    ts.isPropertyAccessExpression(init.expression)
  ) {
    const methodName = init.expression.name.text;
    if (surface.forbiddenFormGetterMethods.has(methodName)) {
      const first = init.arguments[0];
      if (first && ts.isStringLiteralLike(first)) {
        const key = first.text.toLowerCase();
        if (surface.forbiddenFormFieldKeys.has(key)) {
          return {
            kind: 'forbidden',
            reason: `form-reader call .${methodName}(${JSON.stringify(first.text)})`,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Build a per-scope binding map. For every variable declaration,
 * function parameter, catch variable, function declaration, and
 * destructured property, record either the forbidden classification
 * (so a later log call can flag uses of the local) or 'other' (so
 * the binding shadows any same-named outer forbidden binding).
 *
 * Mirrors `collectScopedBindings` in `scripts/check-log-debug-pii.ts`
 * — same scope rules (`var` hoists to the nearest function scope,
 * `let` / `const` are block-scoped, parameters bind on the
 * function-like, catch clauses introduce their own scope) and a
 * separate pass for assignment-aliasing (`pw = req.body.password;`)
 * that resolves the binding scope to where the identifier was
 * actually declared rather than the assignment's enclosing block.
 */
function collectScopedBindings(
  sourceFile: ts.SourceFile,
  surface: Surface,
): Map<ts.Node, Map<string, Binding>> {
  const scopes = new Map<ts.Node, Map<string, Binding>>();
  const recordIn = (scope: ts.Node, name: string, binding: Binding): void => {
    let m = scopes.get(scope);
    if (!m) {
      m = new Map();
      scopes.set(scope, m);
    }
    // Priority when the same name is recorded twice in the same
    // scope: forbidden > helper > methodHost > other. 'forbidden'
    // must always win (stay conservative on the side of catching
    // leaks). A 'helper' upgrade over a placeholder 'other' (recorded
    // by pass 1 for `function pickPassword(...) {}` before its body
    // has been classified) is what lets pass 3 promote the function
    // to a known helper. Same idea for 'methodHost': pass 1 records
    // `const helpers = { ... }` as 'other' before pass 4 has had a
    // chance to inspect the literal's properties; pass 4 then
    // upgrades the binding to methodHost.
    const prev = m.get(name);
    if (prev) {
      if (prev.kind === 'forbidden') return;
      if (
        prev.kind === 'helper' &&
        binding.kind !== 'forbidden'
      ) return;
      if (prev.kind === 'methodHost' && binding.kind === 'other') return;
    }
    m.set(name, binding);
  };
  const recordParameters = (
    params: readonly ts.ParameterDeclaration[],
    scope: ts.Node,
  ): void => {
    for (const p of params) {
      const collectFromBinding = (n: ts.BindingName): void => {
        if (ts.isIdentifier(n)) {
          recordIn(scope, n.text, { kind: 'other' });
        } else if (
          ts.isObjectBindingPattern(n) ||
          ts.isArrayBindingPattern(n)
        ) {
          for (const el of n.elements) {
            if (ts.isBindingElement(el)) collectFromBinding(el.name);
          }
        }
      };
      collectFromBinding(p.name);
    }
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isConstructorDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      recordParameters(node.parameters, node);
    }
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      const vd = node.variableDeclaration;
      if (ts.isIdentifier(vd.name)) {
        recordIn(node, vd.name.text, { kind: 'other' });
      }
    }
    if (ts.isVariableDeclaration(node)) {
      const scope = isVarDeclaration(node)
        ? nearestFunctionScope(node)
        : nearestScope(node);
      const init = node.initializer;
      if (ts.isIdentifier(node.name)) {
        // Plain `const x = <init>` — classify the initializer.
        // Pass `scopes` so a plain-identifier RHS (`const same = pw`)
        // can resolve to the prior binding's classification, which
        // is what makes multi-hop alias chains catch (task #540).
        const cls = init ? classifyInitializer(init, surface, scopes) : null;
        recordIn(scope, node.name.text, cls ?? { kind: 'other' });
      } else if (ts.isObjectBindingPattern(node.name)) {
        // `const { password } = req.body` and friends. Each
        // binding element pulls a property out of the source — if
        // that property NAME is forbidden, the local it lands in
        // is itself a forbidden alias even though the source
        // expression on the RHS is benign-looking.
        for (const el of node.name.elements) {
          if (!ts.isBindingElement(el)) continue;
          let propText = '';
          if (el.propertyName) {
            if (
              ts.isIdentifier(el.propertyName) ||
              ts.isStringLiteralLike(el.propertyName)
            ) {
              propText = el.propertyName.text;
            }
          } else if (ts.isIdentifier(el.name)) {
            propText = el.name.text;
          }
          const lcProp = propText.toLowerCase();
          if (ts.isIdentifier(el.name)) {
            if (
              propText &&
              (surface.forbiddenPropertyNames.has(lcProp) ||
                surface.forbiddenHeaderKeys.has(lcProp))
            ) {
              const reason = surface.forbiddenHeaderKeys.has(lcProp)
                ? `element access [${JSON.stringify(propText)}]`
                : `property access ending in .${propText}`;
              recordIn(scope, el.name.text, {
                kind: 'forbidden',
                reason: `destructured ${reason}`,
              });
            } else {
              recordIn(scope, el.name.text, { kind: 'other' });
            }
          } else if (
            ts.isObjectBindingPattern(el.name) ||
            ts.isArrayBindingPattern(el.name)
          ) {
            const collectFromBinding = (n: ts.BindingName): void => {
              if (ts.isIdentifier(n)) {
                recordIn(scope, n.text, { kind: 'other' });
              } else if (
                ts.isObjectBindingPattern(n) ||
                ts.isArrayBindingPattern(n)
              ) {
                for (const inner of n.elements) {
                  if (ts.isBindingElement(inner)) collectFromBinding(inner.name);
                }
              }
            };
            collectFromBinding(el.name);
          }
        }
      } else if (ts.isArrayBindingPattern(node.name)) {
        const collectFromBinding = (n: ts.BindingName): void => {
          if (ts.isIdentifier(n)) {
            recordIn(scope, n.text, { kind: 'other' });
          } else if (
            ts.isObjectBindingPattern(n) ||
            ts.isArrayBindingPattern(n)
          ) {
            for (const el of n.elements) {
              if (ts.isBindingElement(el)) collectFromBinding(el.name);
            }
          }
        };
        collectFromBinding(node.name);
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      recordIn(nearestScope(node), node.name.text, { kind: 'other' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Pass 2: assignment-alias `pw = req.body.password;`. Resolve to
  // the scope where the LHS was actually declared (mirrors the
  // sibling guard) so an assignment inside an inner block still
  // marks the outer-declared name as forbidden for sibling calls
  // in the same function.
  const visitAssignments = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      // Pass `scopes` for the same reason as Pass 1: an assignment
      // `b = a` where `a` already resolves to a forbidden binding
      // must propagate the forbidden classification to `b`
      // (task #540 multi-hop chain).
      const cls = classifyInitializer(node.right, surface, scopes);
      if (cls) {
        const name = node.left.text;
        let bindingScope: ts.Node = sourceFile;
        let s: ts.Node | undefined = nearestScope(node);
        while (s) {
          if (scopes.get(s)?.has(name)) {
            bindingScope = s;
            break;
          }
          if (ts.isSourceFile(s)) {
            bindingScope = s;
            break;
          }
          s = nearestScope(s);
        }
        recordIn(bindingScope, name, cls);
      }
    }
    ts.forEachChild(node, visitAssignments);
  };
  visitAssignments(sourceFile);

  // Pass 3: helper-function detection (task #541). For every
  // function declaration / arrow / function expression that gets
  // bound to a name (function declarations bind their own name,
  // `const x = (...) => ...` binds `x`), check whether the body
  // returns a forbidden expression. If so, upgrade the binding to
  // 'helper' so a CALL to the function inside a log argument can
  // be flagged. Runs AFTER passes 1 & 2 so the inner-body scopes
  // are fully populated — `function f(req) { const pw =
  // req.body.password; return pw; }` requires `pw` to be a known
  // forbidden binding before classifying the return.
  const visitHelpers = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      const cls = classifyFunctionReturn(node, surface, scopes);
      if (cls) {
        recordIn(nearestScope(node), node.name.text, {
          kind: 'helper',
          reason: cls.reason,
        });
      }
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const init = node.initializer;
      if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
        const scope = isVarDeclaration(node)
          ? nearestFunctionScope(node)
          : nearestScope(node);
        const cls = classifyFunctionReturn(init, surface, scopes);
        if (cls) {
          recordIn(scope, node.name.text, {
            kind: 'helper',
            reason: cls.reason,
          });
        }
      }
    }
    ts.forEachChild(node, visitHelpers);
  };
  visitHelpers(sourceFile);

  // Pass 4: object-literal & class method-host detection (task #548).
  // Task #541 caught bare-identifier helper calls; the natural next
  // bypass is to route the same call through a property access,
  // either via an object literal of helper functions or via a class
  // method:
  //
  //   const helpers = { pickPassword: (req) => req.body.password };
  //   log.info(`pw=${helpers.pickPassword(req)}`);
  //
  //   class H { pick(req) { return req.body.password; } }
  //   log.info(new H().pick(req));
  //
  // Both shapes are recorded as a 'methodHost' binding so the
  // call-site scan (`scanArgForSecrets`) can resolve
  // `helpers.pickPassword(...)` / `H.pick(...)` to the underlying
  // forbidden return.
  const visitMethodHosts = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const init = unwrapTransparentWrappers(node.initializer);
      const scope = isVarDeclaration(node)
        ? nearestFunctionScope(node)
        : nearestScope(node);
      if (ts.isObjectLiteralExpression(init)) {
        const host = buildObjectLiteralMethodHost(init, surface, scopes);
        if (host) {
          recordIn(scope, node.name.text, { kind: 'methodHost', host });
        }
      } else if (ts.isClassExpression(init)) {
        const host = buildClassMethodHost(init, surface, scopes);
        if (host) {
          recordIn(scope, node.name.text, { kind: 'methodHost', host });
        }
      }
    }
    if (ts.isClassDeclaration(node) && node.name) {
      const host = buildClassMethodHost(node, surface, scopes);
      if (host) {
        recordIn(nearestScope(node), node.name.text, {
          kind: 'methodHost',
          host,
        });
      }
    }
    ts.forEachChild(node, visitMethodHosts);
  };
  visitMethodHosts(sourceFile);

  // Pass 5: cross-file helper / methodHost detection (task #541,
  // extended in task #549 to default exports/imports and in
  // task #553 to named-export object literals + classes). For each
  // top-level `import … from '<spec>'`, resolve the spec to an
  // on-disk file, ask `getExportedHelpers` for the set of exports
  // it considers forbidden, and seed the importing file's
  // source-file scope with the appropriate binding under the LOCAL
  // name. Runs BEFORE the `new`-expression instance pass below so
  // that `import { H } from './h'; const h = new H();` correctly
  // resolves `H` to its cross-file methodHost when binding `h`.
  //
  //   import { foo }            -> recorded under `foo`
  //   import { foo as bar }     -> recorded under `bar`
  //   import baz from './x'     -> recorded under `baz` from the
  //                                exporter's `DEFAULT_EXPORT_KEY`
  //                                entry (task #549). The importing
  //                                file picks the local name; whatever
  //                                the source named the default
  //                                export is irrelevant.
  //   import baz, { foo } from './x' -> both default + named bindings
  //                                are walked, since the import
  //                                clause carries `name` AND
  //                                `namedBindings` simultaneously.
  //
  // The import-resolution cache breaks cycles so this stays linear
  // even on a tightly-coupled package.
  for (const stmt of sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    if (!ts.isStringLiteralLike(stmt.moduleSpecifier)) continue;
    const resolved = resolveImportPath(
      sourceFile.fileName,
      stmt.moduleSpecifier.text,
      surface,
    );
    if (!resolved) continue;
    if (resolved === sourceFile.fileName) continue;
    const exported = getExportedHelpers(resolved, surface);
    if (exported.size === 0) continue;
    const ic = stmt.importClause;
    // Default-import binding: `import name from './helpers'`. The
    // `importClause.name` field holds the local default-import name
    // (and is independent of any `namedBindings` on the same clause).
    if (ic.name) {
      const helper = exported.get(DEFAULT_EXPORT_KEY);
      if (helper) {
        recordIn(sourceFile, ic.name.text, helper);
      }
    }
    const nb = ic.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        const importedName = el.propertyName ? el.propertyName.text : el.name.text;
        const helper = exported.get(importedName);
        if (helper) {
          recordIn(sourceFile, el.name.text, helper);
        }
      }
    } else if (nb && ts.isNamespaceImport(nb)) {
      // task #558: `import * as mod from './h'`. Each named export
      // of the source file is reachable as `mod.<exportName>` —
      // helper-function exports become methods on a synthetic
      // namespace methodHost (so `mod.pickPassword(req)` resolves
      // through the existing method-call rule), and methodHost
      // exports (object-literal / class) become nested entries
      // (so `mod.helpers.pickPassword(req)` and
      // `new mod.H().pick(req)` both round-trip through the
      // existing `resolveCallReceiverHost` PropertyAccess +
      // NewExpression branches). The default export is skipped —
      // `mod.default` is the only way to reach it via a namespace
      // import and no consumer in this codebase does so today.
      const methods = new Map<string, string>();
      const nested = new Map<string, MethodHost>();
      for (const [name, b] of exported) {
        if (name === DEFAULT_EXPORT_KEY) continue;
        if (b.kind === 'helper') methods.set(name, b.reason);
        else if (b.kind === 'methodHost') nested.set(name, b.host);
      }
      if (methods.size > 0 || nested.size > 0) {
        recordIn(sourceFile, nb.name.text, {
          kind: 'methodHost',
          host: { methods, nested },
        });
      }
    }
  }

  // Pass 6: instance bindings via `new` (task #548, extended in
  // task #553). After pass 4 has populated in-file class-name ->
  // methodHost bindings AND pass 5 has populated cross-file
  // imported class-name -> methodHost bindings, walk the file and
  // propagate the host to any `const h = new H();` local. A
  // subsequent `h.pick(req)` inside a log argument can then resolve
  // `h` to the same methodHost as `H` and flag the call. Runs as a
  // separate pass so a forward `const h = new H(); ... class H {}`
  // (declaration after use, legal at module scope) and a cross-file
  // `import { H } from './h'; const h = new H();` BOTH resolve —
  // the constructor binding is in scope by the time the receiver
  // resolution runs.
  const visitInstances = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const init = unwrapTransparentWrappers(node.initializer);
      if (ts.isNewExpression(init)) {
        // task #558: generalize from `new H()` (Identifier ctor)
        // to any constructor expression `resolveCallReceiverHost`
        // can resolve, so `const h = new mod.H(); h.pick(req)`
        // binds `h` to the same nested host as `new mod.H()`.
        const host = resolveCallReceiverHost(init.expression, scopes);
        if (host) {
          const scope = isVarDeclaration(node)
            ? nearestFunctionScope(node)
            : nearestScope(node);
          recordIn(scope, node.name.text, {
            kind: 'methodHost',
            host,
          });
        }
      }
    }
    ts.forEachChild(node, visitInstances);
  };
  visitInstances(sourceFile);

  // Pass 7: helper-alias propagation (task #550). Mirrors pass 2's
  // forbidden assignment-alias walk, but for the 'helper' kind that
  // pass 3 (in-file helpers) and pass 5 (cross-file imported helpers)
  // record on the source binding. Without this pass:
  //
  //   function pickPassword(req) { return req.body.password; }
  //   const alias = pickPassword;
  //   log.info(`pw=${alias(req)}`);
  //
  // slips past — pass 1 records `alias` as 'other' (because at that
  // point `pickPassword` is still the placeholder 'other' binding
  // from pass 1 itself; the helper promotion only happens in pass 3),
  // and the helper-call rule in `scanArgForSecrets` only fires when
  // the callee identifier resolves to a 'helper' binding. Re-running
  // `classifyInitializer` here, AFTER passes 3 & 5, lets the
  // identifier branch see the now-known helper source and re-record
  // the alias under the same forwarded reason text used for
  // forbidden chains (`local 'pickPassword' aliasing …`).
  //
  // Source-order traversal is what makes multi-hop chains
  //   const a = pickPassword;
  //   const b = a;
  //   const c = b;
  // work the same way the multi-hop forbidden chain from task #540
  // works: each declaration only consults bindings recorded for
  // earlier statements, so each hop picks up the helper that the
  // previous hop just promoted.
  //
  // Both shapes are handled in the same pass:
  //   - declaration alias  (`const alias = pickPassword;`)
  //   - assignment alias   (`alias = pickPassword;`)
  // The assignment branch resolves the LHS to its declaration scope
  // (mirroring pass 2) so an assignment inside a nested block still
  // marks the outer-declared name as a helper for sibling calls.
  const visitHelperAliases = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const cls = classifyInitializer(node.initializer, surface, scopes);
      if (cls && cls.kind === 'helper') {
        const scope = isVarDeclaration(node)
          ? nearestFunctionScope(node)
          : nearestScope(node);
        recordIn(scope, node.name.text, cls);
      }
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      const cls = classifyInitializer(node.right, surface, scopes);
      if (cls && cls.kind === 'helper') {
        const name = node.left.text;
        let bindingScope: ts.Node = sourceFile;
        let s: ts.Node | undefined = nearestScope(node);
        while (s) {
          if (scopes.get(s)?.has(name)) {
            bindingScope = s;
            break;
          }
          if (ts.isSourceFile(s)) {
            bindingScope = s;
            break;
          }
          s = nearestScope(s);
        }
        recordIn(bindingScope, name, cls);
      }
    }
    ts.forEachChild(node, visitHelperAliases);
  };
  visitHelperAliases(sourceFile);

  return scopes;
}

/**
 * Resolve an identifier used at a call site by walking up scopes
 * until a scope binds the name. Returns the binding when found,
 * or null when no enclosing scope binds the name (the name is
 * from an import / module-level / global).
 */
function resolveIdentifierBinding(
  ident: ts.Identifier,
  scopes: Map<ts.Node, Map<string, Binding>>,
): Binding | null {
  let s: ts.Node | undefined = nearestScope(ident);
  while (s) {
    const m = scopes.get(s);
    const b = m?.get(ident.text);
    if (b) return b;
    if (ts.isSourceFile(s)) break;
    s = s.parent ? nearestScope(s) : undefined;
  }
  return null;
}

/**
 * Resolve a method-call receiver expression (the `expression` of the
 * call's callee, which itself may be a PropertyAccessExpression or an
 * ElementAccessExpression) to its underlying MethodHost.
 *
 * Supports the shapes the briefs call out:
 *   - bare identifier (`helpers.pickPassword(...)` -> `helpers`)
 *   - nested property access (`obj.helper.pick(...)` -> `obj.helper`)
 *   - nested element access with a string-literal index, including the
 *     no-substitution template form
 *     (`obj['helper']['pick'](...)` -> `obj['helper']`,
 *      `obj[\`helper\`].pick(...)` -> `obj[\`helper\`]`); covers task
 *     #554's bracket-form bypass of the dot-form rule
 *   - direct instantiation (`new H().pick(...)` -> `new H()`)
 *   - parenthesized variants of any of the above
 *
 * ElementAccess with a NON-string-literal index (`obj[methodName]` /
 * `obj[\`pick${suffix}\`]`) is intentionally not supported — the
 * called method name can't be resolved statically, so the call-site
 * scanner will not look up a method on this host either, keeping the
 * rule conservative.
 *
 * Returns null when no scope binding for the root identifier (or
 * constructor identifier) resolves to a methodHost — keeps the rule
 * conservative against arbitrary expressions like `getHelpers().pick`
 * which would require flow analysis we deliberately do not do here.
 */
function resolveCallReceiverHost(
  expr: ts.Expression,
  scopes: Map<ts.Node, Map<string, Binding>>,
): MethodHost | null {
  if (isTransparentExpressionWrapper(expr)) {
    return resolveCallReceiverHost(expr.expression, scopes);
  }
  if (ts.isIdentifier(expr)) {
    const b = resolveIdentifierBinding(expr, scopes);
    return b && b.kind === 'methodHost' ? b.host : null;
  }
  if (ts.isPropertyAccessExpression(expr)) {
    const parent = resolveCallReceiverHost(expr.expression, scopes);
    return parent ? parent.nested.get(expr.name.text) ?? null : null;
  }
  if (ts.isElementAccessExpression(expr)) {
    const argExpr = expr.argumentExpression;
    if (!ts.isStringLiteralLike(argExpr)) return null;
    const parent = resolveCallReceiverHost(expr.expression, scopes);
    return parent ? parent.nested.get(argExpr.text) ?? null : null;
  }
  if (ts.isNewExpression(expr)) {
    // task #558: recurse into the constructor expression so
    // `new mod.H().pick(req)` resolves through `mod` (namespace
    // methodHost) -> `mod.H` (nested host) -> `pick`. The bare-
    // identifier case (`new H()`) still resolves through the
    // Identifier branch above, since `resolveCallReceiverHost`
    // already calls `resolveIdentifierBinding` for it.
    return resolveCallReceiverHost(expr.expression, scopes);
  }
  return null;
}

/**
 * Render a method-call receiver back as a short, reviewer-readable
 * path string for the report. Mirrors the shapes
 * `resolveCallReceiverHost` accepts so the textual reason matches
 * what the reviewer will actually see in source. The bracket form is
 * rendered as `["name"]` (always double-quoted via JSON.stringify) so
 * a single reason string is unambiguous regardless of whether the
 * source used a string literal or a no-substitution template.
 */
function describeReceiverPath(expr: ts.Expression): string {
  if (isTransparentExpressionWrapper(expr)) {
    return describeReceiverPath(expr.expression);
  }
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr)) {
    return `${describeReceiverPath(expr.expression)}.${expr.name.text}`;
  }
  if (ts.isElementAccessExpression(expr)) {
    const argExpr = expr.argumentExpression;
    if (ts.isStringLiteralLike(argExpr)) {
      return `${describeReceiverPath(expr.expression)}[${JSON.stringify(argExpr.text)}]`;
    }
    return `${describeReceiverPath(expr.expression)}[<computed>]`;
  }
  if (ts.isNewExpression(expr)) {
    // task #558: render `new mod.H()` and `new ns.deeply.K()`,
    // not just bare `new H()`. Recursing through `expr.expression`
    // delegates Identifier / PropertyAccess / ElementAccess to the
    // branches above and stays symmetric with `resolveCallReceiverHost`.
    return `new ${describeReceiverPath(expr.expression)}()`;
  }
  return '<receiver>';
}

function listSourceFiles(root: string, surface: Surface): string[] {
  const out: string[] = [];
  const exts = surface.fileExtensions;
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '__tests__') continue;
        walk(full);
      } else if (st.isFile()) {
        const matchesExt = exts.some((ext) => full.endsWith(ext));
        if (
          matchesExt &&
          !full.endsWith('.test.ts') &&
          !full.endsWith('.test.tsx') &&
          !full.endsWith('.d.ts')
        ) {
          out.push(full);
        }
      }
    }
  }
  walk(root);
  return out;
}

/**
 * True when `node` is one of the log-method call shapes we recognize:
 *   log.<level>      logger.<level>      console.<level>
 *   log?.<level>     logger?.<level>     console?.<level>
 *   log['<level>']   logger['<level>']   console['<level>']
 * where <level> ∈ LOG_LEVELS.
 */
function isLogMethodAccess(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return (
      ts.isIdentifier(node.expression) &&
      LOG_ROOTS.has(node.expression.text) &&
      LOG_LEVELS.has(node.name.text)
    );
  }
  if (ts.isElementAccessExpression(node)) {
    return (
      ts.isIdentifier(node.expression) &&
      LOG_ROOTS.has(node.expression.text) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      LOG_LEVELS.has(node.argumentExpression.text)
    );
  }
  return false;
}

export interface Hit {
  file: string;
  line: number;
  reasons: string[];
  snippet: string;
}

function getLeadingLineComments(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): string[] {
  const ranges = ts.getLeadingCommentRanges(sourceFile.text, call.getFullStart()) ?? [];
  return ranges.map((r) => sourceFile.text.slice(r.pos, r.end));
}

function getInteriorComments(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): string[] {
  // Comments that physically appear inside the call expression's
  // text range — covers `log.warn(/* secret-log-ok: … */ csrfToken)`
  // and the multi-line form where the annotation lives between args.
  const start = call.getStart(sourceFile);
  const end = call.getEnd();
  const text = sourceFile.text.slice(start, end);
  const out: string[] = [];
  const re = /\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

function getTrailingLineComment(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): string | null {
  // Look for a `//` comment on the same line as the call's closing
  // paren — supports the common `log.info(...); // secret-log-ok: …`
  // pattern.
  const text = sourceFile.text;
  const end = call.getEnd();
  let i = end;
  // Skip over a trailing semicolon and same-line whitespace.
  while (i < text.length && text[i] !== '\n' && /[\s;,)]/.test(text[i]))
    i++;
  if (i + 1 < text.length && text[i] === '/' && text[i + 1] === '/') {
    let j = i;
    while (j < text.length && text[j] !== '\n') j++;
    return text.slice(i, j);
  }
  return null;
}

function callIsSuppressed(
  sourceFile: ts.SourceFile,
  call: ts.CallExpression,
): boolean {
  for (const c of getLeadingLineComments(sourceFile, call)) {
    if (commentSuppresses(c)) return true;
  }
  for (const c of getInteriorComments(sourceFile, call)) {
    if (commentSuppresses(c)) return true;
  }
  const t = getTrailingLineComment(sourceFile, call);
  if (t && commentSuppresses(t)) return true;
  return false;
}

/**
 * Walk the argument subtree and collect every distinct leak reason.
 * Reasons are human-readable strings like `req.body.password` or
 * `bare identifier 'csrfToken'` so the report points the reviewer
 * straight at the offending shape.
 */
/**
 * Predicate for "transparent" expression wrappers — wrappers whose
 * runtime value is identical to their inner `expression` and which
 * therefore cannot change WHICH function is invoked or WHICH object
 * is being dereferenced. Used to strip them off both the callee
 * (`unwrapTransparentCallee`) AND the receiver (the recursive
 * `resolveCallReceiverHost` / `describeReceiverPath` calls) so a
 * cosmetic wrapper anywhere in the call shape can never silently
 * bypass the dispatch.
 *
 * Wrappers recognised:
 *   - `ParenthesizedExpression` — `(x)`               (task #554)
 *   - `AsExpression`            — `x as T`            (task #560)
 *   - `TypeAssertionExpression` — `<T>x`              (task #560)
 *   - `NonNullExpression`       — `x!`                (task #560)
 *   - `SatisfiesExpression`     — `x satisfies T`     (task #560)
 *
 * All five are erased by the TS emitter or are runtime no-ops, so
 * the inner expression evaluates to the same value as the wrapper
 * itself — unwrapping cannot create a false positive (the function
 * actually invoked / object actually dereferenced is exactly the
 * one the inner expression resolves to). DO NOT add wrappers that
 * fail this property here — `ConditionalExpression` (ternary) for
 * example chooses one of two paths at runtime and is NOT
 * transparent.
 */
function isTransparentExpressionWrapper(
  expr: ts.Expression,
): expr is
  | ts.ParenthesizedExpression
  | ts.AsExpression
  | ts.TypeAssertion
  | ts.NonNullExpression
  | ts.SatisfiesExpression {
  return (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isTypeAssertionExpression(expr) ||
    ts.isNonNullExpression(expr) ||
    ts.isSatisfiesExpression(expr)
  );
}

/**
 * Strip transparent wrappers off a callee expression. Without this,
 * a trivial `(helpers.pick)(req)` / `(helpers.pick as any)(req)` /
 * `(<any>helpers.pick)(req)` / `helpers.pick!(req)` /
 * `(helpers.pick satisfies typeof helpers.pick)(req)` slips past
 * every call-site shape check below — those tests look at
 * `n.expression` directly, which would be the wrapper rather than
 * the Property/Element/Identifier the rule expects. Closes the
 * wrapper bypass for ALL three call-shape rules at once
 * (helper-function call, form-reader call, method-call dot AND
 * bracket form).
 *
 * Detection composes — e.g. `((helpers as any)['pick'] as any)(req)`
 * is still flagged because both the callee paren+as wrapper AND the
 * receiver paren+as wrapper are stripped before the dispatch.
 * `resolveCallReceiverHost` and `describeReceiverPath` use the
 * same `isTransparentExpressionWrapper` predicate, so the unwrap
 * stays in lock-step on both sides; adding a new transparent
 * wrapper kind in one place automatically fixes it everywhere.
 */
function unwrapTransparentCallee(expr: ts.Expression): ts.Expression {
  let cur: ts.Expression = expr;
  while (isTransparentExpressionWrapper(cur)) {
    cur = cur.expression;
  }
  return cur;
}

function scanArgForSecrets(
  arg: ts.Node,
  found: Set<string>,
  surface: Surface,
  scopes: Map<ts.Node, Map<string, Binding>>,
): void {
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) {
      const name = n.name.text.toLowerCase();
      if (surface.forbiddenPropertyNames.has(name)) {
        found.add(`property access ending in .${n.name.text}`);
      }
    } else if (ts.isElementAccessExpression(n)) {
      const a = n.argumentExpression;
      if (ts.isStringLiteralLike(a)) {
        const lit = a.text.toLowerCase();
        if (surface.forbiddenHeaderKeys.has(lit)) {
          found.add(`element access [${JSON.stringify(a.text)}]`);
        } else if (surface.forbiddenPropertyNames.has(lit)) {
          // Catches the computed equivalent: req.body['password'].
          found.add(`element access [${JSON.stringify(a.text)}]`);
        }
      }
    } else if (ts.isCallExpression(n)) {
      // Strip transparent wrappers off the callee so a trivial
      // `(helpers.pick)(req)` / `(helpers['pick'])(req)` /
      // `(pickPassword)(req)` / `(helpers.pick as any)(req)` /
      // `(<any>helpers.pick)(req)` / `helpers.pick!(req)` doesn't
      // slip past every shape check below. See
      // `unwrapTransparentCallee` doc-comment for the rationale.
      const callee = unwrapTransparentCallee(n.expression);
      // Detect react-hook-form value readers: `form.getValues('password')`,
      // `form.watch('newPassword')`, etc. Only flagged when both the
      // method name AND the string-literal argument are forbidden — a
      // benign `form.getValues('amount')` does not trip.
      if (
        surface.forbiddenFormGetterMethods.size > 0 &&
        ts.isPropertyAccessExpression(callee)
      ) {
        const methodName = callee.name.text;
        if (surface.forbiddenFormGetterMethods.has(methodName)) {
          const first = n.arguments[0];
          if (first && ts.isStringLiteralLike(first)) {
            const key = first.text.toLowerCase();
            if (surface.forbiddenFormFieldKeys.has(key)) {
              found.add(
                `form-reader call .${methodName}(${JSON.stringify(first.text)})`,
              );
            }
          }
        }
      }
      // Helper-function call detection (task #541). A bare-identifier
      // callee (`pickPassword(req)`, including the optional-chain
      // form `pickPassword?.(req)`) is flagged when the identifier
      // resolves to a 'helper' binding — meaning a same-file or
      // imported function whose body returns a forbidden expression.
      // Catches `log.info(\`pw=\${pickPassword(req)}\`)` even though
      // the forbidden property access never appears inside the log
      // call's argument subtree.
      if (ts.isIdentifier(callee)) {
        const binding = resolveIdentifierBinding(callee, scopes);
        if (binding && binding.kind === 'helper') {
          found.add(
            `helper call '${callee.text}()' returning ${binding.reason}`,
          );
        }
      }
      // Method-call detection (task #548). A property-access call
      // (`helpers.pickPassword(req)`, `obj.helper.pick(req)`,
      // `h.pick(req)` after `const h = new H();`, or
      // `new H().pick(req)`) is flagged when the resolved receiver
      // is a 'methodHost' binding and the property name matches a
      // forbidden-return method on that host. Closes the natural
      // bypass left after #541 (route the helper through a property
      // access so the bare-identifier rule no longer matches).
      //
      // Task #554 extends the same rule to the computed-key form
      // (`helpers['pickPassword'](req)` /
      // `helpers[\`pickPassword\`](req)`) — the only structural
      // difference at the call site is an ElementAccessExpression
      // callee with a string-literal index instead of a
      // PropertyAccessExpression with a `.name`. The
      // methodHost/`host.methods` lookup is keyed by the same string,
      // so once the index is read out of the literal the rest of the
      // detection is identical. A non-literal index
      // (`helpers[methodName](req)` /
      // `helpers[\`pick${suffix}\`](req)`) is intentionally NOT
      // flagged — there is no static method name to compare against
      // the forbidden-return map, so flagging would either misreport
      // the wrong method or require flow analysis we deliberately do
      // not do here.
      //
      // The form-reader detection above already short-circuits on
      // forbiddenFormGetterMethods; reaching this branch with a
      // method name in that set would still be a legitimate hit
      // when a methodHost happens to share the name (rare but
      // benign — produces a separate, more specific reason string).
      if (ts.isPropertyAccessExpression(callee)) {
        const host = resolveCallReceiverHost(callee.expression, scopes);
        if (host) {
          const methodName = callee.name.text;
          const reason = host.methods.get(methodName);
          if (reason) {
            const path = describeReceiverPath(callee.expression);
            found.add(
              `method call '${path}.${methodName}()' returning ${reason}`,
            );
          }
        }
      } else if (ts.isElementAccessExpression(callee)) {
        const idxExpr = callee.argumentExpression;
        if (ts.isStringLiteralLike(idxExpr)) {
          const host = resolveCallReceiverHost(callee.expression, scopes);
          if (host) {
            const methodName = idxExpr.text;
            const reason = host.methods.get(methodName);
            if (reason) {
              const path = describeReceiverPath(callee.expression);
              found.add(
                `method call '${path}[${JSON.stringify(idxExpr.text)}]()' returning ${reason}`,
              );
            }
          }
        }
      }
    } else if (ts.isIdentifier(n)) {
      // Only flag identifiers in value-reference position. Identifier
      // nodes also appear as syntactic labels — PropertyAccessExpression's
      // `.name`, an object-literal property key, a binding-element's
      // propertyName, a method/property declaration name — and those
      // are NOT value references, so skip them.
      const parent = n.parent;
      const isPropertyName =
        (ts.isPropertyAccessExpression(parent) && parent.name === n) ||
        (ts.isPropertyAssignment(parent) && parent.name === n) ||
        (ts.isShorthandPropertyAssignment(parent) && parent.name === n) ||
        (ts.isBindingElement(parent) && parent.propertyName === n) ||
        (ts.isMethodDeclaration(parent) && parent.name === n) ||
        (ts.isPropertyDeclaration(parent) && parent.name === n);
      const isPropertyReceiver =
        (ts.isPropertyAccessExpression(parent) && parent.expression === n) ||
        (ts.isElementAccessExpression(parent) && parent.expression === n);
      const lcName = n.text.toLowerCase();
      // ShorthandPropertyAssignment is the special case: `{ csrfToken }`
      // is BOTH a key and a value reference, so it MUST flag for both
      // the strict and value-only sets.
      let directlyFlagged = false;
      if (
        ts.isShorthandPropertyAssignment(parent) &&
        parent.name === n
      ) {
        if (
          surface.forbiddenIdentifiersStrict.has(lcName) ||
          surface.forbiddenIdentifiersValueOnly.has(lcName)
        ) {
          found.add(`shorthand property '${n.text}' (value reference)`);
          directlyFlagged = true;
        }
      } else if (!isPropertyName) {
        if (surface.forbiddenIdentifiersStrict.has(lcName)) {
          // Strict set: even `csrfToken.length` is suspicious.
          found.add(`bare identifier '${n.text}'`);
          directlyFlagged = true;
        } else if (
          surface.forbiddenIdentifiersValueOnly.has(lcName) &&
          !isPropertyReceiver
        ) {
          // Value-only set: `token` standing alone in a value
          // position is the leak; `token.id` (a property-access
          // receiver, structurally just metadata access) is not.
          found.add(`bare identifier '${n.text}'`);
          directlyFlagged = true;
        }
      }
      // Single-hop alias check (task #516). A local bound to a
      // forbidden value via `const pw = req.body.password;` /
      // `const { password } = req.body;` / `pw = req.body.password;`
      // / etc. carries the secret string; flag uses of that local
      // in the same value-reference positions as the value-only
      // direct identifiers (standalone arg, template span,
      // shorthand prop) but NOT as a property receiver, so
      // `pw.length` style metadata access stays benign.
      if (!directlyFlagged && !isPropertyName && !isPropertyReceiver) {
        const binding = resolveIdentifierBinding(n, scopes);
        if (binding && binding.kind === 'forbidden') {
          if (
            ts.isShorthandPropertyAssignment(parent) &&
            parent.name === n
          ) {
            found.add(
              `shorthand property '${n.text}' aliasing ${binding.reason}`,
            );
          } else {
            found.add(
              `local '${n.text}' aliasing ${binding.reason}`,
            );
          }
        }
      }
    }
    n.forEachChild(visit);
  };
  visit(arg);
}

function scriptKindForFile(file: string): ts.ScriptKind {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

export function scanSource(
  file: string,
  src: string,
  surface: Surface = SERVER_SURFACE,
): Hit[] {
  const sourceFile = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKindForFile(file),
  );
  const scopes = collectScopedBindings(sourceFile, surface);
  const hits: Hit[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isLogCall =
        isLogMethodAccess(callee) ||
        // log?.debug(...) parses as CallExpression -> NonNullExpression /
        // PropertyAccess depending on TS version; the optional-chain
        // form is captured here.
        (ts.isPropertyAccessExpression(callee) &&
          callee.questionDotToken !== undefined &&
          isLogMethodAccess(callee));
      if (isLogCall && !callIsSuppressed(sourceFile, node)) {
        const found = new Set<string>();
        for (const arg of node.arguments)
          scanArgForSecrets(arg, found, surface, scopes);
        if (found.size > 0) {
          const { line } = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile),
          );
          const lineText = src
            .slice(node.getStart(sourceFile), node.getEnd())
            .split('\n')[0]
            .slice(0, 200);
          hits.push({
            file,
            line: line + 1,
            reasons: [...found],
            snippet: lineText,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits;
}

export function scanFile(file: string, surface: Surface = SERVER_SURFACE): Hit[] {
  return scanSource(file, readFileSync(file, 'utf8'), surface);
}

function parseSurfaceArg(): Surface {
  const arg = process.argv.find((a) => a.startsWith('--surface='));
  if (!arg) return SERVER_SURFACE;
  const name = arg.slice('--surface='.length);
  if (name === 'server' || name === 'client') return SURFACES[name];
  process.stderr.write(
    `unknown --surface=${name}; expected 'server' or 'client'\n`,
  );
  process.exit(2);
}

function main(): void {
  const surface = parseSurfaceArg();
  const files: string[] = [];
  for (const root of surface.roots) {
    for (const f of listSourceFiles(root, surface)) files.push(f);
  }
  const hits: Hit[] = [];
  for (const f of files) {
    for (const h of scanFile(f, surface)) hits.push(h);
  }
  const rel = (p: string): string => p.replace(process.cwd() + '/', '');
  if (hits.length === 0) {
    console.log(
      `no-secrets-in-logs guard (${surface.name}): scanned ${files.length} file(s) — OK: no secret-bearing log calls detected`,
    );
    process.exit(0);
  }
  const stream = process.stderr;
  const tag = STRICT ? 'FAIL' : 'WARN';
  for (const h of hits) {
    for (const r of h.reasons) {
      stream.write(
        `${tag}: ${rel(h.file)}:${h.line} log call contains ${r}\n` +
          `    ${h.snippet}\n`,
      );
    }
  }
  stream.write(
    `\n${hits.length} log call(s) appear to interpolate secret-bearing fields (surface=${surface.name}).\n` +
      `If a hit is a structural label (not a value), add an inline\n` +
      `\`// secret-log-ok: <reason>\` annotation and document it in\n` +
      `docs/security/no-secrets-in-logs.md.\n`,
  );
  process.exit(STRICT ? 1 : 0);
}

// Only run the CLI when invoked as the entry point. Importing this
// module from a test file (to call `scanSource` directly without
// paying the per-test `npx tsx` startup cost) must not trigger the
// scan + `process.exit`.
const isCliEntry =
  typeof process.argv[1] === 'string' &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCliEntry) main();
