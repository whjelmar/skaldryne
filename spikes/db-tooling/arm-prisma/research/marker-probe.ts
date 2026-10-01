// Probe: what an M1-, M2- or M3-era client does against a database whose marker is M2.
import "temporal-polyfill/global";
import postgres from "@prisma/orm-postgres/runtime";
import pgvector from "@prisma/orm-extension-pgvector/runtime";
import pg from "pg";
import m1 from "../migrations/snapshots/b4c11737c4774575acc639908163c539bdba2997572ffa13f28883608db2f512/contract.json" with { type: "json" };
import m2 from "../migrations/snapshots/d2b00090b4fc868ad2942ade701084f42423ca169b03c25e745d202ade41d8ab/contract.json" with { type: "json" };
import m3 from "../prisma/contract.json" with { type: "json" };
const url = "postgresql://skal_app:app@localhost:55432/prisma_t5";
for (const [name, contractJson] of [["M1", m1], ["M2", m2], ["M3", m3]] as const) {
  for (const verifyMarker of ["onFirstUse", "onStartup", "always", false] as const) {
    const pool = new pg.Pool({ connectionString: url, max: 2 });
    try {
      const db = postgres<any>({ contractJson, pg: pool, extensions: [pgvector], verifyMarker: verifyMarker as any });
      const rows = await db.orm.public.Tenant.all();
      console.log(`${name} verifyMarker=${verifyMarker}: ok (${rows.length} rows)`);
      await db.close();
    } catch (e: any) {
      console.log(`${name} verifyMarker=${verifyMarker}: ${e.code ?? ""} ${String(e.message).split("\n")[0]}`);
    }
    await pool.end().catch(() => {});
  }
}
process.exit(0);
