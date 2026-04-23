/**
 * `log.debug` PII-leak guard (task #389).
 *
 * Task #336 audited every existing `log.debug` / `logger.debug` call
 * site under `server/` and confirmed each one logs only internal
 * numeric ids and structural facts — no emails, payment ids, tokens,
 * password material, etc. (See `docs/log-debug-pii-audit.md`.) That
 * contract is enforced today only by code review, so a future PR can
 * silently regress it by interpolating user-bearing strings.
 *
 * This guard walks every `.ts` file under `server/` (excluding
 * `*.test.ts` and `__tests__/`), finds each `log.debug(...)` /
 * `logger.debug(...)` call expression, and fails when its argument
 * list contains any of the forbidden identifiers (`email`, `password`,
 * `token`, `phone`, `address`, `secret`) — UNLESS:
 *
 *   1. The same call expression also calls a `mask*` helper
 *      (`maskEmail`, `maskPhone`, …), or
 *   2. The line carries an inline `pii-lint-ok` annotation comment
 *      with a justification, e.g.
 *        log.debug(`address keys: ${keys}`); // pii-lint-ok: keys only, not values
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

const SERVER_DIR = resolve(process.cwd(), 'server');
const STRICT = process.argv.includes('--strict');

// Forbidden identifiers. Match as a substring (case-insensitive) on
// the call argument list. Words like `userEmail`, `resetToken`, and
// `streetAddress` all match — that is intentional.
const FORBIDDEN = ['email', 'password', 'token', 'phone', 'address', 'secret'];

// Match `log.debug(`, `logger.debug(`, the optional-chaining variants
// `log?.debug(` / `logger?.debug(`, and the bracket-notation forms
// `log['debug'](` / `log["debug"](`. Aliased / destructured forms
// (`const d = log.debug; d(...)`) require AST-level analysis and are
// documented as a known limitation — use the inline `pii-lint-ok`
// annotation if you genuinely need that pattern.
const DEBUG_CALL_RE =
  /\b(?:log|logger)(?:\?\.debug|\.debug|\[\s*['"]debug['"]\s*\])\s*\(/g;

const SUPPRESSION_TAG = 'pii-lint-ok';

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
 * From an opening `(` at `start`, scan forward and return the index
 * of the matching closing `)`. Tracks string / template-literal /
 * line-comment / block-comment state so parens inside literals don't
 * skew the count. Returns -1 if no match (truncated source).
 */
function findMatchingParen(src: string, start: number): number {
  let depth = 1;
  let i = start + 1;
  let mode: 'code' | 'sq' | 'dq' | 'tpl' | 'line' | 'block' = 'code';
  let tplDepth = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    switch (mode) {
      case 'code':
        if (c === '/' && next === '/') {
          mode = 'line';
          i += 2;
          continue;
        }
        if (c === '/' && next === '*') {
          mode = 'block';
          i += 2;
          continue;
        }
        if (c === "'") { mode = 'sq'; i++; continue; }
        if (c === '"') { mode = 'dq'; i++; continue; }
        if (c === '`') { mode = 'tpl'; i++; continue; }
        if (c === '(') depth++;
        else if (c === ')') {
          depth--;
          if (depth === 0) return i;
        }
        i++;
        break;
      case 'line':
        if (c === '\n') mode = 'code';
        i++;
        break;
      case 'block':
        if (c === '*' && next === '/') { mode = 'code'; i += 2; continue; }
        i++;
        break;
      case 'sq':
        if (c === '\\') { i += 2; continue; }
        if (c === "'") mode = 'code';
        i++;
        break;
      case 'dq':
        if (c === '\\') { i += 2; continue; }
        if (c === '"') mode = 'code';
        i++;
        break;
      case 'tpl':
        if (c === '\\') { i += 2; continue; }
        if (c === '`') { mode = 'code'; i++; continue; }
        if (c === '$' && next === '{') {
          // Inside the expression of a template literal, switch back
          // to code mode but remember to come back. Track with
          // `tplDepth` and a stack of return modes via depth.
          tplDepth++;
          mode = 'code';
          // Treat the `{` as a paren-like opener for tpl tracking only
          // by lifting `depth` — but that would conflate with parens.
          // Instead inline-track braces via a tiny helper:
          i += 2;
          let braceDepth = 1;
          let m: 'code' | 'sq' | 'dq' | 'tpl' | 'line' | 'block' = 'code';
          while (i < src.length && braceDepth > 0) {
            const cc = src[i];
            const nn = src[i + 1];
            if (m === 'code') {
              if (cc === '/' && nn === '/') { m = 'line'; i += 2; continue; }
              if (cc === '/' && nn === '*') { m = 'block'; i += 2; continue; }
              if (cc === "'") { m = 'sq'; i++; continue; }
              if (cc === '"') { m = 'dq'; i++; continue; }
              if (cc === '`') { m = 'tpl'; i++; continue; }
              if (cc === '(') depth++;
              else if (cc === ')') {
                depth--;
                if (depth === 0) return i;
              } else if (cc === '{') braceDepth++;
              else if (cc === '}') braceDepth--;
              i++;
            } else if (m === 'line') {
              if (cc === '\n') m = 'code';
              i++;
            } else if (m === 'block') {
              if (cc === '*' && nn === '/') { m = 'code'; i += 2; continue; }
              i++;
            } else if (m === 'sq') {
              if (cc === '\\') { i += 2; continue; }
              if (cc === "'") m = 'code';
              i++;
            } else if (m === 'dq') {
              if (cc === '\\') { i += 2; continue; }
              if (cc === '"') m = 'code';
              i++;
            } else if (m === 'tpl') {
              if (cc === '\\') { i += 2; continue; }
              if (cc === '`') { m = 'code'; i++; continue; }
              i++;
            }
          }
          tplDepth--;
          mode = 'tpl';
          continue;
        }
        i++;
        break;
    }
  }
  return -1;
}

/**
 * Decode `\uXXXX`, `\\u{...}`, and `\xHH` escape sequences so a
 * payload like `user.\u0065mail`, `'\u0065mail=' + user.email`, or
 * `'\x74\x6f\x6b\x65\x6e=' + s` can't sneak past the keyword scan by
 * spelling forbidden tokens through escapes.
 */
function decodeUnicodeEscapes(s: string): string {
  return s
    .replace(/\\\u\{([0-9a-fA-F]+)\}/g, (_match, hex: string) => {
      const cp = Number.parseInt(hex, 16);
      try {
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
      } catch {
        return '';
      }
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
}

interface Hit {
  file: string;
  line: number;
  forbidden: string[];
  snippet: string;
}

/**
 * Splits a snippet of TS source into three accumulated buckets:
 *   - `codeNoStrings`: source with string-literal contents replaced
 *     by spaces (preserves structure but blanks out the text inside
 *     `'...'`, `"..."`, and `\`...\`` literals; expressions inside
 *     template `${...}` interpolations stay in the code bucket).
 *   - `strings`: concatenated text of every string-literal body.
 *   - `comments`: concatenated text of every `//` line comment and
 *     `/* ... *\/` block comment.
 *
 * Used to enforce that the `mask*` exemption matches a real call
 * expression in code (not a substring inside a message literal) and
 * that the `pii-lint-ok` annotation only counts when it appears in a
 * comment, never when it appears inside a string payload.
 */
function classify(src: string): {
  codeNoStrings: string;
  strings: string;
  comments: string;
} {
  let codeNoStrings = '';
  let strings = '';
  let comments = '';
  let i = 0;
  type Mode = 'code' | 'sq' | 'dq' | 'tpl' | 'line' | 'block';
  let mode: Mode = 'code';
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; i += 2; codeNoStrings += '  '; continue; }
      if (c === '/' && n === '*') { mode = 'block'; i += 2; codeNoStrings += '  '; continue; }
      if (c === "'") { mode = 'sq'; i++; codeNoStrings += ' '; continue; }
      if (c === '"') { mode = 'dq'; i++; codeNoStrings += ' '; continue; }
      if (c === '`') { mode = 'tpl'; i++; codeNoStrings += ' '; continue; }
      codeNoStrings += c;
      i++;
    } else if (mode === 'line') {
      if (c === '\n') { mode = 'code'; codeNoStrings += '\n'; i++; continue; }
      comments += c;
      i++;
    } else if (mode === 'block') {
      if (c === '*' && n === '/') { mode = 'code'; i += 2; codeNoStrings += '  '; continue; }
      comments += c;
      i++;
    } else if (mode === 'sq') {
      if (c === '\\') { strings += src.slice(i, i + 2); i += 2; continue; }
      if (c === "'") { mode = 'code'; codeNoStrings += ' '; i++; continue; }
      strings += c;
      i++;
    } else if (mode === 'dq') {
      if (c === '\\') { strings += src.slice(i, i + 2); i += 2; continue; }
      if (c === '"') { mode = 'code'; codeNoStrings += ' '; i++; continue; }
      strings += c;
      i++;
    } else if (mode === 'tpl') {
      if (c === '\\') { strings += src.slice(i, i + 2); i += 2; continue; }
      if (c === '`') { mode = 'code'; codeNoStrings += ' '; i++; continue; }
      if (c === '$' && n === '{') {
        // Treat the ${...} expression as code (so identifier names
        // like `user.email` still surface in codeNoStrings and so a
        // real `maskEmail(...)` call inside an interpolation counts
        // as the exemption).
        i += 2;
        let depth = 1;
        // Recursively classify the interpolation expression.
        const exprStart = i;
        while (i < src.length && depth > 0) {
          if (src[i] === '{') depth++;
          else if (src[i] === '}') depth--;
          if (depth > 0) i++;
        }
        const inner = classify(src.slice(exprStart, i));
        codeNoStrings += inner.codeNoStrings;
        strings += inner.strings;
        comments += inner.comments;
        i++; // skip the closing `}`
        continue;
      }
      strings += c;
      i++;
    }
  }
  return { codeNoStrings, strings, comments };
}

function scanFile(file: string): Hit[] {
  const src = readFileSync(file, 'utf8');
  const hits: Hit[] = [];
  DEBUG_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DEBUG_CALL_RE.exec(src)) !== null) {
    const openParen = m.index + m[0].length - 1;
    const close = findMatchingParen(src, openParen);
    if (close === -1) continue;
    const argList = src.slice(openParen + 1, close);
    const parts = classify(argList);

    // Trailing-line comment after the closing paren: only honor a
    // suppression annotation if it appears inside a `//` or `/* */`
    // comment on that line, never as bare text.
    const lineEnd = src.indexOf('\n', close);
    const trailingLine = src.slice(
      close + 1,
      lineEnd === -1 ? src.length : lineEnd,
    );
    const trailingClassified = classify(trailingLine);

    if (
      parts.comments.includes(SUPPRESSION_TAG) ||
      trailingClassified.comments.includes(SUPPRESSION_TAG)
    ) {
      continue;
    }

    // `mask*` exemption: only counts when it is a real call expression
    // in CODE (not text inside a string literal or comment). Matches
    // `maskEmail(`, `maskPhone(`, etc., so identifiers like
    // `unmaskedToken` don't sneak past.
    if (/\bmask[A-Z]\w*\s*\(/.test(parts.codeNoStrings)) continue;

    const haystack = decodeUnicodeEscapes(
      parts.codeNoStrings + ' ' + parts.strings,
    ).toLowerCase();
    const found = FORBIDDEN.filter((kw) => haystack.includes(kw));
    if (found.length === 0) continue;
    const lineNo = src.slice(0, m.index).split('\n').length;
    hits.push({
      file: relative(process.cwd(), file),
      line: lineNo,
      forbidden: found,
      snippet: src.slice(m.index, close + 1).replace(/\s+/g, ' ').slice(0, 200),
    });
  }
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
        `\`/* ${SUPPRESSION_TAG}: <reason> */\` comment with a ` +
        `justification reviewers can verify.\n`,
    );
    return 1;
  }
  return 0;
}

const code = main();
process.exit(code);
