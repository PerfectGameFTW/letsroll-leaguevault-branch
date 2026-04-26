/**
 * Raw-User/Organization wire-sanitization guard (task #382).
 *
 * `server/utils/api.ts` exposes two allowlist-projection helpers —
 * `sanitizeUser` and `sanitizeOrg` — that are the ONLY supported
 * way to ship a `User` or `Organization` row to the wire. Anything
 * not on the allowlist is dropped at the boundary so a future column
 * (`apiKey`, `clientSecret`, `webhookKey`, OAuth tokens in
 * `integrations`, etc.) cannot leak just because nobody noticed.
 *
 * The protection is only as strong as the discipline at every call
 * site. A new route that does `sendSuccess(res, user)` (instead of
 * `sendSuccess(res, sanitizeUser(user))`) — or `res.json({ user })`
 * straight from `storage.getUser(...)` — silently re-introduces the
 * leak risk that #327 (allowlist projection) and the user-org
 * sanitize tests close.
 *
 * This script enumerates every state-returning call site under
 * `server/` and uses the real TypeScript type checker to fail when:
 *
 *   - A `sendSuccess(res, X)` or `sendPaginatedSuccess(res, X, ...)`
 *     call receives a value structurally assignable to the canonical
 *     `User` or `Organization` row type — directly OR as a property,
 *     spread, or array element of an inline object/array literal.
 *
 *   - A `res.json(X)` or `res.status(...).json(X)` call receives the
 *     same shape. The receiver is detected structurally (the chain
 *     bottoms out at an identifier named `res`) so both forms are
 *     covered without per-call type plumbing.
 *
 * Why structural assignability and not name-matching: `User` is
 * `typeof users.$inferSelect`, which TypeScript resolves to an
 * anonymous object type at use sites — the `User` type-alias name is
 * erased and `type.aliasSymbol` is `undefined` at the call site. So
 * we resolve the canonical `User`/`Organization` types ONCE at the
 * top of the program (via `getDeclaredTypeOfSymbol`) and use
 * `checker.isTypeAssignableTo` to ask "does this value satisfy the
 * full row shape?". A `SanitizedUser` (`Pick<User, …>` with no
 * `password`, `inviteToken`, `failedPasswordChangeAttempts`, etc.)
 * is NOT assignable to `User` and so does NOT trigger the guard.
 * The same goes for hand-rolled projections like
 * `{ id: u.id, email: u.email }` — they're missing required fields
 * of `User` so they're not assignable to `User`.
 *
 * Concretely, the canonical wraps stay green:
 *
 *   sendSuccess(res, sanitizeUser(user))
 *   sendSuccess(res, users.map(sanitizeUser))
 *   sendSuccess(res, { user: sanitizeUser(u), emailSent })
 *   sendSuccess(res, { id: user.id, email: user.email })
 *
 * and the leak-shaped forms are flagged:
 *
 *   sendSuccess(res, user)                            // User
 *   sendSuccess(res, users)                           // User[]
 *   sendSuccess(res, { ...user, paymentSyncStatus })  // spread of User
 *   sendSuccess(res, { user })                        // shorthand of User
 *   res.json(organization)                            // raw Organization
 *
 * Recursion contract / parser limitations:
 *   - The AST walk descends through inline `ObjectLiteralExpression`,
 *     `ArrayLiteralExpression`, `ParenthesizedExpression`, and
 *     `ConditionalExpression` (both branches). For everything else
 *     (identifier, call, property access, etc.) the value's static
 *     type is checked directly.
 *   - The type walk descends through unions (so `User | undefined`
 *     from `storage.getUser(...)` is caught), numeric-index types
 *     (so `User[]` is caught), AND properties of object/intersection
 *     types — so a helper whose return type embeds a row, like
 *     `function buildAccountResponse(u: User): { user: User }`, is
 *     flagged when its result is handed to a response helper. The
 *     descent is bounded by a per-walk visited set keyed on type
 *     identity and a depth cap so cyclic schema references like
 *     `Organization.users: User[]` / `User.organization: Organization`
 *     terminate. Function/constructor types (whose properties are
 *     `Function.prototype` methods, not data) are skipped to avoid
 *     walking into the standard library.
 *   - `User` / `Organization` are identified by their declaration
 *     site: a type alias named `User` declared in
 *     `shared/schema/users.ts`, or `Organization` declared in
 *     `shared/schema/organizations.ts`. Re-exports through
 *     `shared/schema/index.ts` resolve to the same canonical
 *     declarations, so import path doesn't matter.
 *
 * The guard runs over the same TypeScript program `npm run check`
 * uses, so it sees exactly the inferred types the type checker sees.
 *
 * Exits 0 when clean, 1 on any unallowlisted leak. Pass `--report`
 * to print the table without exiting non-zero (useful locally when
 * paying down debt before raising the gate).
 *
 * Run with: `npm run check:wire-sanitization` or
 * `tsx scripts/check-wire-sanitization.ts`.
 */
import * as ts from 'typescript';
import { resolve, relative } from 'node:path';

const ROOT = process.cwd();
const TSCONFIG_PATH = resolve(ROOT, 'tsconfig.json');
const REPORT_ONLY = process.argv.includes('--report');

interface Violation {
  file: string;
  line: number;
  column: number;
  helper: string;
  typeName: string;
  snippet: string;
}

function loadProgram(): ts.Program {
  const cfg = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile);
  if (cfg.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(cfg.error.messageText, '\n'),
    );
  }
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, ROOT);
  // `noEmit` is set in tsconfig.json — the program is read-only.
  return ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
  });
}

interface CanonicalTypes {
  user: ts.Type;
  organization: ts.Type;
}

/**
 * Locate the `User` and `Organization` type aliases at their
 * declaration site (`shared/schema/users.ts` and
 * `shared/schema/organizations.ts`) and resolve each to its declared
 * type. The declared type is what `isTypeAssignableTo` compares
 * against — and because Drizzle's `$inferSelect` produces an
 * anonymous object type, asking the checker for the alias's
 * `getDeclaredTypeOfSymbol` is what gives us the canonical row shape
 * we need to compare every call-site value against.
 */
function resolveCanonicalTypes(
  program: ts.Program,
  checker: ts.TypeChecker,
): CanonicalTypes | null {
  let user: ts.Type | undefined;
  let organization: ts.Type | undefined;

  for (const sf of program.getSourceFiles()) {
    const fn = sf.fileName.replace(/\\/g, '/');
    const wantUser = fn.endsWith('/shared/schema/users.ts');
    const wantOrg = fn.endsWith('/shared/schema/organizations.ts');
    if (!wantUser && !wantOrg) continue;

    sf.forEachChild((n) => {
      if (!ts.isTypeAliasDeclaration(n)) return;
      const sym = checker.getSymbolAtLocation(n.name);
      if (!sym) return;
      if (wantUser && n.name.text === 'User') {
        user = checker.getDeclaredTypeOfSymbol(sym);
      } else if (wantOrg && n.name.text === 'Organization') {
        organization = checker.getDeclaredTypeOfSymbol(sym);
      }
    });
  }

  if (!user || !organization) return null;
  return { user, organization };
}

/**
 * Walk a value type and return the name of the first leak it
 * contains, or null. Descends through:
 *   - union members (so `User | undefined` is caught),
 *   - numeric-index types (so `User[]` is caught), and
 *   - properties of object / intersection types (so a helper whose
 *     return type embeds a row, e.g. `function f(): { user: User }`,
 *     is caught when its result is handed to a response helper).
 *
 * The structural assignability check at the top of the walk handles
 * the direct cases (raw `User`, intersection `User & { extra }`,
 * etc.). Recursion is bounded by a per-walk `visited` set keyed on
 * type identity AND a hard depth cap, so cyclic schema references
 * — e.g. `Organization.users: User[]` referring back to `User` which
 * has `organization: Organization` — terminate.
 *
 * Function / constructor types are skipped during the property
 * descent because their `getProperties()` returns
 * `Function.prototype` methods (`call`, `apply`, …) rather than
 * data fields, and recursing into those would balloon the search
 * with no signal.
 */
const MAX_TYPE_WALK_DEPTH = 8;

function findLeakInType(
  type: ts.Type,
  canon: CanonicalTypes,
  checker: ts.TypeChecker,
  visited: Set<ts.Type> = new Set<ts.Type>(),
  depth = 0,
): string | null {
  if (depth > MAX_TYPE_WALK_DEPTH) return null;
  if (visited.has(type)) return null;
  visited.add(type);

  // Skip non-actionable bottoms — `any` would assignable-to anything,
  // which would generate noise. `unknown`/`never` aren't structural
  // matches in either direction.
  const flags = type.flags;
  if (
    flags & ts.TypeFlags.Any ||
    flags & ts.TypeFlags.Unknown ||
    flags & ts.TypeFlags.Never ||
    flags & ts.TypeFlags.Void ||
    flags & ts.TypeFlags.Null ||
    flags & ts.TypeFlags.Undefined
  ) {
    return null;
  }

  if (checker.isTypeAssignableTo(type, canon.user)) return 'User';
  if (checker.isTypeAssignableTo(type, canon.organization)) return 'Organization';

  if (type.isUnion()) {
    for (const sub of type.types) {
      const v = findLeakInType(sub, canon, checker, visited, depth + 1);
      if (v) return v;
    }
    return null;
  }

  // Arrays / readonly arrays / tuples — descend through the element
  // type so `User[]` (the most common batch-list shape) is caught.
  const numIdx = checker.getIndexTypeOfType(type, ts.IndexKind.Number);
  if (numIdx) {
    const v = findLeakInType(numIdx, canon, checker, visited, depth + 1);
    if (v) return `${v}[]`;
  }

  // Walk properties of object / intersection types so a value typed
  // as `{ user: User }` returned from a helper doesn't slip past by
  // hiding the User behind a wrapper. Skip callable/constructable
  // types (their "properties" are Function.prototype methods, not
  // data); the visited-set + depth cap above keep cyclic schemas
  // from blowing up.
  const isObjectLike =
    Boolean(flags & ts.TypeFlags.Object) || type.isIntersection();
  if (isObjectLike) {
    if (
      type.getCallSignatures().length === 0 &&
      type.getConstructSignatures().length === 0
    ) {
      for (const prop of type.getProperties()) {
        const decl = prop.valueDeclaration ?? prop.declarations?.[0];
        if (!decl) continue;
        const propType = checker.getTypeOfSymbolAtLocation(prop, decl);
        const v = findLeakInType(propType, canon, checker, visited, depth + 1);
        if (v) return v;
      }
    }
  }

  return null;
}

interface Reporter {
  (node: ts.Node, typeName: string): void;
}

/**
 * Walk a value expression. Inline object/array/conditional literals
 * are descended structurally so the guard can pinpoint the offending
 * property (e.g. `{ user }` reports the shorthand, not the whole
 * object literal). For anything else we just type-check the value.
 */
function walkExpression(
  expr: ts.Expression,
  checker: ts.TypeChecker,
  canon: CanonicalTypes,
  report: Reporter,
): void {
  if (ts.isParenthesizedExpression(expr)) {
    walkExpression(expr.expression, checker, canon, report);
    return;
  }
  if (ts.isObjectLiteralExpression(expr)) {
    for (const prop of expr.properties) {
      if (ts.isPropertyAssignment(prop)) {
        walkExpression(prop.initializer, checker, canon, report);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        const t = checker.getTypeAtLocation(prop.name);
        const found = findLeakInType(t, canon, checker);
        if (found) report(prop, found);
      } else if (ts.isSpreadAssignment(prop)) {
        const t = checker.getTypeAtLocation(prop.expression);
        const found = findLeakInType(t, canon, checker);
        if (found) report(prop, found);
      }
      // Method/Get/Set declarations on an object literal can't
      // express a User/Organization value as data, so ignore them.
    }
    return;
  }
  if (ts.isArrayLiteralExpression(expr)) {
    for (const el of expr.elements) {
      if (ts.isSpreadElement(el)) {
        const t = checker.getTypeAtLocation(el.expression);
        const found = findLeakInType(t, canon, checker);
        if (found) report(el, found);
      } else {
        walkExpression(el, checker, canon, report);
      }
    }
    return;
  }
  if (ts.isConditionalExpression(expr)) {
    walkExpression(expr.whenTrue, checker, canon, report);
    walkExpression(expr.whenFalse, checker, canon, report);
    return;
  }
  // Default: get the static type and check.
  const t = checker.getTypeAtLocation(expr);
  const found = findLeakInType(t, canon, checker);
  if (found) report(expr, found);
}

interface HelperHit {
  helper: string;
  dataArg: ts.Expression;
}

function isResponseHelperCall(call: ts.CallExpression): HelperHit | null {
  // sendSuccess(res, data, status?)
  // sendPaginatedSuccess(res, data, pagination, status?)
  if (ts.isIdentifier(call.expression)) {
    const name = call.expression.text;
    if (
      (name === 'sendSuccess' || name === 'sendPaginatedSuccess') &&
      call.arguments.length >= 2
    ) {
      return { helper: name, dataArg: call.arguments[1] };
    }
  }
  // res.json(data)  /  res.status(...).json(data)  /  any chain
  // bottoming out at an identifier named `res`.
  if (
    ts.isPropertyAccessExpression(call.expression) &&
    call.expression.name.text === 'json' &&
    call.arguments.length >= 1 &&
    receiverIsRes(call.expression.expression)
  ) {
    return { helper: 'res.json', dataArg: call.arguments[0] };
  }
  return null;
}

function receiverIsRes(expr: ts.Expression): boolean {
  if (ts.isIdentifier(expr)) return expr.text === 'res';
  if (
    ts.isCallExpression(expr) &&
    ts.isPropertyAccessExpression(expr.expression)
  ) {
    return receiverIsRes(expr.expression.expression);
  }
  if (ts.isPropertyAccessExpression(expr)) {
    return receiverIsRes(expr.expression);
  }
  if (ts.isParenthesizedExpression(expr)) {
    return receiverIsRes(expr.expression);
  }
  return false;
}

function shouldScan(fileName: string): boolean {
  const f = fileName.replace(/\\/g, '/');
  if (!f.includes('/server/')) return false;
  if (f.includes('/node_modules/')) return false;
  if (f.includes('/__tests__/')) return false;
  if (f.endsWith('.test.ts') || f.endsWith('.spec.ts')) return false;
  // The sanitize* helpers and `sendSuccess` itself live here; the
  // file's own bodies don't ship raw User/Org and scanning would
  // create false positives on the helper signatures.
  if (f.endsWith('/server/utils/api.ts')) return false;
  return true;
}

function snippetAt(sf: ts.SourceFile, node: ts.Node): string {
  const text = sf.getFullText();
  const start = node.getStart(sf);
  const end = node.getEnd();
  const slice = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return slice.length > 100 ? `${slice.slice(0, 97)}...` : slice;
}

function main(): void {
  const program = loadProgram();
  const checker = program.getTypeChecker();

  const canon = resolveCanonicalTypes(program, checker);
  if (!canon) {
    // Sanity bottom: if we can't find the canonical types the script
    // would silently pass — fail loud instead.
    console.error(
      '[check-wire-sanitization] FAIL — could not resolve User / Organization type aliases from shared/schema/{users,organizations}.ts. ' +
        'Refusing to run rather than silently passing.',
    );
    process.exit(2);
  }

  const violations: Violation[] = [];

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    if (!shouldScan(sf.fileName)) continue;

    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const m = isResponseHelperCall(node);
        if (m) {
          walkExpression(m.dataArg, checker, canon, (badNode, typeName) => {
            const { line, character } = sf.getLineAndCharacterOfPosition(
              badNode.getStart(sf),
            );
            violations.push({
              file: relative(ROOT, sf.fileName),
              line: line + 1,
              column: character + 1,
              helper: m.helper,
              typeName,
              snippet: snippetAt(sf, badNode),
            });
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  if (violations.length === 0) {
    console.log(
      '[check-wire-sanitization] OK — no raw User/Organization values reach a response helper.',
    );
    return;
  }

  console.error(
    `\n[check-wire-sanitization] ${REPORT_ONLY ? 'REPORT' : 'FAIL'} — ${violations.length} call site(s) ship raw User/Organization values to the wire:\n`,
  );
  for (const v of violations) {
    console.error(
      `  ${v.file}:${v.line}:${v.column}  ${v.helper}() <- ${v.typeName}`,
    );
    console.error(`      · ${v.snippet}`);
  }
  console.error(
    '\nWrap the value in sanitizeUser / sanitizeOrg from server/utils/api.ts\n' +
      'before handing it to the response helper. See docs/lint.md for the contract.',
  );

  if (!REPORT_ONLY) process.exit(1);
}

main();
