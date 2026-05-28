#!/usr/bin/env tsx
/**
 * Per-line: if a line contains `space-x-N` or `space-y-N` AND the
 * tokens `flex` or `grid` (as a className), swap `space-` → `gap-`.
 * Skips lines without both signals. Idempotent.
 */
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
let changedFiles = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  let changed = false;
  const out = src
    .split("\n")
    .map((line) => {
      if (!/space-[xy]-\d/.test(line)) return line;
      // Must contain `flex` or `grid` as an EXACT display token on the same line.
      // Excludes `flex-1`, `flex-col`, `flex-row`, `grid-cols-*`, etc. which are
      // flex-child sizing / grid-template utilities, not display rules.
      if (!/(?:^|[\s"'`])(?:flex|grid)(?=[\s"'`]|$)/.test(line)) return line;
      const next = line.replace(/\bspace-(x|y)-(\d+(?:\.\d+)?)/g, "gap-$1-$2");
      if (next !== line) changed = true;
      return next;
    })
    .join("\n");
  if (changed) {
    writeFileSync(f, out);
    changedFiles++;
    console.log(`updated ${f}`);
  }
}
console.log(`\n${changedFiles} file(s) updated.`);
