#!/usr/bin/env tsx
/**
 * Replace three-period ellipsis "..." with the proper ellipsis "…" character
 * inside JSX text nodes only (between '>' and '<' on the same line).
 * Strings and comments are NOT touched. Code-level "..." (spread, rest, etc.)
 * is never inside JSX text so the boundary above is sufficient.
 */
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
let changed = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  // Match JSX text between > and < on one line, replace ... with … inside it.
  // The > can be the closing of a JSX tag like `<span>` or a self-close `/>`.
  const out = src.replace(/>([^<\n]*?)</g, (_m, txt) => {
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
