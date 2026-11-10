// Renders the tables of EXP4B.md from exp4b-results/kysely.json and exp4b-results/drizzle.json.
// Usage: node reference/exp4b-render.ts            (writes exp4b-results/tables.md; EXP4B.md includes it by hand)
// The classification is recomputed here from the stored raw data (tsc errors, test results, rejected statements), using
// classifyRefs from exp4b-common.mts, so the tables always agree with the current classification code.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SPIKE_DIR, classifyRefs, pct, type Ref, type RefResult } from "./exp4b-common.mts";

const SRC = "src/exp1.ts";
type V = RefResult["verdict"] | "unaffected";
type R = Omit<RefResult, "verdict"> & { verdict: V };
interface Run {
  column: string;
  variant?: "D1" | "D2";
  migration: string;
  schemaEdit?: { file: string; lines: number }[];
  tscErrors: { file: string; line: number; code: string; msg: string }[];
  tests: { title: string; status: string; message: string }[];
  dbErrors: { error: string; statement: string; fn: string | null }[];
  refs: RefResult[];
  revert: Record<string, boolean>;
}
const load = (f: string) => JSON.parse(readFileSync(join(SPIKE_DIR, "exp4b-results", f), "utf8")) as { columns: Run[]; baseline: unknown; refCount?: number };

// Kysely reports a failing call at the call's first line (TS2769 on e.g. `.select([`), not at the failing element. The strict
// score counts only errors on the reference's own line. The attributed score also counts a typed-string reference as caught
// when an unmatched TS2769 in the same run starts a call whose extent (up to the line that closes it, by indentation)
// contains the reference. Valid because the call compiled at baseline and only this column was renamed.
let srcLines: string[] = [];
function extentOf(start: number): [number, number] {
  const ind = (l: string) => l.length - l.trimStart().length;
  const base = ind(srcLines[start - 1]!);
  for (let i = start; i < srcLines.length; i++) {
    const l = srcLines[i]!;
    if (l.trim() === "") continue;
    if (ind(l) <= base) return [start, i + 1];
  }
  return [start, srcLines.length];
}
function attribute(run: Run, out: R[]): R[] {
  const refLines = new Set(run.refs.map((r) => r.line));
  const calls = run.tscErrors.filter((e) => e.file.endsWith(SRC) && e.code === "TS2769" && !refLines.has(e.line));
  if (!calls.length) return out;
  return out.map((r) => {
    if (r.verdict === "compile" || r.form !== "typed-string") return r;
    const c = calls.find((e) => { const [a, b] = extentOf(e.line); return r.line > a && r.line <= b; });
    return c ? { ...r, verdict: "compile" as V, evidence: `attributed: TS2769 at L${c.line} (start of the enclosing call)` } : r;
  });
}
function reclassify(run: Run, attributed = false): R[] {
  const refs: Ref[] = run.refs.map(({ verdict: _v, evidence: _e, ...r }) => r);
  const out = classifyRefs(refs, run.tscErrors, run.tests as never, SRC, run.dbErrors) as R[];
  if (attributed) return attribute(run, out);
  if (run.variant === "D1") return out.map((r) => (r.verdict === "undetected" ? { ...r, verdict: "unaffected" as V, evidence: "nothing stale: code names the property, not the database column" } : r));
  return out;
}

const QS = ["Q1", "Q2", "Q3", "Q4"] as const;
const short = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const esc = (s: string) => s.replace(/\|/g, "\\|");

interface Arm {
  name: string;
  runs: { run: Run; refs: R[] }[];
}

function scoreTable(arm: Arm): string {
  const all = arm.runs.flatMap((r) => r.refs);
  const row = (label: string, rs: R[]) => {
    const n = (v: V) => rs.filter((r) => r.verdict === v).length;
    return `| ${label} | ${rs.length} | ${n("compile")} | ${n("runtime")} | ${n("undetected")} | ${n("unaffected")} | ${pct(n("compile"), rs.length)} |`;
  };
  return [
    "| Query | References | Compile-time | Runtime-only | Passes wrongly | Unaffected | Caught at compile time |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...QS.map((q) => row(q, all.filter((r) => r.q === q))),
    row("**All**", all),
  ].join("\n");
}

function colTable(arm: Arm): string {
  const lines = ["| Column | Refs | Compile | Runtime | Passes wrongly | Unaffected | tsc errors (all files) | tsc errors in exp1.ts | Schema/migration edit |", "|---|---:|---:|---:|---:|---:|---:|---:|---|"];
  for (const { run, refs } of arm.runs) {
    const n = (v: V) => refs.filter((r) => r.verdict === v).length;
    const inSrc = run.tscErrors.filter((e) => e.file.endsWith(SRC)).length;
    const edit = run.schemaEdit ? `${run.schemaEdit.map((s) => `${s.file}:${s.lines}`).join(", ")} lines` : "1 migration, types regenerated";
    lines.push(`| ${run.column} | ${refs.length} | ${n("compile")} | ${n("runtime")} | ${n("undetected")} | ${n("unaffected")} | ${run.tscErrors.length} | ${inSrc} | ${edit} |`);
  }
  return lines.join("\n");
}

function refTable(arm: Arm): string {
  const rows: (R & { column: string })[] = arm.runs.flatMap(({ run, refs }) => refs.map((r) => ({ ...r, column: run.column })));
  const out: string[] = [];
  for (const q of QS) {
    out.push(`\n#### ${q}\n`, "| Line | Column | Form | Result | Evidence |", "|---:|---|---|---|---|");
    for (const r of rows.filter((x) => x.q === q).sort((a, b) => a.line - b.line || a.column.localeCompare(b.column))) {
      out.push(`| ${r.line} | ${r.column} | ${r.form} | ${r.verdict} | ${esc(short(r.verdict === "compile" ? r.evidence : r.evidence))} |`);
    }
  }
  return out.join("\n");
}

function unattributed(arm: Arm): string {
  const out: string[] = [];
  for (const { run, refs } of arm.runs) {
    const refLines = new Set(refs.map((r) => r.line));
    const odd = run.tscErrors.filter((e) => e.file.endsWith(SRC) && !refLines.has(e.line));
    for (const e of odd) out.push(`| ${run.column} | ${e.line} | ${e.code} | ${esc(short(e.msg, 140))} |`);
  }
  return out.length ? ["| Column | Line | Code | Message |", "|---|---:|---|---|", ...out].join("\n") : "(none)";
}

const arms: Arm[] = [];
srcLines = readFileSync(join(SPIKE_DIR, "arm-kysely-stable", SRC), "utf8").split("\n").map((l) => l.replace(/\r$/, ""));
const k = load("kysely.json");
const part = load("kysely.partial.json"); // re-run of the columns whose tsc output is stored with continuation detail
const kcols = k.columns.map((c) => part.columns.find((p) => p.column === c.column) ?? c);
arms.push({ name: "Kysely (strict: error on the reference's own line)", runs: kcols.map((run) => ({ run, refs: reclassify(run) })) });
arms.push({ name: "Kysely (attributed: call-start errors counted)", runs: kcols.map((run) => ({ run, refs: reclassify(run, true) })) });
const d = load("drizzle.json");
for (const v of ["D2", "D1"] as const) arms.push({ name: `Drizzle ${v}`, runs: d.columns.filter((c) => c.variant === v).map((run) => ({ run, refs: reclassify(run) })) });

const md: string[] = [];
for (const arm of arms) {
  md.push(`\n### ${arm.name}\n`, "#### Score\n", scoreTable(arm), "\n#### Per column\n", colTable(arm), "\n#### Errors in src/exp1.ts on a line that holds no listed reference of that column\n", unattributed(arm), "\n#### Per reference");
  md.push(refTable(arm));
}
writeFileSync(join(SPIKE_DIR, "exp4b-results", "tables.md"), md.join("\n"));
console.log(arms.map((a) => `${a.name}: ${a.runs.flatMap((r) => r.refs).length} refs`).join("; "));
