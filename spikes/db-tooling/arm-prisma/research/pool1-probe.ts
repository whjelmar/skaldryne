// Probe: does the first use of a client inside db.transaction deadlock with a pool of size 1?
import postgres from "@prisma/orm-postgres/runtime";
import pgvector from "@prisma/orm-extension-pgvector/runtime";
import pg from "pg";
import type { Contract } from "../prisma/contract.d.ts";
import contractJson from "../prisma/contract.json" with { type: "json" };
const url = "postgresql://skal_app:app@localhost:55432/prisma_main";
const timeout = (ms: number) => new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms));
for (const verifyMarker of ["onFirstUse", false] as const) {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  const db = postgres<Contract>({ contractJson, pg: pool, extensions: [pgvector], verifyMarker });
  try {
    const n = await Promise.race([db.transaction(async (tx) => (await tx.orm.public.Tenant.all()).length), timeout(5000)]);
    console.log(`verifyMarker=${verifyMarker}: first use inside transaction ok, rows=${n}`);
  } catch (e) { console.log(`verifyMarker=${verifyMarker}: ${(e as Error).message}`); }
  pool.on("error", () => {});
  void db.close(); void pool.end();
}
process.exit(0);
