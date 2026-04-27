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
 * A binding resolves to one of three classifications:
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
 *   - 'other' — the name is bound here but to something benign.
 *     Load-bearing for shadowing: a `const pw = 'fixture'` in an
 *     inner scope must mask any same-named outer alias so the inner
 *     `pw` is NOT treated as a secret.
 */
type Binding =
  | { kind: 'forbidden'; reason: string }
  | { kind: 'helper'; reason: string }
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
  if (ts.isArrowFunction(fn) && fn.body && !ts.isBlock(fn.body)) {
    return classifyInitializer(fn.body, surface, scopes);
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
      if (cls && !result) result = cls;
    }
    n.forEachChild(visit);
  };
  visit(body);
  return result;
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

/**
 * Parse `file` and extract the names of any top-level exported
 * functions whose body returns a forbidden expression. Used by
 * `collectScopedBindings` to seed the importing file's source-file
 * scope with `helper` bindings for each `import { … } from './path'`
 * specifier.
 *
 * Recognized export shapes:
 *
 *   export function pickPassword(req) { return req.body.password; }
 *   export const pickPassword = (req) => req.body.password;
 *   export const pickPassword = function (req) { return req.body.password; };
 *
 * Default exports and re-exports (`export { x } from './y'`) are
 * intentionally out of scope — the brief asks for "imported
 * function declarations", and named exports cover the canonical
 * helper shape.
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
    if (ts.isFunctionDeclaration(stmt) && stmt.name && hasExportModifier(stmt)) {
      const cls = classifyFunctionReturn(stmt, surface, importedScopes);
      if (cls) {
        map.set(stmt.name.text, { kind: 'helper', reason: cls.reason });
      }
    } else if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
        const init = decl.initializer;
        if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) {
          const cls = classifyFunctionReturn(init, surface, importedScopes);
          if (cls) {
            map.set(decl.name.text, { kind: 'helper', reason: cls.reason });
          }
        }
      }
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
): { kind: 'forbidden'; reason: string } | null {
  // task #547: unwrap parentheses so `(req.body.password ?? '')`
  // resolves the same as the unparenthesized form. Parens are a
  // structurally invisible wrapper for the purposes of leak
  // classification; the existing property-access / identifier /
  // form-reader branches all benefit from this normalization too.
  if (ts.isParenthesizedExpression(init)) {
    return classifyInitializer(init.expression, surface, scopes);
  }
  // task #547: walk through `??` and `||` operands so a forbidden
  // RHS hidden behind a default value (`req.body.password ?? ''`)
  // gets classified the same as the bare property access. Either
  // operand reaching a forbidden shape is enough — the alias is
  // conservatively forbidden, and the original property-access
  // reason is preserved by recursion so the report still points at
  // the real source.
  if (
    ts.isBinaryExpression(init) &&
    (init.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      init.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    const left = classifyInitializer(init.left, surface, scopes);
    if (left) return left;
    const right = classifyInitializer(init.right, surface, scopes);
    if (right) return right;
  }
  // task #547: same idea for ternaries — `cond ? req.body.token :
  // null` could yield the secret on the truthy branch and must be
  // treated as forbidden. Walking both branches keeps the rule
  // symmetric (the secret can sit on either side).
  if (ts.isConditionalExpression(init)) {
    const t = classifyInitializer(init.whenTrue, surface, scopes);
    if (t) return t;
    const f = classifyInitializer(init.whenFalse, surface, scopes);
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
    if (scopes) {
      const prior = resolveIdentifierBinding(init, scopes);
      if (prior && prior.kind === 'forbidden') {
        return {
          kind: 'forbidden',
          reason: `local '${init.text}' aliasing ${prior.reason}`,
        };
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
    // scope: forbidden > helper > other. 'forbidden' must always
    // win (stay conservative on the side of catching leaks). A
    // 'helper' upgrade over a placeholder 'other' (recorded by the
    // first pass for `function pickPassword(...) {}` before its
    // body has been classified) is what lets pass 3 promote the
    // function to a known helper.
    const prev = m.get(name);
    if (prev) {
      if (prev.kind === 'forbidden') return;
      if (prev.kind === 'helper' && binding.kind === 'other') return;
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

  // Pass 4: cross-file helper detection (task #541). For each
  // top-level `import { foo, bar as baz } from '<spec>'`, resolve
  // the spec to an on-disk file, ask `getExportedHelpers` for the
  // set of named exports it considers forbidden helpers, and seed
  // the importing file's source-file scope with a 'helper' binding
  // under the LOCAL name (so `import { x as y }` records `y`).
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
    const nb = stmt.importClause.namedBindings;
    if (nb && ts.isNamedImports(nb)) {
      for (const el of nb.elements) {
        const importedName = el.propertyName ? el.propertyName.text : el.name.text;
        const helper = exported.get(importedName);
        if (helper) {
          recordIn(sourceFile, el.name.text, helper);
        }
      }
    }
  }

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
      // Detect react-hook-form value readers: `form.getValues('password')`,
      // `form.watch('newPassword')`, etc. Only flagged when both the
      // method name AND the string-literal argument are forbidden — a
      // benign `form.getValues('amount')` does not trip.
      if (
        surface.forbiddenFormGetterMethods.size > 0 &&
        ts.isPropertyAccessExpression(n.expression)
      ) {
        const methodName = n.expression.name.text;
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
      if (ts.isIdentifier(n.expression)) {
        const binding = resolveIdentifierBinding(n.expression, scopes);
        if (binding && binding.kind === 'helper') {
          found.add(
            `helper call '${n.expression.text}()' returning ${binding.reason}`,
          );
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
