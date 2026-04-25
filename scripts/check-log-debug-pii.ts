/**
 * `log.debug` PII-leak guard (task #389, AST upgrade in task #405).
 *
 * Task #336 audited every existing `log.debug` / `logger.debug` call
 * site under `server/` and confirmed each one logs only internal
 * numeric ids and structural facts — no emails, payment ids, tokens,
 * password material, etc. (See `docs/log-debug-pii-audit.md`.) That
 * contract is enforced today only by code review, so a future PR can
 * silently regress it by interpolating user-bearing strings.
 *
 * This guard parses every `.ts` file under `server/` (excluding
 * `*.test.ts` and `__tests__/`) with the TypeScript compiler API and
 * walks each `log.debug(...)` / `logger.debug(...)` call expression —
 * including aliased and destructured forms (`const d = log.debug;
 * d(...)`, `const { debug } = log; debug(...)`). It fails when any
 * argument contains a forbidden identifier (`email`, `password`,
 * `token`, `phone`, `address`, `secret`) UNLESS:
 *
 *   1. That argument routes the value through a `mask*` helper
 *      (`maskEmail`, `maskPhone`, …). Per-argument: a mask call on
 *      ONE argument does NOT exempt sibling arguments or sibling
 *      object-literal fields, only the subtree rooted at that mask
 *      call.
 *   2. The call carries an inline `pii-lint-ok: <reason>` annotation
 *      comment with a non-empty reason, e.g.
 *        log.debug(`address keys: ${keys}`); /* pii-lint-ok: keys only *\/
 *      The reason is required so reviewers can audit the suppression.
 *
 * Default mode prints a report and exits 0 (advisory). With
 * `--strict` it exits 1 on any breach. The vitest forcing function in
 * `tests/unit/check-log-debug-pii.test.ts` runs `--strict` against
 * the real codebase and asserts exit 0 — that is how this becomes a
 * CI gate without editing the locked `package.json`.
 *
 * Run with:
 *   tsx scripts/check-log-debug-pii.ts            # advisory
 *   tsx scripts/check-log-debug-pii.ts --strict   # CI gate
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import ts from 'typescript';

const SERVER_DIR = resolve(process.cwd(), 'server');
const STRICT = process.argv.includes('--strict');

// Forbidden identifiers. Match as a substring (case-insensitive) on
// any identifier text, property name, string-literal text, or
// template-literal segment text. Words like `userEmail`, `resetToken`,
// and `streetAddress` all match — that is intentional.
const FORBIDDEN = ['email', 'password', 'token', 'phone', 'address', 'secret'];

// `pii-lint-ok` requires a non-empty reason after the colon — the
// reason is what makes the suppression auditable. We extract the
// reason text from the comment and require at least one
// alphanumeric character. A bare `/* pii-lint-ok: */` does NOT
// suppress (the trailing `*/` would otherwise pass a naive `\S`
// check because `*` is non-whitespace).
const SUPPRESSION_LOCATE_RE = /\bpii-lint-ok\s*:/i;
function commentSuppresses(commentText: string): boolean {
  const m = SUPPRESSION_LOCATE_RE.exec(commentText);
  if (!m) return false;
  let rest = commentText.slice(m.index + m[0].length);
  // Strip block-comment terminator if present so `*/` is not
  // counted as part of the reason.
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
 * `log` and `logger` are the two base names debug calls flow through
 * (matches the pre-AST contract). Every other detection — direct
 * property access, optional chain, bracket-notation, alias, and
 * destructured binding — is anchored on one of these two roots.
 */
function isLogOrLoggerIdent(node: ts.Node): boolean {
  return (
    ts.isIdentifier(node) &&
    (node.text === 'log' || node.text === 'logger')
  );
}

/**
 * True if `node` is one of:
 *   log.debug | logger.debug
 *   log?.debug | logger?.debug          (optional-chain)
 *   log['debug'] | logger['debug']      (bracket-notation w/ literal)
 *   log?.['debug'] | logger?.['debug']  (optional element-access)
 */
function isDebugAccess(node: ts.Node): boolean {
  if (ts.isPropertyAccessExpression(node)) {
    return (
      isLogOrLoggerIdent(node.expression) && node.name.text === 'debug'
    );
  }
  if (ts.isElementAccessExpression(node)) {
    return (
      isLogOrLoggerIdent(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'debug'
    );
  }
  return false;
}

/**
 * True if `node` is a node that introduces its own variable scope
 * for `let` / `const` / parameter bindings. Includes SourceFile and
 * function-like nodes (own scope for parameters and locals), Blocks
 * (block-scope for let/const), and the iteration / catch forms that
 * also introduce their own scope.
 *
 * Used by the scope-aware alias resolver: shadowing is detected by
 * walking up these scope nodes from a call site to find the
 * nearest binding for an identifier name.
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

/**
 * True if `node` introduces a function-level scope (the scope `var`
 * declarations hoist into). Excludes Blocks and other block-scopes
 * which only host `let` / `const`.
 */
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

/**
 * True if the variable declaration belongs to a `var` (rather than
 * a `let` or `const`) declaration list. `var` hoists to the
 * nearest function scope, so its bindings need to be recorded
 * against that scope rather than against an enclosing block.
 */
function isVarDeclaration(decl: ts.VariableDeclaration): boolean {
  const list = decl.parent;
  if (list && ts.isVariableDeclarationList(list)) {
    return (list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0;
  }
  return false;
}

type Binding = 'alias' | 'other';

/**
 * Build a per-scope binding map for the file. For every name that
 * is bound by a variable declaration, record whether the binding
 * resolves to a debug alias (`log.debug`, `logger.debug`, the
 * bracket-notation equivalents, or destructuring `debug` from
 * `log` / `logger`) or to something else.
 *
 * The "else" entries are essential for shadowing: a `const d = ...`
 * in an inner scope must mask an outer `const d = log.debug` so the
 * inner `d(...)` is NOT treated as a debug call. Without recording
 * the inner binding the outer alias would still match by name.
 *
 * Function parameters are also recorded as `'other'` bindings so
 * that `function foo(debug) { debug(...) }` is not falsely flagged
 * when an outer scope happens to have aliased `debug`.
 *
 * Aliases reassigned across modules are out of scope here (the
 * scanner is per-file by design — that mirrors the import-time
 * contract for the guard).
 */
function collectScopedBindings(
  sourceFile: ts.SourceFile,
): Map<ts.Node, Map<string, Binding>> {
  const scopes = new Map<ts.Node, Map<string, Binding>>();
  const recordIn = (scope: ts.Node, name: string, kind: Binding): void => {
    let m = scopes.get(scope);
    if (!m) {
      m = new Map();
      scopes.set(scope, m);
    }
    // 'alias' wins over 'other' if both happen on the same name in
    // the same scope (rare, but stay conservative on the side of
    // catching debug calls).
    const prev = m.get(name);
    if (prev === 'alias') return;
    m.set(name, kind);
  };
  const recordParameters = (params: readonly ts.ParameterDeclaration[],
                            scope: ts.Node): void => {
    for (const p of params) {
      const collectFromBinding = (n: ts.BindingName): void => {
        if (ts.isIdentifier(n)) {
          recordIn(scope, n.text, 'other');
        } else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) {
          for (const el of n.elements) {
            if (ts.isBindingElement(el)) collectFromBinding(el.name);
          }
        }
      };
      collectFromBinding(p.name);
    }
  };

  const visit = (node: ts.Node): void => {
    // Record parameter bindings against the function-like's own scope.
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
      if (ts.isIdentifier(vd.name)) recordIn(node, vd.name.text, 'other');
    }
    if (ts.isVariableDeclaration(node)) {
      // `var` hoists to the nearest enclosing function scope; only
      // `let` / `const` are block-scoped. Picking the right scope
      // here matters so a `var d = log.debug` inside a block is
      // visible to all calls in the same function — and so it does
      // NOT spill out of the function boundary.
      const scope = isVarDeclaration(node)
        ? nearestFunctionScope(node)
        : nearestScope(node);
      const init = node.initializer;
      if (init && isDebugAccess(init) && ts.isIdentifier(node.name)) {
        recordIn(scope, node.name.text, 'alias');
      } else if (
        init &&
        isLogOrLoggerIdent(init) &&
        ts.isObjectBindingPattern(node.name)
      ) {
        for (const el of node.name.elements) {
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
          if (propText === 'debug' && ts.isIdentifier(el.name)) {
            recordIn(scope, el.name.text, 'alias');
          } else if (ts.isIdentifier(el.name)) {
            recordIn(scope, el.name.text, 'other');
          }
        }
      } else if (ts.isIdentifier(node.name)) {
        // Plain `const d = something` — record as 'other' so it
        // shadows any same-named outer alias.
        recordIn(scope, node.name.text, 'other');
      } else {
        // Destructuring without a debug-source pattern: still record
        // local bindings as 'other' to enable shadowing.
        const collectFromBinding = (n: ts.BindingName): void => {
          if (ts.isIdentifier(n)) {
            recordIn(scope, n.text, 'other');
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
      // Function declarations bind their name in the enclosing scope.
      recordIn(nearestScope(node), node.name.text, 'other');
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  // Pass 2: assignment-alias `d = log.debug;`. We must resolve the
  // assignment to the scope where `d` was actually DECLARED, not
  // the scope that immediately encloses the assignment. Otherwise
  // a `d = log.debug` inside an inner block (e.g. `if (cond) { d
  // = log.debug; }`) would record the alias only against that
  // block, and a call to `d(...)` outside the block but inside the
  // same function would not see it — a real bypass.
  //
  // We walk up from the assignment's enclosing scope until we find
  // a scope that already records a binding for this name (from
  // pass 1). If no scope records the name, we fall back to the
  // file scope so the alias is at least visible to the rest of
  // the file. Pass 1 has fully populated declaration bindings, so
  // this lookup is safe regardless of source order.
  const visitAssignments = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      isDebugAccess(node.right)
    ) {
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
      recordIn(bindingScope, name, 'alias');
    }
    ts.forEachChild(node, visitAssignments);
  };
  visitAssignments(sourceFile);

  return scopes;
}

/**
 * Resolve an identifier used at a call site by walking up scopes
 * until a scope binds the name. Returns `'alias'` when the nearest
 * enclosing binding is a debug alias, `'other'` if it's any other
 * binding (i.e. shadowed), or `null` if no enclosing scope binds
 * the name (the name is from an import / outer file / global).
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
 * True if `node` is a call to a function whose syntactic name starts
 * with `mask` followed by an uppercase letter (`maskEmail(...)`,
 * `maskPhone(...)`, `pii.maskEmail(...)`). Per-argument exemption is
 * scoped to the subtree rooted at this call, so a `maskEmail(...)`
 * inside one object property does NOT exempt sibling properties.
 */
function isMaskCall(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  let name = '';
  if (ts.isIdentifier(callee)) name = callee.text;
  else if (ts.isPropertyAccessExpression(callee)) name = callee.name.text;
  return /^mask[A-Z]/.test(name);
}

/**
 * True if any node in `node`'s subtree is a `mask*(...)` call.
 * Used to decide whether a TemplateExpression's literal segments
 * (head/middle/tail) should be scanned: when the template already
 * routes its values through a mask, the surrounding label text is
 * almost always a structured caption like `` `user email: ${mask…}` ``
 * and scanning it would produce false positives for the very
 * keyword the call deliberately surrounds.
 */
function subtreeContainsMaskCall(node: ts.Node): boolean {
  if (isMaskCall(node)) return true;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (isMaskCall(n)) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/**
 * Walk one argument's subtree and collect any forbidden tokens it
 * mentions. Stops descending into subtrees rooted at a `mask*(...)`
 * call — that is the per-argument / per-subtree exemption: a mask
 * call on ONE property exempts only that property's value, not
 * sibling properties or sibling arguments.
 *
 * Inspects identifier text, property names, plain string-literal
 * text, and template-literal head/middle/tail text. Template label
 * segments are scanned UNLESS the enclosing template also contains
 * a mask call — that exemption handles the intentional pattern of
 * a captioned interpolation like `` `user email: ${maskEmail(…)}` ``
 * without silencing siblings: a real leak in a sibling span like
 * `` `${maskEmail(x)} pw=${user.password}` `` is still caught via
 * the unmasked identifier inside the other span.
 *
 * The AST has already decoded `\uXXXX`, `\u{...}`, and `\xHH` escapes
 * inside identifiers and string literals, so previous escape-sequence
 * bypasses are handled automatically.
 */
function scanArgForForbidden(arg: ts.Node, found: Set<string>): void {
  const check = (text: string): void => {
    const lc = text.toLowerCase();
    for (const kw of FORBIDDEN) {
      if (lc.includes(kw)) found.add(kw);
    }
  };
  const visit = (n: ts.Node, inMaskedTemplate: boolean): void => {
    if (isMaskCall(n)) return;
    let nextInMaskedTemplate = inMaskedTemplate;
    if (ts.isTemplateExpression(n) && subtreeContainsMaskCall(n)) {
      nextInMaskedTemplate = true;
    }
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) {
      check(n.text);
    } else if (ts.isStringLiteralLike(n)) {
      // StringLiteral and NoSubstitutionTemplateLiteral.
      check(n.text);
    } else if (
      n.kind === ts.SyntaxKind.TemplateHead ||
      n.kind === ts.SyntaxKind.TemplateMiddle ||
      n.kind === ts.SyntaxKind.TemplateTail
    ) {
      if (!inMaskedTemplate) {
        check((n as ts.TemplateLiteralLikeNode).text);
      }
    }
    n.forEachChild((c) => visit(c, nextInMaskedTemplate));
  };
  visit(arg, false);
}

/**
 * Collect every `// ...` and `/* ... *\/` comment in the file with
 * its starting line number. Used to find `pii-lint-ok: <reason>`
 * suppression annotations — only comments count, never bare text in
 * a string payload.
 *
 * Implemented as a literal-aware text walker rather than via
 * `ts.createScanner` because the standalone scanner does not handle
 * template-literal continuations (the parser drives those via
 * `reScanTemplateToken`), so a `/* ... *\/` after `\`...\`); ` would
 * otherwise be swallowed into a phantom template tail.
 */
function getAllComments(
  sourceFile: ts.SourceFile,
): Array<{ line: number; text: string }> {
  const text = sourceFile.text;
  const out: Array<{ line: number; text: string }> = [];
  const push = (start: number, end: number): void => {
    out.push({
      line: sourceFile.getLineAndCharacterOfPosition(start).line,
      text: text.slice(start, end),
    });
  };

  type Mode = 'code' | 'sq' | 'dq' | 'tpl';
  let mode: Mode = 'code';
  // Stack of brace depths for nested `${...}` expressions. When the
  // depth at the top of the stack hits zero on a `}`, we pop back
  // into template mode. Tracking depth per-frame correctly handles
  // an object literal `{ ... }` inside an interpolation.
  const tplBraceStack: number[] = [];

  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const n = text[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') {
        const start = i;
        i += 2;
        while (i < text.length && text[i] !== '\n') i++;
        push(start, i);
        continue;
      }
      if (c === '/' && n === '*') {
        const start = i;
        i += 2;
        while (i < text.length - 1 && !(text[i] === '*' && text[i + 1] === '/'))
          i++;
        i = Math.min(text.length, i + 2);
        push(start, i);
        continue;
      }
      if (c === "'") { mode = 'sq'; i++; continue; }
      if (c === '"') { mode = 'dq'; i++; continue; }
      if (c === '`') { mode = 'tpl'; i++; continue; }
      if (tplBraceStack.length > 0) {
        if (c === '{') {
          tplBraceStack[tplBraceStack.length - 1]++;
        } else if (c === '}') {
          if (tplBraceStack[tplBraceStack.length - 1] === 0) {
            tplBraceStack.pop();
            mode = 'tpl';
            i++;
            continue;
          }
          tplBraceStack[tplBraceStack.length - 1]--;
        }
      }
      i++;
    } else if (mode === 'sq') {
      if (c === '\\') { i += 2; continue; }
      if (c === "'") { mode = 'code'; i++; continue; }
      i++;
    } else if (mode === 'dq') {
      if (c === '\\') { i += 2; continue; }
      if (c === '"') { mode = 'code'; i++; continue; }
      i++;
    } else {
      // tpl
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { mode = 'code'; i++; continue; }
      if (c === '$' && n === '{') {
        tplBraceStack.push(0);
        mode = 'code';
        i += 2;
        continue;
      }
      i++;
    }
  }
  return out;
}

interface Hit {
  file: string;
  line: number;
  forbidden: string[];
  snippet: string;
}

function scanFile(file: string): Hit[] {
  const src = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    src,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const scopes = collectScopedBindings(sourceFile);
  const allComments = getAllComments(sourceFile);
  const hits: Hit[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let isDebug = false;
      if (isDebugAccess(callee)) {
        isDebug = true;
      } else if (ts.isIdentifier(callee)) {
        // Scope-aware alias resolution: only count this identifier
        // as a debug call if its nearest enclosing binding in the
        // file is a debug alias. A same-named binding in an inner
        // scope (function parameter, inner const, catch variable,
        // etc.) shadows the alias and prevents false positives.
        if (resolveIdentifierBinding(callee, scopes) === 'alias') {
          isDebug = true;
        }
      }

      if (isDebug) {
        const startLine = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        ).line;
        const endLine = sourceFile.getLineAndCharacterOfPosition(
          node.getEnd(),
        ).line;

        // Suppression: a `pii-lint-ok: <reason>` annotation on a
        // comment whose line falls inside the call's line range
        // (covers leading comments on arguments AND a trailing
        // same-line comment after the closing paren).
        let suppressed = false;
        for (const c of allComments) {
          if (
            c.line >= startLine &&
            c.line <= endLine &&
            commentSuppresses(c.text)
          ) {
            suppressed = true;
            break;
          }
        }

        if (!suppressed) {
          const found = new Set<string>();
          for (const arg of node.arguments) {
            scanArgForForbidden(arg, found);
          }
          if (found.size > 0) {
            const snippet = src
              .slice(node.getStart(sourceFile), node.getEnd())
              .replace(/\s+/g, ' ')
              .slice(0, 200);
            hits.push({
              file: relative(process.cwd(), file),
              line: startLine + 1,
              forbidden: Array.from(found).sort(
                (a, b) => FORBIDDEN.indexOf(a) - FORBIDDEN.indexOf(b),
              ),
              snippet,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits;
}

function main(): number {
  const files = listTsFiles(SERVER_DIR);
  const hits: Hit[] = [];
  for (const f of files) {
    hits.push(...scanFile(f));
  }
  process.stdout.write(
    `log.debug PII guard: scanned ${files.length} file(s)\n`,
  );
  if (hits.length === 0) {
    process.stdout.write('OK: no suspicious payloads detected\n');
    return 0;
  }
  const banner = STRICT ? 'FAIL' : 'WARN';
  for (const h of hits) {
    process.stderr.write(
      `${banner}: ${h.file}:${h.line} log.debug payload contains ${h.forbidden.join(', ')}\n` +
        `  ${h.snippet}\n`,
    );
  }
  if (STRICT) {
    process.stderr.write(
      `\nRoute the offending value through a mask* helper from ` +
        `server/utils/pii.ts, or add an inline ` +
        `\`/* pii-lint-ok: <reason> */\` comment with a ` +
        `justification reviewers can verify.\n`,
    );
    return 1;
  }
  return 0;
}

const code = main();
process.exit(code);
