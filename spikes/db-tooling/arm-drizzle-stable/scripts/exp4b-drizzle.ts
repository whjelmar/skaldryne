// Experiment 4b (type safety under a rename), Drizzle arm.
// Usage: node scripts/exp4b-drizzle.ts            (from arm-drizzle-stable/)
//   EXP4B_ONLY=job.state,entity.id   run only these columns (debugging)
//   EXP4B_VARIANTS=D2,D1             variants to run (default both)
//   EXP4B_WORK=<dir>                 work directory (default: <tmp>/exp4b-drizzle)
//
// What it does (see ../../EXPERIMENTS.md, Experiment 4, 4b):
//  1. copies this arm into a work directory (the arm itself is never modified) and patches only the database names
//     (exp1_drizzle / exp1_main -> rename_drizzle / rename_main_d);
//  2. builds the template database rename_main_d from the same SQL as reference/build-exp1.sh;
//  3. enumerates every column reference in src/exp1.ts (property accesses on the table objects, including those inside
//     sql`` templates, plus the keys of .set({...})), and maps each to its database column;
//  4. for each of the 25 columns, and for each variant:
//       D2 (primary)       the TypeScript property and the database column are renamed (schema key and name string, plus every
//                          schema-internal use of the property), the database column is renamed to match;
//       D1 (supplementary) only the database column name string in the schema and the database column are renamed;
//     then runs tsc --noEmit and test/exp1.test.ts, classifies every reference, reverts fully, and re-runs tsc + tests.
// Output: ../exp4b-results/drizzle.json
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";
import { SPIKE_DIR, classifyRefs, dbErrorsSince, type DbError, makeWorkCopy, runTsc, runVitest, type Ref, type RefResult, type TscError } from "../../reference/exp4b-common.mts";

const ARM_DIR = resolve(import.meta.dirname, "..");
const KYSELY_DIR = resolve(ARM_DIR, "..", "arm-kysely-stable");
const PW = { postgres: "postgres", skal_migrator: "migrator" } as const;
const urlOf = (user: keyof typeof PW, db: string) => `postgres://${user}:${PW[user]}@localhost:55432/${db}`;
const TEMPLATE = "rename_main_d";
const WORK = process.env.EXP4B_WORK ?? join(tmpdir(), "exp4b-drizzle");
const SRC = "src/exp1.ts";
const SUFFIX = "_r";

// ---------------------------------------------------------------------------------------------------------------
// Reference enumeration. A reference is an occurrence of <tableObject>.<property> in src/exp1.ts, or a key of a .set({...}).
// ---------------------------------------------------------------------------------------------------------------
interface TableInfo {
  table: string; // database table
  tableVar: string; // identifier of the table object in the schema files
  props: Record<string, string>; // property -> database column
}
const TABLES: Record<string, TableInfo> = {
  claimCurrent: { table: "claim_current", tableVar: "claimCurrent", props: { subjectId: "subject_id", object: "object", tenantId: "tenant_id" } },
  entity: { table: "entity", tableVar: "entity", props: { tenantId: "tenant_id", id: "id", displayName: "display_name" } },
  s: { table: "transcript_segment", tableVar: "transcriptSegment", props: { id: "id", sessionNo: "session_no", startMs: "start_ms", tsv: "tsv", text: "text", tenantId: "tenant_id", campaignId: "campaign_id" } },
  e: { table: "segment_embedding", tableVar: "segmentEmbedding", props: { tenantId: "tenant_id", segmentId: "segment_id", embedding: "embedding" } },
  job: { table: "job", tableVar: "job", props: { tenantId: "tenant_id", id: "id", kind: "kind", payload: "payload", state: "state", runAfter: "run_after", attempts: "attempts", lockedBy: "locked_by", lockedAt: "locked_at" } },
};
// The query functions of src/exp1.ts and their line ranges (as committed). `s` and `e` are aliases that exist only in Q2 and Q3.
const FUNCS: { q: Ref["q"]; fn: string; from: number; to: number; aliases: string[]; setLines: number[] }[] = [
  { q: "Q1", fn: "graphHops", from: 18, to: 49, aliases: ["claimCurrent", "entity"], setLines: [] },
  { q: "Q2", fn: "searchSegments", from: 53, to: 69, aliases: ["s"], setLines: [] },
  { q: "Q3", fn: "hybridSearch", from: 73, to: 105, aliases: ["s", "e"], setLines: [] },
  { q: "Q4", fn: "claimJobs", from: 109, to: 122, aliases: ["job"], setLines: [119] },
  { q: "Q4", fn: "completeJob", from: 126, to: 132, aliases: ["job"], setLines: [129] },
  { q: "Q4", fn: "retryJob", from: 136, to: 147, aliases: ["job"], setLines: [140, 141, 142, 143] },
];
const SET_KEYS = ["state", "lockedBy", "lockedAt", "attempts", "runAfter"];

/** For every character: true when it is code inside a ${...} of a template literal (i.e. inside a sql`` fragment's interpolation). */
function scan(src: string): { inInterp: boolean[]; inCode: boolean[] } {
  const inInterp = new Array<boolean>(src.length).fill(false);
  const inCode = new Array<boolean>(src.length).fill(false);
  type Mode = { kind: "code"; braces: number; interp: boolean } | { kind: "tpl" };
  const stack: Mode[] = [{ kind: "code", braces: 0, interp: false }];
  for (let i = 0; i < src.length; i++) {
    const top = stack[stack.length - 1]!;
    const c = src[i]!;
    if (top.kind === "tpl") {
      if (c === "\\") i++;
      else if (c === "`") stack.pop();
      else if (c === "$" && src[i + 1] === "{") {
        stack.push({ kind: "code", braces: 0, interp: true });
        i++;
      }
      continue;
    }
    // code
    inCode[i] = true;
    inInterp[i] = top.interp;
    if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") {
        inCode[i] = false;
        i++;
      }
    } else if (c === "'" || c === '"') {
      const q = c;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === "\\") i++;
        i++;
      }
    } else if (c === "`") stack.push({ kind: "tpl" });
    else if (c === "{") top.braces++;
    else if (c === "}") {
      if (top.braces === 0 && stack.length > 1) stack.pop();
      else top.braces--;
    }
  }
  return { inInterp, inCode };
}

function enumerateRefs(source: string): Ref[] {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (pos: number) => lineStarts.findIndex((s, k) => s <= pos && (k + 1 >= lineStarts.length || lineStarts[k + 1]! > pos)) + 1;
  const lines = source.split(/\r?\n/);
  const { inInterp, inCode } = scan(source);
  const refs: Ref[] = [];
  for (const f of FUNCS) {
    const re = /\b([A-Za-z_]\w*)\.([A-Za-z_]\w*)\b/g;
    for (const m of source.matchAll(re)) {
      const pos = m.index!;
      const line = lineOf(pos);
      if (line < f.from || line > f.to || !inCode[pos]) continue;
      const [, v, p] = m;
      if (!f.aliases.includes(v!)) continue;
      const info = TABLES[v!]!;
      const col = info.props[p!];
      if (!col) throw new Error(`unmapped property ${v}.${p} at L${line}`);
      refs.push({ q: f.q, fn: f.fn, table: info.table, col, line, form: inInterp[pos] ? "property-in-sql-template" : "property", snip: lines[line - 1]!.trim().slice(0, 60) });
    }
    for (const ln of f.setLines) {
      const text = lines[ln - 1]!;
      const base = lineStarts[ln - 1]!;
      const info = TABLES.job!;
      for (const m of text.matchAll(new RegExp(`\\b(${SET_KEYS.join("|")})\\s*:`, "g"))) {
        const pos = base + m.index!;
        if (inInterp[pos] || !inCode[pos]) continue;
        const col = info.props[m[1]!];
        if (!col) throw new Error("unmapped set key " + m[1]);
        refs.push({ q: f.q, fn: f.fn, table: info.table, col, line: ln, form: "set-key", snip: text.trim().slice(0, 60) });
      }
    }
  }
  return refs.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------------------------------------------
// Schema edits (done on in-memory copies of src/schema/*.ts; the files are restored afterwards).
// ---------------------------------------------------------------------------------------------------------------
function blockRanges(src: string, table: string): [number, number][] {
  const out: [number, number][] = [];
  const re = new RegExp(`pgTable\\(\\s*'${table}'`, "g");
  for (const m of src.matchAll(re)) {
    const open = m.index! + "pgTable".length;
    let depth = 0;
    let i = open;
    for (; i < src.length; i++) {
      const c = src[i]!;
      if (c === "'" || c === '"' || c === "`") {
        const q = c;
        i++;
        while (i < src.length && src[i] !== q) {
          if (src[i] === "\\") i++;
          i++;
        }
      } else if (c === "(") depth++;
      else if (c === ")" && --depth === 0) break;
    }
    out.push([open, i + 1]);
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function editSchema(files: Map<string, string>, table: string, col: string, prop: string, tableVar: string, variant: "D1" | "D2"): Map<string, string> {
  const out = new Map<string, string>();
  let defs = 0;
  const defRe = new RegExp(`\\b${prop}(\\s*:\\s*\\w+\\(\\s*)'${escapeRe(col)}'`);
  for (const [name, src0] of files) {
    let src = src0;
    // column definition (and, for D2, the t.<prop> uses inside the table's own callback), table-scoped
    for (const [a, b] of blockRanges(src, table).reverse()) {
      let block = src.slice(a, b);
      if (defRe.test(block)) {
        defs++;
        block = block.replace(defRe, variant === "D2" ? `${prop}R$1'${col}${SUFFIX}'` : `${prop}$1'${col}${SUFFIX}'`);
      }
      if (variant === "D2") block = block.replace(new RegExp(`\\b(t|table)\\.${prop}\\b`, "g"), `$1.${prop}R`);
      src = src.slice(0, a) + block + src.slice(b);
    }
    // entity.display_name is declared through defineSchema({ displayName: ... }) in m3.ts (the current schema), not inside the table block
    if (table === "entity" && col === "display_name" && name === "m3.ts" && defRe.test(src)) {
      defs++;
      src = src.replace(defRe, variant === "D2" ? `${prop}R$1'${col}${SUFFIX}'` : `${prop}$1'${col}${SUFFIX}'`);
    }
    // uses of the table object's property elsewhere in the schema (foreign keys of other tables, etc.)
    if (variant === "D2") src = src.replace(new RegExp(`\\b${tableVar}\\.${prop}\\b`, "g"), `${tableVar}.${prop}R`);
    out.set(name, src);
  }
  if (defs === 0) throw new Error(`no column definition found for ${table}.${col}`);
  return out;
}

function changedLines(before: Map<string, string>, after: Map<string, string>): { file: string; lines: number }[] {
  const res: { file: string; lines: number }[] = [];
  for (const [f, a] of before) {
    const b = after.get(f)!;
    if (a === b) continue;
    const al = a.split("\n");
    const bl = b.split("\n");
    res.push({ file: f, lines: bl.filter((l, i) => l !== al[i]).length });
  }
  return res;
}

// ---------------------------------------------------------------------------------------------------------------
async function withClient<T>(user: keyof typeof PW, db: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: urlOf(user, db) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function buildTemplate(): Promise<void> {
  await withClient("postgres", "postgres", async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${TEMPLATE} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${TEMPLATE} OWNER skal_migrator`);
  });
  const read = (p: string) => readFileSync(p, "utf8");
  // Same inputs as reference/build-exp1.sh (the canonical SQL for Experiment 1).
  await withClient("postgres", TEMPLATE, (c) => c.query(read(join(KYSELY_DIR, "db", "bootstrap-extensions.sql"))));
  const files = [
    ...["000001-m1-reference-schema.sql", "000002-m2-expand-display_name.sql", "000003-m3-contract-drop-name.sql"].map((f) => join(KYSELY_DIR, "migrations", "committed", f)),
    join(SPIKE_DIR, "reference", "exp1-m4.sql"),
    join(SPIKE_DIR, "reference", "exp1-fixture.sql"),
  ];
  await withClient("skal_migrator", TEMPLATE, async (c) => {
    for (const f of files) await c.query(read(f));
  });
}

async function alter(table: string, from: string, to: string): Promise<string> {
  const sql = `ALTER TABLE public.${table} RENAME COLUMN ${from} TO ${to};`;
  await withClient("skal_migrator", TEMPLATE, (c) => c.query(sql));
  return sql;
}

function patchWorkCopy(): void {
  const p = join(WORK, "test/exp1.test.ts");
  const before = readFileSync(p, "utf8");
  const after = before.replaceAll("exp1_drizzle", "rename_drizzle").replaceAll("TEMPLATE exp1_main", `TEMPLATE ${TEMPLATE}`);
  if (after === before) throw new Error("patch had no effect");
  writeFileSync(p, after);
}

const SCHEMA_DIR = () => join(WORK, "src", "schema");
function readSchema(): Map<string, string> {
  const m = new Map<string, string>();
  for (const f of readdirSync(SCHEMA_DIR()).filter((f) => f.endsWith(".ts"))) m.set(f, readFileSync(join(SCHEMA_DIR(), f), "utf8"));
  return m;
}
function writeSchema(m: Map<string, string>): void {
  for (const [f, s] of m) writeFileSync(join(SCHEMA_DIR(), f), s);
}

type Verdict = RefResult["verdict"] | "unaffected";
interface ColumnRun {
  column: string;
  variant: "D1" | "D2";
  migration: string;
  schemaEdit: { file: string; lines: number }[];
  tscErrors: TscError[];
  tests: { title: string; status: string; message: string }[];
  dbErrors: DbError[];
  refs: (Omit<RefResult, "verdict"> & { verdict: Verdict })[];
  revert: { schemaIdentical: boolean; tscClean: boolean; testsGreen: boolean };
}

async function main() {
  const source = readFileSync(join(ARM_DIR, SRC), "utf8");
  const refs = enumerateRefs(source);
  const columns = [...new Set(refs.map((r) => `${r.table}.${r.col}`))];
  console.log(`enumerated ${refs.length} references over ${columns.length} columns`);
  const only = process.env.EXP4B_ONLY?.split(",");
  const variants = (process.env.EXP4B_VARIANTS?.split(",") ?? ["D2", "D1"]) as ("D1" | "D2")[];
  makeWorkCopy(ARM_DIR, WORK);
  patchWorkCopy();
  await buildTemplate();
  mkdirSync(join(SPIKE_DIR, "exp4b-results"), { recursive: true });

  const pristine = readSchema();
  const baseTsc = runTsc(WORK);
  const baseVt = runVitest(WORK, join(WORK, "vt.json"));
  const baseline = { tscErrors: baseTsc.errors.length, tests: baseVt.tests.map((t) => `${t.status}: ${t.title}`) };
  console.log("baseline", JSON.stringify(baseline));
  if (baseTsc.errors.length || baseVt.tests.some((t) => t.status !== "passed")) throw new Error("baseline is not green; aborting\n" + baseTsc.raw + JSON.stringify(baseVt.tests, null, 1));

  const runs: ColumnRun[] = [];
  for (const variant of variants) {
    for (const column of columns) {
      if (only && !only.includes(column)) continue;
      const [table, col] = column.split(".") as [string, string];
      const info = Object.values(TABLES).find((t) => t.table === table)!;
      const prop = Object.entries(info.props).find(([, c]) => c === col)![0];
      const edited = editSchema(pristine, table, col, prop, info.tableVar, variant);
      const schemaEdit = changedLines(pristine, edited);
      const migration = await alter(table, col, col + SUFFIX);
      writeSchema(edited);
      const tsc = runTsc(WORK);
      const vt = runVitest(WORK, join(WORK, "vt.json"));
      const colRefs = refs.filter((r) => r.table === table && r.col === col);
      const dbErrors = dbErrorsSince(vt.since);
      const classified = classifyRefs(colRefs, tsc.errors, vt.tests, SRC, dbErrors).map((r) => {
        if (variant === "D1" && r.verdict === "undetected") return { ...r, verdict: "unaffected" as Verdict, evidence: "no stale reference: the code names the property, not the database column; tsc and tests pass" };
        return r as ColumnRun["refs"][number];
      });
      // revert
      writeSchema(pristine);
      await alter(table, col + SUFFIX, col);
      const schemaIdentical = [...pristine].every(([f, s]) => readFileSync(join(SCHEMA_DIR(), f), "utf8") === s);
      const tsc2 = runTsc(WORK);
      const vt2 = runVitest(WORK, join(WORK, "vt.json"));
      const revert = { schemaIdentical, tscClean: tsc2.errors.length === 0, testsGreen: vt2.tests.every((t) => t.status === "passed") };
      const n = (v: Verdict) => classified.filter((r) => r.verdict === v).length;
      console.log(`${variant} ${column}: ${colRefs.length} refs, compile ${n("compile")}, runtime ${n("runtime")}, undetected ${n("undetected")}, unaffected ${n("unaffected")}; tsc errors ${tsc.errors.length}; schema lines edited ${schemaEdit.map((s) => s.lines).join("+")}; revert ${JSON.stringify(revert)}`);
      runs.push({ column, variant, migration, schemaEdit, tscErrors: tsc.errors, tests: vt.tests, dbErrors, refs: classified, revert });
    }
  }
  const out = {
    arm: "drizzle",
    versions: { drizzleOrm: "0.45.4", typescript: "7.0.2", vitest: "5.x" },
    renameSuffix: SUFFIX,
    baseline,
    refCount: refs.length,
    allRefs: refs,
    columns: runs,
  };
  writeFileSync(join(SPIKE_DIR, "exp4b-results", only ? "drizzle.partial.json" : "drizzle.json"), JSON.stringify(out, null, 1));
}

if (!existsSync(join(ARM_DIR, "node_modules"))) throw new Error("run pnpm install in arm-drizzle-stable first");
await main();
