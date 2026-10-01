// Probe: with verifyMarker 'onFirstUse', does one query outside a transaction avoid the pool-of-1 deadlock?
import postgres from "@prisma/orm-postgres/runtime";
import pgvector from "@prisma/orm-extension-pgvector/runtime";
import pg from "pg";
import type { Contract } from "../prisma/contract.d.ts";
import contractJson from "../prisma/contract.json" with { type: "json" };
const pool = new pg.Pool({ connectionString: "postgresql://skal_app:app@localhost:55432/prisma_main", max: 1 });
const db = postgres<Contract>({ contractJson, pg: pool, extensions: [pgvector] });
const timeout = (ms: number) => new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms));
try {
  await Promise.race([db.orm.public.Tenant.first(), timeout(5000)]);
  console.log("warm-up ok");
  const n = await Promise.race([db.transaction(async (tx) => (await tx.orm.public.Tenant.all()).length), timeout(5000)]);
  console.log("transaction after warm-up ok", n);
  const u = await Promise.race([db.transaction(async (tx) => tx.orm.public.Tenant.where({ name: "nope" }).updateAll({ name: "x" })), timeout(5000)]);
  console.log("updateAll in tx ok", u);
  const one = await Promise.race([db.transaction(async (tx) => tx.orm.public.Tenant.where({ name: "nope" }).update({ name: "x" })), timeout(5000)]);
  console.log("single update in tx ok", one);
} catch (e) { console.log("FAIL", (e as Error).message); }
process.exit(0);
