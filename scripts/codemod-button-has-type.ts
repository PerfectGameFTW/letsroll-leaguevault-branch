#!/usr/bin/env tsx
/**
 * Add `type="button"` to JSX <button ...> elements that lack a `type=` attribute.
 * Conservative: only adds type when the opening tag is detectable on a single
 * starting `<button` token and has no `type=` anywhere before its closing `>`.
 *
 * Skips:
 *  - <button type="submit"> / type="button" / type="reset"  (already typed)
 *  - <Button ...> (PascalCase — not the DOM element)
 */
import { readFileSync, writeFileSync } from "node:fs";

const files = process.argv.slice(2);
let totalChanged = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  let out = "";
  let i = 0;
  let changed = false;
  while (i < src.length) {
    const idx = src.indexOf("<button", i);
    if (idx === -1) {
      out += src.slice(i);
      break;
    }
    out += src.slice(i, idx);
    // Must be followed by whitespace or >
    const next = src[idx + 7];
    if (next !== " " && next !== "\n" && next !== "\t" && next !== ">" && next !== "/") {
      out += "<button";
      i = idx + 7;
      continue;
    }
    // Find end of opening tag — first '>' not inside braces/strings.
    let j = idx + 7;
    let depth = 0;
    let q: string | null = null;
    while (j < src.length) {
      const c = src[j];
      if (q) {
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (c === q) q = null;
        j++;
        continue;
      }
      if (c === "'" || c === '"' || c === "`") {
        q = c;
        j++;
        continue;
      }
      if (c === "{") {
        depth++;
        j++;
        continue;
      }
      if (c === "}") {
        depth--;
        j++;
        continue;
      }
      if (depth === 0 && c === ">") break;
      j++;
    }
    if (j >= src.length) {
      out += src.slice(idx);
      break;
    }
    const tag = src.slice(idx, j + 1);
    // Already has type=?
    if (/\btype\s*=/.test(tag)) {
      out += tag;
    } else {
      // Insert type="button" right after `<button`
      const isSelfClose = tag.endsWith("/>");
      const inner = tag.slice(7, isSelfClose ? -2 : -1);
      out += `<button type="button"${inner}${isSelfClose ? "/>" : ">"}`;
      changed = true;
    }
    i = j + 1;
  }
  if (changed) {
    writeFileSync(f, out);
    totalChanged++;
    console.log(`updated ${f}`);
  }
}
console.log(`\n${totalChanged} file(s) updated.`);
