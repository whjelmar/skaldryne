// Experiment 4b (type safety under a rename), Kysely arm.
// Usage: node scripts/exp4b-kysely.ts            (from arm-kysely-stable/)
//   EXP4B_ONLY=job.state,entity.id   run only these columns (debugging)
//   EXP4B_WORK=<dir>                 work directory (default: <tmp>/exp4b-kysely)
//
// What it does (see ../../EXPERIMENTS.md, Experiment 4, 4b):
//  1. copies this arm into a work directory (the arm itself is never modified), patches only the database names
//     (kysely14_/exp1_ -> rename_) and removes the destructive vitest globalSetup;
//  2. builds the template database rename_main from the same SQL as reference/build-exp1.sh;
//  3. for each of the 25 columns referenced by Q1-Q4: renames it in the database (ALTER TABLE ... RENAME COLUMN, which is the
//     body of the migration a developer would write), regenerates src/db/types-exp1.ts with kysely-codegen, runs
//     tsc --noEmit, runs test/exp1.test.ts, classifies every reference, reverts fully, and re-runs tsc + tests to prove the revert.
// Output: ../exp4b-results/kysely.json
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { ARM_DIR } from "../src/migrate.ts";
import { SPIKE_DIR, checkRefs, classifyRefs, dbErrorsSince, type DbError, makeWorkCopy, runTsc, runVitest, type Ref, type RefResult } from "../../reference/exp4b-common.mts";

const PW = { postgres: "postgres", skal_migrator: "migrator" } as const;
const urlOf = (user: keyof typeof PW, db: string) => `postgres://${user}:${PW[user]}@localhost:55432/${db}`;
const TEMPLATE = "rename_main";
const WORK = process.env.EXP4B_WORK ?? join(tmpdir(), "exp4b-kysely");
const SRC = "src/exp1.ts";
const TYPES = "src/db/types-exp1.ts";
const SUFFIX = "_r";

// ---------------------------------------------------------------------------------------------------------------
// The reference list. Line numbers are lines of src/exp1.ts as committed. form: t = column named in a typed string
// literal or typed callback argument, k = column named as an object key in .set({...}), r = column named in raw sql text.
// ---------------------------------------------------------------------------------------------------------------
type Form = "t" | "k" | "r";
const refs: Ref[] = [];
function R(q: Ref["q"], fn: string, table: string, col: string, form: Form, line: number, snip: string) {
  refs.push({ q, fn, table, col, form: { t: "typed-string", k: "typed-set-key", r: "raw-sql-text" }[form], line, snip });
}
const cc = "claim_current", en = "entity", ts = "transcript_segment", se = "segment_embedding", jb = "job";
// Q1 graphHops
for (const [form, line, snip] of [["t", 18, "c.subject_id as entity_id"], ["r", 20, "c.subject_id]"], ["t", 25, '"c.subject_id", "<>"'], ["t", 36, "c.subject_id as entity_id"], ["r", 38, "w.path || c.subject_id"], ["r", 41, "c.subject_id <> all"]] as const)
  R("Q1", "graphHops", cc, "subject_id", form, line, snip);
for (const [form, line, snip] of [["r", 20, "(c.object ->> 'entity')"], ["t", 23, '"c.object", "?"'], ["r", 24, "c.object ->> 'entity'"], ["t", 32, '"c.object", "?"'], ["r", 33, "c.object ->> 'entity'"]] as const)
  R("Q1", "graphHops", cc, "object", form, line, snip);
R("Q1", "graphHops", cc, "tenant_id", "t", 22, '"c.tenant_id"');
R("Q1", "graphHops", cc, "tenant_id", "t", 31, '"c.tenant_id"');
R("Q1", "graphHops", en, "tenant_id", "t", 48, '"e.tenant_id"');
R("Q1", "graphHops", en, "id", "t", 48, '"e.id"');
R("Q1", "graphHops", en, "display_name", "t", 49, '"e.display_name as displayName"');
// Q2 searchSegments
R("Q2", "searchSegments", ts, "id", "t", 73, '"s.id"');
R("Q2", "searchSegments", ts, "session_no", "t", 74, '"s.session_no as sessionNo"');
R("Q2", "searchSegments", ts, "start_ms", "t", 75, '"s.start_ms as startMs"');
R("Q2", "searchSegments", ts, "tsv", "t", 76, '"s.tsv"');
R("Q2", "searchSegments", ts, "text", "t", 77, '"s.text"');
R("Q2", "searchSegments", ts, "tenant_id", "t", 79, '"s.tenant_id"');
R("Q2", "searchSegments", ts, "campaign_id", "t", 80, '"s.campaign_id"');
R("Q2", "searchSegments", ts, "tsv", "t", 81, '"s.tsv", "@@"');
R("Q2", "searchSegments", ts, "session_no", "t", 83, '.orderBy("s.session_no")');
R("Q2", "searchSegments", ts, "start_ms", "t", 84, '.orderBy("s.start_ms")');
// Q3 hybridSearch
R("Q3", "hybridSearch", ts, "id", "t", 112, '"s.id"');
R("Q3", "hybridSearch", ts, "tsv", "t", 115, '"s.tsv"');
R("Q3", "hybridSearch", ts, "id", "t", 115, '.orderBy("s.id")');
R("Q3", "hybridSearch", ts, "tenant_id", "t", 120, '"s.tenant_id"');
R("Q3", "hybridSearch", ts, "campaign_id", "t", 121, '"s.campaign_id"');
R("Q3", "hybridSearch", ts, "tsv", "t", 122, '"s.tsv", "@@"');
R("Q3", "hybridSearch", ts, "tenant_id", "t", 129, 'onRef("s.tenant_id"');
R("Q3", "hybridSearch", se, "tenant_id", "t", 129, '"e.tenant_id")');
R("Q3", "hybridSearch", ts, "id", "t", 129, 'onRef("s.id"');
R("Q3", "hybridSearch", se, "segment_id", "t", 129, '"e.segment_id")');
R("Q3", "hybridSearch", se, "segment_id", "t", 131, '"e.segment_id as id"');
R("Q3", "hybridSearch", se, "embedding", "r", 134, "e.embedding <=>");
R("Q3", "hybridSearch", se, "segment_id", "t", 134, '.orderBy("e.segment_id")');
R("Q3", "hybridSearch", ts, "tenant_id", "t", 139, '"s.tenant_id"');
R("Q3", "hybridSearch", ts, "campaign_id", "t", 140, '"s.campaign_id"');
// Q4 claimJobs
R("Q4", "claimJobs", jb, "state", "k", 165, 'state: "running"');
R("Q4", "claimJobs", jb, "locked_by", "k", 166, "locked_by: worker");
R("Q4", "claimJobs", jb, "locked_at", "k", 167, "locked_at: eb.fn");
R("Q4", "claimJobs", jb, "attempts", "k", 168, 'attempts: eb("attempts"');
R("Q4", "claimJobs", jb, "attempts", "t", 168, 'eb("attempts", "+", 1)');
R("Q4", "claimJobs", jb, "tenant_id", "t", 173, '.select(["tenant_id", "id"])');
R("Q4", "claimJobs", jb, "id", "t", 173, '.select(["tenant_id", "id"])');
R("Q4", "claimJobs", jb, "state", "t", 174, '.where("state"');
R("Q4", "claimJobs", jb, "run_after", "t", 175, '.where("run_after"');
R("Q4", "claimJobs", jb, "run_after", "t", 176, '.orderBy("run_after")');
R("Q4", "claimJobs", jb, "id", "t", 177, '.orderBy("id")');
R("Q4", "claimJobs", jb, "tenant_id", "r", 181, "(tenant_id, id) in");
R("Q4", "claimJobs", jb, "id", "r", 181, "(tenant_id, id) in");
R("Q4", "claimJobs", jb, "id", "t", 183, '.returning(["id", "kind", "payload", "attempts"])');
R("Q4", "claimJobs", jb, "kind", "t", 183, '.returning(["id", "kind", "payload", "attempts"])');
R("Q4", "claimJobs", jb, "payload", "t", 183, '.returning(["id", "kind", "payload", "attempts"])');
R("Q4", "claimJobs", jb, "attempts", "t", 183, '.returning(["id", "kind", "payload", "attempts"])');
// Q4 completeJob
R("Q4", "completeJob", jb, "state", "k", 192, 'state: "done"');
R("Q4", "completeJob", jb, "locked_by", "k", 192, "locked_by: null");
R("Q4", "completeJob", jb, "locked_at", "k", 192, "locked_at: null");
R("Q4", "completeJob", jb, "id", "t", 193, '.where("id"');
R("Q4", "completeJob", jb, "locked_by", "t", 194, '.where("locked_by"');
R("Q4", "completeJob", jb, "id", "t", 195, '.returning(["id", "state"])');
R("Q4", "completeJob", jb, "state", "t", 195, '.returning(["id", "state"])');
// Q4 retryJob
R("Q4", "retryJob", jb, "state", "k", 205, "state: eb.case()");
R("Q4", "retryJob", jb, "attempts", "t", 205, '.when("attempts"');
R("Q4", "retryJob", jb, "run_after", "k", 206, "run_after: sql");
R("Q4", "retryJob", jb, "attempts", "r", 206, "make_interval(secs => 30 * attempts)");
R("Q4", "retryJob", jb, "locked_by", "k", 207, "locked_by: null");
R("Q4", "retryJob", jb, "locked_at", "k", 208, "locked_at: null");
R("Q4", "retryJob", jb, "id", "t", 210, '.where("id"');
R("Q4", "retryJob", jb, "locked_by", "t", 211, '.where("locked_by"');
R("Q4", "retryJob", jb, "id", "t", 212, '.returning(["id", "state", "attempts"])');
R("Q4", "retryJob", jb, "state", "t", 212, '.returning(["id", "state", "attempts"])');
R("Q4", "retryJob", jb, "attempts", "t", 212, '.returning(["id", "state", "attempts"])');

const columns = [...new Set(refs.map((r) => `${r.table}.${r.col}`))];

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
  await withClient("postgres", TEMPLATE, (c) => c.query(read(join(ARM_DIR, "db", "bootstrap-extensions.sql"))));
  const files = [
    ...["000001-m1-reference-schema.sql", "000002-m2-expand-display_name.sql", "000003-m3-contract-drop-name.sql"].map((f) => join(ARM_DIR, "migrations", "committed", f)),
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

function node(args: string[]): { status: number | null; out: string } {
  const r = spawnSync(process.execPath, args, { cwd: WORK, encoding: "utf8" });
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") };
}
const codegen = () => {
  const r = node(["scripts/codegen.ts", TEMPLATE, TYPES]);
  if (r.status !== 0) throw new Error("codegen failed: " + r.out);
};

function patchWorkCopy(): void {
  const edit = (rel: string, fn: (s: string) => string) => {
    const p = join(WORK, rel);
    const before = readFileSync(p, "utf8");
    const after = fn(before);
    if (after === before) throw new Error("patch had no effect: " + rel);
    writeFileSync(p, after);
  };
  edit("src/config.ts", (s) =>
    s.replace('database !== EXP1_DB)', 'database !== EXP1_DB && !database.startsWith("rename_"))').replace('"exp1_kysely"', '"rename_kysely"'));
  edit("test/exp1.test.ts", (s) => s.replace("TEMPLATE exp1_main", `TEMPLATE ${TEMPLATE}`));
  edit("vitest.config.ts", (s) => s.replace('globalSetup: ["test/global-setup.ts"],', ""));
}

// ---------------------------------------------------------------------------------------------------------------
interface ColumnRun {
  column: string;
  migration: string;
  tscErrors: { file: string; line: number; code: string; msg: string }[];
  tests: { title: string; status: string; message: string }[];
  dbErrors: DbError[];
  refs: RefResult[];
  revert: { typesIdentical: boolean; tscClean: boolean; testsGreen: boolean };
}

async function main() {
  checkRefs(readFileSync(join(ARM_DIR, SRC), "utf8"), refs);
  const only = process.env.EXP4B_ONLY?.split(",");
  makeWorkCopy(ARM_DIR, WORK);
  patchWorkCopy();
  await buildTemplate();
  mkdirSync(join(SPIKE_DIR, "exp4b-results"), { recursive: true });

  // Baseline: codegen from the unrenamed template must equal the committed types, and tsc + tests must be green.
  const committedTypes = readFileSync(join(ARM_DIR, TYPES), "utf8");
  codegen();
  const regenerated = readFileSync(join(WORK, TYPES), "utf8");
  const baselineTypesIdentical = regenerated === committedTypes;
  const baseTsc = runTsc(WORK);
  const baseVt = runVitest(WORK, join(WORK, "vt.json"));
  const baseline = {
    codegenMatchesCommitted: baselineTypesIdentical,
    tscErrors: baseTsc.errors.length,
    tests: baseVt.tests.map((t) => `${t.status}: ${t.title}`),
  };
  console.log("baseline", JSON.stringify(baseline));
  if (baseTsc.errors.length || baseVt.tests.some((t) => t.status !== "passed")) throw new Error("baseline is not green; aborting\n" + baseTsc.raw + JSON.stringify(baseVt.tests, null, 1));
  const baseTypes = regenerated;

  const runs: ColumnRun[] = [];
  for (const column of columns) {
    if (only && !only.includes(column)) continue;
    const [table, col] = column.split(".") as [string, string];
    const migration = await alter(table, col, col + SUFFIX);
    codegen();
    const tsc = runTsc(WORK);
    const vt = runVitest(WORK, join(WORK, "vt.json"));
    const colRefs = refs.filter((r) => r.table === table && r.col === col);
    const dbErrors = dbErrorsSince(vt.since);
    const classified = classifyRefs(colRefs, tsc.errors, vt.tests, SRC, dbErrors);
    // revert
    await alter(table, col + SUFFIX, col);
    codegen();
    const typesIdentical = readFileSync(join(WORK, TYPES), "utf8") === baseTypes;
    const tsc2 = runTsc(WORK);
    const vt2 = runVitest(WORK, join(WORK, "vt.json"));
    const revert = { typesIdentical, tscClean: tsc2.errors.length === 0, testsGreen: vt2.tests.every((t) => t.status === "passed") };
    const nCompile = classified.filter((r) => r.verdict === "compile").length;
    console.log(`${column}: ${colRefs.length} refs, compile ${nCompile}, runtime ${classified.filter((r) => r.verdict === "runtime").length}, undetected ${classified.filter((r) => r.verdict === "undetected").length}; tsc errors ${tsc.errors.length}; revert ${JSON.stringify(revert)}`);
    runs.push({ column, migration, tscErrors: tsc.errors, tests: vt.tests, dbErrors, refs: classified, revert });
  }
  const out = {
    arm: "kysely",
    versions: { kysely: "0.29.6", codegen: "kysely-codegen 0.20.0", typescript: "5.9.3", vitest: "4.1.11" },
    renameSuffix: SUFFIX,
    baseline,
    columns: runs,
  };
  writeFileSync(join(SPIKE_DIR, "exp4b-results", process.env.EXP4B_ONLY ? "kysely.partial.json" : "kysely.json"), JSON.stringify(out, null, 1));
}

await main();
