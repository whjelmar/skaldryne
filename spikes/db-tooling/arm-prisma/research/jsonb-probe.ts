// Probe: is a jsonb string scalar decoded with a BYO pg.Pool and with a url binding?
import postgres from "@prisma/orm-postgres/runtime";
import pgvector from "@prisma/orm-extension-pgvector/runtime";
import pg from "pg";
import type { Contract } from "../prisma/contract.d.ts";
import contractJson from "../prisma/contract.json" with { type: "json" };
if (process.env.GLOBALJSON) { pg.types.setTypeParser(3802, (v: string) => v); pg.types.setTypeParser(114, (v: string) => v); }
const url = "postgresql://skal_migrator:migrator@localhost:55432/prisma_main";
for (const mode of ["url", "pg"] as const) {
  const pool = new pg.Pool({ connectionString: url, max: 1, ...(process.env.RAWJSON ? { types: { getTypeParser: (oid: number, fmt?: any) => (oid === 3802 || oid === 114 ? (v: string) => v : pg.types.getTypeParser(oid, fmt)) } } : {}) });
  const db = mode === "url" ? postgres<Contract>({ contractJson, url, extensions: [pgvector] }) : postgres<Contract>({ contractJson, pg: pool, extensions: [pgvector] });
  try { console.log(mode, JSON.stringify(await db.orm.public.ClaimCurrent.select("object").all())); }
  catch (e) { console.log(mode, "ERR", (e as Error).message); }
  await db.close(); await pool.end();
}
