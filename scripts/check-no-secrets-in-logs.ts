/**
 * Project-wide guard against logging secret-bearing fields (task #432).
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
 * This script parses every `.ts` file under `server/` (excluding
 * `*.test.ts` and `__tests__/`) with the TypeScript compiler API and
 * walks each call to a known log method:
 *
 *   log.<level>(...)        logger.<level>(...)        console.<level>(...)
 *   log?.<level>(...)       logger?.<level>(...)       console?.<level>(...)
 *   log['<level>'](...)     logger['<level>'](...)     console['<level>'](...)
 *
 * where <level> ∈ {debug, info, warn, error, trace, fatal, log}.
 *
 * Inside each argument subtree it flags as a leak any of:
 *
 *   - PropertyAccessExpression whose property name (case-insensitive)
 *     is one of: password, token, inviteToken, setupSecret, csrfToken,
 *     resetToken. Catches `req.body.password`, `result.token`,
 *     `user.inviteToken`, etc. — including optional-chain
 *     (`req?.body?.token`) and computed-string forms
 *     (`req.body['password']`).
 *
 *   - Bare Identifier whose name (case-insensitive) is one of:
 *     inviteToken, setupSecret, csrfToken, resetToken. These names
 *     have no benign meaning in this codebase — every variable named
 *     `csrfToken` or `inviteToken` IS the secret. Flagged in any
 *     value-reference position, including as a property-access
 *     receiver (`csrfToken.length`).
 *
 *   - Bare Identifier `token` flagged ONLY in value-reference
 *     positions where it stands alone (a direct argument, a template
 *     interpolation `${token}`, a shorthand property `{ token }`),
 *     NOT when it is the receiver of a further property access
 *     (`token.id` — common metadata access on payment / api tokens
 *     where the secret bytes live in a different field). The
 *     property-access check above (`PropertyAccessExpression` whose
 *     .name is `token`) still catches `req.body.token` /
 *     `result.token`, so the dangerous shapes are not blind spots.
 *
 *   - ElementAccessExpression with a string literal argument of
 *     `x-csrf-token` or `x-setup-secret` (case-insensitive). Catches
 *     `req.headers['x-csrf-token']` and `req.headers['x-setup-secret']`.
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
 * `--strict` it exits 1 on any breach. The vitest forcing function in
 * `tests/unit/check-no-secrets-in-logs.test.ts` runs `--strict`
 * against the real codebase and asserts exit 0 — that is how this
 * becomes a CI gate without editing the locked `package.json`
 * (the same wiring as the sibling `check-log-debug-pii` guard).
 *
 * Run with:
 *   tsx scripts/check-no-secrets-in-logs.ts            # advisory
 *   tsx scripts/check-no-secrets-in-logs.ts --strict   # CI gate
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SERVER_DIR = resolve(process.cwd(), 'server');
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

// Property names that, when accessed off any object inside a log
// argument, are treated as secret-bearing.
const FORBIDDEN_PROPERTY_NAMES = new Set([
  'password',
  'token',
  'invitetoken',
  'setupsecret',
  'csrftoken',
  'resettoken',
]);

// Bare identifier names that have no benign meaning in this codebase
// — every variable named `csrfToken` IS the secret. Flagged whenever
// the identifier appears in a value-reference position inside a log
// call argument: as a direct argument, inside a template
// interpolation, in a shorthand property `{ csrfToken }`, AS WELL
// AS when it is the receiver of a further property access
// (`csrfToken.length` — even metadata like length is suspicious for
// these names).
const FORBIDDEN_IDENTIFIERS_STRICT = new Set([
  'invitetoken',
  'setupsecret',
  'csrftoken',
  'resettoken',
]);

// `token` is in the brief's list but has more benign uses than the
// strict set above — `token.id`, `token.kind`, etc., commonly
// reference internal payment-token / api-token metadata where the
// secret bytes live in a different field. So we flag it ONLY in
// value-reference positions where it stands alone (a direct
// argument, a template interpolation, a shorthand `{ token }`)
// — not when it is the receiver of a further property access.
// The property-access check above (`PropertyAccessExpression` whose
// .name is `token`) still catches `req.body.token` / `result.token`.
const FORBIDDEN_IDENTIFIERS_VALUE_ONLY = new Set(['token']);

// String-literal argument values that, when used to index any object,
// imply a secret-bearing header lookup.
const FORBIDDEN_HEADER_KEYS = new Set([
  'x-csrf-token',
  'x-setup-secret',
]);

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

function listTsFiles(root: string): string[] {
  const out: string[] = [];
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
      } else if (
        st.isFile() &&
        full.endsWith('.ts') &&
        !full.endsWith('.test.ts') &&
        !full.endsWith('.d.ts')
      ) {
        out.push(full);
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
function scanArgForSecrets(arg: ts.Node, found: Set<string>): void {
  const visit = (n: ts.Node): void => {
    if (ts.isPropertyAccessExpression(n)) {
      const name = n.name.text.toLowerCase();
      if (FORBIDDEN_PROPERTY_NAMES.has(name)) {
        found.add(`property access ending in .${n.name.text}`);
      }
    } else if (ts.isElementAccessExpression(n)) {
      const arg = n.argumentExpression;
      if (ts.isStringLiteralLike(arg)) {
        const lit = arg.text.toLowerCase();
        if (FORBIDDEN_HEADER_KEYS.has(lit)) {
          found.add(`element access [${JSON.stringify(arg.text)}]`);
        } else if (FORBIDDEN_PROPERTY_NAMES.has(lit)) {
          // Catches the computed equivalent: req.body['password'].
          found.add(`element access [${JSON.stringify(arg.text)}]`);
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
      if (
        ts.isShorthandPropertyAssignment(parent) &&
        parent.name === n
      ) {
        if (
          FORBIDDEN_IDENTIFIERS_STRICT.has(lcName) ||
          FORBIDDEN_IDENTIFIERS_VALUE_ONLY.has(lcName)
        ) {
          found.add(`shorthand property '${n.text}' (value reference)`);
        }
      } else if (!isPropertyName) {
        if (FORBIDDEN_IDENTIFIERS_STRICT.has(lcName)) {
          // Strict set: even `csrfToken.length` is suspicious.
          found.add(`bare identifier '${n.text}'`);
        } else if (
          FORBIDDEN_IDENTIFIERS_VALUE_ONLY.has(lcName) &&
          !isPropertyReceiver
        ) {
          // Value-only set: `token` standing alone in a value
          // position is the leak; `token.id` (a property-access
          // receiver, structurally just metadata access) is not.
          found.add(`bare identifier '${n.text}'`);
        }
      }
    }
    n.forEachChild(visit);
  };
  visit(arg);
}

export function scanSource(file: string, src: string): Hit[] {
  const sourceFile = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
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
        for (const arg of node.arguments) scanArgForSecrets(arg, found);
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

export function scanFile(file: string): Hit[] {
  return scanSource(file, readFileSync(file, 'utf8'));
}

function main(): void {
  const files = listTsFiles(SERVER_DIR);
  const hits: Hit[] = [];
  for (const f of files) {
    for (const h of scanFile(f)) hits.push(h);
  }
  const rel = (p: string): string => p.replace(process.cwd() + '/', '');
  if (hits.length === 0) {
    console.log(
      `no-secrets-in-logs guard: scanned ${files.length} file(s) — OK: no secret-bearing log calls detected`,
    );
    process.exit(0);
  }
  const stream = STRICT ? process.stderr : process.stderr;
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
    `\n${hits.length} log call(s) appear to interpolate secret-bearing fields.\n` +
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
