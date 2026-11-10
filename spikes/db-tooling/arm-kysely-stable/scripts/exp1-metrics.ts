// Computes raw SQL share and LOC for the Exp 1 queries in src/exp1.ts (spec: EXPERIMENTS.md "Metrics").
// Raw escapes counted: sql`...` (with its generic) in full. sql.lit/sql.raw/sql.ref are reported separately ("withLit").
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/exp1.ts", import.meta.url), "utf8");
const nws = (s: string) => s.replace(/\s+/g, "").length;
const stripComments = (s: string) =>
  s
    .split("\n")
    .map((l) => l.replace(/\s\/\/.*$/, "").replace(/^\s*\/\/.*$/, ""))
    .join("\n");

function block(name: string): string {
  return new RegExp(`// BEGIN ${name}\\n([\\s\\S]*?)// END ${name}`).exec(src)![1]!;
}

const TAGGED = /\bsql(<[^`]*?>)?`(?:[^`\\]|\\.)*`/g;
const HELPERS = /\bsql\.(lit|raw|ref)\([^)]*\)/g;

function measure(names: string[]) {
  let expr = "";
  let raw = 0;
  let lit = 0;
  let loc = 0;
  for (const n of names) {
    const code = stripComments(block(n));
    loc += code.split("\n").filter((l) => l.trim() !== "").length;
    const from = code.search(/\btx\s*\.|\breturn tx\b/);
    const start = code.indexOf("tx", from);
    const e = code.slice(start, code.lastIndexOf(".execute()") + ".execute()".length);
    expr += e;
    for (const m of e.matchAll(TAGGED)) raw += nws(m[0]);
    for (const m of e.matchAll(HELPERS)) lit += nws(m[0]);
  }
  const total = nws(expr);
  const pct = (x: number) => ((100 * x) / total).toFixed(1) + "%";
  return { queries: names.join("+"), loc, nonWsChars: total, rawChars: raw, share: pct(raw), shareWithLit: pct(raw + lit) };
}

for (const q of [["Q1"], ["Q2"], ["Q3"], ["Q4A"], ["Q4B"], ["Q4C"], ["Q4A", "Q4B", "Q4C"]]) console.log(JSON.stringify(measure(q)));
