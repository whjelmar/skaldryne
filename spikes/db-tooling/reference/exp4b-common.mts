// Shared helpers for Experiment 4b (type safety under a column rename). Used by both arm scripts:
//   arm-kysely-stable/scripts/exp4b-kysely.ts and arm-drizzle-stable/scripts/exp4b-drizzle.ts.
// No dependencies beyond node: the arm scripts pass in anything that needs `pg`.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";

export const SPIKE_DIR = resolve(import.meta.dirname, "..");

/** One reference to a column in the Experiment 1 query code. */
export interface Ref {
  q: "Q1" | "Q2" | "Q3" | "Q4";
  fn: string; // query function, e.g. "graphHops"
  table: string;
  col: string; // database column name
  line: number; // line in src/exp1.ts of the arm (frozen)
  form: string; // how the column is written: typed-string, typed-set-key, raw-sql-text, property, ...
  snip: string; // text that must appear on that line (guards against drift)
}

export const COLUMN_KEY = (r: { table: string; col: string }) => `${r.table}.${r.col}`;

/** Fail loudly if the arm's source no longer matches the reference list. */
export function checkRefs(source: string, refs: Ref[]): void {
  const lines = source.split(/\r?\n/);
  const bad = refs.filter((r) => !(lines[r.line - 1] ?? "").includes(r.snip));
  if (bad.length) {
    throw new Error("reference list out of date:\n" + bad.map((r) => `  ${r.q} ${COLUMN_KEY(r)} L${r.line} expects "${r.snip}" got "${lines[r.line - 1]}"`).join("\n"));
  }
}

/** Copy an arm into a work directory (no node_modules, no build output) and link its node_modules. */
export function makeWorkCopy(armDir: string, workDir: string): void {
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const skip = new Set(["node_modules", ".tmp", "reports", "exp1-sql.log"]);
  cpSync(armDir, workDir, {
    recursive: true,
    filter: (src) => {
      const n = src.split(/[\\/]/).pop()!;
      return !skip.has(n) && !/^exp4b-/.test(n); // the exp4b scripts import ../../reference and would not type-check in the copy
    },
  });
  mkdirSync(join(workDir, "reports"), { recursive: true });
  symlinkSync(join(armDir, "node_modules"), join(workDir, "node_modules"), "junction");
}

export interface TscError {
  file: string;
  line: number;
  code: string;
  msg: string;
  detail?: string; // the indented continuation lines tsc prints under the error (e.g. the overload that failed and why)
}

export function runTsc(workDir: string): { errors: TscError[]; raw: string } {
  const r = spawnSync(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false"], { cwd: workDir, encoding: "utf8", maxBuffer: 1 << 26 });
  const raw = (r.stdout ?? "") + (r.stderr ?? "");
  const errors: TscError[] = [];
  for (const l of raw.split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/.exec(l);
    if (m) errors.push({ file: m[1]!.replace(/\\/g, "/"), line: Number(m[2]), code: m[3]!, msg: m[4]!, detail: "" });
    else if (/^\s+\S/.test(l) && errors.length) errors[errors.length - 1]!.detail += (errors[errors.length - 1]!.detail ? "\n" : "") + l.trim();
  }
  if (!errors.length && r.status !== 0 && !/error TS/.test(raw)) throw new Error("tsc failed without diagnostics:\n" + raw);
  return { errors, raw };
}

export interface TestResult {
  title: string;
  status: string;
  message: string;
}

export function runVitest(workDir: string, outFile: string): { tests: TestResult[]; raw: string; since: string } {
  const since = new Date(Date.now() - 2000).toISOString();
  const r = spawnSync(
    process.execPath,
    ["node_modules/vitest/vitest.mjs", "run", "test/exp1.test.ts", "--reporter=json", `--outputFile=${outFile}`, "--testTimeout=20000", "--hookTimeout=60000"],
    { cwd: workDir, encoding: "utf8", maxBuffer: 1 << 26, timeout: 600_000 },
  );
  const raw = (r.stdout ?? "") + (r.stderr ?? "");
  if (!existsSync(outFile)) throw new Error("vitest produced no JSON:\n" + raw.slice(-3000));
  const j = JSON.parse(readFileSync(outFile, "utf8"));
  const tests: TestResult[] = [];
  for (const f of j.testResults ?? []) {
    if (f.status === "failed" && !(f.assertionResults ?? []).length) tests.push({ title: "(file failed to load)", status: "failed", message: String(f.message ?? "").slice(0, 600) });
    for (const a of f.assertionResults ?? []) tests.push({ title: a.title, status: a.status, message: String((a.failureMessages ?? []).join("\n")).split("\n").filter((l: string) => l.trim() && !/STACK_TRACE_ERROR/.test(l)).slice(0, 3).join(" | ").slice(0, 400) });
  }
  return { tests, raw, since };
}

/** Which Experiment 1 query a test title belongs to (the RLS and EXPLAIN tests are not part of the scored queries). */
export function testQuery(title: string): "Q1" | "Q2" | "Q3" | "Q4" | "RLS" | "EXPLAIN" {
  if (/^RLS|RLS check|zero rows with no tenant/i.test(title)) return "RLS";
  if (/^EXPLAIN/i.test(title)) return "EXPLAIN";
  const m = /^(Q[1-4])/.exec(title);
  if (m) return m[1] as "Q1";
  throw new Error("unmapped test title: " + title);
}

export type Verdict = "compile" | "runtime" | "undetected";

export interface RefResult extends Ref {
  verdict: Verdict;
  evidence: string;
}

/** A statement the database rejected while the tests ran, taken from the server log (ERROR plus STATEMENT). */
export interface DbError {
  error: string;
  statement: string;
  fn: string | null; // which Experiment 1 query function the statement belongs to, by its SQL shape
}

/** The query function a logged statement belongs to (null for the tests' own SQL). Works for both arms' generated SQL. */
export function fnOfStatement(st: string): string | null {
  if (/with recursive/i.test(st)) return "graphHops";
  if (/skip locked/i.test(st)) return "claimJobs";
  if (/make_interval/i.test(st)) return "retryJob";
  if (/ts_headline/i.test(st)) return "searchSegments";
  if (/full join/i.test(st)) return "hybridSearch";
  if (/^\s*update\s+"job"/i.test(st)) return "completeJob";
  return null;
}

/** Statements Postgres rejected since `sinceIso` because a column or relation does not exist. */
export function dbErrorsSince(sinceIso: string): DbError[] {
  const r = spawnSync("docker", ["logs", "--since", sinceIso, "db-tooling-db-1"], { encoding: "utf8", maxBuffer: 1 << 28, env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  const lines = ((r.stdout ?? "") + (r.stderr ?? "")).split(/\r?\n/);
  const out: DbError[] = [];
  let cur: { error?: string; statement?: string; pid?: string } | null = null;
  const flush = () => {
    if (cur?.error && cur.statement && /does not exist/.test(cur.error)) out.push({ error: cur.error, statement: cur.statement, fn: fnOfStatement(cur.statement) });
    cur = null;
  };
  for (const l of lines) {
    const m = /^\d{4}-\d\d-\d\d \S+ \S+ \[(\d+)\] (ERROR|STATEMENT|HINT|LOG|DETAIL|CONTEXT|FATAL|WARNING):\s+(.*)$/.exec(l);
    if (m) {
      if (m[2] === "ERROR") {
        flush();
        cur = { error: m[3]!, pid: m[1] };
      } else if (m[2] === "STATEMENT" && cur && cur.pid === m[1]) cur.statement = m[3]!;
      else if (m[2] !== "HINT" && m[2] !== "DETAIL" && m[2] !== "CONTEXT") flush();
    } else if (cur?.statement !== undefined && /^\s/.test(l)) cur.statement += " " + l.trim();
  }
  flush();
  return out;
}

/**
 * Classify every reference of one renamed column.
 *   compile    tsc reported an error on the reference's line in src/exp1.ts
 *   runtime    no tsc error there, but a test of the same query failed. evidence says whether the database was seen
 *              rejecting a statement of this very function ("observed") or not ("inferred": the test stopped at an earlier
 *              failure, or Postgres reports only the first bad column of a statement)
 *   undetected no tsc error and the query's tests pass: the stale reference was not noticed
 */
const FN_Q: Record<string, string> = { graphHops: "Q1", searchSegments: "Q2", hybridSearch: "Q3", claimJobs: "Q4", completeJob: "Q4", retryJob: "Q4" };

export function classifyRefs(refs: Ref[], tsc: TscError[], tests: TestResult[], srcFile: string, dbErrors: DbError[] = []): RefResult[] {
  const srcErrs = tsc.filter((e) => e.file.endsWith(srcFile));
  return refs.map((r) => {
    const here = srcErrs.filter((e) => e.line === r.line);
    if (here.length) return { ...r, verdict: "compile", evidence: `${here[0]!.code} at L${r.line}` };
    const failed = tests.filter((t) => t.status === "failed" && testQuery(t.title) === r.q);
    if (failed.length) {
      const seen = dbErrors.find((e) => e.fn === r.fn);
      if (seen) return { ...r, verdict: "runtime", evidence: `observed: ${seen.error}` };
      const sameQuery = dbErrors.find((e) => e.fn !== null && FN_Q[e.fn] === r.q);
      if (sameQuery) return { ...r, verdict: "runtime", evidence: `inferred: another statement of ${r.q} (${sameQuery.fn}) was rejected (${sameQuery.error}); this function's own statement was not seen, the test probably stopped before it` };
      // The test failed, but no statement of any Experiment 1 query function was rejected: the failure comes from the test's own SQL.
      return { ...r, verdict: "undetected", evidence: `${r.q} test fails only in the test's own verification SQL; no statement of ${r.fn} was rejected by the database` };
    }
    return { ...r, verdict: "undetected", evidence: `tests of ${r.q} pass` };
  });
}

export function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

/** Docker helper for quick psql statements against the spike database container (used only for diagnostics). */
export function psql(db: string, sql: string, user = "postgres"): string {
  return execFileSync("docker", ["exec", "db-tooling-db-1", "psql", "-U", user, "-d", db, "-Atc", sql], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
}

export function listDir(d: string): string[] {
  return readdirSync(d);
}
