import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { fleet } from "../scripts/fleet.ts";
import { url } from "../src/config.ts";
import { bootstrapDatabase, migrateDatabase, MIGRATIONS_DIR, prefixFolder } from "../src/migrate.ts";

const A = "kysely_fleet_a";
const B = "kysely_fleet_b";
// Per-task databases are left in place (each run recreates them). Dropping them here with FORCE
// kills graphile-migrate's still-pooled connections, and its pool error handler calls process.exit(1).

async function headerHash(file: string): Promise<string> {
  const text = await readFile(join(MIGRATIONS_DIR, "committed", file), "utf8");
  return /^--! Hash: (\S+)$/m.exec(text)![1]!;
}

describe("T7", () => {
  it("T7 fleet: one script brings a database at M1 and one at M2 to M3 and reports identical state", async () => {
    await bootstrapDatabase(A);
    await bootstrapDatabase(B);
    await migrateDatabase(A, await prefixFolder("fleet-m1", 1));
    await migrateDatabase(B, await prefixFolder("fleet-m2", 2));

    const report = await fleet([A, B]);
    const m3 = await headerHash("000003-m3-contract-drop-name.sql");
    for (const r of report) {
      expect(r.applied.map((m) => m.filename)).toEqual([
        "000001.sql", // the recorded name is the migration number only
        "000002.sql",
        "000003.sql",
      ]);
      expect(r.head).toBe(m3);
    }
    expect(report[0]!.applied).toEqual(report[1]!.applied);
  });

  // Recorded for RESULTS.md: migrate trusts the graphile_migrate.migrations table. Once a database is
  // up to date, a tampered or wrong recorded hash is not detected by a further migrate run.
  it("FINDING: migrate does not re-verify the hashes of already-applied migrations", async () => {
    const c = new pg.Client({ connectionString: url("skal_migrator", A) });
    await c.connect();
    try {
      await c.query("update graphile_migrate.migrations set hash = 'sha1:tampered' where filename = '000003.sql'");
    } finally {
      await c.end();
    }
    const [r] = await fleet([A]);
    expect(r!.head).toBe("sha1:tampered"); // no error; the head hash is only as good as the table
  });
});
