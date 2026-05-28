#!/usr/bin/env tsx
/**
 * Safer regex-only variant of codemod-size-axes.ts: no string-state tracking, so
 * apostrophes in JSX text can't derail it. Only matches the explicit pattern:
 *   ((variant:)*)w-(VAL) <whitespace> \1h-\3   ->   \1size-\3
 *   ((variant:)*)h-(VAL) <whitespace> \1w-\3   ->   \1size-\3
 * with token boundaries (whitespace or string-quote on either side).
 *
 * VAL = digits | [arbitrary]
 *
 * Caveat: this only catches W and H adjacent (or separated by whitespace only),
 * not interleaved with other classes — that's an acceptable tradeoff for safety.
 */
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: codemod-size-axes-safe.ts <file> [file...]");
  process.exit(1);
}

const VARIANT = "(?:[a-z0-9_-]+:)*";
const VAL = "(?:\\d+(?:\\.\\d+)?|\\[[^\\]\\s]+\\])";
const BOUNDARY_LEFT = '(^|[\\s"\'`])';
const BOUNDARY_RIGHT = '(?=[\\s"\'`]|$)';

// Two passes: (a) wXhX (w first) (b) hXwX (h first). We also handle non-adjacent
// case where some classes sit between them — common in cn() arrays — via a
// secondary pass that allows up to ~80 non-newline chars between W and H of the
// same variant+value, as long as nothing else looks like a quote.
const wh = new RegExp(
  `${BOUNDARY_LEFT}(${VARIANT})w-(${VAL})\\s+\\2h-\\3${BOUNDARY_RIGHT}`,
  "g",
);
const hw = new RegExp(
  `${BOUNDARY_LEFT}(${VARIANT})h-(${VAL})\\s+\\2w-\\3${BOUNDARY_RIGHT}`,
  "g",
);

let totalChanged = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  let out = src.replace(wh, (_m, b, v, val) => `${b}${v}size-${val}`);
  out = out.replace(hw, (_m, b, v, val) => `${b}${v}size-${val}`);
  if (out !== src) {
    writeFileSync(f, out);
    totalChanged++;
    console.log(`updated ${f}`);
  }
}
console.log(`\n${totalChanged} file(s) updated.`);
