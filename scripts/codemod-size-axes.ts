#!/usr/bin/env tsx
/**
 * Codemod: replace Tailwind `w-N h-N` (matching square dimensions) with `size-N`.
 * Only touches files inside string-like contexts (`...`, "...", '...', and template literals)
 * to avoid editing identifiers or comments. Scoped to client/src/.
 *
 * Patterns handled (W and H may appear in either order, anywhere in a class string,
 * separated by other classes):
 *   "w-4 h-4"             -> "size-4"
 *   "h-5 w-5"             -> "size-5"
 *   "mr-2 h-4 w-4"        -> "mr-2 size-4"
 *   "w-[18px] h-[18px]"   -> "size-[18px]"
 *   "shrink-0 h-4 w-4"    -> "shrink-0 size-4"
 *
 * Variants are matched on both sides (must match):
 *   "md:w-6 md:h-6"       -> "md:size-6"
 *   "sm:w-4 sm:h-4 lg:w-6 lg:h-6" -> "sm:size-4 lg:size-6"
 *
 * NOT touched (correctly):
 *   "w-4 h-6"             (different values)
 *   "w-4 md:h-4"          (variant mismatch)
 *   "w-full h-full"       -> NOT touched (not size-N; Tailwind has no size-full pre-3.4? — actually does, but conservative skip)
 *
 * Conservative: only handles numeric values and bracketed arbitrary values.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const root = process.cwd();
const targets = execSync(
  `find client/src -type f \\( -name '*.tsx' -o -name '*.jsx' -o -name '*.ts' -o -name '*.js' \\)`,
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

// Match a single utility "X-VAL" where X = w|h, VAL = digits or [arbitrary].
// Capture optional variant prefix (e.g. "md:", "hover:", "group-hover:").
// Variants are colon-separated alphanumerics.
const VARIANT_RE = "(?:[a-z0-9_-]+:)*";
const VAL_RE = "(?:\\d+(?:\\.\\d+)?|\\[[^\\]\\s]+\\])";

// Match a class token: optional variant + 'w-' or 'h-' + value, bordered by whitespace or string boundary
// We work on the string content (without quotes). Use word boundaries via whitespace.
function transformClassString(input: string): string {
  // Split on whitespace, keep separators
  const tokens = input.split(/(\s+)/);
  const items: { variant: string; axis: "w" | "h"; value: string; idx: number; raw: string }[] = [];
  const tokenRe = new RegExp(`^(${VARIANT_RE})(w|h)-(${VAL_RE})$`);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const m = tokenRe.exec(t);
    if (m) {
      items.push({ variant: m[1], axis: m[2] as "w" | "h", value: m[3], idx: i, raw: t });
    }
  }
  // Group by (variant + value); if both axes present → replace.
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const key = `${it.variant}|${it.value}`;
    const arr = groups.get(key) ?? [];
    arr.push(it);
    groups.set(key, arr);
  }
  let changed = false;
  for (const [, arr] of groups) {
    const hasW = arr.find((x) => x.axis === "w");
    const hasH = arr.find((x) => x.axis === "h");
    if (hasW && hasH) {
      // Replace the first occurrence with size-... and remove the second.
      const first = arr[0].idx < arr[1].idx ? arr[0] : arr[1];
      const second = arr[0].idx < arr[1].idx ? arr[1] : arr[0];
      tokens[first.idx] = `${first.variant}size-${first.value}`;
      // Remove second token + the whitespace separator preceding it (or trailing if at start)
      tokens[second.idx] = "";
      // Eat one adjacent whitespace token so we don't leave double spaces
      if (second.idx > 0 && /^\s+$/.test(tokens[second.idx - 1])) {
        tokens[second.idx - 1] = "";
      } else if (second.idx + 1 < tokens.length && /^\s+$/.test(tokens[second.idx + 1])) {
        tokens[second.idx + 1] = "";
      }
      changed = true;
    }
  }
  if (!changed) return input;
  return tokens.join("");
}

// Walk JS/TS source and rewrite string literals/template literals.
// We use a non-AST approach: scan for "...", '...', `...` and apply transformClassString
// to the *literal* contents. This is safe because we only swap class tokens that match
// the strict Tailwind pattern.
function transformSource(source: string): { out: string; changed: boolean } {
  let out = "";
  let i = 0;
  let changed = false;
  const N = source.length;
  while (i < N) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      // Find matching close (respecting escapes; for template literals, do NOT cross ${...}).
      const quote = ch;
      let j = i + 1;
      let segStart = j;
      let buf = quote;
      const isTpl = quote === "`";
      while (j < N) {
        const c = source[j];
        if (c === "\\") {
          j += 2;
          continue;
        }
        if (isTpl && c === "$" && source[j + 1] === "{") {
          // flush current segment
          buf += transformClassString(source.slice(segStart, j));
          // copy ${...} block verbatim (with brace tracking)
          let depth = 1;
          let k = j + 2;
          while (k < N && depth > 0) {
            const cc = source[k];
            if (cc === "{") depth++;
            else if (cc === "}") depth--;
            if (depth === 0) break;
            k++;
          }
          buf += source.slice(j, k + 1);
          j = k + 1;
          segStart = j;
          continue;
        }
        if (c === quote) {
          buf += transformClassString(source.slice(segStart, j));
          buf += quote;
          j++;
          break;
        }
        j++;
      }
      if (buf !== source.slice(i, j)) changed = true;
      out += buf;
      i = j;
    } else if (ch === "/" && source[i + 1] === "/") {
      // line comment
      const eol = source.indexOf("\n", i);
      const end = eol === -1 ? N : eol;
      out += source.slice(i, end);
      i = end;
    } else if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? N : end + 2;
      out += source.slice(i, stop);
      i = stop;
    } else {
      out += ch;
      i++;
    }
  }
  return { out, changed };
}

let touched = 0;
for (const file of targets) {
  const path = `${root}/${file}`;
  const src = readFileSync(path, "utf8");
  const { out, changed } = transformSource(src);
  if (changed) {
    writeFileSync(path, out);
    touched++;
    console.log(`updated ${file}`);
  }
}
console.log(`\n${touched} file(s) updated.`);
