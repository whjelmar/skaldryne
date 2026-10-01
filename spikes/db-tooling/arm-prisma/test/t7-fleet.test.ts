import { beforeAll, describe, expect, it } from "vitest";
import { migratorUrl, recreateDatabase } from "../scripts/bootstrap.ts";
import { migrateFleet, readState, report } from "../scripts/fleet.ts";
import { prisma } from "../scripts/prisma-cli.ts";

const A = "prisma_fleet_a";
const B = "prisma_fleet_b";

beforeAll(async () => {
  for (const [db, ref] of [[A, "m1"], [B, "m2"]] as const) {
    await recreateDatabase(db);
    const r = prisma(["db", "migrate", "--db", migratorUrl(db), "--to", ref]);
    if (r.exitCode !== 0) throw new Error(`setup migrate ${db} --to ${ref}: ${JSON.stringify(r.envelope)}`);
  }
});

describe("T7 one script brings a mixed fleet to M3", () => {
  it("starts with one database at M1 and one at M2", async () => {
    expect((await readState(A)).label).toBe("M1");
    expect((await readState(B)).label).toBe("M2");
  });

  it("migrates both to M3 and reports each one's state", async () => {
    const rows = await migrateFleet([A, B]);
    console.log("T7 fleet report:\n" + report(rows));
    expect(rows.map((r) => [r.db, r.before.label, r.after.label, r.ok])).toEqual([
      [A, "M1", "M3", true],
      [B, "M2", "M3", true],
    ]);
    expect(rows[0]!.applied).toBe(2);
    expect(rows[1]!.applied).toBe(1);
    expect(rows[0]!.after.app).toBe(rows[1]!.after.app);
  });

  it("a second pass is a no-op on every database", async () => {
    const rows = await migrateFleet([A, B]);
    console.log("T7 second pass:\n" + report(rows));
    expect(rows.every((r) => r.ok && r.applied === 0)).toBe(true);
  });
});
