// Helpers for the T7-tamper / T9 / T10 tests. These drive the graphile-migrate *CLI* in a child
// process, for two reasons: the CLI is the runner's real entry point (its output is what T9 asks us
// to record), and graphile-migrate calls process.exit(1) when its pool loses a connection, which is
// exactly what T10 does on purpose and would otherwise kill the Vitest worker.
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { calculateHash } from "graphile-migrate/dist/hash.js";
import { url, SHADOW_DB } from "../src/config.ts";
import { ARM_DIR, MIGRATIONS_DIR } from "../src/migrate.ts";

export interface GmResult {
  code: number | null;
  out: string;
}

/** A scratch migrations folder (.tmp/<name>) holding a copy of the real committed chain (M1..M3). */
export async function scratchFolder(name: string): Promise<string> {
  const folder = join(ARM_DIR, ".tmp", name);
  await rm(folder, { recursive: true, force: true });
  await mkdir(join(folder, "committed"), { recursive: true });
  for (const f of (await readdir(join(MIGRATIONS_DIR, "committed"))).filter((f) => f.endsWith(".sql"))) {
    await copyFile(join(MIGRATIONS_DIR, "committed", f), join(folder, "committed", f));
  }
  await writeFile(join(folder, "current.sql"), "");
  return folder;
}

export async function writeConfig(folder: string, database: string): Promise<string> {
  const cfg = {
    connectionString: url("skal_migrator", database),
    shadowConnectionString: url("skal_migrator", SHADOW_DB),
    rootConnectionString: url("postgres", "postgres"),
    migrationsFolder: folder,
    // resolved as `${migrationsFolder}/${file}`; the scratch folder is ARM/.tmp/<name>
    afterReset: [{ _: "sql", file: "../../db/bootstrap-extensions.sql", root: true }],
  };
  const path = join(folder, "gmrc.json");
  await writeFile(path, JSON.stringify(cfg, null, 2));
  return path;
}

const CLI = join(ARM_DIR, "node_modules", "graphile-migrate", "dist", "cli.js");

export function startGm(configPath: string, args: string[]): { done: Promise<GmResult> } {
  const child = spawn(process.execPath, [CLI, ...args, "--config", configPath], { cwd: ARM_DIR });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const done = new Promise<GmResult>((resolve) => child.on("close", (code) => resolve({ code, out })));
  return { done };
}

export function runGm(configPath: string, args: string[]): Promise<GmResult> {
  return startGm(configPath, args).done;
}

export async function committedFiles(folder: string): Promise<string[]> {
  return (await readdir(join(folder, "committed"))).filter((f) => f.endsWith(".sql")).sort();
}

/** Write a committed migration the way `commit` would (same hash function), chained onto the last file. */
export async function writeCommitted(folder: string, number: string, slug: string, body: string): Promise<string> {
  const files = (await committedFiles(folder)).filter((f) => f < number);
  const last = files[files.length - 1]!;
  const prev = /^--! Hash: (\S+)$/m.exec(await readFile(join(folder, "committed", last), "utf8"))![1]!;
  const text = `--! Previous: ${prev}\n--! Hash: ${calculateHash(body, prev)}\n--! Message: ${slug}\n\n${body}`;
  const name = `${number}-${slug}.sql`;
  await rm(join(folder, "committed", name), { force: true });
  await writeFile(join(folder, "committed", name), text);
  return name;
}

export async function root<T>(fn: (c: pg.Client) => Promise<T>, database = "postgres"): Promise<T> {
  const c = new pg.Client({ connectionString: url("postgres", database) });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Poll until `probe` returns a truthy value (or time out). */
export async function waitFor<T>(what: string, probe: () => Promise<T | undefined | false>, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

export async function indexState(database: string, index: string): Promise<{ valid: boolean; ready: boolean } | null> {
  return root(async (c) => {
    const { rows } = await c.query<{ indisvalid: boolean; indisready: boolean }>(
      "select indisvalid, indisready from pg_index where indexrelid = to_regclass($1)",
      [index],
    );
    const r = rows[0];
    return r ? { valid: r.indisvalid, ready: r.indisready } : null;
  }, database);
}

export async function appliedFiles(database: string): Promise<string[]> {
  return root(async (c) => {
    const { rows } = await c.query<{ filename: string }>("select filename from graphile_migrate.migrations order by filename");
    return rows.map((r) => r.filename);
  }, database);
}

/** Test-run evidence goes to a file under reports/ (Vitest hides stdout of passing tests). */
export function makeNote(file: string): (text: string) => void {
  const path = join(ARM_DIR, "reports", file);
  writeFileSync(path, "");
  return (text) => appendFileSync(path, text.replace(/\r/g, "").replace(/\n    at [^\n]*/g, "") + "\n\n");
}
