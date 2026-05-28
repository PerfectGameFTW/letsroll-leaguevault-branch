#!/usr/bin/env tsx
/**
 * Replace three-period ellipsis "..." with "…" inside JSX text only.
 * Safer than the v1 codemod: text between '>' and '<' must NOT contain
 * any of `{`, `}`, `(`, `)`, `=` — those signal we're inside a code
 * region (arrow function body, JSX expression, rest spread, etc.), not
 * a JSX text node.
 */
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
let changed = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const out = src.replace(/>([^<{}=]*?)</g, (_m, txt) => {
    if (!txt.includes("...")) return `>${txt}<`;
    return `>${txt.replace(/\.\.\./g, "…")}<`;
  });
  if (out !== src) {
    writeFileSync(f, out);
    changed++;
    console.log(`updated ${f}`);
  }
}
console.log(`\n${changed} file(s) updated.`);
