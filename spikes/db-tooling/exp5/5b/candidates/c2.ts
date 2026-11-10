// C2: build a second database from the Drizzle schema, then compare the two catalogs with one fixed SQL query.
// Two ways of building the second database: `drizzle-kit generate` + apply the SQL (c2), or `drizzle-kit push` (c2b).
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { run, url, withClient, CHECK_ROLE, DRIZZLE_KIT } from "../lib/env.ts";
import { catalogSnapshot, lineDiff } from "../lib/catalog.ts";
import { createDatabase, dropDatabase } from "../lib/databases.ts";
import type { Ctx, Outcome } from "./types.ts";

async function compare(ctx: Ctx, second: string, extraFacts: Record<string, unknown>): Promise<Outcome> {
  const left = await withClient(CHECK_ROLE, ctx.db, catalogSnapshot);
  const right = await withClient(CHECK_ROLE, second, catalogSnapshot);
  // '<' = only in the migrated database, '>' = only in the database built from the Drizzle schema
  return { findings: lineDiff(left, right), facts: extraFacts };
}

export async function c2(ctx: Ctx): Promise<Outcome> {
  const second = `${ctx.db}_b`;
  const genDir = join(ctx.dir, "c2-gen");
  await rm(genDir, { recursive: true, force: true });
  const gen = await run("node", [...DRIZZLE_KIT, "generate", "--config", "drizzle.config.ts"], { cwd: ctx.dir, env: { OUT: genDir } });
  if (gen.code !== 0) return { findings: [], error: `generate exit ${gen.code}: ${gen.stderr.slice(0, 300)}` };
  await createDatabase(second); // needs CREATEDB, plus a superuser for CREATE EXTENSION vector
  try {
    const sqlFile = (await readdir(genDir)).find((f) => f.endsWith(".sql"))!;
    const statements = (await readFile(join(genDir, sqlFile), "utf8")).split("--> statement-breakpoint");
    await withClient("skal_migrator", second, async (c) => {
      for (const s of statements) if (s.trim()) await c.query(s);
    });
    return await compare(ctx, second, {});
  } catch (e) {
    return { findings: [], error: String(e) };
  } finally {
    await dropDatabase(second);
  }
}

export async function c2b(ctx: Ctx): Promise<Outcome> {
  const second = `${ctx.db}_b`;
  await createDatabase(second);
  try {
    const push = await run("node", [...DRIZZLE_KIT, "push", "--config", "drizzle.config.ts", "--force"], {
      cwd: ctx.dir, env: { DATABASE_URL: url("skal_migrator", second) },
    });
    if (/error/i.test(push.stdout + push.stderr) && !/No changes/.test(push.stdout)) {
      return { findings: [], error: `push: ${(push.stdout + push.stderr).slice(-300)}` };
    }
    return await compare(ctx, second, { pushExit: push.code });
  } finally {
    await dropDatabase(second);
  }
}
